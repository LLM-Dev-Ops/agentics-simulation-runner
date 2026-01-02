/**
 * Parallel Executor for Workflow Steps
 *
 * Executes multiple workflow steps in parallel while respecting
 * concurrency limits and handling failures according to the
 * configured failure strategy.
 *
 * @module core/parallel-executor
 * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep (PARALLEL_GROUP case)
 * @see SPARC_REFINEMENT.md Section 4.3 - Sub-sequence PRNG for parallel steps
 * @see SPARC_ARCHITECTURE.md MOD-006 - Workflow Scheduler
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  ExecutionContext,
  SeededRandomGenerator,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
  ParallelGroupStep,
} from '../types/workflow.js';

import type {
  SimulationPlan,
  AgentDefinition,
  IntegrationEndpoint,
} from '../types/simulation-plan.js';

import type {
  ISO8601Timestamp,
  DurationMs,
  SHA256Hash,
  StepStatus,
} from '../types/common.js';

import type { OrchestrationStepResult } from '../orchestration/types.js';

import { createDeterministicRandom } from './deterministic-random.js';

// =============================================================================
// Parallel Execution Types
// =============================================================================

/**
 * Result of parallel step execution
 */
export interface ParallelResult {
  /**
   * Parent parallel group step ID
   */
  readonly stepId: string;

  /**
   * Overall status of the parallel execution
   */
  readonly status: StepStatus;

  /**
   * Individual results from each parallel step
   */
  readonly stepResults: readonly OrchestrationStepResult[];

  /**
   * Steps that completed successfully
   */
  readonly successfulSteps: readonly string[];

  /**
   * Steps that failed
   */
  readonly failedSteps: readonly string[];

  /**
   * Steps that were skipped (due to fail_fast)
   */
  readonly skippedSteps: readonly string[];

  /**
   * Total duration for parallel execution (wall clock time)
   */
  readonly totalDurationMs: DurationMs;

  /**
   * Combined duration of all steps (sum)
   */
  readonly combinedDurationMs: DurationMs;

  /**
   * Parallelism efficiency (combined / total)
   */
  readonly parallelismEfficiency: number;

  /**
   * When execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Errors encountered during execution
   */
  readonly errors: readonly ParallelExecutionError[];
}

/**
 * Error from parallel execution
 */
export interface ParallelExecutionError {
  readonly stepId: string;
  readonly errorCode: string;
  readonly message: string;
  readonly timestamp: ISO8601Timestamp;
}

/**
 * Options for parallel execution
 */
export interface ParallelExecutionOptions {
  /**
   * Maximum concurrent step executions
   */
  readonly maxConcurrency: number;

  /**
   * Failure strategy for the parallel group
   */
  readonly failureStrategy: 'fail_fast' | 'fail_slow' | 'ignore_failures';

  /**
   * Timeout for the entire parallel group
   */
  readonly groupTimeoutMs?: DurationMs;

  /**
   * Individual step timeout (overrides step-level config)
   */
  readonly stepTimeoutMs?: DurationMs;
}

// =============================================================================
// Step Executor Interface
// =============================================================================

/**
 * Interface for step execution (injected dependency)
 */
export interface StepExecutorInterface {
  executeStep(step: WorkflowStep): Promise<OrchestrationStepResult>;
}

// =============================================================================
// Parallel Executor Class
// =============================================================================

/**
 * Executes workflow steps in parallel with deterministic ordering
 *
 * Features:
 * - Respects concurrency limits
 * - Handles failure strategies (fail_fast, fail_slow, ignore_failures)
 * - Provides sub-sequence PRNG for each parallel step (INV-EX-001)
 * - Tracks parallelism efficiency metrics
 */
export class ParallelExecutor {
  private readonly ctx: ExecutionContext;
  private readonly stepExecutor: StepExecutorInterface;

  constructor(ctx: ExecutionContext, stepExecutor: StepExecutorInterface) {
    this.ctx = ctx;
    this.stepExecutor = stepExecutor;
  }

