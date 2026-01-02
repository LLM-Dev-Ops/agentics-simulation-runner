/**
 * Step Executor for Workflow Step Dispatch
 *
 * Executes individual workflow steps by dispatching to the appropriate
 * handler based on step type. Handles input resolution, timeout management,
 * and result recording.
 *
 * @module orchestration/step-executor
 * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep
 * @see SPARC_ARCHITECTURE.md MOD-006 - Workflow Scheduler
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  StepStatus,
  Metadata,
} from '../types/common.js';

import type {
  ExecutionContext,
  AgentContext,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
  AgentInvocationStep,
  IntegrationCallStep,
  ConditionalStep,
  ParallelGroupStep,
  LoopStep,
  CheckpointStep,
  DelayStep,
  StateMutationStep,
  EventEmitStep,
  isAgentInvocationStep,
  isIntegrationCallStep,
  isConditionalStep,
  isParallelGroupStep,
  isLoopStep,
  isCheckpointStep,
  isDelayStep,
  isStateMutationStep,
  isEventEmitStep,
} from '../types/workflow.js';

import type {
  SimulationPlan,
  AgentDefinition,
  IntegrationEndpoint,
} from '../types/simulation-plan.js';

import type {
  StepResult,
  IntegrationObservation,
} from '../types/simulation-result.js';

import type {
  OrchestrationStepResult,
  StepExecutionContext,
} from './types.js';

import { computeObjectHash } from '../core/hash-utils.js';

// =============================================================================
// Step Executor Interfaces
// =============================================================================

/**
 * Interface for agent lifecycle management (MOD-007)
 */
export interface AgentLifecycleManager {
  /**
   * Invoke an agent to perform an action
   */
  invokeAgent(
    ctx: ExecutionContext,
    agent: AgentDefinition,
    action: string,
    inputs: Record<string, unknown>
  ): Promise<AgentInvocationResult>;
}

/**
 * Interface for integration adapter management (MOD-008)
 */
export interface IntegrationAdapterManager {
  /**
   * Execute an integration call
   */
  executeIntegration(
    ctx: ExecutionContext,
    integration: IntegrationEndpoint,
    inputs: Record<string, unknown>
  ): Promise<IntegrationCallResult>;
}

/**
 * Result of an agent invocation
 */
