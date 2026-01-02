/**
 * OpenAI GPT Client Implementation
 *
 * MOD-010: LLM Invocation Surface
 *
 * Implements the LLM client for OpenAI's GPT models.
 * Uses the OpenAI Chat Completions API pattern.
 *
 * @module surfaces/providers/openai-client
 */

import type {
  LLMRequest,
  LLMResponse,
  LLMClientOptions,
  ModelInfo,
  OpenAICredentials,
  AzureOpenAICredentials,
  FinishReason,
} from '../llm-types.js';
import { LLMError, LLMProviderType } from '../llm-types.js';
import { BaseLLMClient } from './base-llm-client.js';

// =============================================================================
// OpenAI API Types
// =============================================================================

/**
 * OpenAI message structure
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

/**
 * OpenAI API request body
 */
interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  seed?: number;
  response_format?: { type: 'text' | 'json_object' };
  user?: string;
}

/**
 * OpenAI API response
 */
interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  system_fingerprint?: string;
}

/**
 * OpenAI error response
 */
interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

/**
 * OpenAI models list response
 */
interface OpenAIModelsResponse {
  data: Array<{
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
  }>;
}

// =============================================================================
// Known OpenAI Models
// =============================================================================

const OPENAI_MODELS: ModelInfo[] = [
  {
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: true,
    },
    available: true,
  },
  {
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: true,
    },
    available: true,
  },
  {
    modelId: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: true,
    },
    available: true,
  },
  {
    modelId: 'gpt-4',
    displayName: 'GPT-4',
    provider: 'openai',
    maxContextTokens: 8192,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: false,
      streaming: true,
      jsonMode: true,
      deterministicSeed: true,
    },
    available: true,
  },
  {
    modelId: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    provider: 'openai',
    maxContextTokens: 16385,
    maxOutputTokens: 4096,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: false,
      streaming: true,
      jsonMode: true,
      deterministicSeed: true,
    },
    available: true,
  },
  {
    modelId: 'o1',
    displayName: 'o1',
    provider: 'openai',
    maxContextTokens: 200000,
    maxOutputTokens: 100000,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: true,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
  {
    modelId: 'o1-mini',
    displayName: 'o1-mini',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 65536,
    capabilities: {
      chat: true,
      completion: false,
      functionCalling: true,
      vision: false,
      streaming: true,
      jsonMode: true,
      deterministicSeed: false,
    },
    available: true,
  },
];

// =============================================================================
// OpenAI Client Implementation
// =============================================================================

/**
 * OpenAI GPT client implementation
 */
export class OpenAIClient extends BaseLLMClient {
  private readonly openaiCredentials: OpenAICredentials;

  constructor(credentials: OpenAICredentials, options: LLMClientOptions = {}) {
    super(credentials, options);
    this.openaiCredentials = credentials;
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  getProviderName(): 'openai' {
    return 'openai';
  }

  getProviderDisplayName(): string {
    return 'OpenAI';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com';
  }

  protected async validateCredentials(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/v1/models', undefined, 'GET');
      return response.ok;
    } catch (error) {
      this.log(`Credential validation failed: ${error}`);
      return false;
    }
  }

  protected async doInvoke(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    const requestBody = this.buildRequestBody(request);
    const response = await this.makeRequest('/v1/chat/completions', requestBody);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = await response.json() as OpenAIResponse;
    const latencyMs = Date.now() - startTime;

    return this.parseResponse(data, latencyMs);
  }

  protected async fetchModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    // First check known models
    const knownModel = OPENAI_MODELS.find(m => m.modelId === modelId);
    if (knownModel) {
      return knownModel;
    }

    // Try to fetch from API
    try {
      const response = await this.makeRequest(`/v1/models/${modelId}`, undefined, 'GET');
      if (response.ok) {
        const data = await response.json() as { id: string; owned_by?: string };
        return this.apiModelToModelInfo(data);
      }
    } catch {
      // Model not found
    }

