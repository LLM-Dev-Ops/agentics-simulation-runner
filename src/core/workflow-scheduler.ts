/**
 * Workflow Scheduler (MOD-006)
 *
 * Manages workflow step scheduling and execution ordering.
 * This is the main module for the Workflow Scheduler component
 * in the EXECUTION CORE layer.
 *
 * Responsibilities:
 * - Build execution order from workflow dependencies (topological sort)
 * - Identify parallelization opportunities
 * - Get next steps ready for execution
 * - Dispatch steps to appropriate executors by type
 * - Handle step-level timeout and recording
 *
 * @module core/workflow-scheduler
 * @see SPARC_PSEUDOCODE.md Section 3.2 - buildExecutionOrder
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
} from '../types/common.js';

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
  WorkflowDefinition,
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

import type { OrchestrationStepResult } from '../orchestration/types.js';

import {
  topologicalSort,
  getDependencies,
  getDependents,
  findParallelGroups,
  type Dependency,
  type Step,
  CyclicDependencyError,
} from '../utils/topological-sort.js';

import {
  ExecutionOrder,
  ExecutionOrderBuilder,
  areDependenciesSatisfied,
  getReadySteps,
} from './execution-order.js';

import { computeObjectHash } from './hash-utils.js';

import {
  ConditionalEvaluator,
  createConditionalEvaluator,
  evaluateConditional,
  type ConditionalResult,
} from './conditional-evaluator.js';

import {
  ParallelExecutor,
  createParallelExecutor,
  executeParallelSteps,
  type ParallelResult,
  type StepExecutorInterface,
} from './parallel-executor.js';

import {
  LoopExecutor,
  createLoopExecutor,
  executeLoop,
  type LoopResult,
} from './loop-executor.js';

// =============================================================================
// External Executor Interfaces (for dependency injection)
// =============================================================================

/**
 * Result of an agent invocation (workflow-specific)
 */
export interface WorkflowAgentInvocationResult {
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
 * Result of an integration call (workflow-specific)
 */
export interface WorkflowIntegrationCallResult {
  readonly success: boolean;
  readonly outputs: Record<string, unknown>;
  readonly latencyMs: DurationMs;
  readonly error?: string;
  readonly statusCode?: number;
}

/**
 * Interface for Agent Lifecycle Manager (MOD-007)
 * Handles agent invocation and lifecycle.
 *
 * This is an interface for dependency injection to avoid
 * circular dependencies with the actual AgentLifecycleManager class.
 */
export interface IAgentLifecycleManager {
  /**
   * Invoke an agent to perform an action
   */
  invokeAgent(
    ctx: ExecutionContext,
    agent: AgentDefinition,
    action: string,
    inputs: Record<string, unknown>
  ): Promise<WorkflowAgentInvocationResult>;
}

/**
 * Interface for Integration Adapter Manager (MOD-008)
 * Handles external integration calls.
 *
 * This is an interface for dependency injection to avoid
 * circular dependencies with the actual IntegrationAdapterManager class.
 */
export interface IIntegrationAdapterManager {
  /**
   * Execute an integration call
   */
  executeIntegration(
    ctx: ExecutionContext,
    integration: IntegrationEndpoint,
    inputs: Record<string, unknown>
  ): Promise<WorkflowIntegrationCallResult>;
}

// =============================================================================
// Workflow Scheduler Options
// =============================================================================

/**
 * Options for the workflow scheduler
 */
export interface WorkflowSchedulerOptions {
  /**
   * Default step timeout in milliseconds
   */
  readonly defaultStepTimeoutMs: DurationMs;

  /**
   * Whether to enable parallel execution optimization
   */
  readonly enableParallelExecution: boolean;

  /**
   * Maximum concurrent step executions
   */
  readonly maxConcurrentSteps: number;

  /**
   * Whether to continue on recoverable errors
   */
  readonly continueOnError: boolean;

  /**
   * Whether to create automatic checkpoints
   */
  readonly autoCheckpoint: boolean;

