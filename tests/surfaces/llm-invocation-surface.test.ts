/**
 * LLM Invocation Surface Tests
 *
 * MOD-010: LLM Invocation Surface
 *
 * Tests for the LLM Invocation Surface implementation.
 *
 * @module tests/surfaces/llm-invocation-surface.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  // Surface
  LLMInvocationSurface,
  createLLMInvocationSurface,
  getDefaultLLMInvocationSurface,

  // Types
  LLMProviders,
  LLMError,
  DEFAULT_LLM_REQUEST,
  DEFAULT_CLIENT_OPTIONS,

  // Type guards
  isAnthropicCredentials,
  isOpenAICredentials,
  isAzureOpenAICredentials,
  isRetryableLLMError,
  getLLMErrorCode,

  // Factory
  LLMClientFactory,
  createLLMClient,
  validateCredentials,
  createCredentialsFromEnv,

  // Clients
  AnthropicClient,
  OpenAIClient,
  AzureOpenAIClient,
} from '../../src/surfaces/index.js';

import type {
  LLMProviderType,
  AnthropicCredentials,
  OpenAICredentials,
  AzureOpenAICredentials,
  LLMCredentials,
  LLMRequest,
  LLMResponse,
  LLMClientOptions,
  ModelInfo,
} from '../../src/surfaces/index.js';

// =============================================================================
// Mock Credentials
// =============================================================================

const mockAnthropicCredentials: AnthropicCredentials = {
  provider: 'anthropic',
  apiKey: 'test-anthropic-api-key',
  apiVersion: '2023-06-01',
};

const mockOpenAICredentials: OpenAICredentials = {
  provider: 'openai',
  apiKey: 'test-openai-api-key',
};

const mockAzureCredentials: AzureOpenAICredentials = {
  provider: 'azure_openai',
  apiKey: 'test-azure-api-key',
  resourceName: 'test-resource',
  deploymentName: 'test-deployment',
  apiVersion: '2024-02-01',
};

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('LLM Type Guards', () => {
  describe('isAnthropicCredentials', () => {
    it('should return true for Anthropic credentials', () => {
      expect(isAnthropicCredentials(mockAnthropicCredentials)).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isAnthropicCredentials(mockOpenAICredentials)).toBe(false);
      expect(isAnthropicCredentials(mockAzureCredentials)).toBe(false);
    });
  });

  describe('isOpenAICredentials', () => {
    it('should return true for OpenAI credentials', () => {
      expect(isOpenAICredentials(mockOpenAICredentials)).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isOpenAICredentials(mockAnthropicCredentials)).toBe(false);
      expect(isOpenAICredentials(mockAzureCredentials)).toBe(false);
    });
  });

  describe('isAzureOpenAICredentials', () => {
    it('should return true for Azure OpenAI credentials', () => {
      expect(isAzureOpenAICredentials(mockAzureCredentials)).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isAzureOpenAICredentials(mockAnthropicCredentials)).toBe(false);
      expect(isAzureOpenAICredentials(mockOpenAICredentials)).toBe(false);
    });
  });

  describe('isRetryableLLMError', () => {
    it('should return true for retryable errors', () => {
      const error = new LLMError('Rate limit', 'RATE_LIMIT_ERROR', 'openai', 429, true);
      expect(isRetryableLLMError(error)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error = new LLMError('Invalid request', 'INVALID_REQUEST_ERROR', 'openai', 400, false);
      expect(isRetryableLLMError(error)).toBe(false);
    });

    it('should return false for non-LLMError', () => {
      const error = new Error('Some error');
      expect(isRetryableLLMError(error)).toBe(false);
    });
  });

  describe('getLLMErrorCode', () => {
    it('should return code from LLMError', () => {
      const error = new LLMError('Test', 'AUTHENTICATION_ERROR', 'openai');
      expect(getLLMErrorCode(error)).toBe('AUTHENTICATION_ERROR');
    });

    it('should infer timeout error from message', () => {
      const error = new Error('Request Timeout occurred');
      expect(getLLMErrorCode(error)).toBe('TIMEOUT_ERROR');
    });

    it('should infer rate limit error from message', () => {
      const error = new Error('Rate limit exceeded');
      expect(getLLMErrorCode(error)).toBe('RATE_LIMIT_ERROR');
    });

    it('should return UNKNOWN_ERROR for unrecognized errors', () => {
      const error = new Error('Some random error');
      expect(getLLMErrorCode(error)).toBe('UNKNOWN_ERROR');
    });
  });
});

// =============================================================================
// Credential Validation Tests
// =============================================================================

describe('Credential Validation', () => {
  describe('validateCredentials', () => {
    it('should validate credentials with API key', () => {
      expect(validateCredentials(mockAnthropicCredentials)).toBe(true);
      expect(validateCredentials(mockOpenAICredentials)).toBe(true);
    });

    it('should reject empty API key', () => {
      const invalid: AnthropicCredentials = {
        provider: 'anthropic',
        apiKey: '',
      };
      expect(validateCredentials(invalid)).toBe(false);
    });

    it('should validate Azure credentials with required fields', () => {
      expect(validateCredentials(mockAzureCredentials)).toBe(true);
    });

    it('should reject Azure credentials without required fields', () => {
      const invalid: AzureOpenAICredentials = {
        provider: 'azure_openai',
        apiKey: 'test',
        resourceName: '',  // Empty
        deploymentName: 'deployment',
        apiVersion: '2024-02-01',
      };
      expect(validateCredentials(invalid)).toBe(false);
    });
  });
});

// =============================================================================
// LLM Providers Constants Tests
// =============================================================================

describe('LLM Providers Constants', () => {
  it('should define all provider constants', () => {
    expect(LLMProviders.ANTHROPIC).toBe('anthropic');
    expect(LLMProviders.OPENAI).toBe('openai');
    expect(LLMProviders.AZURE_OPENAI).toBe('azure_openai');
    expect(LLMProviders.GOOGLE).toBe('google');
    expect(LLMProviders.COHERE).toBe('cohere');
    expect(LLMProviders.LOCAL).toBe('local');
    expect(LLMProviders.CUSTOM).toBe('custom');
  });
});

// =============================================================================
// Default Values Tests
// =============================================================================

describe('Default Values', () => {
  it('should have correct default request values', () => {
    expect(DEFAULT_LLM_REQUEST.maxTokens).toBe(4096);
    expect(DEFAULT_LLM_REQUEST.temperature).toBe(0.7);
    expect(DEFAULT_LLM_REQUEST.topP).toBe(1.0);
    expect(DEFAULT_LLM_REQUEST.timeoutMs).toBe(60000);
  });

  it('should have correct default client options', () => {
    expect(DEFAULT_CLIENT_OPTIONS.connectTimeoutMs).toBe(30000);
    expect(DEFAULT_CLIENT_OPTIONS.defaultTimeoutMs).toBe(60000);
    expect(DEFAULT_CLIENT_OPTIONS.maxRetries).toBe(3);
    expect(DEFAULT_CLIENT_OPTIONS.retryBaseDelayMs).toBe(1000);
    expect(DEFAULT_CLIENT_OPTIONS.enableLogging).toBe(false);
  });
});

// =============================================================================
// LLMError Tests
// =============================================================================

describe('LLMError', () => {
  it('should create error with all properties', () => {
    const error = new LLMError(
      'Test error',
      'AUTHENTICATION_ERROR',
      'anthropic',
      401,
      false,
      { extra: 'data' }
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.provider).toBe('anthropic');
    expect(error.statusCode).toBe(401);
    expect(error.isRetryable).toBe(false);
    expect(error.details).toEqual({ extra: 'data' });
    expect(error.name).toBe('LLMError');
  });

  it('should be an instance of Error', () => {
    const error = new LLMError('Test', 'UNKNOWN_ERROR', 'openai');
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// Client Factory Tests
// =============================================================================

describe('LLMClientFactory', () => {
  let factory: LLMClientFactory;

  beforeEach(() => {
    factory = new LLMClientFactory();
  });

  afterEach(async () => {
    await factory.closeAll();
  });

  describe('getSupportedProviders', () => {
    it('should return list of supported providers', () => {
      const providers = factory.getSupportedProviders();
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).toContain('azure_openai');
    });
  });

  describe('isProviderSupported', () => {
    it('should return true for supported providers', () => {
      expect(factory.isProviderSupported('anthropic')).toBe(true);
      expect(factory.isProviderSupported('openai')).toBe(true);
    });

    it('should return false for unsupported providers', () => {
      expect(factory.isProviderSupported('google')).toBe(false);
      expect(factory.isProviderSupported('cohere')).toBe(false);
    });
  });

  describe('getProviderDisplayName', () => {
    it('should return display names for providers', () => {
      expect(factory.getProviderDisplayName('anthropic')).toBe('Anthropic Claude');
      expect(factory.getProviderDisplayName('openai')).toBe('OpenAI');
      expect(factory.getProviderDisplayName('azure_openai')).toBe('Azure OpenAI');
    });
  });

  describe('create', () => {
    it('should create Anthropic client', () => {
      const client = factory.create(mockAnthropicCredentials);
      expect(client).toBeInstanceOf(AnthropicClient);
      expect(client.getProviderName()).toBe('anthropic');
    });

    it('should create OpenAI client', () => {
      const client = factory.create(mockOpenAICredentials);
      expect(client).toBeInstanceOf(OpenAIClient);
      expect(client.getProviderName()).toBe('openai');
    });

    it('should create Azure OpenAI client', () => {
      const client = factory.create(mockAzureCredentials);
      expect(client).toBeInstanceOf(AzureOpenAIClient);
      expect(client.getProviderName()).toBe('azure_openai');
    });

    it('should throw for unsupported provider', () => {
      const unsupported = {
        provider: 'google' as const,
        apiKey: 'test-key',
      };

      expect(() => factory.create(unsupported as LLMCredentials)).toThrow(LLMError);
    });
  });
});

// =============================================================================
// LLMInvocationSurface Tests
// =============================================================================

describe('LLMInvocationSurface', () => {
  let surface: LLMInvocationSurface;

  beforeEach(() => {
    surface = createLLMInvocationSurface({
      enableLogging: false,
    });
  });

  afterEach(async () => {
    await surface.closeAllClients();
  });

  describe('createClient', () => {
    it('should create client for Anthropic', () => {
      const client = surface.createClient('anthropic', mockAnthropicCredentials);
      expect(client.getProviderName()).toBe('anthropic');
    });

    it('should create client for OpenAI', () => {
      const client = surface.createClient('openai', mockOpenAICredentials);
      expect(client.getProviderName()).toBe('openai');
    });

    it('should throw for mismatched provider', () => {
      expect(() =>
        surface.createClient('openai', mockAnthropicCredentials)
      ).toThrow(LLMError);
    });

    it('should throw for invalid credentials', () => {
      const invalid: OpenAICredentials = {
        provider: 'openai',
        apiKey: '',
      };

      expect(() => surface.createClient('openai', invalid)).toThrow(LLMError);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return list of supported providers', () => {
      const providers = surface.getSupportedProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
    });
  });

  describe('isProviderSupported', () => {
    it('should check if provider is supported', () => {
      expect(surface.isProviderSupported('anthropic')).toBe(true);
      expect(surface.isProviderSupported('openai')).toBe(true);
      expect(surface.isProviderSupported('google')).toBe(false);
    });
  });

  describe('getProviderDisplayName', () => {
    it('should return display name for provider', () => {
      expect(surface.getProviderDisplayName('anthropic')).toBe('Anthropic Claude');
      expect(surface.getProviderDisplayName('openai')).toBe('OpenAI');
    });
  });

  describe('getActiveClientCount', () => {
    it('should track active clients', () => {
      expect(surface.getActiveClientCount()).toBe(0);

      surface.createClient('anthropic', mockAnthropicCredentials);
      expect(surface.getActiveClientCount()).toBe(1);

      surface.createClient('openai', mockOpenAICredentials);
      expect(surface.getActiveClientCount()).toBe(2);
    });
  });

  describe('closeClient', () => {
    it('should close and remove client', async () => {
      const client = surface.createClient('anthropic', mockAnthropicCredentials);
      expect(surface.getActiveClientCount()).toBe(1);

      await surface.closeClient(client);
      expect(surface.getActiveClientCount()).toBe(0);
    });
  });

  describe('closeAllClients', () => {
    it('should close all active clients', async () => {
      surface.createClient('anthropic', mockAnthropicCredentials);
      surface.createClient('openai', mockOpenAICredentials);
      expect(surface.getActiveClientCount()).toBe(2);

      await surface.closeAllClients();
      expect(surface.getActiveClientCount()).toBe(0);
    });
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('Default Surface Singleton', () => {
  it('should return same instance', () => {
    const surface1 = getDefaultLLMInvocationSurface();
    const surface2 = getDefaultLLMInvocationSurface();
    expect(surface1).toBe(surface2);
  });
});

// =============================================================================
// Environment Credential Tests
// =============================================================================

describe('Environment Credentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createCredentialsFromEnv', () => {
    it('should create Anthropic credentials from env', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.ANTHROPIC_API_VERSION = '2023-06-01';

      const creds = createCredentialsFromEnv('anthropic');
      expect(creds).toBeDefined();
      expect(creds?.provider).toBe('anthropic');
      expect(creds?.apiKey).toBe('test-key');
    });

    it('should create OpenAI credentials from env', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.OPENAI_ORG_ID = 'test-org';

      const creds = createCredentialsFromEnv('openai');
      expect(creds).toBeDefined();
      expect(creds?.provider).toBe('openai');
      expect((creds as OpenAICredentials)?.organizationId).toBe('test-org');
    });

    it('should return undefined when env vars not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const creds = createCredentialsFromEnv('anthropic');
      expect(creds).toBeUndefined();
    });

    it('should create Azure credentials from env', () => {
      process.env.AZURE_OPENAI_API_KEY = 'test-key';
      process.env.AZURE_OPENAI_RESOURCE = 'test-resource';
      process.env.AZURE_OPENAI_DEPLOYMENT = 'test-deployment';

      const creds = createCredentialsFromEnv('azure_openai');
      expect(creds).toBeDefined();
      expect(creds?.provider).toBe('azure_openai');
    });
  });
});

// =============================================================================
// Client Abstraction Tests
// =============================================================================

describe('Client Abstraction', () => {
  describe('AnthropicClient', () => {
    let client: AnthropicClient;

    beforeEach(() => {
      client = new AnthropicClient(mockAnthropicCredentials);
    });

    afterEach(async () => {
      await client.close();
    });

    it('should have correct provider name', () => {
      expect(client.getProviderName()).toBe('anthropic');
    });

    it('should have correct display name', () => {
      expect(client.getProviderDisplayName()).toBe('Anthropic Claude');
    });

    it('should not be ready initially', () => {
      expect(client.isReady()).toBe(false);
    });
  });

  describe('OpenAIClient', () => {
    let client: OpenAIClient;

    beforeEach(() => {
      client = new OpenAIClient(mockOpenAICredentials);
    });

    afterEach(async () => {
      await client.close();
    });

    it('should have correct provider name', () => {
      expect(client.getProviderName()).toBe('openai');
    });

    it('should have correct display name', () => {
      expect(client.getProviderDisplayName()).toBe('OpenAI');
    });
  });

  describe('AzureOpenAIClient', () => {
    let client: AzureOpenAIClient;

    beforeEach(() => {
      client = new AzureOpenAIClient(mockAzureCredentials);
    });

    afterEach(async () => {
      await client.close();
    });

    it('should have correct provider name', () => {
      expect(client.getProviderName()).toBe('azure_openai');
    });

    it('should have correct display name', () => {
      expect(client.getProviderDisplayName()).toBe('Azure OpenAI');
    });
  });
});

// =============================================================================
// Request Validation Tests
// =============================================================================

describe('Request Validation', () => {
  let surface: LLMInvocationSurface;
  let client: import('../../src/surfaces/index.js').LLMClient;

  beforeEach(() => {
    surface = createLLMInvocationSurface();
    client = surface.createClient('anthropic', mockAnthropicCredentials);
  });

  afterEach(async () => {
    await surface.closeAllClients();
  });

  it('should require model in request', async () => {
    const request: LLMRequest = {
      model: '',
      prompt: 'test',
      maxTokens: 100,
      temperature: 0.7,
    };

    await expect(surface.invoke(client, request)).rejects.toThrow(LLMError);
  });

  it('should require prompt or messages', async () => {
    const request: LLMRequest = {
      model: 'claude-3-haiku-20240307',
      maxTokens: 100,
      temperature: 0.7,
    };

    await expect(surface.invoke(client, request)).rejects.toThrow(LLMError);
  });

  it('should require positive maxTokens', async () => {
    const request: LLMRequest = {
      model: 'claude-3-haiku-20240307',
      prompt: 'test',
      maxTokens: 0,
      temperature: 0.7,
    };

    await expect(surface.invoke(client, request)).rejects.toThrow(LLMError);
  });

  it('should validate temperature range', async () => {
    const request: LLMRequest = {
      model: 'claude-3-haiku-20240307',
      prompt: 'test',
      maxTokens: 100,
      temperature: 3.0, // Invalid: > 2
    };

    await expect(surface.invoke(client, request)).rejects.toThrow(LLMError);
  });
});
