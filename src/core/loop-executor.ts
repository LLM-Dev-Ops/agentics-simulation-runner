/**
 * Loop Executor for Workflow Iteration
 *
 * Handles loop step execution with support for:
 * - FIXED_COUNT: Run exactly N times
 * - UNTIL_CONDITION: Run until condition is true
 * - FOR_EACH: Iterate over collection
 * - WHILE: Run while condition is true
 *
 * Tracks loop index in context for determinism (INV-EX-001).
 *
 * @module core/loop-executor
 * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep (LOOP case)
 * @see SPARC_ARCHITECTURE.md MOD-006 - Workflow Scheduler
 */

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
  LoopStep,
} from '../types/workflow.js';

import type {
  ISO8601Timestamp,
  DurationMs,
  SHA256Hash,
  StepStatus,
} from '../types/common.js';

import type { OrchestrationStepResult } from '../orchestration/types.js';

import { ConditionalEvaluator } from './conditional-evaluator.js';

// =============================================================================
// Loop Result Types
// =============================================================================

/**
 * Result of loop execution
 */
export interface LoopResult {
  /**
   * Loop step ID
   */
  readonly stepId: string;

  /**
   * Overall status of the loop execution
   */
  readonly status: StepStatus;

  /**
   * Number of iterations completed
   */
  readonly iterationCount: number;

  /**
   * Results from each iteration
   */
  readonly iterationResults: readonly LoopIterationResult[];

  /**
   * Total duration for all iterations
   */
  readonly totalDurationMs: DurationMs;

  /**
   * Average duration per iteration
   */
  readonly avgIterationDurationMs: DurationMs;

  /**
   * When loop execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When loop execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Why the loop terminated
   */
  readonly terminationReason: LoopTerminationReason;

  /**
   * Final loop index
   */
  readonly finalLoopIndex: number;

  /**
   * Errors encountered during execution
   */
  readonly errors: readonly LoopExecutionError[];
}

/**
 * Result of a single loop iteration
 */
export interface LoopIterationResult {
  /**
   * Zero-based iteration index
   */
  readonly iterationIndex: number;

  /**
   * Current item for FOR_EACH loops
   */
  readonly currentItem?: unknown;

  /**
   * Results from body steps in this iteration
   */
  readonly bodyResults: readonly OrchestrationStepResult[];

  /**
   * Duration of this iteration
   */
  readonly durationMs: DurationMs;

  /**
   * Whether this iteration succeeded
   */
  readonly success: boolean;

  /**
   * Error if iteration failed
   */
  readonly error?: string;
}

/**
 * Reason for loop termination
 */
export type LoopTerminationReason =
  | 'COUNT_COMPLETED'      // Ran all iterations
  | 'CONDITION_MET'        // Until condition became true
  | 'CONDITION_FALSE'      // While condition became false
  | 'COLLECTION_EXHAUSTED' // Processed all items in collection
  | 'MAX_ITERATIONS'       // Hit safety limit
  | 'ERROR'                // Error during execution
  | 'BREAK';               // Explicit break (future)

/**
 * Error from loop execution
 */
export interface LoopExecutionError {
  readonly iterationIndex: number;
  readonly stepId?: string;
  readonly errorCode: string;
  readonly message: string;
  readonly timestamp: ISO8601Timestamp;
}

/**
 * Loop context state stored during iteration
 */
export interface LoopContextState {
  /**
   * Current iteration index (0-based)
   */
  readonly loopIndex: number;

  /**
   * Current item for FOR_EACH loops
   */
  readonly currentItem?: unknown;

  /**
   * Total expected iterations (if known)
   */
  readonly totalIterations?: number;

  /**
   * Whether this is the first iteration
   */
  readonly isFirst: boolean;

  /**
   * Whether this is the last iteration (if known)
   */
  readonly isLast: boolean;
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
// Loop Executor Class
// =============================================================================

/**
 * Executes loop steps with deterministic iteration tracking
 *
 * Features:
 * - Supports count, for_each, while, and until loop types
 * - Tracks loop index in state for determinism
 * - Enforces maximum iteration limits for safety
 * - Provides iteration context to body steps
 */
export class LoopExecutor {
  private readonly ctx: ExecutionContext;
  private readonly stepExecutor: StepExecutorInterface;
  private readonly conditionalEvaluator: ConditionalEvaluator;

  /**
   * Default maximum iterations as a safety limit
   */
  private static readonly DEFAULT_MAX_ITERATIONS = 1000;

  constructor(ctx: ExecutionContext, stepExecutor: StepExecutorInterface) {
    this.ctx = ctx;
    this.stepExecutor = stepExecutor;
    this.conditionalEvaluator = new ConditionalEvaluator(ctx);
  }

  /**
   * Execute a loop step
   *
   * @param step - The loop step to execute
   * @param preStateHash - State hash before execution
   * @returns LoopResult with all iteration outcomes
   */
  async executeLoop(
    step: LoopStep,
    preStateHash: SHA256Hash
  ): Promise<LoopResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    const maxIterations = step.maxIterations ?? LoopExecutor.DEFAULT_MAX_ITERATIONS;
    const iterationResults: LoopIterationResult[] = [];
    const errors: LoopExecutionError[] = [];

