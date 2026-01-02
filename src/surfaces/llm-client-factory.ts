/**
 * LLM Client Factory
 *
 * MOD-010: LLM Invocation Surface
 *
 * Factory for creating LLM clients based on provider configuration.
 * Provides a unified interface for client creation across all supported providers.
 *
 * @module surfaces/llm-client-factory
 */

import type { LLMClient } from './providers/base-llm-client.js';
import type {
  LLMCredentials,
  LLMClientOptions,
  LLMProviderType,
  AnthropicCredentials,
  OpenAICredentials,
  AzureOpenAICredentials,
  GoogleCredentials,
  CohereCredentials,
  CustomCredentials,
} from './llm-types.js';
import {
  LLMError,
  LLMProviders,
  isAnthropicCredentials,
  isOpenAICredentials,
  isAzureOpenAICredentials,
  isGoogleCredentials,
  isCohereCredentials,
  isCustomCredentials,
} from './llm-types.js';

import { AnthropicClient } from './providers/anthropic-client.js';
import { OpenAIClient, AzureOpenAIClient } from './providers/openai-client.js';

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory configuration
 */
export interface LLMClientFactoryConfig {
  /**
   * Default client options to apply to all created clients
   */
  readonly defaultOptions?: LLMClientOptions;

  /**
   * Enable client caching (reuse clients with same credentials)
   */
  readonly enableCaching?: boolean;

  /**
   * Maximum cached clients
   */
  readonly maxCachedClients?: number;
}

/**
 * Default factory configuration
 */
export const DEFAULT_FACTORY_CONFIG: Required<LLMClientFactoryConfig> = {
  defaultOptions: {},
  enableCaching: false,
  maxCachedClients: 10,
};

// =============================================================================
// LLM Client Factory
// =============================================================================

/**
 * Factory for creating LLM clients
 *
 * Provides a unified interface for creating provider-specific LLM clients.
 * Supports all providers defined in the architecture specification.
 */
export class LLMClientFactory {
  private readonly config: Required<LLMClientFactoryConfig>;
  private readonly clientCache: Map<string, LLMClient>;

  constructor(config: LLMClientFactoryConfig = {}) {
    this.config = {
      defaultOptions: config.defaultOptions ?? DEFAULT_FACTORY_CONFIG.defaultOptions,
      enableCaching: config.enableCaching ?? DEFAULT_FACTORY_CONFIG.enableCaching,
      maxCachedClients: config.maxCachedClients ?? DEFAULT_FACTORY_CONFIG.maxCachedClients,
    };
    this.clientCache = new Map();
  }

  /**
   * Create an LLM client for the specified provider
   *
   * @param credentials - Provider credentials
   * @param options - Optional client options
   * @returns LLM client instance
   * @throws LLMError if provider is not supported
   */
  create(credentials: LLMCredentials, options?: LLMClientOptions): LLMClient {
    const mergedOptions = {
      ...this.config.defaultOptions,
      ...options,
    };

    // Check cache if enabled
    if (this.config.enableCaching) {
      const cacheKey = this.computeCacheKey(credentials);
      const cached = this.clientCache.get(cacheKey);
      if (cached && cached.isReady()) {
        return cached;
      }
    }

    // Create new client
    const client = this.createClient(credentials, mergedOptions);

    // Cache if enabled
    if (this.config.enableCaching) {
      this.cacheClient(credentials, client);
    }

    return client;
  }

  /**
   * Create client for specific provider
   */
  private createClient(credentials: LLMCredentials, options: LLMClientOptions): LLMClient {
    if (isAnthropicCredentials(credentials)) {
      return new AnthropicClient(credentials, options);
    }

    if (isOpenAICredentials(credentials)) {
      return new OpenAIClient(credentials, options);
    }

    if (isAzureOpenAICredentials(credentials)) {
      return new AzureOpenAIClient(credentials, options);
    }

    if (isGoogleCredentials(credentials)) {
      // Google client not yet implemented
      throw new LLMError(
        'Google Gemini client is not yet implemented',
        'MODEL_UNAVAILABLE',
        'google',
        undefined,
        false
      );
    }

    if (isCohereCredentials(credentials)) {
      // Cohere client not yet implemented
      throw new LLMError(
        'Cohere client is not yet implemented',
        'MODEL_UNAVAILABLE',
        'cohere',
        undefined,
        false
      );
    }

    if (isCustomCredentials(credentials)) {
      // Custom clients require special handling
      throw new LLMError(
        'Custom/local providers require a custom client implementation',
        'INVALID_REQUEST_ERROR',
        credentials.provider,
        undefined,
        false
      );
    }

    throw new LLMError(
      `Unsupported provider: ${(credentials as LLMCredentials).provider}`,
      'INVALID_REQUEST_ERROR',
      'custom',
      undefined,
      false
    );
  }

