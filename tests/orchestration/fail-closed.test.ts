/**
 * ADR-0001 Verification 4, 5, 6 — no mock defaults, credentials fail closed,
 * real provider factory is wired.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createAgentResolver } from '../../src/orchestration/agent-resolver.js';
import {
  createConnectionEstablisher,
  createMockSecureVault,
  EnvSecureVault,
  RealAdapterFactory,
  SecureVaultError,
  VaultConfigurationError,
} from '../../src/orchestration/connection-establisher.js';
import {
  ProviderLLMClientFactory,
  ProviderLLMClientAdapter,
  MissingProviderCredentialsError,
} from '../../src/orchestration/provider-llm-client-factory.js';
import { AnthropicClient } from '../../src/surfaces/providers/anthropic-client.js';
import { OpenAIClient } from '../../src/surfaces/providers/openai-client.js';

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_RESOURCE',
  'AZURE_OPENAI_DEPLOYMENT',
  'RUNNER_CREDENTIAL_PREFIX',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of PROVIDER_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('Verification 4 — no mock defaults', () => {
  it('AgentResolver with empty config throws in an unconfigured environment', () => {
    expect(() => createAgentResolver()).toThrow(MissingProviderCredentialsError);
  });

  it('ConnectionEstablisher with empty config throws in an unconfigured environment', () => {
    expect(() => createConnectionEstablisher()).toThrow(VaultConfigurationError);
  });

  it('the default adapter factory rejects adapter types it cannot really build', async () => {
    const factory = new RealAdapterFactory();
    await expect(
      factory.createAdapter(
        {
          integrationId: 'i-1',
          adapterType: 'GRPC',
          name: 'grpc integration',
          connectionSpec: { credentialRef: 'ref' },
          idempotent: true,
        },
        { type: 'API_KEY', value: 'v' }
      )
    ).rejects.toThrow(/No adapter implementation for type GRPC/);
  });
});

describe('Verification 5 — credentials fail closed', () => {
  it('the in-memory test vault throws CREDENTIAL_NOT_FOUND for an unknown reference', async () => {
    const vault = createMockSecureVault();
    await expect(vault.resolveCredential('nonexistent')).rejects.toThrow(SecureVaultError);
    await expect(vault.resolveCredential('nonexistent')).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
  });

  it('the in-memory test vault seeds no credentials of its own', async () => {
    const vault = createMockSecureVault();
    expect(await vault.isCredentialValid('default-api-key')).toBe(false);
    expect(await vault.isCredentialValid('default-bearer-token')).toBe(false);
  });

  it('the environment vault throws CREDENTIAL_NOT_FOUND when the variable is unset', async () => {
    const vault = new EnvSecureVault('RUNNER_CREDENTIAL_');
    await expect(vault.resolveCredential('absent-key')).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
    expect(await vault.isCredentialValid('absent-key')).toBe(false);
  });

  it('the environment vault resolves a configured reference', async () => {
    process.env.RUNNER_CREDENTIAL_PRESENT_KEY = 'real-value';
    try {
      const vault = new EnvSecureVault('RUNNER_CREDENTIAL_');
      expect(await vault.isCredentialValid('present-key')).toBe(true);
      expect(await vault.resolveCredential('present-key')).toEqual({
        type: 'API_KEY',
        value: 'real-value',
      });
    } finally {
      delete process.env.RUNNER_CREDENTIAL_PRESENT_KEY;
    }
  });
});

describe('Verification 6 — the real provider factory is wired', () => {
  it('builds an AnthropicClient when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const client = await new ProviderLLMClientFactory().createClient('ANTHROPIC', {
      provider: 'ANTHROPIC',
      modelId: 'claude-3-5-sonnet-20241022',
      maxTokens: 128,
      temperature: 0,
    });

    expect(client).toBeInstanceOf(ProviderLLMClientAdapter);
    expect((client as ProviderLLMClientAdapter).providerClient).toBeInstanceOf(AnthropicClient);
  });

  it('builds an OpenAIClient when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const client = await new ProviderLLMClientFactory().createClient('OPENAI', {
      provider: 'OPENAI',
      modelId: 'gpt-4o',
      maxTokens: 128,
      temperature: 0,
    });

    expect((client as ProviderLLMClientAdapter).providerClient).toBeInstanceOf(OpenAIClient);
  });

  it('rejects a provider that has no configured credentials', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const factory = new ProviderLLMClientFactory();
    await expect(
      factory.createClient('GOOGLE', {
        provider: 'GOOGLE',
        modelId: 'gemini-1.5-pro',
        maxTokens: 128,
        temperature: 0,
      })
    ).rejects.toThrow(MissingProviderCredentialsError);
  });
});
