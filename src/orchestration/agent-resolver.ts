/**
 * Agent Resolver (MOD-003.3)
 *
 * Resolves and validates agent instances for an execution.
 * Implements Phase 2, Step 4.3 from SPARC Pseudocode.
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4.3 - Resolve Agent Instances
 * - SPARC_ARCHITECTURE.md MOD-003, MOD-007
 *
 * Invariants enforced:
 * - All agent types must be supported
 * - LLM model availability must be validated
 * - Agent instantiation recorded in state
 */

import { randomUUID } from 'crypto';
import type { AgentId, UUID } from '../types/common.js';
import type {
  ExecutionContext,
  AgentInstance,
  AgentInstanceStatus,
  LLMClient,
  LLMRequest,
  LLMResponse,
} from '../types/execution.js';
import type {
  SimulationPlan,
  AgentDefinition,
  AgentType,
  LLMProvider,
  LLMInvocationSpec,
} from '../types/plan.js';
import { StateRepository } from '../state/repository.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the agent resolver
 */
export interface AgentResolverConfig {
  readonly llmClientFactory?: LLMClientFactory;
  readonly stateRepository?: StateRepository;
  readonly supportedAgentTypes?: AgentType[];
  readonly supportedLLMProviders?: LLMProvider[];
}

/**
 * Factory for creating LLM clients
 */
export interface LLMClientFactory {
  createClient(provider: LLMProvider, config: LLMClientConfig): Promise<LLMClient>;
}

/**
 * Configuration for LLM client creation
 */
export interface LLMClientConfig {
  readonly provider: LLMProvider;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP?: number;
  readonly systemPrompt?: string;
}

/**
 * Result of agent resolution
 */
export interface AgentResolutionResult {
  readonly agents: Map<AgentId, AgentInstance>;
  readonly resolvedAt: Date;
  readonly validationErrors: AgentValidationError[];
}

/**
 * Agent validation error details
 */
export interface AgentValidationError {
  readonly agentId: string;
  readonly errorCode: AgentErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type AgentErrorCode =
  | 'UNSUPPORTED_AGENT_TYPE'
  | 'UNSUPPORTED_LLM_PROVIDER'
  | 'MODEL_NOT_AVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'CLIENT_CREATION_FAILED';

// ============================================================================
// Default Supported Types
// ============================================================================

const DEFAULT_SUPPORTED_AGENT_TYPES: AgentType[] = [
  'CONVERSATIONAL',
  'TOOL_USE',
  'REASONING',
  'PLANNING',
  'CODING',
  'ANALYSIS',
  'CUSTOM',
];

const DEFAULT_SUPPORTED_LLM_PROVIDERS: LLMProvider[] = [
  'ANTHROPIC',
  'OPENAI',
  'AZURE_OPENAI',
  'GOOGLE',
  'COHERE',
  'CUSTOM',
];

// ============================================================================
// Mock LLM Client (for testing/development)
// ============================================================================

/**
 * Mock LLM client for testing purposes
 */
class MockLLMClient implements LLMClient {
  private readonly modelId: string;
  private readonly provider: LLMProvider;
  private isModelValid: boolean = true;

  constructor(provider: LLMProvider, modelId: string) {
    this.provider = provider;
    this.modelId = modelId;
  }

  async validateModel(modelId: string): Promise<boolean> {
    // In a real implementation, this would call the provider's API
    // to verify the model exists and is accessible
    return this.isModelValid;
  }

  async invoke(request: LLMRequest): Promise<LLMResponse> {
    // Mock response for testing
    const startTime = Date.now();

    // Simulate some latency
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      content: `Mock response for prompt: ${request.prompt.substring(0, 50)}...`,
      usage: {
        inputTokens: Math.floor(request.prompt.length / 4),
        outputTokens: 50,
      },
      finishReason: 'stop',
      latencyMs: Date.now() - startTime,
      modelId: request.model,
    };
  }

  async close(): Promise<void> {
    // Clean up resources
  }

  setModelValid(valid: boolean): void {
    this.isModelValid = valid;
  }
}

/**
 * Default LLM client factory that creates mock clients
 */
class DefaultLLMClientFactory implements LLMClientFactory {
  async createClient(provider: LLMProvider, config: LLMClientConfig): Promise<LLMClient> {
    // In production, this would create real provider-specific clients
    // (AnthropicClient, OpenAIClient, etc.)
    return new MockLLMClient(provider, config.modelId);
  }
}