    return undefined;
  }

  protected async fetchModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.makeRequest('/v1/models', undefined, 'GET');
      if (response.ok) {
        const data = await response.json() as OpenAIModelsResponse;
        // Filter to only GPT models and map to ModelInfo
        return data.data
          .filter(m => m.id.startsWith('gpt') || m.id.startsWith('o1'))
          .map(m => this.apiModelToModelInfo(m));
      }
    } catch {
      // Fall back to known models
    }

    return [...OPENAI_MODELS];
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Build the request body for OpenAI API
   */
  private buildRequestBody(request: LLMRequest): OpenAIRequestBody {
    const messages = this.buildMessages(request);

    const body: OpenAIRequestBody = {
      model: request.model,
      messages,
    };

    // Handle max tokens - newer models use max_completion_tokens
    if (this.isO1Model(request.model)) {
      body.max_completion_tokens = request.maxTokens;
    } else {
      body.max_tokens = request.maxTokens;
    }

    // Add optional parameters (not supported by o1 models)
    if (!this.isO1Model(request.model)) {
      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      if (request.topP !== undefined) {
        body.top_p = request.topP;
      }

      if (request.frequencyPenalty !== undefined) {
        body.frequency_penalty = request.frequencyPenalty;
      }

      if (request.presencePenalty !== undefined) {
        body.presence_penalty = request.presencePenalty;
      }
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop = [...request.stopSequences];
    }

    if (request.seed !== undefined) {
      body.seed = request.seed;
    }

    return body;
  }

  /**
   * Check if model is an o1 model (which has different parameter support)
   */
  private isO1Model(model: string): boolean {
    return model.startsWith('o1');
  }

  /**
   * Build messages array from request
   */
  private buildMessages(request: LLMRequest): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];

    // Add system message if provided
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt,
      });
    }

    // If messages are provided directly, use them
    if (request.messages && request.messages.length > 0) {
      for (const msg of request.messages) {
        messages.push({
          role: msg.role,
          content: msg.content,
          name: msg.name,
        });
      }
    } else if (request.prompt) {
      // Otherwise, use the prompt as a user message
      messages.push({
        role: 'user',
        content: request.prompt,
      });
    }

    return messages;
  }

  /**
   * Make HTTP request to OpenAI API
   */
  private async makeRequest(
    endpoint: string,
    body?: OpenAIRequestBody,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<Response> {
    const url = `${this.getBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.openaiCredentials.apiKey}`,
      ...this.options.customHeaders,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.openaiCredentials.organizationId) {
      headers['OpenAI-Organization'] = this.openaiCredentials.organizationId;
    }

    if (this.openaiCredentials.projectId) {
      headers['OpenAI-Project'] = this.openaiCredentials.projectId;
    }

    const requestInit: RequestInit = {
      method,
      headers,
    };

    if (body) {
      requestInit.body = JSON.stringify(body);
    }

    return fetch(url, requestInit);
  }

  /**
   * Handle error response from OpenAI API
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string;
    let errorCode: string | null = null;
    let errorType: string = 'unknown';

    try {
      const errorData = await response.json() as OpenAIErrorResponse;
      errorMessage = errorData.error?.message ?? 'Unknown error';
      errorCode = errorData.error?.code ?? null;
      errorType = errorData.error?.type ?? 'unknown';
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }

    const llmErrorCode = this.mapOpenAIErrorCode(errorType, errorCode, response.status);
    const isRetryable = this.isRetryableStatusCode(response.status);

    throw new LLMError(
      errorMessage,
      llmErrorCode,
      'openai',
      response.status,
      isRetryable,
      { errorType, errorCode }
    );
  }

  /**
   * Map OpenAI error to LLM error code
   */
  private mapOpenAIErrorCode(
    errorType: string,
    errorCode: string | null,
    statusCode: number
  ): import('../llm-types.js').LLMErrorCode {
    // Check specific error codes first
    if (errorCode === 'context_length_exceeded') return 'CONTEXT_LENGTH_EXCEEDED';
    if (errorCode === 'model_not_found') return 'MODEL_NOT_FOUND';
    if (errorCode === 'rate_limit_exceeded') return 'RATE_LIMIT_ERROR';

    // Check error types
    switch (errorType) {
      case 'authentication_error':
        return 'AUTHENTICATION_ERROR';
      case 'rate_limit_error':
        return 'RATE_LIMIT_ERROR';
      case 'invalid_request_error':
        return 'INVALID_REQUEST_ERROR';
      case 'server_error':
        return 'SERVER_ERROR';
      default:
        // Fall back to status code
        if (statusCode === 401) return 'AUTHENTICATION_ERROR';
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
    return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503;
  }

  /**
   * Parse OpenAI response to LLMResponse
   */
  private parseResponse(data: OpenAIResponse, latencyMs: number): LLMResponse {
    const choice = data.choices[0];
    const content = choice?.message?.content ?? '';

    const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens;

    return {
      content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        cachedTokens,
      },
      finishReason: this.mapFinishReason(choice?.finish_reason),
      latencyMs,
      model: data.model,
      responseId: data.id,
      provider: 'openai',
      metadata: {
        systemFingerprint: data.system_fingerprint,
        created: data.created,
      },
    };
  }

  /**
   * Map OpenAI finish reason to finish reason
   */
  private mapFinishReason(finishReason: OpenAIResponse['choices'][0]['finish_reason']): FinishReason {
    switch (finishReason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      case 'tool_calls':
        return 'tool_use';
      default:
        return 'stop';
    }
  }

  /**
   * Convert API model to ModelInfo
   */
  private apiModelToModelInfo(apiModel: { id: string; owned_by?: string }): ModelInfo {
    // Check if we have details for this model
    const knownModel = OPENAI_MODELS.find(m => m.modelId === apiModel.id);
    if (knownModel) {
      return knownModel;
    }

    // Create generic model info
    return {
      modelId: apiModel.id,
      displayName: apiModel.id,
      provider: 'openai',
      maxContextTokens: 8192, // Default
      maxOutputTokens: 4096, // Default
      capabilities: {
        chat: true,
        completion: false,
        functionCalling: apiModel.id.includes('gpt-4') || apiModel.id.includes('gpt-3.5-turbo'),
        vision: apiModel.id.includes('vision') || apiModel.id === 'gpt-4o',
        streaming: true,
        jsonMode: true,
        deterministicSeed: true,
      },
      available: true,
    };
  }
}

