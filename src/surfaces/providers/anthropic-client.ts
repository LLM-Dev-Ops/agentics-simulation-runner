/**
 * Anthropic Claude Client Implementation
 *
 * MOD-010: LLM Invocation Surface
 *
 * Implements the LLM client for Anthropic's Claude models.
 * Uses the Anthropic Messages API pattern.
 *
 * @module surfaces/providers/anthropic-client
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMClientOptions,
  ModelInfo,
  ModelCapabilities,
  AnthropicCredentials,
  ChatMessage,
  FinishReason,
} from '../llm-types.js';
import { LLMError } from '../llm-types.js';
import { BaseLLMClient } from './base-llm-client.js';

// =============================================================================
// Anthropic API Types
// =============================================================================

/**
 * Anthropic message structure
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Anthropic API request body
 */
interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: {
    user_id?: string;
  };
}

/**
 * Anthropic API response
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Anthropic error response
 */
interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// =============================================================================
// Known Anthropic Models
// =============================================================================

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    modelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      chat: true,
      completion: true,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
  {
    modelId: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      chat: true,
      completion: true,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
  {
    modelId: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: true,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
  {
    modelId: 'claude-3-sonnet-20240229',
    displayName: 'Claude 3 Sonnet',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: true,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
  {
    modelId: 'claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: true,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
];

// =============================================================================
// Anthropic Client Implementation
// =============================================================================

/**
 * Anthropic Claude client implementation
 */
export class AnthropicClient extends BaseLLMClient {
  private readonly anthropicCredentials: AnthropicCredentials;
  private readonly apiVersion: string;

  constructor(credentials: AnthropicCredentials, options: LLMClientOptions = {}) {
    super(credentials, options);
    this.anthropicCredentials = credentials;
    this.apiVersion = credentials.apiVersion ?? '2023-06-01';
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  getProviderName(): 'anthropic' {
    return 'anthropic';
  }

  getProviderDisplayName(): string {
    return 'Anthropic Claude';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.anthropic.com';
  }

  protected async validateCredentials(): Promise<boolean> {
    try {
      // Make a minimal API call to validate credentials
      const response = await this.makeRequest('/v1/messages', {
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      });

      return response.ok || response.status === 400; // 400 means valid auth but bad request is okay for validation
    } catch (error) {
      this.log(`Credential validation failed: ${error}`);
      return false;
    }
  }

  protected async doInvoke(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    const requestBody = this.buildRequestBody(request);
    const response = await this.makeRequest('/v1/messages', requestBody);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = await response.json() as AnthropicResponse;
    const latencyMs = Date.now() - startTime;

    return this.parseResponse(data, latencyMs);
  }

  protected async fetchModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    // Anthropic doesn't have a models API, so we use our known models list
    return ANTHROPIC_MODELS.find(m => m.modelId === modelId);
  }

  protected async fetchModels(): Promise<ModelInfo[]> {
    // Return known models as Anthropic doesn't expose a models endpoint
    return [...ANTHROPIC_MODELS];
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Build the request body for Anthropic API
   */
  private buildRequestBody(request: LLMRequest): AnthropicRequestBody {
    const messages = this.buildMessages(request);

    const body: AnthropicRequestBody = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens,
    };

    // Add system prompt if provided
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    // Add optional parameters
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    if (request.topK !== undefined) {
      body.top_k = request.topK;
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop_sequences = [...request.stopSequences];
    }

    return body;
  }

  /**
   * Build messages array from request
   */
  private buildMessages(request: LLMRequest): AnthropicMessage[] {
    // If messages are provided directly, use them
    if (request.messages && request.messages.length > 0) {
      return request.messages
        .filter(m => m.role !== 'system') // System is handled separately
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));
    }

    // Otherwise, use the prompt as a user message
    if (request.prompt) {
      return [{ role: 'user', content: request.prompt }];
    }

    return [];
  }

  /**
   * Make HTTP request to Anthropic API
   */
  private async makeRequest(
    endpoint: string,
    body: AnthropicRequestBody
  ): Promise<Response> {
    const url = `${this.getBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.anthropicCredentials.apiKey,
      'anthropic-version': this.apiVersion,
      ...this.options.customHeaders,
    };

    if (this.anthropicCredentials.organizationId) {
      headers['anthropic-organization'] = this.anthropicCredentials.organizationId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    return response;
  }

  /**
   * Handle error response from Anthropic API
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string;
    let errorType: string;

    try {
      const errorData = await response.json() as AnthropicErrorResponse;
      errorMessage = errorData.error?.message ?? 'Unknown error';
      errorType = errorData.error?.type ?? 'unknown_error';
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      errorType = 'http_error';
    }

    const errorCode = this.mapAnthropicErrorCode(errorType, response.status);
    const isRetryable = this.isRetryableStatusCode(response.status);

    throw new LLMError(
      errorMessage,
      errorCode,
      'anthropic',
      response.status,
      isRetryable,
      { errorType }
    );
  }

  /**
   * Map Anthropic error type to LLM error code
   */
  private mapAnthropicErrorCode(
    errorType: string,
    statusCode: number
  ): import('../llm-types.js').LLMErrorCode {
    switch (errorType) {
      case 'authentication_error':
        return 'AUTHENTICATION_ERROR';
      case 'rate_limit_error':
        return 'RATE_LIMIT_ERROR';
      case 'invalid_request_error':
        return 'INVALID_REQUEST_ERROR';
      case 'not_found_error':
        return 'MODEL_NOT_FOUND';
      case 'overloaded_error':
        return 'MODEL_UNAVAILABLE';
      default:
        if (statusCode === 401 || statusCode === 403) return 'AUTHENTICATION_ERROR';
        if (statusCode === 429) return 'RATE_LIMIT_ERROR';
        if (statusCode === 404) return 'MODEL_NOT_FOUND';
        if (statusCode >= 500) return 'SERVER_ERROR';
        return 'UNKNOWN_ERROR';
    }
  }

  /**
   * Check if status code indicates retryable error
   */
  private isRetryableStatusCode(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 503 || statusCode === 529;
  }

  /**
   * Parse Anthropic response to LLMResponse
   */
  private parseResponse(data: AnthropicResponse, latencyMs: number): LLMResponse {
    // Extract text content from response
    const content = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Calculate total cached tokens
    const cachedTokens =
      (data.usage.cache_creation_input_tokens ?? 0) +
      (data.usage.cache_read_input_tokens ?? 0);

    return {
      content,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
      },
      finishReason: this.mapFinishReason(data.stop_reason),
      latencyMs,
      model: data.model,
      responseId: data.id,
      provider: 'anthropic',
      metadata: {
        stopSequence: data.stop_sequence,
      },
    };
  }

  /**
   * Map Anthropic stop reason to finish reason
   */
  private mapFinishReason(stopReason: AnthropicResponse['stop_reason']): FinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_use';
      default:
        return 'stop';
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Anthropic client
 */
export function createAnthropicClient(
  credentials: AnthropicCredentials,
  options?: LLMClientOptions
): AnthropicClient {
  return new AnthropicClient(credentials, options);
}