// ============================================================================
// Agent Resolver
// ============================================================================

/**
 * AgentResolver validates and creates agent instances for execution
 */
export class AgentResolver {
  private readonly config: AgentResolverConfig;
  private readonly llmClientFactory: LLMClientFactory;
  private readonly supportedAgentTypes: Set<AgentType>;
  private readonly supportedLLMProviders: Set<LLMProvider>;

  constructor(config: AgentResolverConfig = {}) {
    this.config = config;
    this.llmClientFactory = config.llmClientFactory ?? new DefaultLLMClientFactory();
    this.supportedAgentTypes = new Set(
      config.supportedAgentTypes ?? DEFAULT_SUPPORTED_AGENT_TYPES
    );
    this.supportedLLMProviders = new Set(
      config.supportedLLMProviders ?? DEFAULT_SUPPORTED_LLM_PROVIDERS
    );
  }

  /**
   * Resolves all agent instances for a simulation plan
   *
   * From Pseudocode 4.3:
   * 1. Validate each agent type is supported
   * 2. Create AgentInstance for each agent in plan
   * 3. Validate LLM model availability
   * 4. Record agent instantiation in state
   *
   * @param ctx - The execution context
   * @param plan - The simulation plan
   * @returns AgentResolutionResult with resolved agents
   */
  async resolveAgentInstances(
    ctx: ExecutionContext,
    plan: SimulationPlan
  ): Promise<AgentResolutionResult> {
    const agents = new Map<AgentId, AgentInstance>();
    const validationErrors: AgentValidationError[] = [];
    const resolvedAt = new Date();

    for (const agentDef of plan.agents) {
      try {
        // 1. Validate agent type is supported
        this.validateAgentType(agentDef);

        // 2. Validate LLM provider is supported
        this.validateLLMProvider(agentDef);

        // 3. Create LLM client
        const llmClient = await this.createLLMClient(agentDef);

        // 4. Validate model availability
        const modelAvailable = await llmClient.validateModel(agentDef.invocationSpec.modelId);
        if (!modelAvailable) {
          validationErrors.push({
            agentId: agentDef.agentId,
            errorCode: 'MODEL_NOT_AVAILABLE',
            message: `Model ${agentDef.invocationSpec.modelId} is not available`,
            details: { provider: agentDef.invocationSpec.provider },
          });
          continue;
        }

        // 5. Create agent instance
        const agentInstance = this.createAgentInstance(ctx, agentDef, llmClient);

        agents.set(agentDef.agentId as AgentId, agentInstance);

        // 6. Record instantiation in state (if state repository is available)
        if (this.config.stateRepository) {
          await this.recordAgentInstantiation(ctx, agentDef, agentInstance);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        validationErrors.push({
          agentId: agentDef.agentId,
          errorCode: 'CLIENT_CREATION_FAILED',
          message: `Failed to resolve agent: ${errorMessage}`,
          details: { error: errorMessage },
        });
      }
    }

    return {
      agents,
      resolvedAt,
      validationErrors,
    };
  }

  /**
   * Validates that an agent type is supported
   */
  private validateAgentType(agentDef: AgentDefinition): void {
    if (!this.supportedAgentTypes.has(agentDef.agentType)) {
      throw new AgentResolutionError(
        `Unsupported agent type: ${agentDef.agentType}`,
        'UNSUPPORTED_AGENT_TYPE',
        agentDef.agentId
      );
    }
  }

  /**
   * Validates that an LLM provider is supported
   */
  private validateLLMProvider(agentDef: AgentDefinition): void {
    if (!this.supportedLLMProviders.has(agentDef.invocationSpec.provider)) {
      throw new AgentResolutionError(
        `Unsupported LLM provider: ${agentDef.invocationSpec.provider}`,
        'UNSUPPORTED_LLM_PROVIDER',
        agentDef.agentId
      );
    }
  }

  /**
   * Creates an LLM client for an agent definition
   */
  private async createLLMClient(agentDef: AgentDefinition): Promise<LLMClient> {
    const spec = agentDef.invocationSpec;

    const clientConfig: LLMClientConfig = {
      provider: spec.provider,
      modelId: spec.modelId,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
      topP: spec.topP,
      systemPrompt: spec.systemPrompt,
    };

    return this.llmClientFactory.createClient(spec.provider, clientConfig);
  }

  /**
   * Creates an agent instance from a definition
   */
  private createAgentInstance(
    ctx: ExecutionContext,
    agentDef: AgentDefinition,
    llmClient: LLMClient
  ): AgentInstance {
    return {
      agentId: agentDef.agentId as AgentId,
      agentType: agentDef.agentType,
      configuration: agentDef.configuration.parameters,
      invocationSpec: agentDef.invocationSpec,
      stateNamespace: `${ctx.stateNamespace}:agent:${agentDef.agentId}`,
      llmClient,
      status: 'READY' as AgentInstanceStatus,
    };
  }

  /**
   * Records agent instantiation in the state repository
   */
  private async recordAgentInstantiation(
    ctx: ExecutionContext,
    agentDef: AgentDefinition,
    agentInstance: AgentInstance
  ): Promise<void> {
    if (!this.config.stateRepository) {
      return;
    }

    const eventId = randomUUID();
    await this.config.stateRepository.recordEvent(ctx.stateNamespace, eventId, 'AGENT_INSTANTIATED', {
      agentId: agentDef.agentId,
      agentType: agentDef.agentType,
      provider: agentDef.invocationSpec.provider,
      modelId: agentDef.invocationSpec.modelId,
      instantiatedAt: new Date().toISOString(),
    });
  }

  /**
   * Terminates all agent instances and cleans up resources
   *
   * @param agents - Map of agent instances to terminate
   */
  async terminateAgents(agents: Map<AgentId, AgentInstance>): Promise<void> {
    const terminationPromises: Promise<void>[] = [];

    agents.forEach((agent, agentId) => {
      terminationPromises.push(
        agent.llmClient.close().catch((error) => {
          console.error(`Failed to close LLM client for agent ${agentId}:`, error);
        })
      );
    });

    await Promise.all(terminationPromises);
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when agent resolution fails
 */
export class AgentResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly agentId: string
  ) {
    super(message);
    this.name = 'AgentResolutionError';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates an AgentResolver instance
 */
export function createAgentResolver(config: AgentResolverConfig = {}): AgentResolver {
  return new AgentResolver(config);
}

/**
 * Validates agent configuration
 *
 * @param agentDef - The agent definition to validate
 * @returns true if valid, throws on validation failure
 */
export function validateAgentConfiguration(agentDef: AgentDefinition): boolean {
  // Validate required fields
  if (!agentDef.agentId) {
    throw new Error('Agent definition missing agentId');
  }

  if (!agentDef.agentType) {
    throw new Error('Agent definition missing agentType');
  }

  if (!agentDef.invocationSpec) {
    throw new Error('Agent definition missing invocationSpec');
  }

  // Validate invocation spec
  const spec = agentDef.invocationSpec;

  if (!spec.provider) {
    throw new Error('Invocation spec missing provider');
  }

  if (!spec.modelId) {
    throw new Error('Invocation spec missing modelId');
  }

  if (spec.maxTokens <= 0) {
    throw new Error('Invocation spec maxTokens must be positive');
  }

  if (spec.temperature < 0 || spec.temperature > 2) {
    throw new Error('Invocation spec temperature must be between 0 and 2');
  }

  return true;
}

/**
 * Checks if an agent type requires tool capabilities
 *
 * @param agentType - The agent type to check
 * @returns true if the agent type requires tools
 */
export function agentRequiresTools(agentType: AgentType): boolean {
  return agentType === 'TOOL_USE' || agentType === 'CODING';
}

/**
 * Gets the default configuration for an agent type
 *
 * @param agentType - The agent type
 * @returns Default configuration parameters
 */
export function getDefaultAgentConfig(agentType: AgentType): Record<string, unknown> {
  switch (agentType) {
    case 'CONVERSATIONAL':
      return { maxTurns: 10, contextWindowSize: 4096 };
    case 'TOOL_USE':
      return { maxToolCalls: 5, toolTimeout: 30000 };
    case 'REASONING':
      return { chainOfThought: true, maxReasoningSteps: 10 };
    case 'PLANNING':
      return { planningHorizon: 10, replanOnFailure: true };
    case 'CODING':
      return { language: 'typescript', lintOnGenerate: true };
    case 'ANALYSIS':
      return { outputFormat: 'json', includeMetrics: true };
    case 'CUSTOM':
    default:
      return {};
  }
}
