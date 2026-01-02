/**
 * Validation Types for MOD-002 Validation Orchestrator
 *
 * Common type definitions used across all validator modules.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3
 */

import type { ISO8601Timestamp } from '../../types/common.js';

/**
 * Severity levels for validation errors
 */
export type ValidationSeverity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO';

/**
 * Validation error structure
 *
 * From Pseudocode Section 3:
 * ValidationError = {code, message, path, context}
 */
export interface ValidationError {
  /**
   * Error code for programmatic handling
   * Examples: 'PLAN_SCHEMA_INVALID', 'HASH_MISMATCH', 'CYCLE_DETECTED'
   */
  readonly code: string;

  /**
   * Severity level of the error
   */
  readonly severity: ValidationSeverity;

  /**
   * Human-readable error message
   */
  readonly message: string;

  /**
   * JSON path to the error location in the plan
   * Example: 'workflow.steps[0].agentRef'
   */
  readonly path?: string;

  /**
   * Additional context for debugging
   */
  readonly context?: Record<string, unknown>;
}

/**
 * Validation warning structure
 *
 * Warnings indicate potential issues that don't prevent execution
 */
export interface ValidationWarning {
  /**
   * Warning code for programmatic handling
   */
  readonly code: string;

  /**
   * Human-readable warning message
   */
  readonly message: string;

  /**
   * JSON path to the warning location
   */
  readonly path?: string;

  /**
   * Additional context for the warning
   */
  readonly context?: Record<string, unknown>;
}

/**
 * Validation phases corresponding to the validation pipeline
 */
export type ValidationPhase =
  | 'SCHEMA_VALIDATION'
  | 'SEMANTIC_VALIDATION'
  | 'RESOURCE_VALIDATION'
  | 'CONNECTIVITY_VALIDATION'
  | 'PRECONDITION_VALIDATION';

/**
 * Result of a single validation phase
 *
 * From Pseudocode Section 3:
 * ValidationResult = {valid, errors[], warnings[], phase}
 */
export interface ValidationResult {
  /**
   * Whether validation passed (no errors)
   */
  readonly valid: boolean;

  /**
   * List of validation errors
   */
  readonly errors: readonly ValidationError[];

  /**
   * List of validation warnings
   */
  readonly warnings: readonly ValidationWarning[];

  /**
   * The phase that produced this result
   */
  readonly phase: ValidationPhase;

  /**
   * When validation was performed
   */
  readonly validatedAt: ISO8601Timestamp;
}

/**
 * Full validation result combining all phases
 *
 * From Pseudocode Section 3:
 * FullValidationResult aggregates all phase results
 */
export interface FullValidationResult {
  /**
   * Overall validation status (all phases passed)
   */
  readonly valid: boolean;

  /**
   * Schema validation phase result
   */
  readonly schemaResult: ValidationResult;

  /**
   * Semantic validation phase result
   */
  readonly semanticResult: ValidationResult;

  /**
   * Resource validation phase result
   */
  readonly resourceResult: ValidationResult;

  /**
   * Connectivity validation phase result
   */
  readonly connectivityResult: ValidationResult;

  /**
   * Pre-condition evaluation phase result
   */
  readonly preConditionResult: ValidationResult;

  /**
   * Aggregated list of all errors across phases
   */
  readonly allErrors: readonly ValidationError[];

  /**
   * Aggregated list of all warnings across phases
   */
  readonly allWarnings: readonly ValidationWarning[];

  /**
   * When full validation completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total validation duration in milliseconds
   */
  readonly durationMs: number;
}

/**
 * Resource pool status for resource validation
 *
 * From Pseudocode Section 3.3:
 * Resource availability check against pool limits
 */
export interface ResourcePool {
  /**
   * Available CPU units
   */
  readonly availableCpu: number;

  /**
   * Available memory in bytes
   */
  readonly availableMemory: number;

  /**
   * Available storage in bytes
   */
  readonly availableStorage: number;

  /**
   * Maximum allowed execution duration in milliseconds
   */
  readonly maxExecutionDuration: number;

