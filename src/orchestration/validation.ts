/**
 * Validation Orchestrator (MOD-002)
 *
 * Coordinates all validation activities for submitted SimulationPlans.
 * Ensures plans are syntactically valid, semantically complete, and
 * executable before acceptance.
 *
 * Implements:
 * - INV-IN-001: SimulationPlan MUST be syntactically valid
 * - INV-IN-002: SimulationPlan MUST be semantically complete
 * - INV-IN-003: SimulationPlan MUST have valid planHash
 * - INV-IN-005: All referenced agents MUST be resolvable
 * - INV-IN-006: All referenced integrations MUST be connectable
 * - INV-IN-007: Resource limits MUST be satisfiable
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Phase 1
 */

import { z } from 'zod';
import type { SimulationPlan } from '../types/plan.js';
import { SimulationPlanSchema } from '../types/plan.js';
import { computeObjectHash, verifyObjectHash } from '../core/hash-utils.js';
import type { SHA256Hash } from '../types/common.js';

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly details?: Record<string, unknown>;
}

export interface ValidationWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly phase: string;
}

export interface FullValidationResult {
  readonly valid: boolean;
  readonly schemaResult: ValidationResult;
  readonly semanticResult: ValidationResult;
  readonly resourceResult: ValidationResult;
  readonly connectivityResult: ValidationResult;
  readonly preConditionResult: ValidationResult;
}

// ============================================================================
// Schema Validation (INV-IN-001)
// ============================================================================

/**
 * Validate the SimulationPlan against its JSON schema
 * Enforces INV-IN-001: SimulationPlan MUST be syntactically valid
 */
