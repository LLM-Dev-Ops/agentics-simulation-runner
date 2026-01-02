/**
 * Orchestration Type Definitions for Agentics Simulation Runner
 *
 * Defines types specific to the execution orchestration module,
 * including workflow results, failure handling, and checkpoint management.
 *
 * @module orchestration/types
 * @see SPARC_PSEUDOCODE.md Section 5 - Execution Orchestrator
 * @see SPARC_ARCHITECTURE.md MOD-004, MOD-006, MOD-007, MOD-008
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  ExecutionStatus,
  StepStatus,
  Metadata,
  LogLevel,
} from '../types/common.js';

import type {
  WorkflowStep,
  WorkflowStepResult,
} from '../types/workflow.js';

import type {
  ExecutionContext,
  Checkpoint,
} from '../types/execution-context.js';

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

// =============================================================================
// Execution Order Types
// =============================================================================

/**
 * Represents the ordered execution sequence for workflow steps
 * Derived from topological sort of the dependency graph (INV-EX-004)
 */
export interface ExecutionOrder {
  /**
   * Steps in topologically sorted order
   */
  readonly orderedSteps: readonly WorkflowStep[];

  /**
   * Map from step ID to its dependencies
   */
  readonly dependencyMap: ReadonlyMap<string, readonly string[]>;

  /**
   * Map from step ID to its dependents
   */
  readonly dependentMap: ReadonlyMap<string, readonly string[]>;

  /**
   * Steps that can be executed in parallel (same level)
   */
  readonly parallelGroups: readonly (readonly WorkflowStep[])[];
}

// =============================================================================
// Workflow Result Types
// =============================================================================

/**
 * Comprehensive result of workflow execution
 * From Pseudocode Section 5.1
 */
export interface WorkflowResult {
  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Final execution status
   */
  readonly status: ExecutionStatus;

  /**
   * When execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * All step results in execution order
   */
  readonly stepResults: readonly StepResult[];

  /**
   * Agent execution summaries
   */
  readonly agentSummaries: readonly AgentSummary[];

  /**
   * Integration call observations
   */
  readonly integrationObservations: readonly IntegrationObservation[];

  /**
   * Final state reference
   */
  readonly finalState: FinalState;

  /**
   * Execution summary statistics
   */
  readonly summary: ExecutionSummary;

  /**
   * Telemetry data collected
   */
  readonly telemetry: ExecutionTelemetry;

  /**
   * Errors encountered (if any)
   */
  readonly errors: readonly ExecutionError[];

  /**
   * Checkpoints created during execution
   */
  readonly checkpoints: readonly CheckpointInfo[];

  /**
   * Whether execution was rolled back
   */
  readonly rolledBack: boolean;

  /**
   * Rollback checkpoint ID (if rolled back)
   */
  readonly rollbackCheckpointId?: UUID;
}

/**
 * Execution error with full context
 */
export interface ExecutionError {
  readonly errorId: UUID;
  readonly stepId?: string;
  readonly agentId?: string;
  readonly integrationId?: string;
  readonly errorCode: string;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly stackTrace?: string;
  readonly timestamp: ISO8601Timestamp;
  readonly recoverable: boolean;
  readonly recoveryAttempted: boolean;
  readonly recoveryResult?: string;
  readonly context?: Metadata;
}

/**
 * Checkpoint information for tracking
 */
export interface CheckpointInfo {
  readonly checkpointId: UUID;
  readonly label: string;
  readonly stepId?: string;
  readonly sequenceNumber: number;
  readonly createdAt: ISO8601Timestamp;
  readonly stateHash: SHA256Hash;
}

// =============================================================================
// Step Execution Types
// =============================================================================

/**
 * Extended step result with orchestration metadata
 */
export interface OrchestrationStepResult extends StepResult {
  /**
   * Dependencies that were waited for
   */
  readonly waitedForDependencies: readonly string[];

  /**
   * Time spent waiting for dependencies (ms)
   */
  readonly dependencyWaitTimeMs: DurationMs;

  /**
   * Whether step was skipped
   */
  readonly skipped: boolean;

  /**
   * Skip reason if skipped
   */
  readonly skipReason?: string;

