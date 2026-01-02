/**
 * LLM Invocation Surface Type Definitions
 *
 * MOD-010: LLM Invocation Surface
 *
 * Provides type definitions for abstracting LLM provider interactions,
 * including credentials, requests, responses, and usage metrics.
 *
 * @module surfaces/llm-types
 */

import type { DurationMs, LLMProvider as BaseLLMProvider } from '../types/common.js';

// =============================================================================
// LLM Provider Types
// =============================================================================

/**
 * Supported LLM providers
 *
 * Extends the base LLMProvider from common types with additional providers
 * supported by the LLM Invocation Surface.
 */
export type LLMProviderType =
  | 'anthropic'
  | 'openai'
  | 'azure_openai'
  | 'google'
  | 'cohere'
  | 'local'
  | 'custom';

/**
 * LLM provider enum for type-safe provider identification
 */
export const LLMProviders = {
  ANTHROPIC: 'anthropic' as const,
  OPENAI: 'openai' as const,
  AZURE_OPENAI: 'azure_openai' as const,
  GOOGLE: 'google' as const,
  COHERE: 'cohere' as const,
  LOCAL: 'local' as const,
  CUSTOM: 'custom' as const,
} as const;

// =============================================================================
// Credentials Types
// =============================================================================

/**
 * Base credentials interface for all LLM providers
 */
export interface LLMCredentialsBase {
  /**
   * API key for authentication
   */
  readonly apiKey: string;

  /**
   * Optional base URL for custom endpoints
   */
  readonly baseUrl?: string;

  /**
   * Optional organization ID (for providers that support it)
   */
  readonly organizationId?: string;
}

/**
 * Anthropic-specific credentials
 */
export interface AnthropicCredentials extends LLMCredentialsBase {
  readonly provider: 'anthropic';
  /**
   * API version for Anthropic (e.g., "2024-01-01")
   */
  readonly apiVersion?: string;
}

/**
 * OpenAI-specific credentials
 */
export interface OpenAICredentials extends LLMCredentialsBase {
  readonly provider: 'openai';
  /**
   * Project ID for OpenAI
   */
  readonly projectId?: string;
}

/**
 * Azure OpenAI-specific credentials
 */
export interface AzureOpenAICredentials extends LLMCredentialsBase {
  readonly provider: 'azure_openai';
  /**
   * Azure deployment name
   */
  readonly deploymentName: string;
  /**
   * Azure API version
   */
  readonly apiVersion: string;
  /**
   * Azure resource name
   */
  readonly resourceName: string;
}

/**
 * Google (Gemini)-specific credentials
 */
export interface GoogleCredentials extends LLMCredentialsBase {
  readonly provider: 'google';
  /**
   * Google Cloud project ID
   */
  readonly projectId?: string;
  /**
   * Google Cloud location/region
   */
  readonly location?: string;
}

/**
 * Cohere-specific credentials
 */
export interface CohereCredentials extends LLMCredentialsBase {
  readonly provider: 'cohere';
}

/**
 * Custom/self-hosted provider credentials
 */
export interface CustomCredentials extends LLMCredentialsBase {
  readonly provider: 'custom' | 'local';
  /**
   * Custom headers for authentication
   */
  readonly customHeaders?: Record<string, string>;
}

/**
 * Union type for all credential types
 */
export type LLMCredentials =
  | AnthropicCredentials
  | OpenAICredentials
  | AzureOpenAICredentials
  | GoogleCredentials
  | CohereCredentials
  | CustomCredentials;

// =============================================================================
// Request Types
// =============================================================================

/**
 * Message role for chat-based models
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * Chat message structure
 */
export interface ChatMessage {
  readonly role: MessageRole;
  readonly content: string;
  /**
   * Optional name for the message author
   */
  readonly name?: string;
}

/**
 * LLM request configuration
 */
