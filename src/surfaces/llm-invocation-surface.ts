/**
 * LLM Invocation Surface
 *
 * MOD-010: LLM Invocation Surface
 *
 * Abstracts LLM provider interactions for the simulation runner.
 * Provides a unified interface for creating clients, validating models,
 * and invoking LLMs with built-in retry logic and metrics collection.
 *
 * Supported Providers (from Architecture):
 * - Anthropic (Claude)
 * - OpenAI (GPT-4)
 * - Azure OpenAI
 * - Google (Gemini) - planned
 * - Cohere (Command-R) - planned
 * - Custom/Self-host - planned
 *
 * @module surfaces/llm-invocation-surface
 */

import type { DurationMs, UUID } from '../types/common.js';
import type { LLMClient } from './providers/base-llm-client.js';
import type {
  LLMCredentials,
  LLMClientOptions,
  LLMProviderType,
  LLMRequest,
  LLMResponse,
  ModelInfo,
} from './llm-types.js';
import { LLMError, DEFAULT_LLM_REQUEST } from './llm-types.js';
import {
  LLMClientFactory,
  createCredentialsFromEnv,
  validateCredentials,
} from './llm-client-factory.js';

// =============================================================================
// Surface Configuration
// =============================================================================

/**
 * LLM Invocation Surface configuration
 */
export interface LLMInvocationSurfaceConfig {
  /**
   * Default client options
   */
  readonly defaultClientOptions?: LLMClientOptions;

  /**
   * Enable client caching
   */
  readonly enableClientCaching?: boolean;

  /**
   * Maximum cached clients
   */
  readonly maxCachedClients?: number;

  /**
   * Default timeout for LLM requests
   */
  readonly defaultTimeoutMs?: DurationMs;

  /**
   * Default maximum retries
   */
  readonly defaultMaxRetries?: number;

  /**
   * Enable request/response logging
   */
  readonly enableLogging?: boolean;

  /**
   * Metrics collector callback
   */
  readonly metricsCollector?: LLMMetricsCollector;
}

/**
 * Default surface configuration
 */
export const DEFAULT_SURFACE_CONFIG: Required<LLMInvocationSurfaceConfig> = {
  defaultClientOptions: {},
  enableClientCaching: true,
  maxCachedClients: 10,
  defaultTimeoutMs: 60000,
  defaultMaxRetries: 3,
  enableLogging: false,
  metricsCollector: undefined as unknown as LLMMetricsCollector,
};

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * LLM invocation metrics
 */
export interface LLMInvocationMetrics {
  /**
   * Invocation ID
   */
  readonly invocationId: string;

  /**
   * Provider used
   */
  readonly provider: LLMProviderType;

  /**
   * Model used
   */
  readonly model: string;

  /**
   * Request timestamp
   */
  readonly requestedAt: string;

  /**
   * Response timestamp
   */
  readonly respondedAt: string;

  /**
   * Total latency in milliseconds
   */
  readonly latencyMs: DurationMs;

  /**
   * Input tokens
   */
  readonly inputTokens: number;

  /**
   * Output tokens
   */
  readonly outputTokens: number;

  /**
   * Total tokens
   */
  readonly totalTokens: number;

  /**
   * Whether the request was successful
   */
  readonly success: boolean;

  /**
   * Error code if failed
   */
  readonly errorCode?: string;

  /**
   * Number of retry attempts
   */
  readonly retryCount: number;

  /**
   * Finish reason
   */
  readonly finishReason?: string;
}

/**
 * Metrics collector interface
 */
export interface LLMMetricsCollector {
  /**
   * Record an LLM invocation metric
   */
  record(metrics: LLMInvocationMetrics): void;
}

// =============================================================================
// LLM Invocation Surface
// =============================================================================

/**
 * LLM Invocation Surface
 *
 * Main entry point for LLM provider interactions.
 * Provides client creation, model validation, and invocation with metrics.
 */
export class LLMInvocationSurface {
  private readonly config: Required<LLMInvocationSurfaceConfig>;
  private readonly factory: LLMClientFactory;
  private readonly activeClients: Map<string, LLMClient>;
  private invocationCounter: number = 0;

