/**
 * Workflow Type Definitions for Agentics Simulation Runner
 *
 * Defines workflow steps, triggers, and execution flow structures.
 * Based on SPARC Specification Sections 4.1 and 4.4.
 *
 * @module types/workflow
 */

import type {
  UUID,
  ISO8601Timestamp,
  DurationMs,
  Condition,
  StepControlFlow,
  WorkflowExecutionMode,
  WorkflowTriggerType,
  AgentActionType,
  StepStatus,
  Metadata,
} from './common.js';

// =============================================================================
// Step Type Enumeration
// =============================================================================

/**
 * Step types from Architecture MOD-006
 * Defines the fundamental types of steps that can appear in a workflow
 */
export type WorkflowStepType =
  | 'AGENT_INVOCATION'   // Invoke an agent to perform an action
  | 'INTEGRATION_CALL'   // Call an external integration endpoint
  | 'CONDITIONAL'        // Conditional branching based on state
  | 'PARALLEL_GROUP'     // Execute multiple steps in parallel
  | 'LOOP'               // Iterate over a collection or until condition
  | 'CHECKPOINT'         // Create a state checkpoint
  | 'DELAY'              // Introduce a delay in execution
  | 'STATE_MUTATION'     // Direct state modification
  | 'EVENT_EMIT';        // Emit an event to observers

// =============================================================================
// Workflow Trigger Types
// =============================================================================

/**
 * Immediate trigger - workflow starts immediately upon execution
 */
export interface ImmediateTrigger {
  readonly type: 'immediate';
}

/**
 * Scheduled trigger - workflow starts at a specified time
 */
export interface ScheduledTrigger {
  readonly type: 'scheduled';
  readonly scheduleExpression: string; // cron expression or ISO8601 timestamp
  readonly timezone?: string;
}

/**
 * Event-driven trigger - workflow starts when an event occurs
 */
export interface EventDrivenTrigger {
  readonly type: 'event_driven';
  readonly eventType: string;
  readonly condition?: string; // Optional filter expression
}

/**
 * Union type for all trigger types
 */
export type WorkflowTrigger =
  | ImmediateTrigger
  | ScheduledTrigger
  | EventDrivenTrigger;

// =============================================================================
// Step Input/Output Types
// =============================================================================

/**
 * Step input specification
 * From Section 4.4: workflow_definition.steps[].inputs
 */
export interface StepInputSpec {
  /**
   * Static values known at plan time
   */
  readonly static?: Record<string, unknown>;

  /**
   * Dynamic values resolved from state at runtime
   * Array of state key references
   */
  readonly dynamic?: readonly string[];

  /**
   * Input transformation expressions
   */
  readonly transformations?: Record<string, string>;
}

/**
 * Step output specification
 * From Section 4.4: workflow_definition.steps[].outputs
 */
export interface StepOutputSpec {
  /**
   * State keys to write outputs to
   */
  readonly stateKeys: readonly string[];

  /**
   * Events to emit on completion
   */
  readonly emitEvents?: readonly string[];

  /**
   * Output transformation expressions
   */
  readonly transformations?: Record<string, string>;
}

// =============================================================================
// Base Step Definition
// =============================================================================

/**
 * Common properties shared by all step types
 */
export interface BaseWorkflowStep {
  /**
   * Unique step identifier within the workflow
   */
  readonly id: string;

  /**
   * Human-readable step name
   */
  readonly name?: string;

  /**
   * Step description
   */
  readonly description?: string;

  /**
   * Step type discriminator
   */
  readonly stepType: WorkflowStepType;

  /**
   * Timeout for this step in milliseconds
   */
  readonly timeoutMs?: DurationMs;

  /**
   * Preconditions that must be satisfied before step execution
   */
  readonly preconditions?: readonly Condition[];

  /**
   * Postconditions that must be satisfied after step execution
   */
  readonly postconditions?: readonly Condition[];

  /**
   * Control flow configuration
   */
  readonly controlFlow?: StepControlFlow;

  /**
   * Step IDs that must complete before this step can start
   */
  readonly dependencies?: readonly string[];

  /**
   * Additional metadata for the step
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Specific Step Type Definitions
// =============================================================================

/**
 * Agent invocation step
 * Invokes an agent to perform a specific action
 */
export interface AgentInvocationStep extends BaseWorkflowStep {
  readonly stepType: 'AGENT_INVOCATION';

  /**
   * ID of the agent to invoke (references agents[].id in plan)
   */
  readonly agentId: string;

  /**
   * Action for the agent to perform
   */
  readonly action: string;

  /**
   * Action type classification
   */
  readonly actionType?: AgentActionType;

