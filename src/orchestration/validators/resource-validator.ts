/**
 * Resource Validator (INV-IN-007)
 *
 * Validates that requested resources are available and within limits.
 * Checks CPU, memory, storage, execution duration, and concurrency limits
 * against the tenant's resource pool.
 *
 * Implements INV-IN-007: Resource limits MUST be satisfiable
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3.3
 */

import type { SimulationPlan } from '../../types/plan.js';
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ResourcePool,
} from './types.js';
import { StateRepository, getSharedStateRepository } from '../../state/state-repository.js';

/**
 * Resource validation configuration options
 */
export interface ResourceValidatorOptions {
  /**
   * Whether to allow soft limit warnings (vs hard errors)
   */
  readonly allowSoftLimits?: boolean;

  /**
   * Percentage threshold for warning (0-1)
   * If resource usage is above this percentage of limit, warn
   */
  readonly warningThreshold?: number;

  /**
   * Whether to check tenant-specific limits
   */
  readonly checkTenantLimits?: boolean;

  /**
   * Tenant ID for tenant-specific limit checks
   */
  readonly tenantId?: string;

  /**
   * State repository for querying resource status
   */
  readonly stateRepository?: StateRepository;
}

const DEFAULT_OPTIONS: Required<Omit<ResourceValidatorOptions, 'tenantId' | 'stateRepository'>> = {
  allowSoftLimits: false,
  warningThreshold: 0.8,
  checkTenantLimits: true,
};

/**
 * Default resource pool limits
 */
export const DEFAULT_RESOURCE_POOL: ResourcePool = {
  availableCpu: 8,
  availableMemory: 16 * 1024 * 1024 * 1024, // 16GB
  availableStorage: 100 * 1024 * 1024 * 1024, // 100GB
  maxExecutionDuration: 24 * 60 * 60 * 1000, // 24 hours in ms
  maxConcurrentAgents: 100,
  maxTotalTokens: 10_000_000,
};

/**
 * Validates resource availability for a SimulationPlan
 *
 * From Pseudocode Section 3.3:
 * ```
 * FUNCTION validateResourceAvailability(plan: SimulationPlan): ValidationResult
 *   pool = queryResourcePool()  // from ruvvector-postgres
 *   errors = []
 *
 *   IF plan.executionConfig.resourceLimits.maxCpu > pool.availableCpu:
 *     errors.append(ValidationError(code="INSUFFICIENT_CPU"))
 *   IF plan.executionConfig.resourceLimits.maxMemory > pool.availableMemory:
 *     errors.append(ValidationError(code="INSUFFICIENT_MEMORY"))
 *   IF plan.executionConfig.resourceLimits.maxStorage > pool.availableStorage:
 *     errors.append(ValidationError(code="INSUFFICIENT_STORAGE"))
 *   IF plan.executionConfig.maxDuration > pool.maxExecutionDuration:
 *     errors.append(ValidationError(code="DURATION_EXCEEDED"))
 *
 *   RETURN ValidationResult(valid=errors.isEmpty(), errors=errors)
 * ```
 *
 * @param plan - The SimulationPlan to validate
 * @param resourcePool - Available resources to validate against
 * @param options - Optional validation configuration
 * @returns ValidationResult with resource availability status
 */
