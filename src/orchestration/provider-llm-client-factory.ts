/**
 * Provider-backed LLM client factory (ADR-0001)
 *
 * Bridges the orchestration-layer `LLMClientFactory` contract onto the real
 * provider clients in `src/surfaces/providers/` via `LLMClientFactory` from
 * `src/surfaces/llm-client-factory.ts`.
 *
 * Fail-closed: constructing this factory in an environment with no provider
 * credentials throws. There is no mock fallback on any server-reachable path.
 */

import {
  LLMClientFactory as SurfaceLLMClientFactory,
  createCredentialsFromEnv,
} from '../surfaces/llm-client-factory.js';
import type { LLMClient as ProviderLLMClient } from '../surfaces/providers/base-llm-client.js';
import type { LLMProviderType, LLMClientOptions } from '../surfaces/llm-types.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../types/execution.js';
import type { LLMProvider } from '../types/plan.js';
import type { LLMClientFactory, LLMClientConfig } from './agent-resolver.js';

/**
 * Providers that can be configured purely from environment variables and have
 * a concrete client implementation behind them.
 */
const CONFIGURABLE_PROVIDERS: readonly LLMProviderType[] = [
  'anthropic',
  'openai',
  'azure_openai',
];

const PROVIDER_TYPE_BY_PLAN_PROVIDER: Partial<Record<LLMProvider, LLMProviderType>> = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  AZURE_OPENAI: 'azure_openai',
  GOOGLE: 'google',
  COHERE: 'cohere',
};

/**
 * Thrown when the process has no usable provider credentials.
 */
export class MissingProviderCredentialsError extends Error {
  readonly code = 'MISSING_PROVIDER_CREDENTIALS';

  constructor(message: string) {
    super(message);
    this.name = 'MissingProviderCredentialsError';
  }
}

/**
 * Returns the providers that currently have complete credentials in the
 * environment.
 */
export function getConfiguredProviders(): LLMProviderType[] {
  return CONFIGURABLE_PROVIDERS.filter((p) => createCredentialsFromEnv(p) !== undefined);
}

/**
 * Adapts a provider client to the narrower `LLMClient` shape the orchestration
 * layer consumes. `providerClient` is exposed so callers can assert which real
 * client backs a resolved agent.
 */
export class ProviderLLMClientAdapter implements LLMClient {
  constructor(
    readonly providerClient: ProviderLLMClient,
    private readonly clientConfig: LLMClientConfig
  ) {}

  async validateModel(modelId: string): Promise<boolean> {
    return this.providerClient.validateModel(modelId);
  }

  async invoke(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.providerClient.invoke({
      model: request.model,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt ?? this.clientConfig.systemPrompt,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      topP: request.topP ?? this.clientConfig.topP,
      stopSequences: request.stopSequences,
      seed: request.seed === undefined ? undefined : Number(request.seed),
    });

    return {
      content: response.content,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      finishReason: response.finishReason,
      latencyMs: response.latencyMs,
      modelId: response.model,
    };
  }

  async close(): Promise<void> {
    await this.providerClient.close();
  }
}

/**
 * Creates real provider clients from environment configuration.
 *
 * @throws MissingProviderCredentialsError if no provider is configured
 */
export class ProviderLLMClientFactory implements LLMClientFactory {
  private readonly surfaceFactory: SurfaceLLMClientFactory;
  private readonly clientOptions?: LLMClientOptions;

  constructor(options?: LLMClientOptions) {
    const configured = getConfiguredProviders();
    if (configured.length === 0) {
      throw new MissingProviderCredentialsError(
        'No LLM provider credentials configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, ' +
          'or the AZURE_OPENAI_* variables before starting the runner.'
      );
    }

    this.surfaceFactory = new SurfaceLLMClientFactory();
    this.clientOptions = options;
  }

  async createClient(provider: LLMProvider, config: LLMClientConfig): Promise<LLMClient> {
    const providerType = PROVIDER_TYPE_BY_PLAN_PROVIDER[provider];
    if (!providerType) {
      throw new MissingProviderCredentialsError(
        `Provider ${provider} has no environment-configurable client in this runner`
      );
    }

    const credentials = createCredentialsFromEnv(providerType);
    if (!credentials) {
      throw new MissingProviderCredentialsError(
        `No credentials configured for provider ${provider} (${providerType})`
      );
    }

    const client = this.surfaceFactory.create(credentials, this.clientOptions);
    return new ProviderLLMClientAdapter(client, config);
  }
}
