/**
 * LLM Provider Clients Index
 *
 * MOD-010: LLM Invocation Surface
 *
 * Exports all LLM provider client implementations.
 *
 * @module surfaces/providers
 */

// Base client
export { BaseLLMClient } from './base-llm-client.js';
export type { LLMClient } from './base-llm-client.js';

// Anthropic client
export {
  AnthropicClient,
  createAnthropicClient,
} from './anthropic-client.js';

// OpenAI clients
export {
  OpenAIClient,
  AzureOpenAIClient,
  createOpenAIClient,
  createAzureOpenAIClient,
} from './openai-client.js';