  /**
   * Checkpoint interval (steps between checkpoints)
   */
  readonly checkpointInterval: number;
}

/**
 * Default scheduler options
 */
export const DEFAULT_SCHEDULER_OPTIONS: WorkflowSchedulerOptions = {
  defaultStepTimeoutMs: 30000, // 30 seconds
  enableParallelExecution: true,
  maxConcurrentSteps: 10,
  continueOnError: false,
  autoCheckpoint: true,
  checkpointInterval: 100,
};

// =============================================================================
// Workflow Scheduler Class
// =============================================================================

/**
 * Manages workflow step scheduling and execution ordering
 *
 * This is the main class for MOD-006 (Workflow Scheduler) in the
 * EXECUTION CORE layer. It handles:
 *
 * - Building execution order from workflow dependencies
 * - Identifying parallelization opportunities
 * - Getting next steps ready for execution
 * - Dispatching steps to appropriate executors
 * - Recording step execution results
 *
 * Invariants enforced:
 * - INV-EX-004: Dependency ordering - steps execute only after dependencies complete
 */
export class WorkflowScheduler implements StepExecutorInterface {
  private readonly ctx: ExecutionContext;
  private readonly plan: SimulationPlan;
  private readonly options: WorkflowSchedulerOptions;
  private readonly agentManager: IAgentLifecycleManager;
  private readonly integrationManager: IIntegrationAdapterManager;

  private executionOrder: ExecutionOrder | null = null;
  private completedSteps: Set<string> = new Set();
  private inProgressSteps: Set<string> = new Set();
  private stepResults: Map<string, OrchestrationStepResult> = new Map();

  // Internal executors
  private readonly conditionalEvaluator: ConditionalEvaluator;
  private readonly parallelExecutor: ParallelExecutor;
  private readonly loopExecutor: LoopExecutor;

  constructor(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    agentManager: IAgentLifecycleManager,
    integrationManager: IIntegrationAdapterManager,
    options: Partial<WorkflowSchedulerOptions> = {}
  ) {
    this.ctx = ctx;
    this.plan = plan;
    this.agentManager = agentManager;
    this.integrationManager = integrationManager;
    this.options = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };

    // Initialize internal executors
    this.conditionalEvaluator = createConditionalEvaluator(ctx);
    this.parallelExecutor = createParallelExecutor(ctx, this);
    this.loopExecutor = createLoopExecutor(ctx, this);
  }

  // ===========================================================================
  // Execution Order Building
  // ===========================================================================