  /**
   * Input specification for the agent
   */
  readonly inputs: StepInputSpec;

  /**
   * Output specification for capturing results
   */
  readonly outputs: StepOutputSpec;

  /**
   * Maximum retries for this agent invocation
   */
  readonly maxRetries?: number;
}

/**
 * Integration call step
 * Calls an external integration endpoint
 */
export interface IntegrationCallStep extends BaseWorkflowStep {
  readonly stepType: 'INTEGRATION_CALL';

  /**
   * ID of the integration endpoint (references integration_endpoints[].id)
   */
  readonly integrationId: string;

  /**
   * Input specification for the integration call
   */
  readonly inputs: StepInputSpec;

  /**
   * Output specification for capturing results
   */
  readonly outputs: StepOutputSpec;

  /**
   * Whether to record the call for replay
   */
  readonly recordForReplay?: boolean;
}

/**
 * Conditional step
 * Branches execution based on a condition
 */
export interface ConditionalStep extends BaseWorkflowStep {
  readonly stepType: 'CONDITIONAL';

  /**
   * Condition expression to evaluate
   */
  readonly condition: string;

  /**
   * Step ID or inline steps to execute if condition is true
   */
  readonly thenBranch: string | readonly WorkflowStep[];

  /**
   * Step ID or inline steps to execute if condition is false
   */
  readonly elseBranch?: string | readonly WorkflowStep[];
}

/**
 * Parallel group step
 * Executes multiple steps concurrently
 */
export interface ParallelGroupStep extends BaseWorkflowStep {
  readonly stepType: 'PARALLEL_GROUP';

  /**
   * Steps to execute in parallel
   */
  readonly parallelSteps: readonly WorkflowStep[];

  /**
   * How to handle failures in parallel execution
   */
  readonly failureStrategy: 'fail_fast' | 'fail_slow' | 'ignore_failures';

  /**
   * Maximum number of concurrent executions
   */
  readonly maxConcurrency?: number;
}

/**
 * Loop step
 * Iterates over a collection or until a condition is met
 */
export interface LoopStep extends BaseWorkflowStep {
  readonly stepType: 'LOOP';

  /**
   * Type of loop
   */
  readonly loopType: 'for_each' | 'while' | 'until' | 'count';

  /**
   * For 'for_each': state key containing the collection
   * For 'count': number of iterations
   */
  readonly iteratorSource?: string | number;

  /**
   * For 'while'/'until': condition expression
   */
  readonly condition?: string;

  /**
   * Variable name for current iteration item
   */
  readonly iteratorVariable?: string;

  /**
   * Steps to execute in each iteration
   */
  readonly body: readonly WorkflowStep[];

  /**
   * Maximum iterations (safety limit)
   */
  readonly maxIterations?: number;
}

/**
 * Checkpoint step
 * Creates a state checkpoint for potential restore
 */
export interface CheckpointStep extends BaseWorkflowStep {
  readonly stepType: 'CHECKPOINT';

  /**
   * Checkpoint label for identification
   */
  readonly label: string;

  /**
   * Whether to include vector memory in checkpoint
   */
  readonly includeVectorMemory?: boolean;

  /**
   * Specific state keys to include (undefined = all)
   */
  readonly includeStateKeys?: readonly string[];
}

/**
 * Delay step
 * Introduces a delay in workflow execution
 */
export interface DelayStep extends BaseWorkflowStep {
  readonly stepType: 'DELAY';

  /**
   * Delay duration in milliseconds
   */
  readonly delayMs: DurationMs;

  /**
   * Whether the delay is interruptible
   */
  readonly interruptible?: boolean;
}

/**
 * State mutation step
 * Directly modifies state without agent involvement
 */
export interface StateMutationStep extends BaseWorkflowStep {
  readonly stepType: 'STATE_MUTATION';

  /**
   * Mutations to apply (key -> value or expression)
   */
  readonly mutations: Record<string, unknown | string>;

  /**
   * Whether mutations are expressions to evaluate
   */
  readonly evaluateExpressions?: boolean;
}

/**
 * Event emit step
 * Emits an event to observers
 */
export interface EventEmitStep extends BaseWorkflowStep {
  readonly stepType: 'EVENT_EMIT';

  /**
   * Event type to emit
   */
  readonly eventType: string;

  /**
   * Event payload (can reference state via expressions)
   */
  readonly payload: Record<string, unknown>;
}

// =============================================================================
// Union Type for All Step Types
// =============================================================================

/**
 * Union type for all workflow step types
 */
export type WorkflowStep =
  | AgentInvocationStep
  | IntegrationCallStep
  | ConditionalStep
  | ParallelGroupStep
  | LoopStep
  | CheckpointStep
  | DelayStep
  | StateMutationStep
  | EventEmitStep;

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Error handling configuration for workflow
 * From Section 4.4: workflow_definition.error_handling
 */
export interface WorkflowErrorHandling {
  /**
   * Global timeout for the entire workflow
   */
  readonly globalTimeoutMs?: DurationMs;

