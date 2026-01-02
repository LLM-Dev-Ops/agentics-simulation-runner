/**
 * Agent Instance (MOD-007)
 *
 * Represents a resolved and ready-to-invoke agent with its LLM client,
 * configuration, and state management.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-007 Agent Lifecycle Manager
 * - SPARC_SPECIFICATION.md Section 4.3 Agent Manifest
 * - SPARC_PSEUDOCODE.md Section 5.3 Agent Invocation
 *
 * State Machine:
 * CREATED -> READY -> INVOKING -> READY (loop) -> TERMINATED
 */

import type { UUID, AgentId, DurationMs } from '../types/common.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../types/execution.js';
import type { LLMInvocationSpec, LLMProvider } from '../types/plan.js';

/**
 * Agent type string (flexible to support both plan formats)
 * Matches values from plan.ts AgentType enum: CONVERSATIONAL, TOOL_USE, etc.
 */
export type AgentTypeString = string;

// =============================================================================
// Agent State Types
// =============================================================================

/**
 * Agent lifecycle states
 *
 * - CREATED: Agent instance created but not yet initialized
 * - READY: Agent is ready for invocation
 * - INVOKING: Agent is currently processing an invocation
 * - TERMINATED: Agent has been shut down and cannot be used
 */
export type AgentState = 'CREATED' | 'READY' | 'INVOKING' | 'TERMINATED';

/**
 * Valid state transitions for the agent state machine
 */
export const VALID_STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  CREATED: ['READY', 'TERMINATED'],
  READY: ['INVOKING', 'TERMINATED'],
  INVOKING: ['READY', 'TERMINATED'],
  TERMINATED: [], // Terminal state, no transitions allowed
};

// =============================================================================
// Agent Configuration Types
// =============================================================================

/**
 * Invocation specification for the agent's LLM
 * Contains all parameters needed to invoke the LLM
 */
export interface AgentInvocationSpec {
  /**
   * LLM model identifier
   */
  readonly modelId: string;

  /**
   * LLM provider
   */
  readonly provider: LLMProvider;

  /**
   * Prompt template for generating prompts
   */
  readonly promptTemplate: string;

  /**
   * Maximum tokens for completion
   */
  readonly maxTokens: number;

  /**
   * Temperature for sampling (0.0 - 2.0)
   */
  readonly temperature: number;

  /**
   * Top-p sampling parameter (optional)
   */
  readonly topP?: number;

  /**
   * Stop sequences for completion
   */
  readonly stopSequences?: readonly string[];

  /**
   * System prompt for the agent
   */
  readonly systemPrompt?: string;
}

/**
 * Agent metrics tracking
 */
export interface AgentInstanceMetrics {
  /**
   * Total number of invocations
   */
  invocationCount: number;

  /**
   * Total input tokens consumed
   */
  totalInputTokens: number;

  /**
   * Total output tokens consumed
   */
  totalOutputTokens: number;

  /**
   * Total latency across all invocations
   */
  totalLatencyMs: DurationMs;

  /**
   * Number of successful invocations
   */
  successCount: number;

  /**
   * Number of failed invocations
   */
  errorCount: number;

  /**
   * Last invocation timestamp
   */
  lastInvocationAt?: Date;

  /**
   * Last error timestamp
   */
  lastErrorAt?: Date;
}

// =============================================================================
// Agent Instance Class
// =============================================================================

/**
 * AgentInstance represents a resolved agent ready for invocation
 *
 * This class manages the agent's lifecycle, state, and LLM client.
 * It ensures proper state transitions and tracks invocation metrics.
 */
export class AgentInstance {
  /**
   * Unique agent identifier
   */
  readonly agentId: AgentId;

  /**
   * Agent type (e.g., CONVERSATIONAL, TOOL_USE, etc.)
   */
  readonly agentType: AgentTypeString;

  /**
   * Agent configuration parameters
   */
  readonly configuration: Readonly<Record<string, unknown>>;

  /**
   * Invocation specification for LLM calls
   */
  readonly invocationSpec: AgentInvocationSpec;

  /**
   * LLM client for making invocations
   */
  private _llmClient: LLMClient;

  /**
   * State namespace for agent-specific state
   */
  readonly stateNamespace: string;