  /**
   * Build execution order from workflow definition
   *
   * Topologically sorts steps by dependencies and identifies
   * parallelization opportunities.
   *
   * @param workflow - Optional workflow definition (uses plan's workflow if not provided)
   * @returns ExecutionOrder with sorted steps and parallel groups
   * @throws CyclicDependencyError if the workflow has circular dependencies
   *
   * @see SPARC_PSEUDOCODE.md Section 3.2 - buildExecutionOrder
   */
  buildExecutionOrder(workflow?: WorkflowDefinition): ExecutionOrder {
    const workflowSteps = workflow?.steps ?? this.plan.workflow.steps;
    const workflowId = workflow?.id ?? this.plan.planId;
    const dependencyConfig = this.plan.workflow.dependencies ?? {};

    // Convert steps to the format expected by topological sort
    const stepsForSort: Step[] = workflowSteps.map((step) => ({
      stepId: step.id,
      ...step,
    }));

    // Build dependency edges
    const dependencies: Dependency[] = [];

    // From explicit step dependencies
    for (const step of workflowSteps) {
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          dependencies.push({ from: depId, to: step.id });
        }
      }
    }

    // From workflow-level dependency config
    for (const [stepId, deps] of Object.entries(dependencyConfig)) {
      for (const depId of deps) {
        // Avoid duplicates
        const exists = dependencies.some(
          (d) => d.from === depId && d.to === stepId
        );
        if (!exists) {
          dependencies.push({ from: depId, to: stepId });
        }
      }
    }

    // Perform topological sort
    const sortedSteps = topologicalSort(dependencies, stepsForSort);

    // Map back to WorkflowStep
    const stepMap = new Map(workflowSteps.map((s) => [s.id, s]));
    const orderedSteps = sortedSteps.map((s) => stepMap.get(s.stepId)!);

    // Find parallel groups
    const parallelGroups = findParallelGroups(stepsForSort, dependencies);

    // Build the ExecutionOrder
    const builder = new ExecutionOrderBuilder();
    builder.setWorkflowId(workflowId);
    builder.setSteps(orderedSteps);

    // Add parallel groups and step levels
    parallelGroups.forEach((group, level) => {
      for (const step of group) {
        builder.addToParallelGroup(level, step.stepId);
      }
    });

    // Add dependency information
    for (const step of orderedSteps) {
      const deps = getDependencies(step.id, dependencies);
      const dependents = getDependents(step.id, dependencies);
      builder.setDependencies(step.id, deps);
      builder.setDependents(step.id, dependents);
    }

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(orderedSteps, dependencies);
    builder.setCriticalPath(criticalPath);

    // Compute hash for the execution order
    const orderHash = computeObjectHash({
      workflowId,
      steps: orderedSteps.map((s) => s.id),
      dependencies,
    });

    this.executionOrder = builder.build(orderHash);
    return this.executionOrder;
  }

  /**
   * Calculate the critical path through the dependency graph
   */
  private calculateCriticalPath(
    steps: readonly WorkflowStep[],
    dependencies: Dependency[]
  ): string[] {
    // Build adjacency list for longest path calculation
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const step of steps) {
      graph.set(step.id, []);
      inDegree.set(step.id, 0);
    }

    for (const dep of dependencies) {
      graph.get(dep.from)?.push(dep.to);
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
    }

    // Find longest path using dynamic programming
    const dist = new Map<string, number>();
    const parent = new Map<string, string | null>();

    for (const step of steps) {
      dist.set(step.id, 0);
      parent.set(step.id, null);
    }

    // Process in topological order
    for (const step of steps) {
      const current = dist.get(step.id) ?? 0;
      for (const next of graph.get(step.id) ?? []) {
        const newDist = current + 1;
        if (newDist > (dist.get(next) ?? 0)) {
          dist.set(next, newDist);
          parent.set(next, step.id);
        }
      }
    }

    // Find the endpoint of the longest path
    let maxDist = 0;
    let endNode: string | null = null;
    for (const [node, d] of dist) {
      if (d >= maxDist) {
        maxDist = d;
        endNode = node;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current = endNode;
    while (current !== null) {
      path.unshift(current);
      current = parent.get(current) ?? null;
    }

    return path;
  }

  // ===========================================================================
  // Step Retrieval
  // ===========================================================================

  /**
   * Get steps that are ready for execution
   *
   * Returns steps whose dependencies are all satisfied.
   *
   * @param completed - Set of completed step IDs (uses internal tracking if not provided)
   * @returns List of steps ready for execution
   */
  getNextSteps(completed?: Set<string>): WorkflowStep[] {
    if (!this.executionOrder) {
      throw new Error('Execution order not built. Call buildExecutionOrder first.');
    }

    const completedSet = completed ?? this.completedSteps;
    return getReadySteps(this.executionOrder, completedSet, this.inProgressSteps);
  }

  /**
   * Check if a specific step is ready for execution
   */
  isStepReady(stepId: string): boolean {
    if (!this.executionOrder) {
      return false;
    }
    if (this.completedSteps.has(stepId) || this.inProgressSteps.has(stepId)) {
      return false;
    }
    return areDependenciesSatisfied(stepId, this.executionOrder, this.completedSteps);
  }

  /**
   * Mark a step as in progress
   */
  markStepInProgress(stepId: string): void {
    this.inProgressSteps.add(stepId);
  }

  /**
   * Mark a step as completed
   */
  markStepCompleted(stepId: string, result: OrchestrationStepResult): void {
    this.inProgressSteps.delete(stepId);
    this.completedSteps.add(stepId);
    this.stepResults.set(stepId, result);
  }

  /**
   * Get result for a completed step
   */
  getStepResult(stepId: string): OrchestrationStepResult | undefined {
    return this.stepResults.get(stepId);
  }

  // ===========================================================================
  // Step Execution
  // ===========================================================================

  /**
   * Execute a workflow step
   *
   * Dispatches to the appropriate executor based on step type:
   * - AGENT_INVOCATION -> AgentLifecycleManager (MOD-007)
   * - INTEGRATION_CALL -> IntegrationAdapterManager (MOD-008)
   * - CONDITIONAL -> ConditionalEvaluator (internal)
   * - PARALLEL_GROUP -> ParallelExecutor (internal)
   * - LOOP -> LoopExecutor (internal)
   * - Other types -> Internal handlers
   *
   * @param step - The step to execute
   * @returns Step result with outputs and metrics
   *
   * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep
   */
  async executeStep(step: WorkflowStep): Promise<OrchestrationStepResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    // Get timeout for this step
    const stepTimeout = step.timeoutMs ?? this.options.defaultStepTimeoutMs;

    // Mark step as in progress
    this.markStepInProgress(step.id);

    // Start telemetry span
    const span = this.ctx.telemetry.startSpan(`step:${step.id}`, {
      stepType: step.stepType,
      stepName: step.name ?? step.id,
    });

    try {
      // Get pre-state hash
      const preStateHash = await this.ctx.stateNamespace.getStateHash();

      // Resolve inputs
      const resolvedInputs = await this.resolveStepInputs(step);

      // Execute with timeout
      const result = await this.executeWithTimeout(
        step,
        resolvedInputs,
        startedAt,
        startTime,
        preStateHash,
        stepTimeout
      );

      // Record result
      this.markStepCompleted(step.id, result);
      span.end();

      return result;
    } catch (error) {
      span.recordError(error instanceof Error ? error : new Error(String(error)));
      span.end();

      const errorResult = this.createErrorResult(
        step,
        startedAt,
        startTime,
        error instanceof Error ? error : new Error(String(error))
      );

      this.markStepCompleted(step.id, errorResult);
      return errorResult;
    }
  }

  /**
   * Execute a step with timeout handling
   */
  private async executeWithTimeout(
    step: WorkflowStep,
    resolvedInputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash,
    timeoutMs: DurationMs
  ): Promise<OrchestrationStepResult> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Step ${step.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const executionPromise = this.dispatchStep(
      step,
      resolvedInputs,
      startedAt,
      startMs,
      preStateHash
    );

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Dispatch step to appropriate executor
   */
  private async dispatchStep(
    step: WorkflowStep,
    resolvedInputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    switch (step.stepType) {
      case 'AGENT_INVOCATION':
        return this.executeAgentInvocation(
          step as AgentInvocationStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'INTEGRATION_CALL':
        return this.executeIntegrationCall(
          step as IntegrationCallStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'CONDITIONAL':
        return this.executeConditionalStep(
          step as ConditionalStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'PARALLEL_GROUP':
        return this.executeParallelGroupStep(
          step as ParallelGroupStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'LOOP':
        return this.executeLoopStep(
          step as LoopStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'CHECKPOINT':
        return this.executeCheckpointStep(
          step as CheckpointStep,
          startedAt,
          startMs,
          preStateHash
        );

      case 'DELAY':
        return this.executeDelayStep(
          step as DelayStep,
          startedAt,
          startMs,
          preStateHash
        );

      case 'STATE_MUTATION':
        return this.executeStateMutationStep(
          step as StateMutationStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      case 'EVENT_EMIT':
        return this.executeEventEmitStep(
          step as EventEmitStep,
          resolvedInputs,
          startedAt,
          startMs,
          preStateHash
        );

      default:
        throw new Error(`Unknown step type: ${(step as WorkflowStep).stepType}`);
    }
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
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const agent = this.plan.agents.find((a) => a.id === step.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${step.agentId}`);
    }

    const result = await this.agentManager.invokeAgent(
      this.ctx,
      agent,
      step.action,
      inputs
    );

    if (!result.success) {
      throw new Error(result.error ?? 'Agent invocation failed');
    }

    // Store outputs
    await this.storeStepOutputs(step, result.outputs);

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      agentId: step.agentId,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: result.outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      llmInteraction: result.llmDetails ? {
        provider: result.llmDetails.provider,
        model: result.llmDetails.model,
        promptTokens: result.llmDetails.promptTokens,
        completionTokens: result.llmDetails.completionTokens,
        totalTokens: result.llmDetails.promptTokens + result.llmDetails.completionTokens,
        latencyMs: result.latencyMs,
      } : undefined,
      waitedForDependencies: this.getWaitedDependencies(step.id),
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
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const integration = this.plan.integrations?.find((i) => i.id === step.integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${step.integrationId}`);
    }

    const result = await this.integrationManager.executeIntegration(
      this.ctx,
      integration,
      inputs
    );

    if (!result.success) {
      throw new Error(result.error ?? 'Integration call failed');
    }

    // Store outputs
    await this.storeStepOutputs(step, result.outputs);

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: result.outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a conditional step
   */
  private async executeConditionalStep(
    step: ConditionalStep,
    inputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const condResult = await evaluateConditional(this.ctx, step);

    const outputs: Record<string, unknown> = {
      conditionResult: condResult.result,
      executedBranch: condResult.branch,
    };

    // Execute inline branch steps if present
    if (typeof condResult.branchTarget !== 'string' && Array.isArray(condResult.branchTarget)) {
      const branchResults = [];
      for (const branchStep of condResult.branchTarget) {
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
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs,
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a parallel group step
   */
  private async executeParallelGroupStep(
    step: ParallelGroupStep,
    inputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const parallelResult = await executeParallelSteps(
      this.ctx,
      step,
      this,
      preStateHash
    );

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: parallelResult.status,
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: {
        parallelResults: parallelResult.stepResults,
        successfulSteps: parallelResult.successfulSteps,
        failedSteps: parallelResult.failedSteps,
        parallelismEfficiency: parallelResult.parallelismEfficiency,
      },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      error: parallelResult.errors.length > 0 ? {
        code: 'PARALLEL_EXECUTION_ERRORS',
        message: `${parallelResult.errors.length} errors during parallel execution`,
      } : undefined,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a loop step
   */
  private async executeLoopStep(
    step: LoopStep,
    inputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const loopResult = await executeLoop(this.ctx, step, this, preStateHash);

    const postStateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: loopResult.status,
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: {
        iterationCount: loopResult.iterationCount,
        iterationResults: loopResult.iterationResults,
        terminationReason: loopResult.terminationReason,
      },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash,
      error: loopResult.errors.length > 0 ? {
        code: 'LOOP_EXECUTION_ERRORS',
        message: `${loopResult.errors.length} errors during loop execution`,
      } : undefined,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a checkpoint step
   */
  private async executeCheckpointStep(
    step: CheckpointStep,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const checkpoint = await this.ctx.checkpointManager.create(step.label, step.id);

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: {},
      outputs: {
        checkpointId: checkpoint.checkpointId,
        label: step.label,
      },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash,
      checkpointId: checkpoint.checkpointId,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a delay step
   */
  private async executeDelayStep(
    step: DelayStep,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    await new Promise((resolve) => setTimeout(resolve, step.delayMs));

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: {},
      outputs: { delayedMs: step.delayMs },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute a state mutation step
   */
  private async executeStateMutationStep(
    step: StateMutationStep,
    inputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    const transaction = await this.ctx.stateNamespace.beginTransaction();

    try {
      for (const [key, value] of Object.entries(step.mutations)) {
        let resolvedValue = value;

        if (step.evaluateExpressions && typeof value === 'string') {
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
      startedAt,
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
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  /**
   * Execute an event emit step
   */
  private async executeEventEmitStep(
    step: EventEmitStep,
    inputs: Record<string, unknown>,
    startedAt: ISO8601Timestamp,
    startMs: number,
    preStateHash: SHA256Hash
  ): Promise<OrchestrationStepResult> {
    this.ctx.telemetry.emitEvent(step.eventType, {
      stepId: step.id,
      payload: step.payload,
      timestamp: new Date().toISOString(),
    });

    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Date.now() - startMs,
      inputsSnapshot: inputs,
      outputs: { eventEmitted: step.eventType },
      sequenceNumber: this.ctx.currentStepSequence,
      preStateHash,
      postStateHash: preStateHash,
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  // ===========================================================================
  // Input/Output Resolution
  // ===========================================================================

  /**
   * Resolve step inputs from static values and state
   */
  private async resolveStepInputs(step: WorkflowStep): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};

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
        const value = await this.ctx.stateNamespace.get(stateKey);
        resolved[stateKey] = value;
      }
    }

    // Apply transformations
    if (inputs.transformations) {
      for (const [key, expression] of Object.entries(inputs.transformations)) {
        resolved[key] = expression;
      }
    }

    return resolved;
  }

  /**
   * Store step outputs to state
   */
  private async storeStepOutputs(
    step: WorkflowStep,
    outputs: Record<string, unknown>
  ): Promise<void> {
    if (!('outputs' in step) || !step.outputs) {
      return;
    }

    const outputSpec = step.outputs;

    for (const stateKey of outputSpec.stateKeys) {
      if (stateKey in outputs) {
        await this.ctx.stateNamespace.set(stateKey, outputs[stateKey]);
      }
    }

    if (outputSpec.emitEvents) {
      for (const eventType of outputSpec.emitEvents) {
        this.ctx.telemetry.emitEvent(eventType, {
          stepId: step.id,
          outputs,
        });
      }
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get dependencies that this step waited for
   */
  private getWaitedDependencies(stepId: string): string[] {
    if (!this.executionOrder) return [];
    const deps = this.executionOrder.dependencyMap.get(stepId);
    return deps ? [...deps] : [];
  }

  /**
   * Create an error result
   */
  private createErrorResult(
    step: WorkflowStep,
    startedAt: ISO8601Timestamp,
    startMs: number,
    error: Error
  ): OrchestrationStepResult {
    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'failure',
      startedAt,
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
      waitedForDependencies: this.getWaitedDependencies(step.id),
      dependencyWaitTimeMs: 0,
      skipped: false,
    };
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  /**
   * Get the current execution order
   */
  getExecutionOrder(): ExecutionOrder | null {
    return this.executionOrder;
  }

  /**
   * Get all completed steps
   */
  getCompletedSteps(): ReadonlySet<string> {
    return this.completedSteps;
  }

  /**
   * Get all in-progress steps
   */
  getInProgressSteps(): ReadonlySet<string> {
    return this.inProgressSteps;
  }

  /**
   * Get all step results
   */
  getAllStepResults(): ReadonlyMap<string, OrchestrationStepResult> {
    return this.stepResults;
  }

  /**
   * Check if all steps are completed
   */
  isComplete(): boolean {
    if (!this.executionOrder) return false;
    return this.completedSteps.size === this.executionOrder.steps.length;
  }

  /**
   * Reset scheduler state
   */
  reset(): void {
    this.completedSteps.clear();
    this.inProgressSteps.clear();
    this.stepResults.clear();
    this.executionOrder = null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a workflow scheduler
 *
 * @param ctx - Execution context
 * @param plan - Simulation plan
 * @param agentManager - Agent lifecycle manager (MOD-007)
 * @param integrationManager - Integration adapter manager (MOD-008)
 * @param options - Scheduler options
 * @returns WorkflowScheduler instance
 */
export function createWorkflowScheduler(
  ctx: ExecutionContext,
  plan: SimulationPlan,
  agentManager: IAgentLifecycleManager,
  integrationManager: IIntegrationAdapterManager,
  options?: Partial<WorkflowSchedulerOptions>
): WorkflowScheduler {
  return new WorkflowScheduler(ctx, plan, agentManager, integrationManager, options);
}

// =============================================================================
// Re-exports
// =============================================================================

export {
  ExecutionOrder,
  ExecutionOrderBuilder,
  areDependenciesSatisfied,
  getReadySteps,
} from './execution-order.js';

export {
  ConditionalEvaluator,
  createConditionalEvaluator,
  evaluateConditional,
  type ConditionalResult,
} from './conditional-evaluator.js';

export {
  ParallelExecutor,
  createParallelExecutor,
  executeParallelSteps,
  type ParallelResult,
  type StepExecutorInterface,
} from './parallel-executor.js';

export {
  LoopExecutor,
  createLoopExecutor,
  executeLoop,
  type LoopResult,
} from './loop-executor.js';