// =============================================================================
// Azure OpenAI Client Implementation
// =============================================================================

/**
 * Azure OpenAI client implementation
 */
export class AzureOpenAIClient extends BaseLLMClient {
  private readonly azureCredentials: AzureOpenAICredentials;

  constructor(credentials: AzureOpenAICredentials, options: LLMClientOptions = {}) {
    super(credentials, options);
    this.azureCredentials = credentials;
  }

  getProviderName(): 'azure_openai' {
    return 'azure_openai';
  }

  getProviderDisplayName(): string {
    return 'Azure OpenAI';
  }

  protected getDefaultBaseUrl(): string {
    return `https://${this.azureCredentials.resourceName}.openai.azure.com`;
  }

  protected async validateCredentials(): Promise<boolean> {
    try {
      // Try to list deployments
      const response = await this.makeRequest('/openai/models', undefined, 'GET');
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async doInvoke(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    const requestBody = this.buildRequestBody(request);
    const endpoint = `/openai/deployments/${this.azureCredentials.deploymentName}/chat/completions`;
    const response = await this.makeRequest(endpoint, requestBody);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = await response.json() as OpenAIResponse;
    const latencyMs = Date.now() - startTime;

    return this.parseResponse(data, latencyMs);
  }

  protected async fetchModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    // For Azure, the model is the deployment
    return {
      modelId: this.azureCredentials.deploymentName,
      displayName: this.azureCredentials.deploymentName,
      provider: 'azure_openai',
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
      capabilities: {
        chat: true,
        completion: false,
        functionCalling: true,
        vision: false,
        streaming: true,
        jsonMode: true,
        deterministicSeed: true,
      },
      available: true,
    };
  }

  protected async fetchModels(): Promise<ModelInfo[]> {
    // Azure doesn't have a simple models list, return the deployment
    const modelInfo = await this.fetchModelInfo(this.azureCredentials.deploymentName);
    return modelInfo ? [modelInfo] : [];
  }

  private buildRequestBody(request: LLMRequest): OpenAIRequestBody {
    // Same structure as OpenAI
    const messages: OpenAIMessage[] = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    if (request.messages && request.messages.length > 0) {
      for (const msg of request.messages) {
        messages.push({ role: msg.role, content: msg.content, name: msg.name });
      }
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt });
    }

    const body: OpenAIRequestBody = {
      model: request.model, // Ignored by Azure, uses deployment
      messages,
      max_tokens: request.maxTokens,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.frequencyPenalty !== undefined) body.frequency_penalty = request.frequencyPenalty;
    if (request.presencePenalty !== undefined) body.presence_penalty = request.presencePenalty;
    if (request.stopSequences?.length) body.stop = [...request.stopSequences];
    if (request.seed !== undefined) body.seed = request.seed;

    return body;
  }

  private async makeRequest(
    endpoint: string,
    body?: OpenAIRequestBody,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<Response> {
    const url = `${this.getBaseUrl()}${endpoint}?api-version=${this.azureCredentials.apiVersion}`;

    const headers: Record<string, string> = {
      'api-key': this.azureCredentials.apiKey,
      ...this.options.customHeaders,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const requestInit: RequestInit = { method, headers };
    if (body) requestInit.body = JSON.stringify(body);

    return fetch(url, requestInit);
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage: string;

    try {
      const errorData = await response.json() as OpenAIErrorResponse;
      errorMessage = errorData.error?.message ?? 'Unknown error';
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }

    const isRetryable = response.status === 429 || response.status >= 500;

    throw new LLMError(
      errorMessage,
      response.status === 401 ? 'AUTHENTICATION_ERROR' : 'UNKNOWN_ERROR',
      'azure_openai',
      response.status,
      isRetryable
    );
  }

  private parseResponse(data: OpenAIResponse, latencyMs: number): LLMResponse {
    const choice = data.choices[0];

    return {
      content: choice?.message?.content ?? '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      finishReason: choice?.finish_reason === 'stop' ? 'stop' : 'length',
      latencyMs,
      model: data.model,
      responseId: data.id,
      provider: 'azure_openai',
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an OpenAI client
 */
export function createOpenAIClient(
  credentials: OpenAICredentials,
  options?: LLMClientOptions
): OpenAIClient {
  return new OpenAIClient(credentials, options);
}

/**
 * Create an Azure OpenAI client
 */
export function createAzureOpenAIClient(
  credentials: AzureOpenAICredentials,
  options?: LLMClientOptions
): AzureOpenAIClient {
  return new AzureOpenAIClient(credentials, options);
}
