/**
 * Execution Orchestrator (MOD-004)
 *
 * Central coordinator for workflow execution. Manages the complete lifecycle
 * of a simulation execution from initialization through completion or failure.
 *
 * Implements:
 * - INV-EX-001: Deterministic execution with identical results for identical inputs
 * - INV-EX-002: Preconditions validated before step execution
 * - INV-EX-003: Execution completes fully or rollback to valid state
 * - INV-EX-004: Step dependencies respected (topological order)
 * - INV-EX-005: Parallel steps have no shared mutable state
 * - INV-EX-006: Maximum duration enforced (deadline tracking)
 * - INV-EX-007: Resource limits continuously monitored
 *
 * @module orchestration/execution-orchestrator
 * @see SPARC_PSEUDOCODE.md Section 5 - Execution Orchestrator
 * @see SPARC_ARCHITECTURE.md MOD-004
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  DurationSeconds,
  ExecutionStatus,
  StepStatus,
  Metadata,
  LogLevel,
} from '../types/common.js';

import type {
  ExecutionContext,
  Checkpoint,
  CheckpointInfo,
} from '../types/execution-context.js';

import type {
  WorkflowStep,
  WorkflowStepResult,
} from '../types/workflow.js';

import type {
  SimulationPlan,
  AgentDefinition,
  IntegrationEndpoint,
  ExecutionConfig,
} from '../types/simulation-plan.js';

import type {
  SimulationResult,
  StepResult,
  ExecutionSummary,
  ExecutionTelemetry,
  FinalState,
  AgentSummary,
  IntegrationObservation,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
  ExecutionError,
  OrchestrationStepResult,
  PauseResult,
  ResumeResult,
  AbortResult,
  ExecutionOrder,
  ExecutionOptions,
  OrchestrationEventType,
  OrchestrationEvent,
  CheckpointInfo as OrchestratorCheckpointInfo,
  DependencyResolution,
} from './types.js';

import { DEFAULT_EXECUTION_OPTIONS } from './types.js';

import {
  topologicalSort,
  getDependencies,
  getDependents,
  findParallelGroups,
  type Dependency,
} from '../utils/topological-sort.js';

import {
  ExecutionCheckpointManager,
  InMemoryCheckpointStorage,
  createCheckpointManager,
  type CreateCheckpointOptions,
} from './checkpoint-manager.js';

import {
  FailureHandler,
  createFailureHandler,
  classifyErrorSeverity,
} from './failure-handler.js';

import {
  StepExecutor,
  createStepExecutor,
  type AgentLifecycleManager,
  type IntegrationAdapterManager,
} from './step-executor.js';

import { computeObjectHash } from '../core/hash-utils.js';

// =============================================================================
// Orchestration State
// =============================================================================

/**
 * Internal state of the orchestrator during execution
 */
interface OrchestratorState {
  status: ExecutionStatus;
  currentStepIndex: number;
  completedStepIds: Set<string>;
  stepResults: Map<string, OrchestrationStepResult>;
  errors: ExecutionError[];
  startTime: Date;
  deadline: Date;
  pausedAt?: Date;
  abortReason?: string;
  rolledBack: boolean;
  rollbackCheckpointId?: UUID;
}

// =============================================================================
// Execution Orchestrator
// =============================================================================

/**
 * Central coordinator for workflow execution
 *
 * Responsibilities:
 * - Build execution order from dependency graph (INV-EX-004)
 * - Track deadline and enforce maximum duration (INV-EX-006)
 * - Execute steps in topological order
 * - Create checkpoints at defined intervals
 * - Handle failures with retry, fallback, or rollback
 * - Support pause/resume/abort operations
 *
 * @see SPARC_PSEUDOCODE.md Section 5.1 - execute(ctx, plan)
 */
export class ExecutionOrchestrator {
  private state: OrchestratorState;
  private readonly checkpointManager: ExecutionCheckpointManager;
  private readonly failureHandler: FailureHandler;
  private readonly stepExecutor: StepExecutor;
  private readonly executionOrder: ExecutionOrder;
  private readonly options: ExecutionOptions;
  private readonly eventListeners: Set<(event: OrchestrationEvent) => void> = new Set();