  /**
   * Get list of supported providers
   */
  getSupportedProviders(): LLMProviderType[] {
    return [
      LLMProviders.ANTHROPIC,
      LLMProviders.OPENAI,
      LLMProviders.AZURE_OPENAI,
      // These are defined but not yet implemented:
      // LLMProviders.GOOGLE,
      // LLMProviders.COHERE,
      // LLMProviders.LOCAL,
      // LLMProviders.CUSTOM,
    ];
  }

  /**
   * Check if a provider is supported
   */
  isProviderSupported(provider: LLMProviderType): boolean {
    return this.getSupportedProviders().includes(provider);
  }

  /**
   * Get provider display name
   */
  getProviderDisplayName(provider: LLMProviderType): string {
    switch (provider) {
      case 'anthropic':
        return 'Anthropic Claude';
      case 'openai':
        return 'OpenAI';
      case 'azure_openai':
        return 'Azure OpenAI';
      case 'google':
        return 'Google Gemini';
      case 'cohere':
        return 'Cohere Command-R';
      case 'local':
        return 'Local/Self-hosted';
      case 'custom':
        return 'Custom Provider';
      default:
        return provider;
    }
  }

  /**
   * Clear the client cache
   */
  async clearCache(): Promise<void> {
    const clients = Array.from(this.clientCache.values());
    for (const client of clients) {
      await client.close();
    }
    this.clientCache.clear();
  }

  /**
   * Close all cached clients
   */
  async closeAll(): Promise<void> {
    await this.clearCache();
  }

  /**
   * Compute cache key for credentials
   */
  private computeCacheKey(credentials: LLMCredentials): string {
    const parts = [
      credentials.provider,
      credentials.baseUrl ?? 'default',
      // Don't include full API key in cache key for security
      credentials.apiKey.slice(0, 8),
      credentials.organizationId ?? '',
    ];

    if (isAzureOpenAICredentials(credentials)) {
      parts.push(credentials.resourceName, credentials.deploymentName);
    }

    return parts.join(':');
  }

  /**
   * Cache a client
   */
  private cacheClient(credentials: LLMCredentials, client: LLMClient): void {
    const cacheKey = this.computeCacheKey(credentials);

    // Evict oldest if at capacity
    if (this.clientCache.size >= this.config.maxCachedClients) {
      const oldestKey = this.clientCache.keys().next().value;
      if (oldestKey) {
        const oldest = this.clientCache.get(oldestKey);
        oldest?.close();
        this.clientCache.delete(oldestKey);
      }
    }

    this.clientCache.set(cacheKey, client);
  }
}

// =============================================================================
// Singleton Factory
// =============================================================================

let defaultFactory: LLMClientFactory | null = null;

/**
 * Get the default factory instance
 */
export function getDefaultFactory(): LLMClientFactory {
  if (!defaultFactory) {
    defaultFactory = new LLMClientFactory();
  }
  return defaultFactory;
}

/**
 * Create a client using the default factory
 */
export function createLLMClient(
  credentials: LLMCredentials,
  options?: LLMClientOptions
): LLMClient {
  return getDefaultFactory().create(credentials, options);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create credentials from environment variables
 */
export function createCredentialsFromEnv(
  provider: LLMProviderType
): LLMCredentials | undefined {
  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return undefined;
      return {
        provider: 'anthropic',
        apiKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        organizationId: process.env.ANTHROPIC_ORG_ID,
        apiVersion: process.env.ANTHROPIC_API_VERSION,
      } satisfies AnthropicCredentials;
    }

    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return undefined;
      return {
        provider: 'openai',
        apiKey,
        baseUrl: process.env.OPENAI_BASE_URL,
        organizationId: process.env.OPENAI_ORG_ID,
        projectId: process.env.OPENAI_PROJECT_ID,
      } satisfies OpenAICredentials;
    }

    case 'azure_openai': {
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const resourceName = process.env.AZURE_OPENAI_RESOURCE;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01';

      if (!apiKey || !resourceName || !deploymentName) return undefined;

      return {
        provider: 'azure_openai',
        apiKey,
        resourceName,
        deploymentName,
        apiVersion,
      } satisfies AzureOpenAICredentials;
    }

    case 'google': {
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) return undefined;
      return {
        provider: 'google',
        apiKey,
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
      } satisfies GoogleCredentials;
    }

    case 'cohere': {
      const apiKey = process.env.COHERE_API_KEY;
      if (!apiKey) return undefined;
      return {
        provider: 'cohere',
        apiKey,
      } satisfies CohereCredentials;
    }

    default:
      return undefined;
  }
}

/**
 * Validate credentials structure
 */
export function validateCredentials(credentials: LLMCredentials): boolean {
  if (!credentials.apiKey || credentials.apiKey.trim() === '') {
    return false;
  }

  if (isAzureOpenAICredentials(credentials)) {
    return !!(
      credentials.resourceName &&
      credentials.deploymentName &&
      credentials.apiVersion
    );
  }

  return true;
}
