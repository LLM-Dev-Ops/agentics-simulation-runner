/**
 * Failure Handler for Execution Error Management
 *
 * Handles step failures, determines appropriate recovery actions,
 * and manages rollback when necessary. Implements error severity
 * classification and recovery strategies.
 *
 * @module orchestration/failure-handler
 * @see SPARC_PSEUDOCODE.md Section 8 - Error Handling
 * @see SPARC_ARCHITECTURE.md MOD-004 - Execution Orchestrator
 * @see INV-EX-003 - Complete execution or rollback
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  Metadata,
} from '../types/common.js';

import type {
  ExecutionContext,
  Checkpoint,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
} from '../types/workflow.js';

import type {
  SimulationPlan,
  ExecutionConfig,
} from '../types/simulation-plan.js';

import type {
  StepResult,
} from '../types/simulation-result.js';

import type {
  ExecutionError,
  ErrorSeverity,
  FailureAction,
  FailureHandlingResult,
  RollbackResult,
} from './types.js';

import type { ExecutionCheckpointManager } from './checkpoint-manager.js';

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Error codes and their default severity mappings
 */
const ERROR_SEVERITY_MAP: Record<string, ErrorSeverity> = {
  // Recoverable errors - can retry or use fallback
  'TIMEOUT': 'RECOVERABLE',
  'RATE_LIMIT': 'RECOVERABLE',
  'NETWORK_ERROR': 'RECOVERABLE',
  'TEMPORARY_FAILURE': 'RECOVERABLE',
  'RESOURCE_BUSY': 'RECOVERABLE',
  'TRANSIENT_ERROR': 'RECOVERABLE',
  'RETRY_EXHAUSTED': 'RECOVERABLE',

  // Critical errors - need fallback or skip
  'STEP_FAILED': 'CRITICAL',
  'AGENT_ERROR': 'CRITICAL',
  'INTEGRATION_ERROR': 'CRITICAL',
  'VALIDATION_FAILED': 'CRITICAL',
  'PRECONDITION_FAILED': 'CRITICAL',
  'POSTCONDITION_FAILED': 'CRITICAL',
  'DEPENDENCY_FAILED': 'CRITICAL',

  // Fatal errors - must abort or rollback
  'INVARIANT_VIOLATED': 'FATAL',
  'RESOURCE_EXHAUSTED': 'FATAL',
  'DEADLINE_EXCEEDED': 'FATAL',
  'STATE_CORRUPTION': 'FATAL',
  'SECURITY_VIOLATION': 'FATAL',
  'UNRECOVERABLE_ERROR': 'FATAL',
  'SYSTEM_FAILURE': 'FATAL',
};

/**
 * Classify error severity based on error code and context
 */
export function classifyErrorSeverity(
  errorCode: string,
  step: WorkflowStep
): ErrorSeverity {
  // Check explicit mapping first
  if (errorCode in ERROR_SEVERITY_MAP) {
    return ERROR_SEVERITY_MAP[errorCode];
  }

  // If step is marked as critical, escalate non-fatal errors
  if (step.controlFlow?.onFailure === 'abort') {
    return 'FATAL';
  }

  // Default to critical for unknown errors
  return 'CRITICAL';
}

/**
 * Determine if an error is recoverable through retry
 */
export function isRetryableError(errorCode: string): boolean {
  const severity = ERROR_SEVERITY_MAP[errorCode];
  return severity === 'RECOVERABLE';
}

// =============================================================================
// Failure Handler
// =============================================================================

/**
 * Handler for execution failures
 *
 * Responsibilities:
 * - Classify error severity
 * - Determine appropriate recovery action
 * - Execute retry, fallback, skip, or rollback
 * - Track failure handling results
 */