export interface LLMRequest {
  /**
   * Model identifier (e.g., "claude-3-opus-20240229", "gpt-4-turbo")
   */
  readonly model: string;

  /**
   * Prompt text (for completion-style requests)
   * Either prompt or messages must be provided
   */
  readonly prompt?: string;

  /**
   * Chat messages (for chat-style requests)
   * Either prompt or messages must be provided
   */
  readonly messages?: readonly ChatMessage[];

  /**
   * System prompt/instruction
   */
  readonly systemPrompt?: string;

  /**
   * Maximum tokens to generate
   */
  readonly maxTokens: number;

  /**
   * Temperature for response randomness (0.0 - 2.0)
   * Lower values make output more deterministic
   */
  readonly temperature: number;

  /**
   * Top-p (nucleus) sampling
   */
  readonly topP?: number;

  /**
   * Top-k sampling (provider-specific)
   */
  readonly topK?: number;

  /**
   * Frequency penalty (-2.0 to 2.0)
   */
  readonly frequencyPenalty?: number;

  /**
   * Presence penalty (-2.0 to 2.0)
   */
  readonly presencePenalty?: number;

  /**
   * Stop sequences that will halt generation
   */
  readonly stopSequences?: readonly string[];

  /**
   * Seed for reproducibility (provider-specific support)
   */
  readonly seed?: number;

  /**
   * Request timeout in milliseconds
   */
  readonly timeoutMs?: DurationMs;

  /**
   * Additional provider-specific parameters
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Default request values
 */
export const DEFAULT_LLM_REQUEST: Partial<LLMRequest> = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 1.0,
  timeoutMs: 60000,
};

// =============================================================================
// Response Types
// =============================================================================

/**
 * Token usage information
 */
export interface TokenUsage {
  /**
   * Number of tokens in the input/prompt
   */
  readonly inputTokens: number;

  /**
   * Number of tokens in the output/completion
   */
  readonly outputTokens: number;

  /**
   * Total tokens (input + output)
   */
  readonly totalTokens: number;

  /**
   * Cached tokens (if applicable)
   */
  readonly cachedTokens?: number;
}

/**
 * Finish reason for generation completion
 */
export type FinishReason =
  | 'stop'           // Natural completion or stop sequence
  | 'length'         // Max tokens reached
  | 'content_filter' // Content filtered by provider
  | 'tool_use'       // Tool/function call requested
  | 'error';         // Error during generation

/**
 * LLM response structure
 */
export interface LLMResponse {
  /**
   * Generated content
   */
  readonly content: string;

  /**
   * Token usage metrics
   */
  readonly usage: TokenUsage;

  /**
   * Reason for generation completion
   */
  readonly finishReason: FinishReason;

  /**
   * Request latency in milliseconds
   */
  readonly latencyMs: DurationMs;

  /**
   * Model used for generation
   */
  readonly model: string;

  /**
   * Provider-specific response ID
   */
  readonly responseId?: string;

  /**
   * Provider name
   */
  readonly provider: LLMProviderType;

  /**
   * Additional response metadata
   */
  readonly metadata?: Record<string, unknown>;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * LLM error codes
 */
export type LLMErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'INVALID_REQUEST_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_UNAVAILABLE'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'CONTENT_FILTER_ERROR'
  | 'TIMEOUT_ERROR'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * LLM-specific error class
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: LLMErrorCode,
    public readonly provider: LLMProviderType,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// =============================================================================
// Model Information Types
// =============================================================================

/**
 * Model capability flags
 */
export interface ModelCapabilities {
  /**
   * Supports chat/conversation mode
   */
  readonly chat: boolean;

  /**
   * Supports text completion mode
   */
  readonly completion: boolean;

  /**
   * Supports function/tool calling
   */
  readonly functionCalling: boolean;

  /**
   * Supports vision/image input
   */
  readonly vision: boolean;

  /**
   * Supports streaming responses
   */
  readonly streaming: boolean;