export function validateResourceAvailability(
  plan: SimulationPlan,
  resourcePool: ResourcePool = DEFAULT_RESOURCE_POOL,
  options: ResourceValidatorOptions = {}
): ValidationResult {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const limits = plan.executionConfig.resourceLimits;

  // Validate CPU limits
  if (limits.maxCpu !== undefined) {
    const cpuResult = validateCpuLimits(
      limits.maxCpu,
      resourcePool.availableCpu,
      config.warningThreshold,
      config.allowSoftLimits
    );
    errors.push(...cpuResult.errors);
    warnings.push(...cpuResult.warnings);
  }

  // Validate memory limits
  if (limits.maxMemory !== undefined) {
    const memResult = validateMemoryLimits(
      limits.maxMemory,
      resourcePool.availableMemory,
      config.warningThreshold,
      config.allowSoftLimits
    );
    errors.push(...memResult.errors);
    warnings.push(...memResult.warnings);
  }

  // Validate storage limits
  if (limits.maxStorage !== undefined) {
    const storageResult = validateStorageLimits(
      limits.maxStorage,
      resourcePool.availableStorage,
      config.warningThreshold,
      config.allowSoftLimits
    );
    errors.push(...storageResult.errors);
    warnings.push(...storageResult.warnings);
  }

  // Validate execution duration
  const durationResult = validateExecutionDuration(
    plan.executionConfig.maxDuration,
    resourcePool.maxExecutionDuration,
    config.warningThreshold,
    config.allowSoftLimits
  );
  errors.push(...durationResult.errors);
  warnings.push(...durationResult.warnings);

  // Validate concurrency limits
  if (limits.maxConcurrency !== undefined && resourcePool.maxConcurrentAgents !== undefined) {
    const concurrencyResult = validateConcurrencyLimits(
      limits.maxConcurrency,
      resourcePool.maxConcurrentAgents,
      config.warningThreshold,
      config.allowSoftLimits
    );
    errors.push(...concurrencyResult.errors);
    warnings.push(...concurrencyResult.warnings);
  }

  // Validate total token limits if specified
  if (limits.maxTokensTotal !== undefined && resourcePool.maxTotalTokens !== undefined) {
    const tokenResult = validateTokenLimits(
      limits.maxTokensTotal,
      resourcePool.maxTotalTokens,
      config.warningThreshold,
      config.allowSoftLimits
    );
    errors.push(...tokenResult.errors);
    warnings.push(...tokenResult.warnings);
  }

  // Validate tenant-specific limits if applicable
  if (config.checkTenantLimits && resourcePool.tenantLimits) {
    const tenantResult = validateTenantLimits(plan, resourcePool.tenantLimits);
    errors.push(...tenantResult.errors);
    warnings.push(...tenantResult.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'RESOURCE_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates CPU limits
 */
function validateCpuLimits(
  requested: number,
  available: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > available) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'CPU_SOFT_LIMIT_EXCEEDED',
        message: `Requested CPU (${requested}) exceeds available (${available}), execution may be throttled`,
        path: 'executionConfig.resourceLimits.maxCpu',
        context: { requested, available },
      });
    } else {
      errors.push({
        code: 'INSUFFICIENT_CPU',
        severity: 'ERROR',
        message: `Requested CPU (${requested}) exceeds available CPU (${available})`,
        path: 'executionConfig.resourceLimits.maxCpu',
        context: { requested, available },
      });
    }
  } else if (requested > available * warningThreshold) {
    warnings.push({
      code: 'CPU_HIGH_USAGE',
      message: `Requested CPU (${requested}) is above ${warningThreshold * 100}% of available (${available})`,
      path: 'executionConfig.resourceLimits.maxCpu',
      context: { requested, available, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates memory limits
 */
function validateMemoryLimits(
  requested: number,
  available: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > available) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'MEMORY_SOFT_LIMIT_EXCEEDED',
        message: `Requested memory (${formatBytes(requested)}) exceeds available (${formatBytes(available)})`,
        path: 'executionConfig.resourceLimits.maxMemory',
        context: { requested, available },
      });
    } else {
      errors.push({
        code: 'INSUFFICIENT_MEMORY',
        severity: 'ERROR',
        message: `Requested memory (${formatBytes(requested)}) exceeds available memory (${formatBytes(available)})`,
        path: 'executionConfig.resourceLimits.maxMemory',
        context: { requested, available },
      });
    }
  } else if (requested > available * warningThreshold) {
    warnings.push({
      code: 'MEMORY_HIGH_USAGE',
      message: `Requested memory (${formatBytes(requested)}) is above ${warningThreshold * 100}% of available`,
      path: 'executionConfig.resourceLimits.maxMemory',
      context: { requested, available, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates storage limits
 */
function validateStorageLimits(
  requested: number,
  available: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > available) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'STORAGE_SOFT_LIMIT_EXCEEDED',
        message: `Requested storage (${formatBytes(requested)}) exceeds available (${formatBytes(available)})`,
        path: 'executionConfig.resourceLimits.maxStorage',
        context: { requested, available },
      });
    } else {
      errors.push({
        code: 'INSUFFICIENT_STORAGE',
        severity: 'ERROR',
        message: `Requested storage (${formatBytes(requested)}) exceeds available storage (${formatBytes(available)})`,
        path: 'executionConfig.resourceLimits.maxStorage',
        context: { requested, available },
      });
    }
  } else if (requested > available * warningThreshold) {
    warnings.push({
      code: 'STORAGE_HIGH_USAGE',
      message: `Requested storage (${formatBytes(requested)}) is above ${warningThreshold * 100}% of available`,
      path: 'executionConfig.resourceLimits.maxStorage',
      context: { requested, available, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates execution duration limits
 */
function validateExecutionDuration(
  requested: number,
  maxAllowed: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > maxAllowed) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'DURATION_SOFT_LIMIT_EXCEEDED',
        message: `Requested duration (${formatDuration(requested)}) exceeds maximum (${formatDuration(maxAllowed)})`,
        path: 'executionConfig.maxDuration',
        context: { requested, maxAllowed },
      });
    } else {
      errors.push({
        code: 'DURATION_EXCEEDED',
        severity: 'ERROR',
        message: `Requested execution duration (${formatDuration(requested)}) exceeds maximum allowed (${formatDuration(maxAllowed)})`,
        path: 'executionConfig.maxDuration',
        context: { requested, maxAllowed },
      });
    }
  } else if (requested > maxAllowed * warningThreshold) {
    warnings.push({
      code: 'DURATION_HIGH',
      message: `Requested duration (${formatDuration(requested)}) is above ${warningThreshold * 100}% of maximum`,
      path: 'executionConfig.maxDuration',
      context: { requested, maxAllowed, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates concurrency limits
 */
function validateConcurrencyLimits(
  requested: number,
  maxAllowed: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > maxAllowed) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'CONCURRENCY_SOFT_LIMIT_EXCEEDED',
        message: `Requested concurrency (${requested}) exceeds maximum (${maxAllowed})`,
        path: 'executionConfig.resourceLimits.maxConcurrency',
        context: { requested, maxAllowed },
      });
    } else {
      errors.push({
        code: 'CONCURRENCY_EXCEEDED',
        severity: 'ERROR',
        message: `Requested concurrency (${requested}) exceeds maximum allowed (${maxAllowed})`,
        path: 'executionConfig.resourceLimits.maxConcurrency',
        context: { requested, maxAllowed },
      });
    }
  } else if (requested > maxAllowed * warningThreshold) {
    warnings.push({
      code: 'CONCURRENCY_HIGH',
      message: `Requested concurrency (${requested}) is above ${warningThreshold * 100}% of maximum`,
      path: 'executionConfig.resourceLimits.maxConcurrency',
      context: { requested, maxAllowed, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates token limits
 */
function validateTokenLimits(
  requested: number,
  maxAllowed: number,
  warningThreshold: number,
  allowSoftLimits: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (requested > maxAllowed) {
    if (allowSoftLimits) {
      warnings.push({
        code: 'TOKEN_SOFT_LIMIT_EXCEEDED',
        message: `Requested token limit (${requested.toLocaleString()}) exceeds maximum (${maxAllowed.toLocaleString()})`,
        path: 'executionConfig.resourceLimits.maxTokensTotal',
        context: { requested, maxAllowed },
      });
    } else {
      errors.push({
        code: 'TOKEN_LIMIT_EXCEEDED',
        severity: 'ERROR',
        message: `Requested token limit (${requested.toLocaleString()}) exceeds maximum allowed (${maxAllowed.toLocaleString()})`,
        path: 'executionConfig.resourceLimits.maxTokensTotal',
        context: { requested, maxAllowed },
      });
    }
  } else if (requested > maxAllowed * warningThreshold) {
    warnings.push({
      code: 'TOKEN_LIMIT_HIGH',
      message: `Requested token limit (${requested.toLocaleString()}) is above ${warningThreshold * 100}% of maximum`,
      path: 'executionConfig.resourceLimits.maxTokensTotal',
      context: { requested, maxAllowed, threshold: warningThreshold },
    });
  }

  return { errors, warnings };
}

/**
 * Validates tenant-specific resource limits
 */
function validateTenantLimits(
  plan: SimulationPlan,
  tenantLimits: NonNullable<ResourcePool['tenantLimits']>
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const limits = plan.executionConfig.resourceLimits;

  // Check tenant CPU quota
  if (limits.maxCpu !== undefined && limits.maxCpu > tenantLimits.cpuQuota) {
    errors.push({
      code: 'TENANT_CPU_QUOTA_EXCEEDED',
      severity: 'ERROR',
      message: `Requested CPU (${limits.maxCpu}) exceeds tenant quota (${tenantLimits.cpuQuota})`,
      path: 'executionConfig.resourceLimits.maxCpu',
      context: {
        tenantId: tenantLimits.tenantId,
        requested: limits.maxCpu,
        quota: tenantLimits.cpuQuota,
      },
    });
  }

  // Check tenant memory quota
  if (limits.maxMemory !== undefined && limits.maxMemory > tenantLimits.memoryQuota) {
    errors.push({
      code: 'TENANT_MEMORY_QUOTA_EXCEEDED',
      severity: 'ERROR',
      message: `Requested memory exceeds tenant quota`,
      path: 'executionConfig.resourceLimits.maxMemory',
      context: {
        tenantId: tenantLimits.tenantId,
        requested: limits.maxMemory,
        quota: tenantLimits.memoryQuota,
      },
    });
  }

  // Check tenant storage quota
  if (limits.maxStorage !== undefined && limits.maxStorage > tenantLimits.storageQuota) {
    errors.push({
      code: 'TENANT_STORAGE_QUOTA_EXCEEDED',
      severity: 'ERROR',
      message: `Requested storage exceeds tenant quota`,
      path: 'executionConfig.resourceLimits.maxStorage',
      context: {
        tenantId: tenantLimits.tenantId,
        requested: limits.maxStorage,
        quota: tenantLimits.storageQuota,
      },
    });
  }

  // Check tenant duration limit
  if (plan.executionConfig.maxDuration > tenantLimits.maxDuration) {
    errors.push({
      code: 'TENANT_DURATION_EXCEEDED',
      severity: 'ERROR',
      message: `Requested duration exceeds tenant limit`,
      path: 'executionConfig.maxDuration',
      context: {
        tenantId: tenantLimits.tenantId,
        requested: plan.executionConfig.maxDuration,
        limit: tenantLimits.maxDuration,
      },
    });
  }

  return { errors, warnings };
}

/**
 * Queries the current resource pool status from the state repository
 *
 * @param tenantId - Optional tenant ID for tenant-specific limits
 * @param stateRepository - State repository to query
 * @returns Promise resolving to ResourcePool
 */
export async function queryResourcePool(
  tenantId?: string,
  stateRepository?: StateRepository
): Promise<ResourcePool> {
  // For now, return default pool
  // In production, this would query ruvvector-postgres for actual resource status
  const repo = stateRepository ?? getSharedStateRepository();

  // TODO: Implement actual resource pool querying from ruvvector-postgres
  // This would involve:
  // 1. Querying current resource usage
  // 2. Calculating available resources
  // 3. Fetching tenant-specific limits if tenantId provided

  return {
    ...DEFAULT_RESOURCE_POOL,
    tenantLimits: tenantId
      ? {
          tenantId,
          cpuQuota: 4,
          memoryQuota: 8 * 1024 * 1024 * 1024, // 8GB
          storageQuota: 50 * 1024 * 1024 * 1024, // 50GB
          maxDuration: 12 * 60 * 60 * 1000, // 12 hours
        }
      : undefined,
  };
}

/**
 * Estimates resource requirements from a plan
 *
 * @param plan - The plan to analyze
 * @returns Estimated resource requirements
 */
export function estimateResourceRequirements(plan: SimulationPlan): {
  estimatedCpu: number;
  estimatedMemory: number;
  estimatedStorage: number;
  estimatedDuration: number;
  estimatedTokens: number;
} {
  const stepCount = countTotalSteps(plan.workflow.steps);
  const agentCount = plan.agents.length;
  const integrationCount = plan.integrations.length;

  // Simple estimation heuristics
  const estimatedCpu = Math.ceil(agentCount * 0.5);
  const estimatedMemory = agentCount * 512 * 1024 * 1024; // 512MB per agent
  const estimatedStorage = stepCount * 10 * 1024 * 1024; // 10MB per step
  const estimatedDuration = stepCount * 30_000; // 30 seconds per step average
  const estimatedTokens = agentCount * 100_000; // 100K tokens per agent

  return {
    estimatedCpu,
    estimatedMemory,
    estimatedStorage,
    estimatedDuration,
    estimatedTokens,
  };
}

/**
 * Counts total steps including sub-steps
 */
function countTotalSteps(steps: SimulationPlan['workflow']['steps']): number {
  let count = 0;
  for (const step of steps) {
    count++;
    if (step.subSteps && step.subSteps.length > 0) {
      count += countTotalSteps(step.subSteps);
    }
  }
  return count;
}

/**
 * Formats bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Formats duration to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86400_000) return `${(ms / 3600_000).toFixed(1)}h`;
  return `${(ms / 86400_000).toFixed(1)}d`;
}