  constructor(config: LLMInvocationSurfaceConfig = {}) {
    this.config = {
      defaultClientOptions: config.defaultClientOptions ?? DEFAULT_SURFACE_CONFIG.defaultClientOptions,
      enableClientCaching: config.enableClientCaching ?? DEFAULT_SURFACE_CONFIG.enableClientCaching,
      maxCachedClients: config.maxCachedClients ?? DEFAULT_SURFACE_CONFIG.maxCachedClients,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_SURFACE_CONFIG.defaultTimeoutMs,
      defaultMaxRetries: config.defaultMaxRetries ?? DEFAULT_SURFACE_CONFIG.defaultMaxRetries,
      enableLogging: config.enableLogging ?? DEFAULT_SURFACE_CONFIG.enableLogging,
      metricsCollector: config.metricsCollector ?? { record: () => {} },
    };

    this.factory = new LLMClientFactory({
      defaultOptions: {
        ...this.config.defaultClientOptions,
        maxRetries: this.config.defaultMaxRetries,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        enableLogging: this.config.enableLogging,
      },
      enableCaching: this.config.enableClientCaching,
      maxCachedClients: this.config.maxCachedClients,
    });

    this.activeClients = new Map();
  }

  // ===========================================================================
  // Client Management
  // ===========================================================================

  /**
   * Create an LLM client for a provider
   *
   * @param provider - LLM provider type
   * @param credentials - Provider credentials
   * @param options - Optional client options
   * @returns LLM client instance
   */
  createClient(
    provider: LLMProviderType,
    credentials: LLMCredentials,
    options?: LLMClientOptions
  ): LLMClient {
    // Validate credentials
    if (!validateCredentials(credentials)) {
      throw new LLMError(
        'Invalid credentials provided',
        'AUTHENTICATION_ERROR',
        provider,
        undefined,
        false
      );
    }

    // Ensure provider matches credentials
    if (credentials.provider !== provider) {
      throw new LLMError(
        `Credential provider mismatch: expected ${provider}, got ${credentials.provider}`,
        'INVALID_REQUEST_ERROR',
        provider,
        undefined,
        false
      );
    }

    const client = this.factory.create(credentials, options);

    // Track active client
    const clientId = this.generateClientId();
    this.activeClients.set(clientId, client);

    this.log(`Created client for ${provider} (${clientId})`);

    return client;
  }

  /**
   * Create a client from environment variables
   *
   * @param provider - LLM provider type
   * @param options - Optional client options
   * @returns LLM client or undefined if credentials not found
   */
  createClientFromEnv(
    provider: LLMProviderType,
    options?: LLMClientOptions
  ): LLMClient | undefined {
    const credentials = createCredentialsFromEnv(provider);
    if (!credentials) {
      this.log(`No environment credentials found for ${provider}`);
      return undefined;
    }

    return this.createClient(provider, credentials, options);
  }

  // ===========================================================================
  // Model Validation
  // ===========================================================================

  /**
   * Validate if a model is available and accessible
   *
   * @param client - LLM client
   * @param modelId - Model identifier to validate
   * @returns true if model is available
   */
  async validateModel(client: LLMClient, modelId: string): Promise<boolean> {
    try {
      const isValid = await client.validateModel(modelId);
      this.log(`Model validation for ${modelId}: ${isValid}`);
      return isValid;
    } catch (error) {
      this.log(`Model validation failed for ${modelId}: ${error}`);
      return false;
    }
  }

  /**
   * Get model information
   *
   * @param client - LLM client
   * @param modelId - Model identifier
   * @returns Model information or undefined
   */
  async getModelInfo(client: LLMClient, modelId: string): Promise<ModelInfo | undefined> {
    return client.getModelInfo(modelId);
  }

  /**
   * List available models for a client
   *
   * @param client - LLM client
   * @returns List of available models
   */
  async listModels(client: LLMClient): Promise<ModelInfo[]> {
    return client.listModels();
  }

  // ===========================================================================
  // LLM Invocation
  // ===========================================================================