    let terminationReason: LoopTerminationReason = 'ERROR';
    let loopIndex = 0;
    let continueLoop = true;

    try {
      switch (step.loopType) {
        case 'count':
          ({ loopIndex, terminationReason } = await this.executeCountLoop(
            step,
            maxIterations,
            iterationResults,
            errors
          ));
          break;

        case 'for_each':
          ({ loopIndex, terminationReason } = await this.executeForEachLoop(
            step,
            maxIterations,
            iterationResults,
            errors
          ));
          break;

        case 'while':
          ({ loopIndex, terminationReason } = await this.executeWhileLoop(
            step,
            maxIterations,
            iterationResults,
            errors
          ));
          break;

        case 'until':
          ({ loopIndex, terminationReason } = await this.executeUntilLoop(
            step,
            maxIterations,
            iterationResults,
            errors
          ));
          break;

        default:
          throw new Error(`Unknown loop type: ${(step as LoopStep).loopType}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({
        iterationIndex: loopIndex,
        errorCode: 'LOOP_EXECUTION_ERROR',
        message: errorMsg,
        timestamp: new Date().toISOString() as ISO8601Timestamp,
      });
      terminationReason = 'ERROR';
    }

    const completedAt = new Date().toISOString() as ISO8601Timestamp;
    const totalDurationMs = Date.now() - startTime;
    const avgIterationDurationMs = iterationResults.length > 0
      ? totalDurationMs / iterationResults.length
      : 0;

    // Determine overall status
    const hasFailures = iterationResults.some((r) => !r.success) || errors.length > 0;
    const status: StepStatus = hasFailures ? 'failure' : 'success';

    return {
      stepId: step.id,
      status,
      iterationCount: iterationResults.length,
      iterationResults,
      totalDurationMs,
      avgIterationDurationMs,
      startedAt,
      completedAt,
      terminationReason,
      finalLoopIndex: loopIndex,
      errors,
    };
  }

  /**
   * Execute a count-based loop (run exactly N times)
   */
  private async executeCountLoop(
    step: LoopStep,
    maxIterations: number,
    iterationResults: LoopIterationResult[],
    errors: LoopExecutionError[]
  ): Promise<{ loopIndex: number; terminationReason: LoopTerminationReason }> {
    const count = typeof step.iteratorSource === 'number' ? step.iteratorSource : 0;
    const actualCount = Math.min(count, maxIterations);

    for (let i = 0; i < actualCount; i++) {
      const iterResult = await this.executeIteration(
        step,
        i,
        undefined,
        actualCount,
        errors
      );
      iterationResults.push(iterResult);

      // Stop on failure
      if (!iterResult.success) {
        return { loopIndex: i, terminationReason: 'ERROR' };
      }
    }

    const terminationReason: LoopTerminationReason = count > maxIterations
      ? 'MAX_ITERATIONS'
      : 'COUNT_COMPLETED';

    return { loopIndex: actualCount - 1, terminationReason };
  }

  /**
   * Execute a for-each loop over a collection
   */
  private async executeForEachLoop(
    step: LoopStep,
    maxIterations: number,
    iterationResults: LoopIterationResult[],
    errors: LoopExecutionError[]
  ): Promise<{ loopIndex: number; terminationReason: LoopTerminationReason }> {
    // Get the collection from state
    const collectionKey = typeof step.iteratorSource === 'string' ? step.iteratorSource : '';
    const collection = await this.ctx.stateNamespace.get<unknown[]>(collectionKey);

    if (!Array.isArray(collection)) {
      errors.push({
        iterationIndex: 0,
        errorCode: 'INVALID_COLLECTION',
        message: `Iterator source '${collectionKey}' is not an array`,
        timestamp: new Date().toISOString() as ISO8601Timestamp,
      });
      return { loopIndex: 0, terminationReason: 'ERROR' };
    }

    const actualCount = Math.min(collection.length, maxIterations);

    for (let i = 0; i < actualCount; i++) {
      const item = collection[i];
      const iterResult = await this.executeIteration(
        step,
        i,
        item,
        actualCount,
        errors
      );
      iterationResults.push(iterResult);

      // Stop on failure
      if (!iterResult.success) {
        return { loopIndex: i, terminationReason: 'ERROR' };
      }
    }

    const terminationReason: LoopTerminationReason = collection.length > maxIterations
      ? 'MAX_ITERATIONS'
      : 'COLLECTION_EXHAUSTED';

    return { loopIndex: actualCount - 1, terminationReason };
  }

  /**
   * Execute a while loop (run while condition is true)
   */
  private async executeWhileLoop(
    step: LoopStep,
    maxIterations: number,
    iterationResults: LoopIterationResult[],
    errors: LoopExecutionError[]
  ): Promise<{ loopIndex: number; terminationReason: LoopTerminationReason }> {
    let loopIndex = 0;

    while (loopIndex < maxIterations) {
      // Check condition before each iteration
      if (step.condition) {
        const conditionResult = await this.conditionalEvaluator.evaluateExpression(
          step.condition,
          {}
        );
        if (!conditionResult) {
          return { loopIndex: loopIndex - 1, terminationReason: 'CONDITION_FALSE' };
        }
      }

      const iterResult = await this.executeIteration(
        step,
        loopIndex,
        undefined,
        undefined,
        errors
      );
      iterationResults.push(iterResult);

      // Stop on failure
      if (!iterResult.success) {
        return { loopIndex, terminationReason: 'ERROR' };
      }

      loopIndex++;
    }

    return { loopIndex: loopIndex - 1, terminationReason: 'MAX_ITERATIONS' };
  }

  /**
   * Execute an until loop (run until condition becomes true)
   */
  private async executeUntilLoop(
    step: LoopStep,
    maxIterations: number,
    iterationResults: LoopIterationResult[],
    errors: LoopExecutionError[]
  ): Promise<{ loopIndex: number; terminationReason: LoopTerminationReason }> {
    let loopIndex = 0;

    do {
      if (loopIndex >= maxIterations) {
        return { loopIndex: loopIndex - 1, terminationReason: 'MAX_ITERATIONS' };
      }

      const iterResult = await this.executeIteration(
        step,
        loopIndex,
        undefined,
        undefined,
        errors
      );
      iterationResults.push(iterResult);

      // Stop on failure
      if (!iterResult.success) {
        return { loopIndex, terminationReason: 'ERROR' };
      }

      loopIndex++;

      // Check condition after each iteration
      if (step.condition) {
        const conditionResult = await this.conditionalEvaluator.evaluateExpression(
          step.condition,
          {}
        );
        if (conditionResult) {
          return { loopIndex: loopIndex - 1, terminationReason: 'CONDITION_MET' };
        }
      }
    } while (true);
  }

  /**
   * Execute a single loop iteration
   */
  private async executeIteration(
    step: LoopStep,
    iterationIndex: number,
    currentItem: unknown | undefined,
    totalIterations: number | undefined,
    errors: LoopExecutionError[]
  ): Promise<LoopIterationResult> {
    const startTime = Date.now();
    const bodyResults: OrchestrationStepResult[] = [];
    let success = true;
    let errorMsg: string | undefined;

    try {
      // Set up loop context in state
      const loopContext: LoopContextState = {
        loopIndex: iterationIndex,
        currentItem,
        totalIterations,
        isFirst: iterationIndex === 0,
        isLast: totalIterations !== undefined && iterationIndex === totalIterations - 1,
      };

      // Store loop context for body steps
      await this.ctx.stateNamespace.set(`__loop_${step.id}_context`, loopContext);
      await this.ctx.stateNamespace.set(`__loop_${step.id}_index`, iterationIndex);

      // Store iterator variable if specified
      if (step.iteratorVariable) {
        if (currentItem !== undefined) {
          await this.ctx.stateNamespace.set(step.iteratorVariable, currentItem);
        } else {
          await this.ctx.stateNamespace.set(step.iteratorVariable, iterationIndex);
        }
      }

      // Execute body steps
      for (const bodyStep of step.body) {
        const result = await this.stepExecutor.executeStep(bodyStep);
        bodyResults.push(result);

        if (result.status === 'failure') {
          success = false;
          errorMsg = result.error?.message ?? 'Body step failed';
          errors.push({
            iterationIndex,
            stepId: bodyStep.id,
            errorCode: result.error?.code ?? 'BODY_STEP_FAILED',
            message: errorMsg,
            timestamp: new Date().toISOString() as ISO8601Timestamp,
          });
          break;
        }
      }
    } catch (error) {
      success = false;
      errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({
        iterationIndex,
        errorCode: 'ITERATION_ERROR',
        message: errorMsg,
        timestamp: new Date().toISOString() as ISO8601Timestamp,
      });
    } finally {
      // Clean up loop context
      await this.ctx.stateNamespace.delete(`__loop_${step.id}_context`);
      await this.ctx.stateNamespace.delete(`__loop_${step.id}_index`);
    }

    return {
      iterationIndex,
      currentItem,
      bodyResults,
      durationMs: Date.now() - startTime,
      success,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a loop executor for the given execution context
 *
 * @param ctx - Execution context
 * @param stepExecutor - Step executor for body steps
 * @returns LoopExecutor instance
 */
export function createLoopExecutor(
  ctx: ExecutionContext,
  stepExecutor: StepExecutorInterface
): LoopExecutor {
  return new LoopExecutor(ctx, stepExecutor);
}

// =============================================================================
// Standalone Execution Function
// =============================================================================

/**
 * Execute a loop step with the given configuration
 *
 * @param ctx - Execution context
 * @param step - Loop step to execute
 * @param stepExecutor - Step executor for body steps
 * @param preStateHash - State hash before execution
 * @returns LoopResult with all iteration outcomes
 */
export async function executeLoop(
  ctx: ExecutionContext,
  step: LoopStep,
  stepExecutor: StepExecutorInterface,
  preStateHash: SHA256Hash
): Promise<LoopResult> {
  const executor = createLoopExecutor(ctx, stepExecutor);
  return executor.executeLoop(step, preStateHash);
}