export function validateSchema(plan: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    SimulationPlanSchema.parse(plan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        errors.push({
          code: 'SCHEMA_ERROR',
          message: issue.message,
          path: issue.path.join('.'),
          details: { zodCode: issue.code },
        });
      }
    } else {
      errors.push({
        code: 'SCHEMA_ERROR',
        message: 'Unknown schema validation error',
        details: { error: String(error) },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SCHEMA_VALIDATION',
  };
}

// ============================================================================
// Semantic Validation (INV-IN-002, INV-IN-003)
// ============================================================================

/**
 * Validate semantic completeness and integrity
 * Enforces:
 * - INV-IN-002: SimulationPlan MUST be semantically complete
 * - INV-IN-003: SimulationPlan MUST have valid planHash
 */
export function validateSemantics(plan: SimulationPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate hash integrity (INV-IN-003)
  const planWithoutHash = { ...plan, planHash: undefined };
  const computedHash = computeObjectHash(planWithoutHash);
  if (computedHash.toLowerCase() !== plan.planHash.toLowerCase()) {
    errors.push({
      code: 'HASH_MISMATCH',
      message: `Plan hash mismatch: expected ${plan.planHash}, computed ${computedHash}`,
      path: 'planHash',
    });
  }

  // Validate dependency graph is acyclic
  const cycleError = detectCycles(plan);
  if (cycleError) {
    errors.push(cycleError);
  }

  // Validate all step references exist
  const stepIds = new Set(plan.workflow.steps.map((s) => s.stepId));

  for (const dep of plan.workflow.dependencies.edges) {
    if (!stepIds.has(dep.from)) {
      errors.push({
        code: 'INVALID_REFERENCE',
        message: `Dependency references unknown step: ${dep.from}`,
        path: `workflow.dependencies.edges`,
      });
    }
    if (!stepIds.has(dep.to)) {
      errors.push({
        code: 'INVALID_REFERENCE',
        message: `Dependency references unknown step: ${dep.to}`,
        path: `workflow.dependencies.edges`,
      });
    }
  }

  // Validate agent references (INV-IN-005)
  const agentIds = new Set(plan.agents.map((a) => a.agentId));
  for (const step of plan.workflow.steps) {
    if (step.stepType === 'AGENT_INVOCATION' && step.agentRef) {
      if (!agentIds.has(step.agentRef)) {
        errors.push({
          code: 'INVALID_REFERENCE',
          message: `Step ${step.stepId} references unknown agent: ${step.agentRef}`,
          path: `workflow.steps.${step.stepId}.agentRef`,
        });
      }
    }
  }

  // Validate integration references
  const integrationIds = new Set(plan.integrations.map((i) => i.integrationId));
  for (const step of plan.workflow.steps) {
    if (step.stepType === 'INTEGRATION_CALL' && step.integrationRef) {
      if (!integrationIds.has(step.integrationRef)) {
        errors.push({
          code: 'INVALID_REFERENCE',
          message: `Step ${step.stepId} references unknown integration: ${step.integrationRef}`,
          path: `workflow.steps.${step.stepId}.integrationRef`,
        });
      }
    }
  }

  // Validate checkpoint references
  for (const checkpoint of plan.workflow.checkpoints) {
    if (!stepIds.has(checkpoint.stepRef)) {
      errors.push({
        code: 'INVALID_REFERENCE',
        message: `Checkpoint ${checkpoint.checkpointId} references unknown step: ${checkpoint.stepRef}`,
        path: `workflow.checkpoints.${checkpoint.checkpointId}.stepRef`,
      });
    }
  }

  // Validate agent invocation specs are complete
  for (const agent of plan.agents) {
    if (!agent.invocationSpec.modelId) {
      errors.push({
        code: 'INCOMPLETE_AGENT',
        message: `Agent ${agent.agentId} missing modelId`,
        path: `agents.${agent.agentId}.invocationSpec.modelId`,
      });
    }
    if (!agent.invocationSpec.promptTemplate) {
      errors.push({
        code: 'INCOMPLETE_AGENT',
        message: `Agent ${agent.agentId} missing promptTemplate`,
        path: `agents.${agent.agentId}.invocationSpec.promptTemplate`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
  };
}

/**
 * Detect cycles in the dependency graph
 */
function detectCycles(plan: SimulationPlan): ValidationError | null {
  const adjacency = new Map<string, string[]>();

  // Build adjacency list
  for (const step of plan.workflow.steps) {
    adjacency.set(step.stepId, []);
  }
  for (const dep of plan.workflow.dependencies.edges) {
    const deps = adjacency.get(dep.from);
    if (deps) {
      deps.push(dep.to);
    }
  }

  // DFS for cycle detection
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjacency.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) {
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const [stepId] of adjacency) {
    if (!visited.has(stepId)) {
      if (hasCycle(stepId)) {
        return {
          code: 'DEPENDENCY_CYCLE',
          message: 'Workflow dependency graph contains cycles',
          path: 'workflow.dependencies',
        };
      }
    }
  }

  return null;
}

// ============================================================================
// Resource Validation (INV-IN-007)
// ============================================================================

export interface ResourcePool {
  readonly availableCpu: number;
  readonly availableMemory: number;
  readonly availableStorage: number;
  readonly maxExecutionDuration: number;
}

/**
 * Validate resource availability
 * Enforces INV-IN-007: Resource limits MUST be satisfiable
 */
export function validateResourceAvailability(
  plan: SimulationPlan,
  resourcePool: ResourcePool
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const limits = plan.executionConfig.resourceLimits;

  if (limits.maxCpu !== undefined && resourcePool.availableCpu < limits.maxCpu) {
    errors.push({
      code: 'INSUFFICIENT_RESOURCES',
      message: `Insufficient CPU: need ${limits.maxCpu}, have ${resourcePool.availableCpu}`,
      path: 'executionConfig.resourceLimits.maxCpu',
    });
  }

  if (limits.maxMemory !== undefined && resourcePool.availableMemory < limits.maxMemory) {
    errors.push({
      code: 'INSUFFICIENT_RESOURCES',
      message: `Insufficient memory: need ${limits.maxMemory}, have ${resourcePool.availableMemory}`,
      path: 'executionConfig.resourceLimits.maxMemory',
    });
  }

  if (limits.maxStorage !== undefined && resourcePool.availableStorage < limits.maxStorage) {
    errors.push({
      code: 'INSUFFICIENT_RESOURCES',
      message: `Insufficient storage: need ${limits.maxStorage}, have ${resourcePool.availableStorage}`,
      path: 'executionConfig.resourceLimits.maxStorage',
    });
  }

  if (plan.executionConfig.maxDuration > resourcePool.maxExecutionDuration) {
    errors.push({
      code: 'DURATION_EXCEEDED',
      message: `maxDuration ${plan.executionConfig.maxDuration}ms exceeds limit ${resourcePool.maxExecutionDuration}ms`,
      path: 'executionConfig.maxDuration',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'RESOURCE_VALIDATION',
  };
}

// ============================================================================
// Connectivity Validation (INV-IN-006)
// ============================================================================

export interface ConnectivityTester {
  testConnection(
    adapterType: string,
    connectionSpec: Record<string, unknown>
  ): Promise<{ success: boolean; reason?: string; warnings?: string[] }>;
}

/**
 * Validate integration connectivity
 * Enforces INV-IN-006: All referenced integrations MUST be connectable
 */
export async function validateConnectivity(
  plan: SimulationPlan,
  tester: ConnectivityTester
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const integration of plan.integrations) {
    try {
      const result = await tester.testConnection(
        integration.adapterType,
        integration.connectionSpec as unknown as Record<string, unknown>
      );

      if (!result.success) {
        errors.push({
          code: 'CONNECTIVITY_ERROR',
          message: `Integration ${integration.integrationId} failed: ${result.reason}`,
          path: `integrations.${integration.integrationId}`,
        });
      }

      if (result.warnings) {
        for (const warning of result.warnings) {
          warnings.push({
            code: 'CONNECTIVITY_WARNING',
            message: warning,
            path: `integrations.${integration.integrationId}`,
          });
        }
      }
    } catch (error) {
      errors.push({
        code: 'CONNECTIVITY_ERROR',
        message: `Integration ${integration.integrationId} error: ${String(error)}`,
        path: `integrations.${integration.integrationId}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'CONNECTIVITY_VALIDATION',
  };
}

// ============================================================================
// Pre-Condition Evaluation
// ============================================================================

export interface ConditionEvaluator {
  evaluate(
    conditionType: string,
    expression: string,
    context: Record<string, unknown>
  ): Promise<{ passed: boolean; message: string }>;
}

/**
 * Evaluate all pre-conditions before execution begins
 */
export async function evaluatePreConditions(
  plan: SimulationPlan,
  evaluator: ConditionEvaluator,
  context: Record<string, unknown>
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const condition of plan.validation.preConditions) {
    const result = await evaluator.evaluate(condition.type, condition.expression, context);

    if (!result.passed && condition.required) {
      errors.push({
        code: 'PRECONDITION_FAILED',
        message: `Pre-condition ${condition.conditionId} failed: ${result.message}`,
        path: `validation.preConditions.${condition.conditionId}`,
      });
    } else if (!result.passed) {
      warnings.push({
        code: 'PRECONDITION_WARNING',
        message: `Optional pre-condition ${condition.conditionId} failed: ${result.message}`,
        path: `validation.preConditions.${condition.conditionId}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'PRECONDITION_VALIDATION',
  };
}

// ============================================================================
// Full Validation Pipeline
// ============================================================================

/**
 * Run the complete validation pipeline
 */
export async function validatePlan(
  plan: unknown,
  resourcePool: ResourcePool,
  connectivityTester: ConnectivityTester,
  conditionEvaluator: ConditionEvaluator,
  context: Record<string, unknown>
): Promise<FullValidationResult> {
  // Phase 1: Schema validation
  const schemaResult = validateSchema(plan);
  if (!schemaResult.valid) {
    return {
      valid: false,
      schemaResult,
      semanticResult: { valid: true, errors: [], warnings: [], phase: 'SEMANTIC_VALIDATION' },
      resourceResult: { valid: true, errors: [], warnings: [], phase: 'RESOURCE_VALIDATION' },
      connectivityResult: { valid: true, errors: [], warnings: [], phase: 'CONNECTIVITY_VALIDATION' },
      preConditionResult: { valid: true, errors: [], warnings: [], phase: 'PRECONDITION_VALIDATION' },
    };
  }

  const validPlan = plan as SimulationPlan;

  // Phase 2: Semantic validation
  const semanticResult = validateSemantics(validPlan);
  if (!semanticResult.valid) {
    return {
      valid: false,
      schemaResult,
      semanticResult,
      resourceResult: { valid: true, errors: [], warnings: [], phase: 'RESOURCE_VALIDATION' },
      connectivityResult: { valid: true, errors: [], warnings: [], phase: 'CONNECTIVITY_VALIDATION' },
      preConditionResult: { valid: true, errors: [], warnings: [], phase: 'PRECONDITION_VALIDATION' },
    };
  }

  // Phase 3: Resource validation
  const resourceResult = validateResourceAvailability(validPlan, resourcePool);
  if (!resourceResult.valid) {
    return {
      valid: false,
      schemaResult,
      semanticResult,
      resourceResult,
      connectivityResult: { valid: true, errors: [], warnings: [], phase: 'CONNECTIVITY_VALIDATION' },
      preConditionResult: { valid: true, errors: [], warnings: [], phase: 'PRECONDITION_VALIDATION' },
    };
  }

  // Phase 4: Connectivity validation
  const connectivityResult = await validateConnectivity(validPlan, connectivityTester);
  if (!connectivityResult.valid) {
    return {
      valid: false,
      schemaResult,
      semanticResult,
      resourceResult,
      connectivityResult,
      preConditionResult: { valid: true, errors: [], warnings: [], phase: 'PRECONDITION_VALIDATION' },
    };
  }

  // Phase 5: Pre-condition evaluation
  const preConditionResult = await evaluatePreConditions(validPlan, conditionEvaluator, context);

  return {
    valid: preConditionResult.valid,
    schemaResult,
    semanticResult,
    resourceResult,
    connectivityResult,
    preConditionResult,
  };
}