  /**
   * Current agent state
   */
  private _state: AgentState;

  /**
   * Agent metrics
   */
  private _metrics: AgentInstanceMetrics;

  /**
   * Timestamp when agent was created
   */
  readonly createdAt: Date;

  /**
   * Timestamp when agent was terminated (if applicable)
   */
  private _terminatedAt?: Date;

  /**
   * Current invocation ID (if invoking)
   */
  private _currentInvocationId?: UUID;

  constructor(params: {
    agentId: AgentId;
    agentType: AgentTypeString;
    configuration: Record<string, unknown>;
    invocationSpec: AgentInvocationSpec;
    llmClient: LLMClient;
    stateNamespace: string;
    initialState?: AgentState;
  }) {
    this.agentId = params.agentId;
    this.agentType = params.agentType;
    this.configuration = Object.freeze({ ...params.configuration });
    this.invocationSpec = Object.freeze({ ...params.invocationSpec });
    this._llmClient = params.llmClient;
    this.stateNamespace = params.stateNamespace;
    this._state = params.initialState ?? 'CREATED';
    this.createdAt = new Date();

    this._metrics = {
      invocationCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalLatencyMs: 0,
      successCount: 0,
      errorCount: 0,
    };
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Get current agent state
   */
  get state(): AgentState {
    return this._state;
  }

  /**
   * Get the LLM client
   */
  get llmClient(): LLMClient {
    return this._llmClient;
  }

  /**
   * Get agent metrics
   */
  get metrics(): Readonly<AgentInstanceMetrics> {
    return { ...this._metrics };
  }

  /**
   * Get termination timestamp
   */
  get terminatedAt(): Date | undefined {
    return this._terminatedAt;
  }

  /**
   * Get current invocation ID
   */
  get currentInvocationId(): UUID | undefined {
    return this._currentInvocationId;
  }

  /**
   * Check if agent is ready for invocation
   */
  isReady(): boolean {
    return this._state === 'READY';
  }

  /**
   * Check if agent is currently invoking
   */
  isInvoking(): boolean {
    return this._state === 'INVOKING';
  }

  /**
   * Check if agent is terminated
   */
  isTerminated(): boolean {
    return this._state === 'TERMINATED';
  }

  /**
   * Transition to a new state
   * @throws {AgentStateError} if transition is invalid
   */
  transitionTo(newState: AgentState): void {
    if (!this.canTransitionTo(newState)) {
      throw new AgentStateError(
        `Invalid state transition: ${this._state} -> ${newState}`,
        this.agentId as string,
        this._state,
        newState
      );
    }

    const previousState = this._state;
    this._state = newState;

    if (newState === 'TERMINATED') {
      this._terminatedAt = new Date();
    }

    // Clear invocation ID when leaving INVOKING state
    if (previousState === 'INVOKING' && newState !== 'INVOKING') {
      this._currentInvocationId = undefined;
    }
  }

  /**
   * Check if a state transition is valid
   */
  canTransitionTo(newState: AgentState): boolean {
    return VALID_STATE_TRANSITIONS[this._state].includes(newState);
  }

  // ===========================================================================
  // Invocation Support
  // ===========================================================================

  /**
   * Begin an invocation (transition to INVOKING state)
   * @throws {AgentStateError} if agent is not ready
   */
  beginInvocation(invocationId: UUID): void {
    if (!this.isReady()) {
      throw new AgentStateError(
        `Agent must be READY to begin invocation, current state: ${this._state}`,
        this.agentId as string,
        this._state,
        'INVOKING'
      );
    }

    this._currentInvocationId = invocationId;
    this.transitionTo('INVOKING');
  }

  /**
   * Complete an invocation (transition back to READY state)
   */
  completeInvocation(success: boolean, response?: LLMResponse): void {
    if (!this.isInvoking()) {
      throw new AgentStateError(
        `Agent must be INVOKING to complete invocation, current state: ${this._state}`,
        this.agentId as string,
        this._state,
        'READY'
      );
    }

    // Update metrics
    this._metrics.invocationCount++;
    this._metrics.lastInvocationAt = new Date();

    if (success && response) {
      this._metrics.successCount++;
      this._metrics.totalInputTokens += response.usage.inputTokens;
      this._metrics.totalOutputTokens += response.usage.outputTokens;
      this._metrics.totalLatencyMs += response.latencyMs;
    } else {
      this._metrics.errorCount++;
      this._metrics.lastErrorAt = new Date();
    }

    this.transitionTo('READY');
  }

  /**
   * Initialize the agent (transition from CREATED to READY)
   */
  async initialize(): Promise<void> {
    if (this._state !== 'CREATED') {
      throw new AgentStateError(
        `Agent must be CREATED to initialize, current state: ${this._state}`,
        this.agentId as string,
        this._state,
        'READY'
      );
    }

    // Validate model availability
    const modelValid = await this._llmClient.validateModel(this.invocationSpec.modelId);
    if (!modelValid) {
      throw new AgentInitializationError(
        `Model ${this.invocationSpec.modelId} is not available`,
        this.agentId as string
      );
    }

    this.transitionTo('READY');
  }

  /**
   * Terminate the agent
   */
  async terminate(): Promise<void> {
    if (this.isTerminated()) {
      return; // Already terminated
    }

    // If invoking, wait is not possible - force terminate
    this.transitionTo('TERMINATED');

    // Close LLM client
    await this._llmClient.close();
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get average invocation latency
   */
  getAverageLatencyMs(): number {
    if (this._metrics.successCount === 0) {
      return 0;
    }
    return this._metrics.totalLatencyMs / this._metrics.successCount;
  }

  /**
   * Get average tokens per invocation
   */
  getAverageTokensPerInvocation(): { input: number; output: number } {
    if (this._metrics.successCount === 0) {
      return { input: 0, output: 0 };
    }
    return {
      input: this._metrics.totalInputTokens / this._metrics.successCount,
      output: this._metrics.totalOutputTokens / this._metrics.successCount,
    };
  }

  /**
   * Get success rate (0.0 - 1.0)
   */
  getSuccessRate(): number {
    if (this._metrics.invocationCount === 0) {
      return 1.0; // No invocations = 100% success rate
    }
    return this._metrics.successCount / this._metrics.invocationCount;
  }

  /**
   * Create an LLM request from the invocation spec
   */
  createLLMRequest(prompt: string, seedOverride?: bigint): LLMRequest {
    return {
      model: this.invocationSpec.modelId,
      prompt,
      maxTokens: this.invocationSpec.maxTokens,
      temperature: this.invocationSpec.temperature,
      topP: this.invocationSpec.topP,
      stopSequences: this.invocationSpec.stopSequences
        ? [...this.invocationSpec.stopSequences]
        : undefined,
      systemPrompt: this.invocationSpec.systemPrompt,
      seed: seedOverride,
    };
  }

  /**
   * Serialize agent instance for checkpointing
   */
  toJSON(): Record<string, unknown> {
    return {
      agentId: this.agentId,
      agentType: this.agentType,
      configuration: this.configuration,
      invocationSpec: this.invocationSpec,
      stateNamespace: this.stateNamespace,
      state: this._state,
      metrics: this._metrics,
      createdAt: this.createdAt.toISOString(),
      terminatedAt: this._terminatedAt?.toISOString(),
    };
  }
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error for invalid state transitions
 */
export class AgentStateError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly currentState: AgentState,
    public readonly targetState: AgentState
  ) {
    super(message);
    this.name = 'AgentStateError';
  }
}

/**
 * Error for agent initialization failures
 */
export class AgentInitializationError extends Error {
  constructor(
    message: string,
    public readonly agentId: string
  ) {
    super(message);
    this.name = 'AgentInitializationError';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an AgentInvocationSpec from an LLMInvocationSpec
 */
export function createInvocationSpec(spec: LLMInvocationSpec): AgentInvocationSpec {
  return {
    modelId: spec.modelId,
    provider: spec.provider,
    promptTemplate: spec.promptTemplate,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    topP: spec.topP,
    stopSequences: spec.stopSequences,
    systemPrompt: spec.systemPrompt,
  };
}

/**
 * Create initial metrics for a new agent
 */
export function createInitialMetrics(): AgentInstanceMetrics {
  return {
    invocationCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalLatencyMs: 0,
    successCount: 0,
    errorCount: 0,
  };
}