  /**
   * Invoke an LLM with a request
   *
   * Handles retries for transient failures and collects metrics.
   *
   * @param client - LLM client
   * @param request - LLM request
   * @returns LLM response with usage metrics
   */
  async invoke(client: LLMClient, request: LLMRequest): Promise<LLMResponse> {
    const invocationId = this.generateInvocationId();
    const requestedAt = new Date().toISOString();
    let retryCount = 0;
    let lastError: Error | undefined;

    this.log(`Invoking ${request.model} (${invocationId})`);

    // Apply defaults
    const fullRequest: LLMRequest = {
      ...DEFAULT_LLM_REQUEST,
      ...request,
      timeoutMs: request.timeoutMs ?? this.config.defaultTimeoutMs,
    };

    const startTime = Date.now();

    try {
      const response = await client.invoke(fullRequest);

      // Record success metrics
      this.recordMetrics({
        invocationId,
        provider: client.getProviderName(),
        model: request.model,
        requestedAt,
        respondedAt: new Date().toISOString(),
        latencyMs: response.latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        success: true,
        retryCount,
        finishReason: response.finishReason,
      });

      this.log(`Invocation completed: ${response.usage.totalTokens} tokens, ${response.latencyMs}ms`);

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const latencyMs = Date.now() - startTime;

      // Record failure metrics
      this.recordMetrics({
        invocationId,
        provider: client.getProviderName(),
        model: request.model,
        requestedAt,
        respondedAt: new Date().toISOString(),
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        success: false,
        errorCode: error instanceof LLMError ? error.code : 'UNKNOWN_ERROR',
        retryCount,
      });

      this.log(`Invocation failed: ${lastError.message}`);

      throw error;
    }
  }

  /**
   * Invoke LLM with a simple prompt
   *
   * Convenience method for simple prompt-based invocations.
   *
   * @param client - LLM client
   * @param model - Model identifier
   * @param prompt - Prompt text
   * @param options - Optional parameters
   * @returns Generated text content
   */
  async invokeSimple(
    client: LLMClient,
    model: string,
    prompt: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    const request: LLMRequest = {
      model,
      prompt,
      systemPrompt: options?.systemPrompt,
      maxTokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    const response = await this.invoke(client, request);
    return response.content;
  }

  // ===========================================================================
  // Provider Information
  // ===========================================================================

  /**
   * Get list of supported providers
   */
  getSupportedProviders(): LLMProviderType[] {
    return this.factory.getSupportedProviders();
  }

  /**
   * Check if a provider is supported
   */
  isProviderSupported(provider: LLMProviderType): boolean {
    return this.factory.isProviderSupported(provider);
  }

  /**
   * Get provider display name
   */
  getProviderDisplayName(provider: LLMProviderType): string {
    return this.factory.getProviderDisplayName(provider);
  }

  // ===========================================================================
  // Lifecycle Management
  // ===========================================================================

  /**
   * Close a specific client
   */
  async closeClient(client: LLMClient): Promise<void> {
    await client.close();

    // Remove from active clients
    const entries = Array.from(this.activeClients.entries());
    for (const [id, c] of entries) {
      if (c === client) {
        this.activeClients.delete(id);
        break;
      }
    }
  }

  /**
   * Close all active clients
   */
  async closeAllClients(): Promise<void> {
    const clients = Array.from(this.activeClients.values());
    const closePromises: Promise<void>[] = clients.map(client => client.close());

    await Promise.all(closePromises);
    this.activeClients.clear();
    await this.factory.closeAll();

    this.log('All clients closed');
  }

  /**
   * Get number of active clients
   */
  getActiveClientCount(): number {
    return this.activeClients.size;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a unique invocation ID
   */
  private generateInvocationId(): string {
    this.invocationCounter++;
    return `inv-${Date.now()}-${this.invocationCounter}`;
  }

  /**
   * Record invocation metrics
   */
  private recordMetrics(metrics: LLMInvocationMetrics): void {
    if (this.config.metricsCollector) {
      this.config.metricsCollector.record(metrics);
    }
  }

  /**
   * Log a message if logging is enabled
   */
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[LLMInvocationSurface] ${message}`);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultSurface: LLMInvocationSurface | null = null;

/**
 * Get the default LLM Invocation Surface instance
 */
export function getDefaultLLMInvocationSurface(): LLMInvocationSurface {
  if (!defaultSurface) {
    defaultSurface = new LLMInvocationSurface();
  }
  return defaultSurface;
}

/**
 * Create a new LLM Invocation Surface instance
 */
export function createLLMInvocationSurface(
  config?: LLMInvocationSurfaceConfig
): LLMInvocationSurface {
  return new LLMInvocationSurface(config);
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick invoke using environment credentials
 *
 * @param provider - LLM provider
 * @param model - Model identifier
 * @param prompt - Prompt text
 * @param options - Optional parameters
 * @returns Generated text or undefined if credentials not available
 */
export async function quickInvoke(
  provider: LLMProviderType,
  model: string,
  prompt: string,
  options?: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string | undefined> {
  const surface = getDefaultLLMInvocationSurface();
  const client = surface.createClientFromEnv(provider);

  if (!client) {
    return undefined;
  }

  try {
    return await surface.invokeSimple(client, model, prompt, options);
  } finally {
    await surface.closeClient(client);
  }
}