  /**
   * Maximum concurrent agents allowed
   */
  readonly maxConcurrentAgents?: number;

  /**
   * Maximum total tokens allowed
   */
  readonly maxTotalTokens?: number;

  /**
   * Tenant-specific limits (if applicable)
   */
  readonly tenantLimits?: TenantResourceLimits;
}

/**
 * Tenant-specific resource limits
 */
export interface TenantResourceLimits {
  /**
   * Tenant identifier
   */
  readonly tenantId: string;

  /**
   * CPU quota for the tenant
   */
  readonly cpuQuota: number;

  /**
   * Memory quota for the tenant
   */
  readonly memoryQuota: number;

  /**
   * Storage quota for the tenant
   */
  readonly storageQuota: number;

  /**
   * Maximum execution duration for the tenant
   */
  readonly maxDuration: number;
}

/**
 * Connectivity test result for a single integration
 */
export interface ConnectivityTestResult {
  /**
   * Whether connection was successful
   */
  readonly success: boolean;

  /**
   * Reason for failure (if applicable)
   */
  readonly reason?: string;

  /**
   * Any warnings from the connection test
   */
  readonly warnings?: readonly string[];

  /**
   * Connection latency in milliseconds (if successful)
   */
  readonly latencyMs?: number;

  /**
   * Additional connection metadata
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Interface for connectivity testing
 *
 * From Pseudocode Section 3.4:
 * Test connection for each integration
 */
export interface ConnectivityTester {
  /**
   * Test connection to an integration endpoint
   *
   * @param adapterType - Type of adapter (HTTP_REST, GRPC, etc.)
   * @param connectionSpec - Connection specification
   * @returns Promise resolving to connectivity test result
   */
  testConnection(
    adapterType: string,
    connectionSpec: Record<string, unknown>
  ): Promise<ConnectivityTestResult>;
}

/**
 * Pre-condition evaluation result
 */
export interface ConditionEvaluationResult {
  /**
   * Whether the condition passed
   */
  readonly passed: boolean;

  /**
   * Evaluation message/explanation
   */
  readonly message: string;

  /**
   * Evaluated value (if applicable)
   */
  readonly evaluatedValue?: unknown;

  /**
   * Condition expression that was evaluated
   */
  readonly expression?: string;
}

/**
 * Interface for condition evaluation
 *
 * From Pseudocode Section 3.5:
 * Evaluate pre-conditions from plan.validation.preConditions
 */
export interface ConditionEvaluator {
  /**
   * Evaluate a condition expression
   *
   * @param conditionType - Type of condition (EXPRESSION, STATE_CHECK, etc.)
   * @param expression - Condition expression to evaluate
   * @param context - Evaluation context
   * @returns Promise resolving to evaluation result
   */
  evaluate(
    conditionType: string,
    expression: string,
    context: Record<string, unknown>
  ): Promise<ConditionEvaluationResult>;
}

/**
 * Validator function type for single-phase validation
 */
export type SyncValidator<T> = (input: T) => ValidationResult;

/**
 * Async validator function type for phases requiring I/O
 */
export type AsyncValidator<T> = (input: T) => Promise<ValidationResult>;

/**
 * Helper to create an empty (successful) validation result
 */
export function createEmptyResult(phase: ValidationPhase): ValidationResult {
  return {
    valid: true,
    errors: [],
    warnings: [],
    phase,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Helper to create a failed validation result with a single error
 */
export function createErrorResult(
  phase: ValidationPhase,
  code: string,
  message: string,
  path?: string,
  context?: Record<string, unknown>
): ValidationResult {
  return {
    valid: false,
    errors: [
      {
        code,
        severity: 'ERROR',
        message,
        path,
        context,
      },
    ],
    warnings: [],
    phase,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Merges multiple validation results into a single result
 */
export function mergeResults(
  phase: ValidationPhase,
  ...results: ValidationResult[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const result of results) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase,
    validatedAt: new Date().toISOString(),
  };
}