  /**
   * Execute steps in parallel respecting concurrency limits
   *
   * @param step - The parallel group step containing parallel steps
   * @param preStateHash - State hash before execution
   * @returns ParallelResult with all step outcomes
   */
  async executeParallelSteps(
    step: ParallelGroupStep,
    preStateHash: SHA256Hash
  ): Promise<ParallelResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    const parallelSteps = step.parallelSteps;
    const maxConcurrency = step.maxConcurrency ?? parallelSteps.length;
    const failureStrategy = step.failureStrategy;

    const results: OrchestrationStepResult[] = [];
    const errors: ParallelExecutionError[] = [];
    const successfulSteps: string[] = [];
    const failedSteps: string[] = [];
    const skippedSteps: string[] = [];

    let shouldAbort = false;
    let combinedDurationMs = 0;

    // Prepare steps with deterministic ordering
    // Sort by step ID for consistent ordering across executions
    const sortedSteps = [...parallelSteps].sort((a, b) => a.id.localeCompare(b.id));

    // Execute in batches based on maxConcurrency
    for (let batchStart = 0; batchStart < sortedSteps.length && !shouldAbort; batchStart += maxConcurrency) {
      const batch = sortedSteps.slice(batchStart, batchStart + maxConcurrency);

      if (failureStrategy === 'fail_fast') {
        // Use Promise.all for fail_fast - any failure rejects immediately
        try {
          const batchPromises = batch.map((s) => this.executeWithSubSequencePRNG(s, batchStart));
          const batchResults = await Promise.all(batchPromises);

          for (const result of batchResults) {
            results.push(result);
            combinedDurationMs += result.durationMs ?? 0;

            if (result.status === 'failure') {
              failedSteps.push(result.stepId);
              errors.push({
                stepId: result.stepId,
                errorCode: result.error?.code ?? 'STEP_FAILED',
                message: result.error?.message ?? 'Step execution failed',
                timestamp: result.completedAt ?? new Date().toISOString() as ISO8601Timestamp,
              });
              shouldAbort = true;
            } else if (result.status === 'success') {
              successfulSteps.push(result.stepId);
            }
          }

          // Mark remaining steps as skipped if we're aborting
          if (shouldAbort) {
            for (let i = batchStart + maxConcurrency; i < sortedSteps.length; i++) {
              skippedSteps.push(sortedSteps[i].id);
            }
          }
        } catch (error) {
          // Unexpected error during batch execution
          shouldAbort = true;
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            stepId: 'batch',
            errorCode: 'BATCH_EXECUTION_ERROR',
            message: errorMsg,
            timestamp: new Date().toISOString() as ISO8601Timestamp,
          });
        }
      } else {
        // Use Promise.allSettled for fail_slow and ignore_failures
        const batchPromises = batch.map((s) => this.executeWithSubSequencePRNG(s, batchStart));
        const batchResults = await Promise.allSettled(batchPromises);

        for (let i = 0; i < batchResults.length; i++) {
          const settled = batchResults[i];
          const stepId = batch[i].id;

          if (settled.status === 'fulfilled') {
            const result = settled.value;
            results.push(result);
            combinedDurationMs += result.durationMs ?? 0;

            if (result.status === 'failure') {
              failedSteps.push(result.stepId);
              errors.push({
                stepId: result.stepId,
                errorCode: result.error?.code ?? 'STEP_FAILED',
                message: result.error?.message ?? 'Step execution failed',
                timestamp: result.completedAt ?? new Date().toISOString() as ISO8601Timestamp,
              });
            } else if (result.status === 'success') {
              successfulSteps.push(result.stepId);
            }
          } else {
            // Promise was rejected
            failedSteps.push(stepId);
            const errorMsg = settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason);
            errors.push({
              stepId,
              errorCode: 'STEP_REJECTED',
              message: errorMsg,
              timestamp: new Date().toISOString() as ISO8601Timestamp,
            });

            // Create a failure result for the rejected step
            results.push(this.createFailureResult(
              stepId,
              step.id, // workflowId placeholder
              errorMsg
            ));
          }
        }
      }
    }

    const completedAt = new Date().toISOString() as ISO8601Timestamp;
    const totalDurationMs = Date.now() - startTime;

    // Determine overall status
    let status: StepStatus;
    if (failedSteps.length === 0) {
      status = 'success';
    } else if (failureStrategy === 'ignore_failures') {
      status = 'success'; // Ignore failures means success overall
    } else {
      status = 'failure';
    }

    // Calculate parallelism efficiency
    const parallelismEfficiency = totalDurationMs > 0
      ? combinedDurationMs / totalDurationMs
      : 1;

    return {
      stepId: step.id,
      status,
      stepResults: results,
      successfulSteps,
      failedSteps,
      skippedSteps,
      totalDurationMs,
      combinedDurationMs,
      parallelismEfficiency,
      startedAt,
      completedAt,
      errors,
    };
  }

  /**
   * Execute a step with a sub-sequence PRNG for determinism
   *
   * Each parallel step gets its own PRNG derived from the main PRNG
   * to ensure deterministic execution regardless of execution order.
   *
   * @param step - Step to execute
   * @param batchIndex - Index of the batch for PRNG derivation
   * @returns Step result
   */
  private async executeWithSubSequencePRNG(
    step: WorkflowStep,
    batchIndex: number
  ): Promise<OrchestrationStepResult> {
    // Derive a sub-sequence seed from the main PRNG
    // This ensures each parallel step has deterministic random values
    // regardless of actual execution order
    const baseSeed = this.ctx.randomGenerator.seed;
    const stepIndex = step.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const subSequenceSeed = BigInt(baseSeed) + BigInt(batchIndex * 1000) + BigInt(stepIndex);

    // Store the sub-sequence seed in context for this step
    // The step executor can use this for deterministic random operations
    await this.ctx.stateNamespace.set(
      `__parallel_prng_${step.id}`,
      subSequenceSeed.toString()
    );

    try {
      return await this.stepExecutor.executeStep(step);
    } finally {
      // Clean up the temporary PRNG seed
      await this.ctx.stateNamespace.delete(`__parallel_prng_${step.id}`);
    }
  }

  /**
   * Create a failure result for a rejected step
   */
  private createFailureResult(
    stepId: string,
    workflowId: string,
    errorMessage: string
  ): OrchestrationStepResult {
    const now = new Date().toISOString() as ISO8601Timestamp;
    return {
      stepId,
      workflowId,
      status: 'failure',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      inputsSnapshot: {},
      outputs: {},
      error: {
        code: 'STEP_EXECUTION_ERROR',
        message: errorMessage,
      },
      sequenceNumber: this.ctx.currentStepSequence,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a parallel executor for the given execution context
 *
 * @param ctx - Execution context
 * @param stepExecutor - Step executor to use for individual steps
 * @returns ParallelExecutor instance
 */
export function createParallelExecutor(
  ctx: ExecutionContext,
  stepExecutor: StepExecutorInterface
): ParallelExecutor {
  return new ParallelExecutor(ctx, stepExecutor);
}

// =============================================================================
// Standalone Execution Function
// =============================================================================

/**
 * Execute parallel steps with the given configuration
 *
 * @param ctx - Execution context
 * @param step - Parallel group step
 * @param stepExecutor - Step executor for individual steps
 * @param preStateHash - State hash before execution
 * @returns ParallelResult with all step outcomes
 */
export async function executeParallelSteps(
  ctx: ExecutionContext,
  step: ParallelGroupStep,
  stepExecutor: StepExecutorInterface,
  preStateHash: SHA256Hash
): Promise<ParallelResult> {
  const executor = createParallelExecutor(ctx, stepExecutor);
  return executor.executeParallelSteps(step, preStateHash);
}