  /**
   * Compensation workflow to run on failure
   */
  readonly compensationWorkflowId?: string;

  /**
   * Default retry policy for steps
   */
  readonly defaultRetryPolicy?: {
    readonly maxRetries: number;
    readonly backoffStrategy: 'fixed' | 'exponential';
    readonly initialDelayMs: DurationMs;
  };
}

/**
 * Complete workflow definition
 * From Section 4.4
 */
export interface WorkflowDefinition {
  /**
   * Unique workflow identifier
   */
  readonly id: string;

  /**
   * Human-readable workflow name
   */
  readonly name: string;

  /**
   * Workflow version
   */
  readonly version?: string;

  /**
   * Workflow description
   */
  readonly description?: string;

  /**
   * How the workflow should be triggered
   */
  readonly trigger?: WorkflowTrigger;

  /**
   * Execution mode for steps
   */
  readonly executionMode: WorkflowExecutionMode;

  /**
   * Ordered list of workflow steps
   */
  readonly steps: readonly WorkflowStep[];

  /**
   * Error handling configuration
   */
  readonly errorHandling?: WorkflowErrorHandling;

  /**
   * Additional workflow metadata
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Workflow Step Result Types
// =============================================================================

/**
 * Result of executing a workflow step
 */
export interface WorkflowStepResult {
  /**
   * Step ID
   */
  readonly stepId: string;

  /**
   * Workflow ID
   */
  readonly workflowId: string;

  /**
   * Agent ID (if agent invocation)
   */
  readonly agentId?: string;

  /**
   * Step execution status
   */
  readonly status: StepStatus;

  /**
   * When step started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When step completed
   */
  readonly completedAt?: ISO8601Timestamp;

  /**
   * Duration in milliseconds
   */
  readonly durationMs?: DurationMs;

  /**
   * Input snapshot at execution time
   */
  readonly inputsSnapshot?: Record<string, unknown>;

  /**
   * Outputs produced by the step
   */
  readonly outputs?: Record<string, unknown>;

  /**
   * Error details if step failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly stackTrace?: string;
  };

  /**
   * Number of retry attempts
   */
  readonly retryAttempts?: number;
}

// =============================================================================
// Workflow Dependency Types
// =============================================================================

/**
 * Dependency graph node
 */
export interface WorkflowDependencyNode {
  readonly stepId: string;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
}

/**
 * Workflow dependency graph
 */
export interface WorkflowDependencyGraph {
  readonly workflowId: string;
  readonly nodes: ReadonlyMap<string, WorkflowDependencyNode>;
  readonly topologicalOrder: readonly string[];
  readonly hasCycles: boolean;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for AgentInvocationStep
 */
export function isAgentInvocationStep(
  step: WorkflowStep
): step is AgentInvocationStep {
  return step.stepType === 'AGENT_INVOCATION';
}

/**
 * Type guard for IntegrationCallStep
 */
export function isIntegrationCallStep(
  step: WorkflowStep
): step is IntegrationCallStep {
  return step.stepType === 'INTEGRATION_CALL';
}

/**
 * Type guard for ConditionalStep
 */
export function isConditionalStep(step: WorkflowStep): step is ConditionalStep {
  return step.stepType === 'CONDITIONAL';
}

/**
 * Type guard for ParallelGroupStep
 */
export function isParallelGroupStep(
  step: WorkflowStep
): step is ParallelGroupStep {
  return step.stepType === 'PARALLEL_GROUP';
}

/**
 * Type guard for LoopStep
 */
export function isLoopStep(step: WorkflowStep): step is LoopStep {
  return step.stepType === 'LOOP';
}

/**
 * Type guard for CheckpointStep
 */
export function isCheckpointStep(step: WorkflowStep): step is CheckpointStep {
  return step.stepType === 'CHECKPOINT';
}

/**
 * Type guard for DelayStep
 */
export function isDelayStep(step: WorkflowStep): step is DelayStep {
  return step.stepType === 'DELAY';
}

/**
 * Type guard for StateMutationStep
 */
export function isStateMutationStep(
  step: WorkflowStep
): step is StateMutationStep {
  return step.stepType === 'STATE_MUTATION';
}

/**
 * Type guard for EventEmitStep
 */
export function isEventEmitStep(step: WorkflowStep): step is EventEmitStep {
  return step.stepType === 'EVENT_EMIT';
}