export class FailureHandler {
  private readonly failureHistory: ExecutionError[] = [];

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan,
    private readonly checkpointManager: ExecutionCheckpointManager
  ) {}

  /**
   * Handle a step failure and determine recovery action
   *
   * Algorithm:
   * 1. Classify error severity
   * 2. Check step's control flow configuration
   * 3. If RECOVERABLE and retries available: RETRY
   * 4. If fallback step defined: FALLBACK
   * 5. If non-critical step: SKIP
   * 6. If critical/fatal: ROLLBACK or ABORT
   *
   * @param step - The step that failed
   * @param error - The error that occurred
   * @param retryAttempt - Current retry attempt number
   * @returns Failure handling result with action taken
   *
   * @see SPARC_PSEUDOCODE.md Section 8.1 - handleStepFailure
   */
  async handleStepFailure(
    step: WorkflowStep,
    error: Error,
    retryAttempt: number
  ): Promise<FailureHandlingResult> {
    const errorId = uuidv4() as UUID;
    const timestamp = new Date().toISOString() as ISO8601Timestamp;

    // Classify error severity
    const errorCode = this.extractErrorCode(error);
    const severity = classifyErrorSeverity(errorCode, step);

    // Create execution error record
    const executionError: ExecutionError = {
      errorId,
      stepId: step.id,
      errorCode,
      message: error.message,
      severity,
      stackTrace: error.stack,
      timestamp,
      recoverable: severity === 'RECOVERABLE',
      recoveryAttempted: false,
      context: { retryAttempt },
    };

    // Track error in history
    this.failureHistory.push(executionError);

    // Determine and execute recovery action
    return this.executeRecoveryAction(step, executionError, retryAttempt);
  }

  /**
   * Execute the appropriate recovery action
   */
  private async executeRecoveryAction(
    step: WorkflowStep,
    error: ExecutionError,
    retryAttempt: number
  ): Promise<FailureHandlingResult> {
    const controlFlow = step.controlFlow;

    // Check for retry possibility
    if (error.severity === 'RECOVERABLE') {
      const maxRetries = step.controlFlow?.onFailure === 'retry'
        ? this.plan.executionConfig.retryPolicy?.maxRetries ?? 3
        : 0;

      if (retryAttempt < maxRetries) {
        return this.createRetryResult(step, error);
      }
    }

    // Check for fallback step in metadata or control flow
    const planStep = this.findStepInPlan(step.id);
    const fallbackStep = planStep?.metadata?.fallbackStep as string | undefined;
    if (fallbackStep) {
      return this.createFallbackResult(step, error, fallbackStep);
    }

    // Check control flow configuration
    if (controlFlow) {
      switch (controlFlow.onFailure) {
        case 'abort':
          return this.createAbortResult(step, error);
        case 'complete':
          // Skip this step and continue
          return this.createSkipResult(step, error);
        default:
          // If it's a step ID, it's a fallback
          if (typeof controlFlow.onFailure === 'string') {
            return this.createFallbackResult(step, error, controlFlow.onFailure);
          }
      }
    }

    // Check if step is critical (from plan step metadata)
    const isCritical = planStep?.metadata?.critical as boolean | undefined;
    if (isCritical) {
      return this.createRollbackResult(step, error);
    }

    // For non-critical steps without specific handling, skip
    if (error.severity === 'CRITICAL') {
      return this.createSkipResult(step, error);
    }

    // Fatal errors trigger rollback
    return this.createRollbackResult(step, error);
  }

  /**
   * Execute a rollback to the last valid checkpoint
   *
   * @param reason - Reason for rollback
   * @returns Rollback result
   *
   * @see SPARC_PSEUDOCODE.md Section 8.2 - rollbackExecution
   * @see INV-EX-003 - Complete execution or rollback
   */
  async rollbackExecution(reason: string): Promise<RollbackResult> {
    const rolledBackAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // Get the latest checkpoint
      const latestCheckpoint = await this.checkpointManager.getLatestCheckpoint();

      if (!latestCheckpoint) {
        // No checkpoint available - cannot rollback
        return {
          success: false,
          checkpointId: '' as UUID,
          undoneStepIds: [],
          stateHash: '' as SHA256Hash,
          rolledBackAt,
          error: 'No checkpoint available for rollback',
        };
      }

      // Calculate steps that will be undone
      const undoneStepIds = this.calculateUndoneSteps(latestCheckpoint.sequenceNumber);

      // Restore to checkpoint
      const restored = await this.checkpointManager.restoreCheckpoint(
        this.ctx,
        latestCheckpoint.checkpointId
      );

      if (!restored) {
        return {
          success: false,
          checkpointId: latestCheckpoint.checkpointId,
          undoneStepIds: [],
          stateHash: '' as SHA256Hash,
          rolledBackAt,
          error: 'Failed to restore checkpoint',
        };
      }

      // Get state hash after rollback
      const stateHash = await this.ctx.stateNamespace.getStateHash();

      return {
        success: true,
        checkpointId: latestCheckpoint.checkpointId,
        undoneStepIds,
        stateHash,
        rolledBackAt,
      };
    } catch (error) {
      return {
        success: false,
        checkpointId: '' as UUID,
        undoneStepIds: [],
        stateHash: '' as SHA256Hash,
        rolledBackAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Abort execution immediately
   *
   * @param reason - Reason for abort
   *
   * @see SPARC_PSEUDOCODE.md Section 8.3 - abortExecution
   */
  async abortExecution(reason: string): Promise<void> {
    // Cancel the execution context
    await this.ctx.cancel(reason);

    // Emit abort telemetry
    this.ctx.telemetry.emitEvent('EXECUTION_ABORTED', {
      reason,
      timestamp: new Date().toISOString(),
      errorCount: this.failureHistory.length,
    });
  }

  /**
   * Get failure history
   */
  getFailureHistory(): readonly ExecutionError[] {
    return this.failureHistory;
  }

  /**
   * Get count of errors by severity
   */
  getErrorCountBySeverity(): Record<ErrorSeverity, number> {
    const counts: Record<ErrorSeverity, number> = {
      RECOVERABLE: 0,
      CRITICAL: 0,
      FATAL: 0,
    };

    for (const error of this.failureHistory) {
      counts[error.severity]++;
    }

    return counts;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Extract error code from error object
   */
  private extractErrorCode(error: Error): string {
    // Check for explicit error code
    if ('code' in error && typeof error.code === 'string') {
      return error.code;
    }

    // Check error name
    if (error.name && error.name !== 'Error') {
      return error.name.toUpperCase().replace(/ERROR$/, '_ERROR');
    }

    // Infer from message
    const message = error.message.toLowerCase();
    if (message.includes('timeout')) return 'TIMEOUT';
    if (message.includes('rate limit')) return 'RATE_LIMIT';
    if (message.includes('network')) return 'NETWORK_ERROR';
    if (message.includes('resource')) return 'RESOURCE_EXHAUSTED';

    return 'STEP_FAILED';
  }

  /**
   * Find step definition in the plan
   */
  private findStepInPlan(stepId: string): WorkflowStep | undefined {
    return this.plan.workflow.steps.find((s) => s.id === stepId);
  }

  /**
   * Calculate which steps would be undone by rollback
   */
  private calculateUndoneSteps(checkpointSequence: number): string[] {
    // This would track steps executed since the checkpoint
    // For now, return empty - actual implementation would track this
    return [];
  }

  /**
   * Create a retry result
   */
  private createRetryResult(
    step: WorkflowStep,
    error: ExecutionError
  ): FailureHandlingResult {
    return {
      failedStepId: step.id,
      error: { ...error, recoveryAttempted: true, recoveryResult: 'RETRY' },
      action: 'RETRY',
      handled: true,
      actionResult: { retrySucceeded: undefined }, // Not yet attempted
      continueExecution: true,
      nextStepId: step.id, // Retry the same step
    };
  }

  /**
   * Create a fallback result
   */
  private createFallbackResult(
    step: WorkflowStep,
    error: ExecutionError,
    fallbackStepId: string
  ): FailureHandlingResult {
    return {
      failedStepId: step.id,
      error: { ...error, recoveryAttempted: true, recoveryResult: 'FALLBACK' },
      action: 'FALLBACK',
      handled: true,
      actionResult: { fallbackStepExecuted: fallbackStepId },
      continueExecution: true,
      nextStepId: fallbackStepId,
    };
  }

  /**
   * Create a skip result
   */
  private createSkipResult(
    step: WorkflowStep,
    error: ExecutionError
  ): FailureHandlingResult {
    return {
      failedStepId: step.id,
      error: { ...error, recoveryAttempted: true, recoveryResult: 'SKIPPED' },
      action: 'SKIP',
      handled: true,
      actionResult: { skipped: true },
      continueExecution: true,
      nextStepId: undefined, // Continue with next step in order
    };
  }

  /**
   * Create a rollback result
   */
  private async createRollbackResult(
    step: WorkflowStep,
    error: ExecutionError
  ): Promise<FailureHandlingResult> {
    const rollbackResult = await this.rollbackExecution(
      `Step ${step.id} failed: ${error.message}`
    );

    return {
      failedStepId: step.id,
      error: { ...error, recoveryAttempted: true, recoveryResult: 'ROLLBACK' },
      action: 'ROLLBACK',
      handled: rollbackResult.success,
      actionResult: {
        rolledBackTo: rollbackResult.success ? rollbackResult.checkpointId : undefined,
      },
      continueExecution: false,
      nextStepId: undefined,
    };
  }

  /**
   * Create an abort result
   */
  private createAbortResult(
    step: WorkflowStep,
    error: ExecutionError
  ): FailureHandlingResult {
    return {
      failedStepId: step.id,
      error: { ...error, recoveryAttempted: false },
      action: 'ABORT',
      handled: false,
      continueExecution: false,
      nextStepId: undefined,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a failure handler for the execution
 */
export function createFailureHandler(
  ctx: ExecutionContext,
  plan: SimulationPlan,
  checkpointManager: ExecutionCheckpointManager
): FailureHandler {
  return new FailureHandler(ctx, plan, checkpointManager);
}
