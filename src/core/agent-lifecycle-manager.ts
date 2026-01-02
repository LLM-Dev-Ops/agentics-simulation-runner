/**
 * Agent Lifecycle Manager (MOD-007)
 *
 * Manages the complete lifecycle of agent instances from creation through
 * invocation to termination. Coordinates with LLM providers for invocations
 * and ensures deterministic execution.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-007 Agent Lifecycle Manager
 * - SPARC_PSEUDOCODE.md Section 5.3 Agent Invocation
 *
 * Responsibilities:
 * 1. Resolve agent definitions into agent instances
 * 2. Invoke agents with rendered prompts
 * 3. Manage agent state transitions
 * 4. Track metrics and resource usage
 * 5. Terminate agents and cleanup resources
 *
 * Invariants enforced:
 * - GUA-COR-003: invocationSpec compliance
 * - GUA-REP-002: Deterministic random for temperature > 0
 *
 * State Machine:
 * CREATED -> READY -> INVOKING -> READY (loop) -> TERMINATED
 */

import { randomUUID } from 'crypto';
import type { UUID, AgentId, DurationMs } from '../types/common.js';
import type { ExecutionContext, LLMClient, LLMRequest, LLMResponse } from '../types/execution.js';
import type {
  AgentDefinition as PlanAgentDefinition,
  LLMInvocationSpec,
  WorkflowStep,
} from '../types/plan.js';
import type { AgentDefinition as SimPlanAgentDefinition } from '../types/simulation-plan.js';
import {
  AgentInstance,
  AgentState,
  createInvocationSpec,
  AgentStateError,
  AgentInitializationError,
} from './agent-instance.js';
import {
  renderPromptTemplate,
  RenderContext,
  AgentRenderContext,
  StepOutputs,
  PromptRenderError,
} from './prompt-renderer.js';
import {
  InvocationResult,
  InvocationMetrics,
  InvocationError,
  createSuccessResult,
  createErrorResult,
  createMetrics,
  createRetryableError,
  createFatalError,
} from './invocation-result.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the Agent Lifecycle Manager
 */
export interface AgentLifecycleManagerConfig {
  /**
   * Factory for creating LLM clients
   */
  readonly llmClientFactory: LLMClientFactory;

  /**
   * Optional telemetry collector
   */
  readonly telemetryCollector?: TelemetryCollector;

  /**
   * Optional state repository
   */
  readonly stateRepository?: StateRepository;

  /**
   * Maximum concurrent invocations per agent
   */
  readonly maxConcurrentInvocations?: number;

  /**
   * Default timeout for invocations in milliseconds
   */
  readonly defaultInvocationTimeoutMs?: DurationMs;
}

/**
 * Factory interface for creating LLM clients
 */
export interface LLMClientFactory {
  createClient(spec: LLMInvocationSpec): Promise<LLMClient>;
}

/**
 * Telemetry collector interface
 */
export interface TelemetryCollector {
  recordMetric(name: string, value: number, labels?: Record<string, string>): void;
  recordEvent(eventType: string, payload: Record<string, unknown>): void;
  startSpan(name: string): SpanHandle;
}

/**
 * Span handle for telemetry
 */
export interface SpanHandle {
  end(): void;
  recordError(error: Error): void;
}

/**
 * State repository interface
 */
export interface StateRepository {
  recordEvent(namespace: string, eventId: string, eventType: string, data: Record<string, unknown>): Promise<void>;
}

/**
 * Agent definition (unified type for both plan formats)
 */
export type AgentDefinition = PlanAgentDefinition | SimPlanAgentDefinition;

/**
 * Result of agent resolution
 */
export interface AgentResolutionResult {
  readonly agent: AgentInstance;
  readonly resolvedAt: Date;
  readonly validationErrors: string[];
}

/**
 * Step output accessor for prompt rendering
 */
export interface StepOutputAccessor {
  getOutput(stepId: string): unknown;
  getAllOutputs(): StepOutputs;
}

// =============================================================================
// Agent Lifecycle Manager
// =============================================================================