  /**
   * Create a new execution orchestrator
   *
   * @param ctx - Execution context with state, random generator, etc.
   * @param plan - The simulation plan to execute
   * @param agentManager - Manager for agent lifecycle (MOD-007)
   * @param integrationManager - Manager for integrations (MOD-008)
   * @param options - Execution options
   */
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan,
    agentManager: AgentLifecycleManager,
    integrationManager: IntegrationAdapterManager,
    options: Partial<ExecutionOptions> = {}
  ) {
    this.options = { ...DEFAULT_EXECUTION_OPTIONS, ...options };

    // Initialize state
    const startTime = new Date();
    const maxDurationMs = plan.executionConfig.timeoutSeconds * 1000;
    const deadline = new Date(startTime.getTime() + maxDurationMs);

    this.state = {
      status: 'pending',
      currentStepIndex: 0,
      completedStepIds: new Set(),
      stepResults: new Map(),
      errors: [],
      startTime,
      deadline,
      rolledBack: false,
    };

    // Build execution order from dependency graph (INV-EX-004)
    this.executionOrder = this.buildExecutionOrder();

    // Initialize checkpoint manager
    this.checkpointManager = createCheckpointManager(ctx.executionId);

    // Initialize failure handler
    this.failureHandler = createFailureHandler(ctx, plan, this.checkpointManager);

    // Initialize step executor
    this.stepExecutor = createStepExecutor(ctx, plan, agentManager, integrationManager);

    // Register event listeners
    if (options.eventListeners) {
      for (const listener of options.eventListeners) {
        this.eventListeners.add(listener.onEvent.bind(listener));
      }
    }
  }

  // ===========================================================================
  // Main Execution Interface
  // ===========================================================================

  /**
   * Execute the complete workflow
   *
   * Algorithm:
   * 1. Build execution order using topologicalSort (INV-EX-004)
   * 2. Track deadline = startTime + maxDuration (INV-EX-006)
   * 3. For each step in order:
   *    a. Check deadline
   *    b. Wait for dependencies to complete
   *    c. Execute step via StepExecutor
   *    d. Create checkpoint if defined
   *    e. Handle failures (rollback if critical, continue if not)
   * 4. Return WorkflowResult
   *
   * @returns Comprehensive workflow execution result
   *
   * @see SPARC_PSEUDOCODE.md Section 5.1
   */
  async execute(): Promise<WorkflowResult> {
    this.state.status = 'running';
    this.ctx.status = 'running';
    this.emitEvent('EXECUTION_STARTED', { planId: this.plan.planId });

    try {
      // Create initial checkpoint
      if (this.options.autoCheckpoint) {
        await this.createCheckpoint('initial', undefined);
      }

      // Execute steps in topological order
      for (let i = 0; i < this.executionOrder.orderedSteps.length; i++) {
        // Check for cancellation
        if (this.ctx.isCancelled()) {
          this.state.status = 'cancelled';
          this.state.abortReason = this.ctx.getCancellationReason();
          break;
        }

        // Check deadline (INV-EX-006)
        if (this.isDeadlineExceeded()) {
          this.state.status = 'timeout';
          this.emitEvent('DEADLINE_WARNING', { remaining: 0 });
          break;
        }

        // Check deadline warning
        if (this.isDeadlineWarningThreshold()) {
          this.emitEvent('DEADLINE_WARNING', {
            remainingMs: this.state.deadline.getTime() - Date.now(),
          });
        }

        // Check resource limits (INV-EX-007)
        if (this.ctx.resourceManager.isAnyLimitExceeded()) {
          this.emitEvent('RESOURCE_WARNING', {
            usage: this.ctx.resourceManager.snapshot(),
          });
        }

        const step = this.executionOrder.orderedSteps[i];
        this.state.currentStepIndex = i;
        this.ctx.currentStepId = step.id;
        this.ctx.currentStepSequence++;

        // Wait for dependencies to complete
        const dependencyResolution = await this.waitForDependencies(step);
        if (!dependencyResolution.allSatisfied) {
          // Skip step due to unmet dependencies
          const skipResult = this.createSkippedResult(
            step,
            `Dependencies not satisfied: ${dependencyResolution.blockedBy.join(', ')}`
          );
          this.state.stepResults.set(step.id, skipResult);
          this.emitEvent('STEP_SKIPPED', {
            stepId: step.id,
            reason: 'Dependencies not satisfied',
          });
          continue;
        }

        // Execute the step
        try {
          this.emitEvent('STEP_STARTED', {
            stepId: step.id,
            stepType: step.stepType,
          });

          const result = await this.executeStepWithRetry(step);

          this.state.stepResults.set(step.id, result);
          this.state.completedStepIds.add(step.id);

          if (result.status === 'success') {
            this.emitEvent('STEP_COMPLETED', {
              stepId: step.id,
              durationMs: result.durationMs,
            });
          } else {
            this.emitEvent('STEP_FAILED', {
              stepId: step.id,
              error: result.error,
            });
          }

          // Create checkpoint if needed
          if (this.shouldCreateCheckpoint(step, i)) {
            await this.createCheckpoint(`after-${step.id}`, step.id);
          }
        } catch (error) {
          // Handle step failure
          const failureResult = await this.failureHandler.handleStepFailure(
            step,
            error instanceof Error ? error : new Error(String(error)),
            0
          );

          if (!failureResult.continueExecution) {
            // Rollback or abort
            if (failureResult.action === 'ROLLBACK') {
              this.state.rolledBack = true;
              this.state.rollbackCheckpointId = failureResult.actionResult?.rolledBackTo;
            }
            this.state.status = 'failed';
            break;
          }

          // Record error and continue
          this.state.errors.push(failureResult.error);
        }
      }

      // Finalize execution
      if (this.state.status === 'running') {
        this.state.status = 'completed';
      }

      // Build and return result
      const result = await this.buildWorkflowResult();
      this.emitEvent(
        this.state.status === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
        { status: this.state.status }
      );

      return result;
    } catch (error) {
      this.state.status = 'failed';
      this.state.errors.push({
        errorId: uuidv4() as UUID,
        errorCode: 'ORCHESTRATION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        severity: 'FATAL',
        timestamp: new Date().toISOString() as ISO8601Timestamp,
        recoverable: false,
        recoveryAttempted: false,
      });

      this.emitEvent('EXECUTION_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.buildWorkflowResult();
    }
  }

  /**
   * Pause execution at the next checkpoint
   *
   * @returns Pause result with checkpoint for resumption
   */
  async pause(): Promise<PauseResult> {
    if (this.state.status !== 'running') {
      return {
        success: false,
        pausedAt: new Date().toISOString() as ISO8601Timestamp,
        checkpoint: undefined as unknown as Checkpoint,
        completedStepIds: Array.from(this.state.completedStepIds),
        remainingStepIds: this.getRemainingStepIds(),
      };
    }

    // Create checkpoint for resumption
    const checkpoint = await this.checkpointManager.createCheckpoint(this.ctx, {
      label: 'pause-checkpoint',
      stepId: this.ctx.currentStepId,
      captureState: true,
      captureMetrics: true,
      captureVectorMemory: true,
    });

    this.state.pausedAt = new Date();
    this.state.status = 'pending'; // Paused state

    this.emitEvent('EXECUTION_PAUSED', {
      checkpointId: checkpoint.checkpointId,
      completedSteps: this.state.completedStepIds.size,
    });

    return {
      success: true,
      pausedAt: this.state.pausedAt.toISOString() as ISO8601Timestamp,
      checkpoint,
      interruptedStepId: this.ctx.currentStepId,
      completedStepIds: Array.from(this.state.completedStepIds),
      remainingStepIds: this.getRemainingStepIds(),
    };
  }

  /**
   * Resume paused execution
   *
   * @returns Resume result
   */
  async resume(): Promise<ResumeResult> {
    if (!this.state.pausedAt) {
      return {
        success: false,
        resumedAt: new Date().toISOString() as ISO8601Timestamp,
        restoredFromCheckpoint: '' as UUID,
        pauseDurationMs: 0,
      };
    }

    const latestCheckpoint = await this.checkpointManager.getLatestCheckpoint();
    if (!latestCheckpoint) {
      return {
        success: false,
        resumedAt: new Date().toISOString() as ISO8601Timestamp,
        restoredFromCheckpoint: '' as UUID,
        pauseDurationMs: 0,
      };
    }

    // Restore from checkpoint
    const restored = await this.checkpointManager.restoreCheckpoint(
      this.ctx,
      latestCheckpoint.checkpointId
    );

    if (!restored) {
      return {
        success: false,
        resumedAt: new Date().toISOString() as ISO8601Timestamp,
        restoredFromCheckpoint: latestCheckpoint.checkpointId,
        pauseDurationMs: Date.now() - this.state.pausedAt.getTime(),
      };
    }

    const pauseDurationMs = Date.now() - this.state.pausedAt.getTime();

    // Adjust deadline for pause duration
    this.state.deadline = new Date(this.state.deadline.getTime() + pauseDurationMs);
    this.state.pausedAt = undefined;
    this.state.status = 'running';

    this.emitEvent('EXECUTION_RESUMED', {
      checkpointId: latestCheckpoint.checkpointId,
      pauseDurationMs,
    });

    return {
      success: true,
      resumedAt: new Date().toISOString() as ISO8601Timestamp,
      restoredFromCheckpoint: latestCheckpoint.checkpointId,
      resumingFromStepId: latestCheckpoint.stepId,
      pauseDurationMs,
    };
  }

  /**
   * Abort execution immediately
   *
   * @param reason - Reason for abort
   * @returns Abort result
   */
  async abort(reason: string): Promise<AbortResult> {
    const abortedAt = new Date().toISOString() as ISO8601Timestamp;

    // Cancel the execution context
    await this.ctx.cancel(reason);

    this.state.abortReason = reason;
    const abortedStepId = this.ctx.currentStepId;

    // Optionally trigger rollback
    let rolledBack = false;
    let rollbackCheckpointId: UUID | undefined;

    if (this.options.autoCheckpoint) {
      const rollbackResult = await this.failureHandler.rollbackExecution(reason);
      if (rollbackResult.success) {
        rolledBack = true;
        rollbackCheckpointId = rollbackResult.checkpointId;
        this.state.rolledBack = true;
        this.state.rollbackCheckpointId = rollbackCheckpointId;
      }
    }

    this.state.status = 'cancelled';

    this.emitEvent('EXECUTION_ABORTED', {
      reason,
      rolledBack,
      rollbackCheckpointId,
    });

    return {
      success: true,
      abortedAt,
      reason,
      abortedStepId,
      cleanupPerformed: true,
      rolledBack,
      rollbackCheckpointId,
    };
  }

  // ===========================================================================
  // Step Execution
  // ===========================================================================

  /**
   * Execute a step with retry support
   */
  private async executeStepWithRetry(
    step: WorkflowStep
  ): Promise<OrchestrationStepResult> {
    const maxRetries = step.controlFlow?.onFailure === 'retry'
      ? this.plan.executionConfig.retryPolicy?.maxRetries ?? 3
      : 0;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.emitEvent('STEP_RETRYING', {
            stepId: step.id,
            attempt,
            maxRetries,
          });

          // Apply backoff delay
          const backoffMs = this.calculateBackoffDelay(attempt);
          await this.delay(backoffMs);
        }

        const result = await this.stepExecutor.executeStep(step);

        if (result.status === 'success') {
          return result;
        }

        // Step returned failure status
        if (result.error) {
          lastError = new Error(result.error.message);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (attempt < maxRetries && this.isRetryableError(lastError)) {
          continue;
        }

        throw lastError;
      }
    }

    // All retries exhausted
    throw lastError || new Error('Step execution failed after retries');
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorCode = 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNKNOWN';
    return classifyErrorSeverity(errorCode, {} as WorkflowStep) === 'RECOVERABLE';
  }

  /**
   * Calculate backoff delay for retry
   */
  private calculateBackoffDelay(attempt: number): number {
    const policy = this.plan.executionConfig.retryPolicy;
    if (!policy) {
      return 1000 * attempt; // Default linear backoff
    }

    const baseDelay = policy.initialDelayMs;
    const maxDelay = policy.maxDelayMs ?? 30000;

    if (policy.backoffStrategy === 'exponential') {
      return Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    }

    return Math.min(baseDelay * attempt, maxDelay);
  }

  /**
   * Create a skipped result for a step
   */
  private createSkippedResult(
    step: WorkflowStep,
    reason: string
  ): OrchestrationStepResult {
    const now = new Date().toISOString() as ISO8601Timestamp;
    return {
      stepId: step.id,
      workflowId: this.plan.planId,
      status: 'skipped',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      inputsSnapshot: {},
      outputs: {},
      sequenceNumber: this.ctx.currentStepSequence,
      waitedForDependencies: [],
      dependencyWaitTimeMs: 0,
      skipped: true,
      skipReason: reason,
    };
  }

  // ===========================================================================
  // Dependency Management
  // ===========================================================================

  /**
   * Build execution order from dependency graph
   * Enforces INV-EX-004: Step dependencies respected
   */
  private buildExecutionOrder(): ExecutionOrder {
    const steps = this.plan.workflow.steps;
    const dependencies = this.plan.workflow.dependencies || {};

    // Convert dependency map to edges format
    const edges: Dependency[] = [];
    if (dependencies && typeof dependencies === 'object') {
      for (const [stepId, deps] of Object.entries(dependencies)) {
        if (Array.isArray(deps)) {
          for (const depId of deps) {
            edges.push({ from: depId, to: stepId });
          }
        }
      }
    }

    // Build step objects with required stepId field
    const stepObjects = steps.map((s) => ({
      ...s,
      stepId: s.id,
    }));

    // Topological sort
    const sortedSteps = topologicalSort(edges, stepObjects);

    // Build dependency maps
    const dependencyMap = new Map<string, readonly string[]>();
    const dependentMap = new Map<string, readonly string[]>();

    for (const step of sortedSteps) {
      dependencyMap.set(step.id, getDependencies(step.id, edges));
      dependentMap.set(step.id, getDependents(step.id, edges));
    }

    // Find parallel groups
    const parallelGroups = findParallelGroups(stepObjects, edges);

    return {
      orderedSteps: sortedSteps.map((s) => {
        const { stepId, ...rest } = s;
        return rest as WorkflowStep;
      }),
      dependencyMap,
      dependentMap,
      parallelGroups: parallelGroups.map((group) =>
        group.map((s) => {
          const { stepId, ...rest } = s;
          return rest as WorkflowStep;
        })
      ),
    };
  }

  /**
   * Wait for a step's dependencies to complete
   */
  private async waitForDependencies(step: WorkflowStep): Promise<DependencyResolution> {
    const dependencies = this.executionOrder.dependencyMap.get(step.id) || [];
    const resolvedDeps = [];
    const blockedBy: string[] = [];

    for (const depId of dependencies) {
      const depResult = this.state.stepResults.get(depId);
      const completed = this.state.completedStepIds.has(depId);

      resolvedDeps.push({
        dependencyStepId: depId,
        completed,
        result: depResult,
      });

      if (!completed) {
        blockedBy.push(depId);
      }
    }

    return {
      stepId: step.id,
      dependencies: resolvedDeps,
      allSatisfied: blockedBy.length === 0,
      blockedBy,
    };
  }

  // ===========================================================================
  // Checkpoint Management
  // ===========================================================================

  /**
   * Check if a checkpoint should be created after this step
   */
  private shouldCreateCheckpoint(step: WorkflowStep, stepIndex: number): boolean {
    if (!this.options.autoCheckpoint) {
      return false;
    }

    // Check if step has a checkpoint defined in the plan
    // Checkpoints can be either strings (step IDs) or objects with stepRef
    const checkpoints = this.plan.workflow.checkpoints || [];
    const hasDefinedCheckpoint = checkpoints.some((cp) => {
      if (typeof cp === 'string') {
        return cp === step.id;
      }
      return typeof cp === 'object' && cp !== null && 'stepRef' in cp && (cp as { stepRef: string }).stepRef === step.id;
    });
    if (hasDefinedCheckpoint) {
      return true;
    }

    // Check interval-based checkpoint
    if (
      this.options.checkpointInterval > 0 &&
      (stepIndex + 1) % this.options.checkpointInterval === 0
    ) {
      return true;
    }

    // Checkpoint after step types that are checkpoints
    if (step.stepType === 'CHECKPOINT') {
      return true;
    }

    return false;
  }

  /**
   * Create a checkpoint
   */
  private async createCheckpoint(label: string, stepId?: string): Promise<void> {
    const options: CreateCheckpointOptions = {
      label,
      stepId,
      captureState: true,
      captureMetrics: true,
      captureVectorMemory: true,
    };

    const checkpoint = await this.checkpointManager.createCheckpoint(this.ctx, options);

    this.emitEvent('CHECKPOINT_CREATED', {
      checkpointId: checkpoint.checkpointId,
      label,
      stepId,
      sequenceNumber: checkpoint.sequenceNumber,
    });
  }

  // ===========================================================================
  // Deadline and Resource Management
  // ===========================================================================

  /**
   * Check if deadline is exceeded (INV-EX-006)
   */
  private isDeadlineExceeded(): boolean {
    return Date.now() >= this.state.deadline.getTime();
  }

  /**
   * Check if deadline warning threshold is reached
   */
  private isDeadlineWarningThreshold(): boolean {
    const remaining = this.state.deadline.getTime() - Date.now();
    return remaining <= this.options.deadlineWarningThresholdMs && remaining > 0;
  }

  /**
   * Get remaining step IDs
   */
  private getRemainingStepIds(): string[] {
    return this.executionOrder.orderedSteps
      .filter((s) => !this.state.completedStepIds.has(s.id))
      .map((s) => s.id);
  }

  // ===========================================================================
  // Result Building
  // ===========================================================================

  /**
   * Build the comprehensive workflow result
   */
  private async buildWorkflowResult(): Promise<WorkflowResult> {
    const completedAt = new Date().toISOString() as ISO8601Timestamp;
    const durationMs = Date.now() - this.state.startTime.getTime();

    // Collect step results
    const stepResults: StepResult[] = [];
    for (const step of this.executionOrder.orderedSteps) {
      const result = this.state.stepResults.get(step.id);
      if (result) {
        stepResults.push(result);
      }
    }

    // Build agent summaries
    const agentSummaries = this.buildAgentSummaries();

    // Get integration observations
    const integrationObservations = this.stepExecutor.getIntegrationObservations();

    // Build final state
    const finalState = await this.buildFinalState();

    // Build execution summary
    const summary = this.buildExecutionSummary(stepResults, durationMs);

    // Build telemetry
    const telemetry = this.buildTelemetry();

    // Get checkpoints
    const checkpoints = this.checkpointManager.getCreatedCheckpoints();

    return {
      executionId: this.ctx.executionId,
      status: this.state.status,
      startedAt: this.state.startTime.toISOString() as ISO8601Timestamp,
      completedAt,
      durationMs,
      stepResults,
      agentSummaries,
      integrationObservations: Array.from(integrationObservations),
      finalState,
      summary,
      telemetry,
      errors: this.state.errors,
      checkpoints: Array.from(checkpoints),
      rolledBack: this.state.rolledBack,
      rollbackCheckpointId: this.state.rollbackCheckpointId,
    };
  }

  /**
   * Build agent summaries from execution
   */
  private buildAgentSummaries(): AgentSummary[] {
    const summaries: AgentSummary[] = [];

    for (const [agentId, agentContext] of this.ctx.getAllAgentContexts()) {
      const metrics = agentContext.getMetrics();
      summaries.push({
        agentId,
        invocationCount: metrics.invocationCount,
        totalTokensConsumed: metrics.totalTokensConsumed,
        averageLatencyMs: metrics.averageLatencyMs,
        errorCount: metrics.errorCount,
      });
    }

    return summaries;
  }

  /**
   * Build final state reference
   */
  private async buildFinalState(): Promise<FinalState> {
    const stateHash = await this.ctx.stateNamespace.getStateHash();

    return {
      snapshotId: uuidv4() as UUID,
      stateHash,
      stateLocation: `${this.ctx.stateNamespace.schemaName}/${this.ctx.executionId}`,
    };
  }

  /**
   * Build execution summary
   */
  private buildExecutionSummary(
    stepResults: StepResult[],
    durationMs: DurationMs
  ): ExecutionSummary {
    let successfulSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;

    for (const result of stepResults) {
      switch (result.status) {
        case 'success':
          successfulSteps++;
          break;
        case 'failure':
          failedSteps++;
          break;
        case 'skipped':
          skippedSteps++;
          break;
      }
    }

    // Calculate total tokens
    let totalTokensConsumed = 0;
    for (const [, agentContext] of this.ctx.getAllAgentContexts()) {
      totalTokensConsumed += agentContext.totalTokensConsumed;
    }

    return {
      totalStepsExecuted: stepResults.length,
      successfulSteps,
      failedSteps,
      skippedSteps,
      totalAgentInvocations: Array.from(this.ctx.getAllAgentContexts().values()).reduce(
        (sum, ctx) => sum + ctx.invocationCount,
        0
      ),
      totalStateMutations: 0, // Would track from state namespace
      totalEventsEmitted: 0, // Would track from telemetry
      totalTokensConsumed,
      deterministicSeed: this.ctx.randomGenerator.seed,
      checkpointsCreated: this.checkpointManager.getCreatedCheckpoints().length,
    };
  }

  /**
   * Build telemetry data
   */
  private buildTelemetry(): ExecutionTelemetry {
    return {
      metrics: [],
      events: [],
      traces: [],
      logsSummary: {
        totalEntries: 0,
        byLevel: {},
        errors: [],
      },
    };
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Emit an orchestration event
   */
  private emitEvent(eventType: OrchestrationEventType, payload: Metadata): void {
    const event: OrchestrationEvent = {
      eventId: uuidv4() as UUID,
      eventType,
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      executionId: this.ctx.executionId,
      stepId: this.ctx.currentStepId,
      payload,
    };

    // Emit to telemetry
    this.ctx.telemetry.emitEvent(eventType, payload);

    // Emit to registered listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        // Log but don't fail on listener errors
        this.ctx.telemetry.log('ERROR', 'Event listener error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current execution status
   */
  getStatus(): ExecutionStatus {
    return this.state.status;
  }

  /**
   * Get completed step IDs
   */
  getCompletedStepIds(): readonly string[] {
    return Array.from(this.state.completedStepIds);
  }

  /**
   * Get step results
   */
  getStepResults(): ReadonlyMap<string, OrchestrationStepResult> {
    return this.state.stepResults;
  }

  /**
   * Get execution errors
   */
  getErrors(): readonly ExecutionError[] {
    return this.state.errors;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an execution orchestrator
 */
export function createExecutionOrchestrator(
  ctx: ExecutionContext,
  plan: SimulationPlan,
  agentManager: AgentLifecycleManager,
  integrationManager: IntegrationAdapterManager,
  options?: Partial<ExecutionOptions>
): ExecutionOrchestrator {
  return new ExecutionOrchestrator(ctx, plan, agentManager, integrationManager, options);
}