  /**
   * Supports JSON mode
   */
  readonly jsonMode: boolean;

  /**
   * Supports seed for reproducibility
   */
  readonly deterministicSeed: boolean;
}

/**
 * Model information
 */
export interface ModelInfo {
  /**
   * Model identifier
   */
  readonly modelId: string;

  /**
   * Display name
   */
  readonly displayName: string;

  /**
   * Provider
   */
  readonly provider: LLMProviderType;

  /**
   * Maximum context length in tokens
   */
  readonly maxContextTokens: number;

  /**
   * Maximum output tokens
   */
  readonly maxOutputTokens: number;

  /**
   * Model capabilities
   */
  readonly capabilities: ModelCapabilities;

  /**
   * Whether the model is currently available
   */
  readonly available: boolean;

  /**
   * Optional deprecation date
   */
  readonly deprecationDate?: string;
}

// =============================================================================
// Client Interface Types
// =============================================================================

/**
 * Client options for creating LLM clients
 */
export interface LLMClientOptions {
  /**
   * Connection timeout in milliseconds
   */
  readonly connectTimeoutMs?: DurationMs;

  /**
   * Default request timeout in milliseconds
   */
  readonly defaultTimeoutMs?: DurationMs;

  /**
   * Maximum retries for transient failures
   */
  readonly maxRetries?: number;

  /**
   * Base delay for retry backoff in milliseconds
   */
  readonly retryBaseDelayMs?: DurationMs;

  /**
   * Enable request/response logging
   */
  readonly enableLogging?: boolean;

  /**
   * Custom HTTP headers
   */
  readonly customHeaders?: Record<string, string>;
}

/**
 * Default client options
 */
export const DEFAULT_CLIENT_OPTIONS: LLMClientOptions = {
  connectTimeoutMs: 30000,
  defaultTimeoutMs: 60000,
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  enableLogging: false,
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if credentials are for Anthropic
 */
export function isAnthropicCredentials(creds: LLMCredentials): creds is AnthropicCredentials {
  return creds.provider === 'anthropic';
}

/**
 * Check if credentials are for OpenAI
 */
export function isOpenAICredentials(creds: LLMCredentials): creds is OpenAICredentials {
  return creds.provider === 'openai';
}

/**
 * Check if credentials are for Azure OpenAI
 */
export function isAzureOpenAICredentials(creds: LLMCredentials): creds is AzureOpenAICredentials {
  return creds.provider === 'azure_openai';
}

/**
 * Check if credentials are for Google
 */
export function isGoogleCredentials(creds: LLMCredentials): creds is GoogleCredentials {
  return creds.provider === 'google';
}

/**
 * Check if credentials are for Cohere
 */
export function isCohereCredentials(creds: LLMCredentials): creds is CohereCredentials {
  return creds.provider === 'cohere';
}

/**
 * Check if credentials are for custom provider
 */
export function isCustomCredentials(creds: LLMCredentials): creds is CustomCredentials {
  return creds.provider === 'custom' || creds.provider === 'local';
}

/**
 * Check if an error is retryable
 */
export function isRetryableLLMError(error: unknown): boolean {
  if (error instanceof LLMError) {
    return error.isRetryable;
  }
  return false;
}

/**
 * Get error code from various error types
 */
export function getLLMErrorCode(error: unknown): LLMErrorCode {
  if (error instanceof LLMError) {
    return error.code;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) return 'TIMEOUT_ERROR';
    if (message.includes('network') || message.includes('econnrefused')) return 'NETWORK_ERROR';
    if (message.includes('rate limit') || message.includes('429')) return 'RATE_LIMIT_ERROR';
    if (message.includes('unauthorized') || message.includes('401')) return 'AUTHENTICATION_ERROR';
    if (message.includes('not found') || message.includes('404')) return 'MODEL_NOT_FOUND';
  }

  return 'UNKNOWN_ERROR';
}