/**
 * AgentLifecycleManager manages the complete lifecycle of agent instances
 */
export class AgentLifecycleManager {
  private readonly config: AgentLifecycleManagerConfig;
  private readonly agents: Map<string, AgentInstance> = new Map();
  private readonly invocationHistory: Map<string, InvocationResult[]> = new Map();

  constructor(config: AgentLifecycleManagerConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Agent Resolution
  // ===========================================================================

  /**
   * Resolves an agent definition into an agent instance
   *
   * From Pseudocode 4.3:
   * 1. Validate agent type is supported
   * 2. Create AgentInstance
   * 3. Validate LLM model availability
   * 4. Record agent instantiation in state
   *
   * @param agentDef - The agent definition from the simulation plan
   * @param executionId - The execution ID for namespacing
   * @returns AgentResolutionResult with the resolved agent
   */
  async resolveAgent(
    agentDef: AgentDefinition,
    executionId: UUID
  ): Promise<AgentResolutionResult> {
    const validationErrors: string[] = [];
    const resolvedAt = new Date();

    // Extract agent ID and invocation spec based on definition format
    const agentId = this.getAgentId(agentDef);
    const invocationSpec = this.getInvocationSpec(agentDef);

    // Create LLM client
    const llmClient = await this.config.llmClientFactory.createClient(invocationSpec);

    // Create agent instance
    const agent = new AgentInstance({
      agentId: agentId as AgentId,
      agentType: this.getAgentType(agentDef),
      configuration: this.getConfiguration(agentDef),
      invocationSpec: createInvocationSpec(invocationSpec),
      llmClient,
      stateNamespace: `execution:${executionId}:agent:${agentId}`,
      initialState: 'CREATED',
    });

    // Store agent
    this.agents.set(agentId, agent);

    // Initialize agent (validates model and transitions to READY)
    try {
      await agent.initialize();
    } catch (error) {
      validationErrors.push(
        error instanceof Error ? error.message : String(error)
      );
    }

    // Record instantiation in telemetry
    this.config.telemetryCollector?.recordEvent('agent.resolved', {
      agentId,
      agentType: agent.agentType,
      modelId: invocationSpec.modelId,
      provider: invocationSpec.provider,
      hasErrors: validationErrors.length > 0,
    });

    // Record in state repository
    if (this.config.stateRepository) {
      await this.config.stateRepository.recordEvent(
        agent.stateNamespace,
        randomUUID(),
        'AGENT_RESOLVED',
        {
          agentId,
          agentType: agent.agentType,
          resolvedAt: resolvedAt.toISOString(),
        }
      );
    }

    return {
      agent,
      resolvedAt,
      validationErrors,
    };
  }

  // ===========================================================================
  // Agent Invocation
  // ===========================================================================

  /**
   * Invokes an agent for a workflow step
   *
   * From Pseudocode 5.3 (Agent Invocation):
   * 1. Render prompt template with step inputs
   * 2. Invoke LLM via MOD-010 LLMInvocationSurface
   * 3. Capture tokens and latency
   * 4. Enforce GUA-COR-003 (invocationSpec compliance)
   * 5. Use deterministic random for temperature > 0 (GUA-REP-002)
   * 6. Log random values used
   *
   * @param ctx - Execution context
   * @param agent - Agent instance to invoke
   * @param step - Workflow step containing inputs
   * @param stepOutputs - Outputs from previous steps
   * @returns InvocationResult with the response and metrics
   */
  async invoke(
    ctx: ExecutionContext,
    agent: AgentInstance,
    step: WorkflowStep,
    stepOutputs: StepOutputAccessor
  ): Promise<InvocationResult> {
    const invocationId = randomUUID();
    const startedAt = new Date();

    // Generate deterministic seed for reproducibility (GUA-REP-002)
    const randomSeed = this.generateDeterministicSeed(ctx, invocationId);

    // Start telemetry span
    const span = this.config.telemetryCollector?.startSpan('agent.invoke');

    try {
      // Validate agent is ready
      if (!agent.isReady()) {
        throw new AgentStateError(
          `Agent ${agent.agentId} is not ready for invocation`,
          agent.agentId as string,
          agent.state,
          'INVOKING'
        );
      }

      // Begin invocation (state transition)
      agent.beginInvocation(invocationId);

      // Render prompt template
      const prompt = this.renderPrompt(ctx, agent, step, stepOutputs);

      // Log random seed used (GUA-REP-002)
      this.config.telemetryCollector?.recordEvent('agent.invocation.seed', {
        invocationId,
        agentId: agent.agentId,
        stepId: step.stepId,
        randomSeed,
      });

      // Create LLM request with deterministic seed
      const request = agent.createLLMRequest(
        prompt,
        agent.invocationSpec.temperature > 0 ? BigInt(randomSeed) : undefined
      );

      // Invoke LLM (GUA-COR-003: invocationSpec compliance)
      const response = await this.invokeLLM(agent.llmClient, request);
      const completedAt = new Date();

      // Create metrics
      const metrics = createMetrics({
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        latencyMs: response.latencyMs,
        modelUsed: response.modelId,
      });

      // Complete invocation (state transition back to READY)
      agent.completeInvocation(true, response);

      // Record invocation in telemetry
      this.recordInvocationMetrics(invocationId, agent, metrics, true);

      // Create success result
      const result = createSuccessResult({
        invocationId,
        output: response.content,
        metrics,
        finishReason: this.mapFinishReason(response.finishReason),
        randomSeedUsed: randomSeed,
        startedAt,
        completedAt,
      });

      // Store in history
      this.storeInvocationResult(agent.agentId as string, result);

      span?.end();
      return result;
    } catch (error) {
      const completedAt = new Date();

      // Handle invocation error
      const invocationError = this.createInvocationError(error);

      // Complete invocation as failure
      if (agent.isInvoking()) {
        agent.completeInvocation(false);
      }

      // Record error metrics
      this.recordInvocationMetrics(invocationId, agent, undefined, false);

      // Create error result
      const result = createErrorResult({
        invocationId,
        error: invocationError,
        randomSeedUsed: randomSeed,
        startedAt,
        completedAt,
      });

      // Store in history
      this.storeInvocationResult(agent.agentId as string, result);

      span?.recordError(error instanceof Error ? error : new Error(String(error)));
      span?.end();

      return result;
    }
  }

  // ===========================================================================
  // Agent Termination
  // ===========================================================================

  /**
   * Terminates an agent and releases its resources
   *
   * @param agent - Agent instance to terminate
   */
  async terminateAgent(agent: AgentInstance): Promise<void> {
    const agentId = agent.agentId as string;

    // Record termination event
    this.config.telemetryCollector?.recordEvent('agent.terminated', {
      agentId,
      invocationCount: agent.metrics.invocationCount,
      successCount: agent.metrics.successCount,
      errorCount: agent.metrics.errorCount,
      totalTokens: agent.metrics.totalInputTokens + agent.metrics.totalOutputTokens,
    });

    // Terminate agent (closes LLM client)
    await agent.terminate();

    // Remove from active agents
    this.agents.delete(agentId);

    // Record in state repository
    if (this.config.stateRepository) {
      await this.config.stateRepository.recordEvent(
        agent.stateNamespace,
        randomUUID(),
        'AGENT_TERMINATED',
        {
          agentId,
          terminatedAt: new Date().toISOString(),
          finalMetrics: agent.metrics,
        }
      );
    }
  }

  /**
   * Terminates all active agents
   */
  async terminateAllAgents(): Promise<void> {
    const agents = Array.from(this.agents.values());
    await Promise.all(agents.map(agent => this.terminateAgent(agent)));
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all active agents
   */
  getAllAgents(): ReadonlyMap<string, AgentInstance> {
    return this.agents;
  }

  /**
   * Get invocation history for an agent
   */
  getInvocationHistory(agentId: string): readonly InvocationResult[] {
    return this.invocationHistory.get(agentId) ?? [];
  }

  /**
   * Get aggregate metrics across all agents
   */
  getAggregateMetrics(): {
    totalInvocations: number;
    totalTokens: number;
    totalLatencyMs: number;
    successRate: number;
  } {
    let totalInvocations = 0;
    let totalTokens = 0;
    let totalLatencyMs = 0;
    let totalSuccess = 0;

    for (const agent of this.agents.values()) {
      const metrics = agent.metrics;
      totalInvocations += metrics.invocationCount;
      totalTokens += metrics.totalInputTokens + metrics.totalOutputTokens;
      totalLatencyMs += metrics.totalLatencyMs;
      totalSuccess += metrics.successCount;
    }

    return {
      totalInvocations,
      totalTokens,
      totalLatencyMs,
      successRate: totalInvocations > 0 ? totalSuccess / totalInvocations : 1.0,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Renders the prompt template with step inputs and context
   */
  private renderPrompt(
    ctx: ExecutionContext,
    agent: AgentInstance,
    step: WorkflowStep,
    stepOutputs: StepOutputAccessor
  ): string {
    const renderContext: RenderContext = {
      executionId: ctx.executionId as string,
      planId: ctx.planRef.planId as string,
      stepId: step.stepId as string,
      stepSequence: 0, // Could be enhanced with actual sequence
      startTime: ctx.startTime,
      currentTime: new Date(),
      elapsedMs: Date.now() - ctx.startTime.getTime(),
      tenantId: ctx.tenantId as string,
    };

    const agentContext: AgentRenderContext = {
      agentId: agent.agentId as string,
      agentName: agent.agentType,
      agentType: agent.agentType,
      invocationCount: agent.metrics.invocationCount,
      config: agent.configuration as Record<string, unknown>,
    };

    const result = renderPromptTemplate(
      agent.invocationSpec.promptTemplate,
      step.inputs,
      stepOutputs.getAllOutputs(),
      renderContext,
      agentContext
    );

    if (result.missingVariables.length > 0) {
      throw new PromptRenderError(
        `Missing variables in prompt template: ${result.missingVariables.join(', ')}`,
        result.missingVariables[0],
        agent.invocationSpec.promptTemplate
      );
    }

    return result.prompt;
  }

  /**
   * Invokes the LLM with the given request
   */
  private async invokeLLM(
    client: LLMClient,
    request: LLMRequest
  ): Promise<LLMResponse> {
    return client.invoke(request);
  }

  /**
   * Generates a deterministic seed from execution context
   * Ensures reproducibility per GUA-REP-002
   */
  private generateDeterministicSeed(ctx: ExecutionContext, invocationId: UUID): number {
    // Use the random generator from execution context for determinism
    const randomValue = ctx.randomGenerator.next();
    // Convert to integer seed
    return Math.floor(randomValue * Number.MAX_SAFE_INTEGER);
  }

  /**
   * Maps LLM finish reason to our enum
   */
  private mapFinishReason(reason: string): 'stop' | 'length' | 'content_filter' | 'tool_call' | 'error' {
    switch (reason.toLowerCase()) {
      case 'stop':
      case 'end_turn':
        return 'stop';
      case 'length':
      case 'max_tokens':
        return 'length';
      case 'content_filter':
      case 'safety':
        return 'content_filter';
      case 'tool_call':
      case 'function_call':
        return 'tool_call';
      default:
        return 'stop';
    }
  }

  /**
   * Creates an InvocationError from an exception
   */
  private createInvocationError(error: unknown): InvocationError {
    if (error instanceof AgentStateError) {
      return createFatalError('AGENT_STATE_ERROR', error.message, {
        currentState: error.currentState,
        targetState: error.targetState,
      });
    }

    if (error instanceof PromptRenderError) {
      return createFatalError('PROMPT_RENDER_ERROR', error.message, {
        variablePath: error.variablePath,
      });
    }

    const message = error instanceof Error ? error.message : String(error);

    // Check for retryable errors
    if (this.isRetryableError(error)) {
      return createRetryableError('LLM_ERROR', message, 1000);
    }

    return createFatalError('INVOCATION_ERROR', message);
  }

  /**
   * Checks if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    // Rate limiting
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return true;
    }

    // Timeout
    if (message.includes('timeout') || message.includes('timed out')) {
      return true;
    }

    // Service unavailable
    if (message.includes('503') || message.includes('service unavailable')) {
      return true;
    }

    return false;
  }

  /**
   * Records invocation metrics in telemetry
   */
  private recordInvocationMetrics(
    invocationId: UUID,
    agent: AgentInstance,
    metrics: InvocationMetrics | undefined,
    success: boolean
  ): void {
    const labels = {
      agentId: agent.agentId as string,
      agentType: agent.agentType,
      modelId: agent.invocationSpec.modelId,
    };

    this.config.telemetryCollector?.recordMetric('agent.invocation.count', 1, {
      ...labels,
      success: String(success),
    });

    if (metrics) {
      this.config.telemetryCollector?.recordMetric(
        'agent.invocation.input_tokens',
        metrics.inputTokens,
        labels
      );
      this.config.telemetryCollector?.recordMetric(
        'agent.invocation.output_tokens',
        metrics.outputTokens,
        labels
      );
      this.config.telemetryCollector?.recordMetric(
        'agent.invocation.latency_ms',
        metrics.latencyMs,
        labels
      );
    }
  }

  /**
   * Stores invocation result in history
   */
  private storeInvocationResult(agentId: string, result: InvocationResult): void {
    let history = this.invocationHistory.get(agentId);
    if (!history) {
      history = [];
      this.invocationHistory.set(agentId, history);
    }
    history.push(result);
  }

  // ===========================================================================
  // Agent Definition Helpers (handle both plan formats)
  // ===========================================================================

  private getAgentId(agentDef: AgentDefinition): string {
    if ('agentId' in agentDef) {
      return agentDef.agentId as string;
    }
    return agentDef.id;
  }

  private getAgentType(agentDef: AgentDefinition): string {
    if ('agentType' in agentDef) {
      return agentDef.agentType;
    }
    return agentDef.type;
  }

  private getConfiguration(agentDef: AgentDefinition): Record<string, unknown> {
    if ('configuration' in agentDef && agentDef.configuration) {
      return 'parameters' in agentDef.configuration
        ? agentDef.configuration.parameters
        : {};
    }
    return {};
  }

  private getInvocationSpec(agentDef: AgentDefinition): LLMInvocationSpec {
    if ('invocationSpec' in agentDef) {
      return agentDef.invocationSpec;
    }
    // Convert from SimulationPlan format
    const binding = agentDef.llmBinding;
    return {
      provider: binding.provider as 'ANTHROPIC' | 'OPENAI' | 'AZURE_OPENAI' | 'GOOGLE' | 'COHERE' | 'CUSTOM',
      modelId: binding.modelId,
      promptTemplate: binding.systemPrompt || '',
      maxTokens: binding.configuration.maxTokens,
      temperature: binding.configuration.temperature,
      topP: binding.configuration.topP,
      stopSequences: binding.configuration.stopSequences
        ? [...binding.configuration.stopSequences]
        : undefined,
      systemPrompt: binding.systemPrompt,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an AgentLifecycleManager instance
 */
export function createAgentLifecycleManager(
  config: AgentLifecycleManagerConfig
): AgentLifecycleManager {
  return new AgentLifecycleManager(config);
}

// =============================================================================
// Re-exports
// =============================================================================

export {
  AgentInstance,
  AgentState,
  AgentTypeString,
  AgentStateError,
  AgentInitializationError,
  createInvocationSpec,
} from './agent-instance.js';

export {
  InvocationResult,
  InvocationMetrics,
  InvocationError,
  FinishReason,
  createSuccessResult,
  createErrorResult,
  createMetrics,
  createRetryableError,
  createFatalError,
  isSuccessfulInvocation,
  isRetryableError as isRetryableInvocationError,
} from './invocation-result.js';

export {
  renderPromptTemplate,
  renderSimpleTemplate,
  extractVariables,
  validateTemplateSyntax,
  RenderContext,
  AgentRenderContext,
  StepOutputs,
  PromptRenderError,
} from './prompt-renderer.js';