export interface AgentInvocationResult {
  readonly success: boolean;
  readonly outputs: Record<string, unknown>;
  readonly tokensConsumed: number;
  readonly latencyMs: DurationMs;
  readonly error?: string;
  readonly llmDetails?: {
    readonly provider: string;
    readonly model: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

/**
 * Result of an integration call
 */
export interface IntegrationCallResult {
  readonly success: boolean;
  readonly outputs: Record<string, unknown>;
  readonly latencyMs: DurationMs;
  readonly error?: string;
  readonly observation: IntegrationObservation;
}

// =============================================================================
// Input/Output Resolution
// =============================================================================

/**
 * Resolve step inputs from static values and state
 *
 * @param step - The step with input specifications
 * @param ctx - Execution context for state access
 * @returns Resolved inputs as key-value pairs
 */
export async function resolveStepInputs(
  step: WorkflowStep,
  ctx: ExecutionContext
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  // Check if step has inputs property
  if (!('inputs' in step) || !step.inputs) {
    return resolved;
  }

  const inputs = step.inputs;

  // Copy static inputs
  if (inputs.static) {
    Object.assign(resolved, inputs.static);
  }

  // Resolve dynamic inputs from state
  if (inputs.dynamic) {
    for (const stateKey of inputs.dynamic) {
      const value = await ctx.stateNamespace.get(stateKey);
      resolved[stateKey] = value;
    }
  }

  // Apply transformations (simplified - would use expression evaluation)
  if (inputs.transformations) {
    for (const [key, expression] of Object.entries(inputs.transformations)) {
      // For now, just copy the value - real implementation would evaluate expression
      resolved[key] = expression;
    }
  }

  return resolved;
}

/**
 * Store step outputs to state
 *
 * @param step - The step with output specifications
 * @param outputs - Outputs to store
 * @param ctx - Execution context for state access
 */
export async function storeStepOutputs(
  step: WorkflowStep,
  outputs: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<void> {
  // Check if step has outputs property
  if (!('outputs' in step) || !step.outputs) {
    return;
  }

  const outputSpec = step.outputs;

  // Store outputs to specified state keys
  for (const stateKey of outputSpec.stateKeys) {
    if (stateKey in outputs) {
      await ctx.stateNamespace.set(stateKey, outputs[stateKey]);
    }
  }

  // Emit events if specified
  if (outputSpec.emitEvents) {
    for (const eventType of outputSpec.emitEvents) {
      ctx.telemetry.emitEvent(eventType, {
        stepId: step.id,
        outputs,
      });
    }
  }
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Evaluate a condition expression
 *
 * @param expression - Condition expression to evaluate
 * @param ctx - Execution context for state access
 * @returns Boolean result of evaluation
 */
export async function evaluateCondition(
  expression: string,
  ctx: ExecutionContext
): Promise<boolean> {
  // Simple expression evaluation
  // Real implementation would use a proper expression parser

  // Handle simple state checks like "state.key == value"
  // Note: Order matters - >= and <= must come before > and < to match correctly
  const stateMatch = expression.match(/state\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)/);
  if (stateMatch) {
    const [, key, operator, valueStr] = stateMatch;
    const stateValue = await ctx.stateNamespace.get(key);
    const compareValue = JSON.parse(valueStr.trim());

    switch (operator) {
      case '==':
        return stateValue === compareValue;
      case '!=':
        return stateValue !== compareValue;
      case '>':
        return (stateValue as number) > compareValue;
      case '<':
        return (stateValue as number) < compareValue;
      case '>=':
        return (stateValue as number) >= compareValue;
      case '<=':
        return (stateValue as number) <= compareValue;
      default:
        return false;
    }
  }

  // Boolean literals
  if (expression.toLowerCase() === 'true') return true;
  if (expression.toLowerCase() === 'false') return false;

  // Default to true for unrecognized expressions
  return true;
}

// =============================================================================
// Step Executor Class
// =============================================================================

/**
 * Executes individual workflow steps by dispatching to appropriate handlers
 *
 * Responsibilities:
 * - Resolve inputs from static values and state
 * - Dispatch to appropriate handler based on step type
 * - Record execution metrics and telemetry
 * - Store outputs to state
 * - Handle step-level errors
 */
export class StepExecutor {
  private readonly integrationObservations: IntegrationObservation[] = [];

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan,
    private readonly agentManager: AgentLifecycleManager,
    private readonly integrationManager: IntegrationAdapterManager
  ) {}

  /**
   * Execute a workflow step
   *
   * Dispatches to appropriate handler based on step type:
   * - AGENT_INVOCATION -> AgentLifecycleManager
   * - INTEGRATION_CALL -> IntegrationAdapterManager
   * - CONDITIONAL -> evaluateConditional()
   * - PARALLEL_GROUP -> executeParallelSteps()
   * - LOOP -> executeLoop()
   * - CHECKPOINT -> handled by orchestrator
   * - DELAY -> executeDelay()
   * - STATE_MUTATION -> executeStateMutation()
   * - EVENT_EMIT -> executeEventEmit()
   *
   * @param step - The step to execute
   * @returns Step result with outputs and metrics
   *
   * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep
   */
  async executeStep(step: WorkflowStep): Promise<OrchestrationStepResult> {
    const startTime = new Date().toISOString() as ISO8601Timestamp;
    const startMs = Date.now();

    // Start span for telemetry
    const span = this.ctx.telemetry.startSpan(`step:${step.id}`, {
      stepType: step.stepType,
      stepName: step.name || step.id,
    });

    try {
      // Resolve inputs
      const resolvedInputs = await resolveStepInputs(step, this.ctx);

      // Get pre-state hash
      const preStateHash = await this.ctx.stateNamespace.getStateHash();

      // Dispatch to appropriate handler
      let result: OrchestrationStepResult;

      switch (step.stepType) {
        case 'AGENT_INVOCATION':
          result = await this.executeAgentInvocation(
            step as AgentInvocationStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'INTEGRATION_CALL':
          result = await this.executeIntegrationCall(
            step as IntegrationCallStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'CONDITIONAL':
          result = await this.executeConditional(
            step as ConditionalStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'PARALLEL_GROUP':
          result = await this.executeParallelGroup(
            step as ParallelGroupStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'LOOP':
          result = await this.executeLoop(
            step as LoopStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'CHECKPOINT':
          // Checkpoints are handled by the orchestrator
          result = this.createSuccessResult(
            step,
            startTime,
            startMs,
            preStateHash,
            {}
          );
          break;

        case 'DELAY':
          result = await this.executeDelay(
            step as DelayStep,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'STATE_MUTATION':
          result = await this.executeStateMutation(
            step as StateMutationStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        case 'EVENT_EMIT':
          result = await this.executeEventEmit(
            step as EventEmitStep,
            resolvedInputs,
            startTime,
            startMs,
            preStateHash
          );
          break;

        default:
          // Exhaustive check - this should never happen if all step types are handled
          throw new Error(`Unknown step type: ${(step as WorkflowStep).stepType}`);
      }

      span.end();
      return result;
    } catch (error) {
      span.recordError(error instanceof Error ? error : new Error(String(error)));
      span.end();

      return this.createErrorResult(
        step,
        startTime,
        startMs,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get collected integration observations
   */
  getIntegrationObservations(): readonly IntegrationObservation[] {
    return this.integrationObservations;
  }

  // ===========================================================================
  // Step Type Handlers
  // ===========================================================================

  /**
   * Execute an agent invocation step
   */
  private async executeAgentInvocation(
    step: AgentInvocationStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    // Find agent definition
    const agent = this.plan.agents.find((a) => a.id === step.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${step.agentId}`);
    }

    // Invoke agent
    const result = await this.agentManager.invokeAgent(
      this.ctx,
      agent,
      step.action,
      inputs
    );

    if (!result.success) {
      throw new Error(result.error || 'Agent invocation failed');
    }

    // Store outputs
    await storeStepOutputs(step, result.outputs, this.ctx);

    // Get post-state hash
    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      agentId: step.agentId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: result.outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      llmInteraction: result.llmDetails
        ? {
            provider: result.llmDetails.provider,
            model: result.llmDetails.model,
            promptTokens: result.llmDetails.promptTokens,
            completionTokens: result.llmDetails.completionTokens,
            totalTokens:
              result.llmDetails.promptTokens + result.llmDetails.completionTokens,
            latencyMs: result.latencyMs,
          }
        : undefined,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute an integration call step
   */
  private async executeIntegrationCall(
    step: IntegrationCallStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    // Find integration definition
    const integration = this.plan.integrations?.find(
      (i) => i.id === step.integrationId
    );
    if (!integration) {
      throw new Error(`Integration not found: ${step.integrationId}`);
    }

    // Execute integration call
    const result = await this.integrationManager.executeIntegration(
      this.ctx,
      integration,
      inputs
    );

    // Track observation
    this.integrationObservations.push(result.observation);

    if (!result.success) {
      throw new Error(result.error || 'Integration call failed');
    }

    // Store outputs
    await storeStepOutputs(step, result.outputs, this.ctx);

    // Get post-state hash
    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: result.outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a conditional step
   */
  private async executeConditional(
    step: ConditionalStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    // Evaluate condition
    const conditionResult = await evaluateCondition(step.condition, this.ctx);

    // Determine which branch to execute
    const branch = conditionResult ? step.thenBranch : step.elseBranch;

    const outputs: Record<string, unknown> = {
      conditionResult,
      executedBranch: conditionResult ? 'then' : 'else',
    };

    // If branch is inline steps, execute them
    if (branch && typeof branch !== 'string' && Array.isArray(branch)) {
      const branchResults = [];
      for (const branchStep of branch) {
        const result = await this.executeStep(branchStep);
        branchResults.push(result);
      }
      outputs.branchResults = branchResults;
    }

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a parallel group step
   */
  private async executeParallelGroup(
    step: ParallelGroupStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const parallelSteps = step.parallelSteps;
    const maxConcurrency = step.maxConcurrency ?? parallelSteps.length;

    const results: OrchestrationStepResult[] = [];
    const errors: Error[] = [];

    // Execute in batches based on maxConcurrency
    for (let i = 0; i < parallelSteps.length; i += maxConcurrency) {
      const batch = parallelSteps.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((s) => this.executeStep(s));

      try {
        if (step.failureStrategy === 'fail_fast') {
          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          // Check for failures
          const failed = batchResults.find((r) => r.status === 'failure');
          if (failed) {
            throw new Error(`Parallel step ${failed.stepId} failed`);
          }
        } else {
          const batchResults = await Promise.allSettled(batchPromises);
          for (const result of batchResults) {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              errors.push(result.reason);
            }
          }
        }
      } catch (error) {
        if (step.failureStrategy === 'fail_fast') {
          throw error;
        }
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Determine final status
    let status: StepStatus = 'success';
    if (errors.length > 0) {
      if (step.failureStrategy === 'ignore_failures') {
        status = 'success'; // Ignore failures
      } else {
        status = 'failure';
      }
    }

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status,
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: { parallelResults: results },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      error:
        errors.length > 0
          ? {
              code: 'PARALLEL_STEP_ERRORS',
              message: `${errors.length} parallel steps failed`,
            }
          : undefined,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a loop step
   */
  private async executeLoop(
    step: LoopStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const iterations: OrchestrationStepResult[][] = [];
    let iterationCount = 0;
    const maxIterations = step.maxIterations ?? 1000;

    switch (step.loopType) {
      case 'count': {
        const count =
          typeof step.iteratorSource === 'number' ? step.iteratorSource : 0;
        for (let i = 0; i < count && i < maxIterations; i++) {
          iterationCount++;
          if (step.iteratorVariable) {
            await this.ctx.stateNamespace.set(step.iteratorVariable, i);
          }
          const iterResults = [];
          for (const bodyStep of step.body) {
            const result = await this.executeStep(bodyStep);
            iterResults.push(result);
          }
          iterations.push(iterResults);
        }
        break;
      }

      case 'for_each': {
        if (typeof step.iteratorSource === 'string') {
          const collection = (await this.ctx.stateNamespace.get(
            step.iteratorSource
          )) as unknown[];
          if (Array.isArray(collection)) {
            for (const item of collection) {
              if (iterationCount >= maxIterations) break;
              iterationCount++;
              if (step.iteratorVariable) {
                await this.ctx.stateNamespace.set(step.iteratorVariable, item);
              }
              const iterResults = [];
              for (const bodyStep of step.body) {
                const result = await this.executeStep(bodyStep);
                iterResults.push(result);
              }
              iterations.push(iterResults);
            }
          }
        }
        break;
      }

      case 'while': {
        while (
          step.condition &&
          (await evaluateCondition(step.condition, this.ctx))
        ) {
          if (iterationCount >= maxIterations) break;
          iterationCount++;
          const iterResults = [];
          for (const bodyStep of step.body) {
            const result = await this.executeStep(bodyStep);
            iterResults.push(result);
          }
          iterations.push(iterResults);
        }
        break;
      }

      case 'until': {
        do {
          if (iterationCount >= maxIterations) break;
          iterationCount++;
          const iterResults = [];
          for (const bodyStep of step.body) {
            const result = await this.executeStep(bodyStep);
            iterResults.push(result);
          }
          iterations.push(iterResults);
        } while (
          step.condition &&
          !(await evaluateCondition(step.condition, this.ctx))
        );
        break;
      }
    }

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: { iterations: iterations.length, iterationResults: iterations },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a delay step
   */
  private async executeDelay(
    step: DelayStep,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    // Wait for the specified delay
    await new Promise((resolve) => setTimeout(resolve, step.delayMs));

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: {},
      outputs: { delayedMs: step.delayMs },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash, // No state change
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a state mutation step
   */
  private async executeStateMutation(
    step: StateMutationStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const transaction = await this.ctx.stateNamespace.beginTransaction();

    try {
      for (const [key, value] of Object.entries(step.mutations)) {
        let resolvedValue = value;

        // If evaluating expressions, resolve state references
        if (step.evaluateExpressions && typeof value === 'string') {
          // Simple expression resolution
          if (value.startsWith('state.')) {
            const stateKey = value.substring(6);
            resolvedValue = await transaction.get(stateKey);
          }
        }

        await transaction.set(key, resolvedValue);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: { mutatedKeys: Object.keys(step.mutations) },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      memoryOperations: {
        reads: 0,
        writes: Object.keys(step.mutations).length,
        vectorQueries: 0,
        vectorInserts: 0,
      },
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute an event emit step
   */
  private async executeEventEmit(
    step: EventEmitStep,
    inputs: Record<string, unknown>,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    // Emit the event
    this.ctx.telemetry.emitEvent(step.eventType, {
      stepId: step.id,
      payload: step.payload,
      timestamp: new Date().toISOString(),
    });

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: { eventEmitted: step.eventType },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash, // No state change
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Create a success result
   */
  private createSuccessResult(
    step: WorkflowStep,
    startTime: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash,
    outputs: Record<string, unknown>
  ): OrchestrationStepResult {
    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: {},
      outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Create an error result
   */
  private createErrorResult(
    step: WorkflowStep,
    startTime: ISO8601Timestamp,
    startMs: number,
    error: Error
  ): OrchestrationStepResult {
    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'failure',
      startedAt: startTime,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: {},
      outputs: {},
      error: {
        code: 'STEP_EXECUTION_ERROR',
        message: error.message,
        stackTrace: error.stack,
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
 * Create a step executor
 */
export function createStepExecutor(
  ctx: ExecutionContext,
  plan: SimulationPlan,
  agentManager: AgentLifecycleManager,
  integrationManager: IntegrationAdapterManager
): StepExecutor {
  return new StepExecutor(ctx, plan, agentManager, integrationManager);
}