  /**
   * Checkpoint created after this step (if any)
   */
  readonly checkpointId?: UUID;
}

/**
 * Step execution context with runtime state
 */
export interface StepExecutionContext {
  /**
   * The step being executed
   */
  readonly step: WorkflowStep;

  /**
   * Parent execution context
   */
  readonly executionContext: ExecutionContext;

  /**
   * Resolved inputs for the step
   */
  readonly resolvedInputs: Record<string, unknown>;

  /**
   * Start time of step execution
   */
  readonly startTime: ISO8601Timestamp;

  /**
   * Retry attempt number (0 for first attempt)
   */
  readonly retryAttempt: number;

  /**
   * Timeout deadline for this step
   */
  readonly timeoutDeadline: Date;
}

// =============================================================================
// Pause/Resume Types
// =============================================================================

/**
 * Result of pausing execution
 */
export interface PauseResult {
  /**
   * Whether pause was successful
   */
  readonly success: boolean;

  /**
   * Pause timestamp
   */
  readonly pausedAt: ISO8601Timestamp;

  /**
   * Checkpoint created for resumption
   */
  readonly checkpoint: Checkpoint;

  /**
   * Step that was interrupted (if any)
   */
  readonly interruptedStepId?: string;

  /**
   * Steps that completed before pause
   */
  readonly completedStepIds: readonly string[];

  /**
   * Steps remaining to execute
   */
  readonly remainingStepIds: readonly string[];
}

/**
 * Result of resuming execution
 */
export interface ResumeResult {
  /**
   * Whether resume was successful
   */
  readonly success: boolean;

  /**
   * Resume timestamp
   */
  readonly resumedAt: ISO8601Timestamp;

  /**
   * Checkpoint restored from
   */
  readonly restoredFromCheckpoint: UUID;

  /**
   * Step resuming from
   */
  readonly resumingFromStepId?: string;

  /**
   * Time execution was paused (ms)
   */
  readonly pauseDurationMs: DurationMs;
}

/**
 * Result of aborting execution
 */
export interface AbortResult {
  /**
   * Whether abort was successful
   */
  readonly success: boolean;

  /**
   * Abort timestamp
   */
  readonly abortedAt: ISO8601Timestamp;

  /**
   * Abort reason
   */
  readonly reason: string;

  /**
   * Step that was executing when aborted
   */
  readonly abortedStepId?: string;

  /**
   * Whether cleanup was performed
   */
  readonly cleanupPerformed: boolean;

  /**
   * Whether rollback was triggered
   */
  readonly rolledBack: boolean;

  /**
   * Rollback checkpoint ID (if rolled back)
   */
  readonly rollbackCheckpointId?: UUID;
}

// =============================================================================
// Failure Handling Types
// =============================================================================

/**
 * Error severity levels
 */
export type ErrorSeverity = 'RECOVERABLE' | 'CRITICAL' | 'FATAL';

/**
 * Failure handling action
 */
export type FailureAction = 'RETRY' | 'FALLBACK' | 'SKIP' | 'ROLLBACK' | 'ABORT';

/**
 * Result of handling a step failure
 */
export interface FailureHandlingResult {
  /**
   * Original step that failed
   */
  readonly failedStepId: string;

  /**
   * Error that caused the failure
   */
  readonly error: ExecutionError;

  /**
   * Action taken
   */
  readonly action: FailureAction;

  /**
   * Whether failure was handled successfully
   */
  readonly handled: boolean;

  /**
   * Result of the handling action
   */
  readonly actionResult?: {
    readonly retrySucceeded?: boolean;
    readonly fallbackStepExecuted?: string;
    readonly skipped?: boolean;
    readonly rolledBackTo?: UUID;
  };

  /**
   * Whether execution should continue
   */
  readonly continueExecution: boolean;

  /**
   * Next step to execute (if continuing)
   */
  readonly nextStepId?: string;
}

/**
 * Result of executing a rollback
 */
export interface RollbackResult {
  /**
   * Whether rollback was successful
   */
  readonly success: boolean;

  /**
   * Checkpoint rolled back to
   */
  readonly checkpointId: UUID;

  /**
   * Steps that were undone
   */
  readonly undoneStepIds: readonly string[];

  /**
   * State hash after rollback
   */
  readonly stateHash: SHA256Hash;

  /**
   * Rollback timestamp
   */
  readonly rolledBackAt: ISO8601Timestamp;

  /**
   * Error if rollback failed
   */
  readonly error?: string;
}

// =============================================================================
// Checkpoint Types
// =============================================================================

/**
 * Checkpoint definition from the plan
 */
export interface CheckpointDefinition {
  readonly checkpointId: string;
  readonly stepRef: string;
  readonly name: string;
  readonly captureState: boolean;
  readonly captureMetrics: boolean;
}

/**
 * Full checkpoint data including state snapshot
 */
export interface CheckpointData extends Checkpoint {
  /**
   * Full state snapshot data
   */
  readonly stateData: Record<string, unknown>;

  /**
   * Metrics at checkpoint time
   */
  readonly metrics?: {
    readonly tokensConsumed: number;
    readonly stepsCompleted: number;
    readonly agentsActive: number;
    readonly elapsedMs: DurationMs;
  };

  /**
   * Vector memory state (if applicable)
   */
  readonly vectorMemoryState?: {
    readonly collections: readonly string[];
    readonly vectorCounts: Record<string, number>;
  };
}

// =============================================================================
// Orchestration Events
// =============================================================================

/**
 * Event types emitted during orchestration
 */
export type OrchestrationEventType =
  | 'EXECUTION_STARTED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_PAUSED'
  | 'EXECUTION_RESUMED'
  | 'EXECUTION_ABORTED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'STEP_SKIPPED'
  | 'STEP_RETRYING'
  | 'CHECKPOINT_CREATED'
  | 'CHECKPOINT_RESTORED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_COMPLETED'
  | 'DEADLINE_WARNING'
  | 'RESOURCE_WARNING';

/**
 * Orchestration event
 */
export interface OrchestrationEvent {
  readonly eventId: UUID;
  readonly eventType: OrchestrationEventType;
  readonly timestamp: ISO8601Timestamp;
  readonly executionId: UUID;
  readonly stepId?: string;
  readonly payload: Metadata;
}

/**
 * Event listener for orchestration events
 */
export interface OrchestrationEventListener {
  onEvent(event: OrchestrationEvent): void;
}

// =============================================================================
// Dependency Resolution
// =============================================================================

/**
 * Resolved dependencies with their completion status
 */
export interface DependencyResolution {
  readonly stepId: string;
  readonly dependencies: readonly {
    readonly dependencyStepId: string;
    readonly completed: boolean;
    readonly result?: StepResult;
  }[];
  readonly allSatisfied: boolean;
  readonly blockedBy: readonly string[];
}

// =============================================================================
// Resource Tracking
// =============================================================================

/**
 * Resource usage during execution
 */
export interface ExecutionResourceUsage {
  readonly peakMemoryBytes: number;
  readonly totalTokensConsumed: number;
  readonly totalApiCalls: number;
  readonly activeAgentsCount: number;
  readonly stateSizeBytes: number;
  readonly checkpointCount: number;
}

// =============================================================================
// Execution Options
// =============================================================================

/**
 * Options for execution orchestration
 */
export interface ExecutionOptions {
  /**
   * Whether to create automatic checkpoints
   */
  readonly autoCheckpoint: boolean;

  /**
   * Checkpoint interval (steps between checkpoints)
   */
  readonly checkpointInterval: number;

  /**
   * Whether to continue on non-critical failures
   */
  readonly continueOnError: boolean;

  /**
   * Maximum parallel step executions
   */
  readonly maxParallelSteps: number;

  /**
   * Event listeners for orchestration events
   */
  readonly eventListeners?: readonly OrchestrationEventListener[];

  /**
   * Deadline warning threshold (ms before deadline)
   */
  readonly deadlineWarningThresholdMs: number;

  /**
   * Whether to enable detailed telemetry
   */
  readonly detailedTelemetry: boolean;
}

/**
 * Default execution options
 */
export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  autoCheckpoint: true,
  checkpointInterval: 100,
  continueOnError: false,
  maxParallelSteps: 10,
  deadlineWarningThresholdMs: 60000, // 1 minute
  detailedTelemetry: true,
};
