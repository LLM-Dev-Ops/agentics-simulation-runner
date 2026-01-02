/**
 * Base LLM Client Abstract Class
 *
 * MOD-010: LLM Invocation Surface
 *
 * Provides the abstract base class for all LLM provider clients.
 * Concrete implementations extend this class for provider-specific behavior.
 *
 * @module surfaces/providers/base-llm-client
 */

import type {
  LLMCredentials,
  LLMRequest,
  LLMResponse,
  LLMClientOptions,
  LLMProviderType,
  ModelInfo,
  LLMErrorCode,
} from '../llm-types.js';
import { LLMError, DEFAULT_CLIENT_OPTIONS } from '../llm-types.js';

// =============================================================================
// Base LLM Client Interface
// =============================================================================

/**
 * Base interface for LLM clients
 */
export interface LLMClient {
  /**
   * Get the provider name
   */
  getProviderName(): LLMProviderType;

  /**
   * Get the provider display name
   */
  getProviderDisplayName(): string;

  /**
   * Check if the client is connected and ready
   */
  isReady(): boolean;

  /**
   * Invoke the LLM with a request
   */
  invoke(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Validate if a model is available and accessible
   */
  validateModel(modelId: string): Promise<boolean>;

  /**
   * Get information about a model
   */
  getModelInfo(modelId: string): Promise<ModelInfo | undefined>;

  /**
   * List available models
   */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Close the client and release resources
   */
  close(): Promise<void>;
}

// =============================================================================
// Base LLM Client Abstract Class
// =============================================================================

/**
 * Abstract base class for LLM clients
 *
 * Provides common functionality and template methods for provider implementations.
 */
export abstract class BaseLLMClient implements LLMClient {
  protected readonly credentials: LLMCredentials;
  protected readonly options: Required<LLMClientOptions>;
  protected isInitialized: boolean = false;
  protected isClosed: boolean = false;

  constructor(credentials: LLMCredentials, options: LLMClientOptions = {}) {
    this.credentials = credentials;
    this.options = {
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CLIENT_OPTIONS.connectTimeoutMs!,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_CLIENT_OPTIONS.defaultTimeoutMs!,
      maxRetries: options.maxRetries ?? DEFAULT_CLIENT_OPTIONS.maxRetries!,
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_CLIENT_OPTIONS.retryBaseDelayMs!,
      enableLogging: options.enableLogging ?? DEFAULT_CLIENT_OPTIONS.enableLogging!,
      customHeaders: options.customHeaders ?? {},
    };
  }

  // ===========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================================================================

  /**
   * Get the provider type
   */
  abstract getProviderName(): LLMProviderType;

  /**
   * Get the provider display name
   */
  abstract getProviderDisplayName(): string;

  /**
   * Perform the actual LLM invocation
   */
  protected abstract doInvoke(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Validate credentials with the provider
   */
  protected abstract validateCredentials(): Promise<boolean>;

  /**
   * Fetch model information from the provider
   */
  protected abstract fetchModelInfo(modelId: string): Promise<ModelInfo | undefined>;

  /**
   * Fetch list of available models
   */
  protected abstract fetchModels(): Promise<ModelInfo[]>;

  // ===========================================================================
  // Template Methods
  // ===========================================================================

  /**
   * Initialize the client (called lazily on first use)
   */
  protected async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.log('Initializing client...');

    const isValid = await this.validateCredentials();
    if (!isValid) {
      throw new LLMError(
        'Failed to validate credentials',
        'AUTHENTICATION_ERROR',
        this.getProviderName(),
        401,
        false
      );
    }

    this.isInitialized = true;
    this.log('Client initialized successfully');
  }

  /**
   * Check if the client is ready
   */
  isReady(): boolean {
    return this.isInitialized && !this.isClosed;
  }

  /**
   * Invoke the LLM with a request
   */
  async invoke(request: LLMRequest): Promise<LLMResponse> {
    this.ensureNotClosed();
    await this.initialize();

    this.validateRequest(request);
    this.log(`Invoking model: ${request.model}`);

    const startTime = Date.now();

    try {
      const response = await this.executeWithRetry(
        () => this.doInvoke(request),
        request.timeoutMs ?? this.options.defaultTimeoutMs
      );

      this.log(`Invocation completed in ${response.latencyMs}ms`);
      return response;
    } catch (error) {
      this.log(`Invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw this.wrapError(error);
    }
  }

  /**
   * Validate if a model is available
   */
  async validateModel(modelId: string): Promise<boolean> {
    this.ensureNotClosed();
    await this.initialize();

    try {
      const modelInfo = await this.fetchModelInfo(modelId);
      return modelInfo !== undefined && modelInfo.available;
    } catch (error) {
      this.log(`Model validation failed for ${modelId}: ${error}`);
      return false;
    }
  }

  /**
   * Get model information
   */
  async getModelInfo(modelId: string): Promise<ModelInfo | undefined> {
    this.ensureNotClosed();
    await this.initialize();

    return this.fetchModelInfo(modelId);
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelInfo[]> {
    this.ensureNotClosed();
    await this.initialize();

    return this.fetchModels();
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    if (this.isClosed) return;

    this.log('Closing client...');
    await this.doClose();
    this.isClosed = true;
    this.log('Client closed');
  }

  /**
   * Perform cleanup (can be overridden by subclasses)
   */
  protected async doClose(): Promise<void> {
    // Default implementation does nothing
  }

  // ===========================================================================
  // Protected Helper Methods
  // ===========================================================================

  /**
   * Ensure the client is not closed
   */
  protected ensureNotClosed(): void {
    if (this.isClosed) {
      throw new LLMError(
        'Client is closed',
        'INVALID_REQUEST_ERROR',
        this.getProviderName(),
        undefined,
        false
      );
    }
  }

  /**
   * Validate request parameters
   */
  protected validateRequest(request: LLMRequest): void {
    if (!request.model) {
      throw new LLMError(
        'Model ID is required',
        'INVALID_REQUEST_ERROR',
        this.getProviderName(),
        400,
        false
      );
    }

    if (!request.prompt && (!request.messages || request.messages.length === 0)) {
      throw new LLMError(
        'Either prompt or messages must be provided',
        'INVALID_REQUEST_ERROR',
        this.getProviderName(),
        400,
        false
      );
    }

    if (request.maxTokens <= 0) {
      throw new LLMError(
        'maxTokens must be a positive number',
        'INVALID_REQUEST_ERROR',
        this.getProviderName(),
        400,
        false
      );
    }

    if (request.temperature < 0 || request.temperature > 2) {
      throw new LLMError(
        'temperature must be between 0 and 2',
        'INVALID_REQUEST_ERROR',
        this.getProviderName(),
        400,
        false
      );
    }
  }

  /**
   * Execute a function with retry logic
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt <= this.options.maxRetries) {
      try {
        return await this.withTimeout(fn(), timeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryableError(error) || attempt >= this.options.maxRetries) {
          throw error;
        }

        const delay = this.computeRetryDelay(attempt);
        this.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
        await this.sleep(delay);
        attempt++;
      }
    }

    throw lastError ?? new Error('Unknown error during retry');
  }

  /**
   * Wrap a promise with a timeout
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new LLMError(
            `Request timed out after ${timeoutMs}ms`,
            'TIMEOUT_ERROR',
            this.getProviderName(),
            undefined,
            true
          ));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Check if an error is retryable
   */
  protected isRetryableError(error: unknown): boolean {
    if (error instanceof LLMError) {
      return error.isRetryable;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('503') ||
        message.includes('service unavailable')
      );
    }

    return false;
  }

  /**
   * Compute retry delay with exponential backoff
   */
  protected computeRetryDelay(attempt: number): number {
    const baseDelay = this.options.retryBaseDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * baseDelay * 0.5;
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wrap an error in LLMError
   */
  protected wrapError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = this.inferErrorCode(error);
    const isRetryable = this.isRetryableError(error);

    return new LLMError(
      errorMessage,
      errorCode,
      this.getProviderName(),
      undefined,
      isRetryable,
      { originalError: errorMessage }
    );
  }

  /**
   * Infer error code from error
   */
  protected inferErrorCode(error: unknown): LLMErrorCode {
    if (error instanceof LLMError) {
      return error.code;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('timeout')) return 'TIMEOUT_ERROR';
      if (message.includes('rate limit') || message.includes('429')) return 'RATE_LIMIT_ERROR';
      if (message.includes('unauthorized') || message.includes('401')) return 'AUTHENTICATION_ERROR';
      if (message.includes('not found') || message.includes('404')) return 'MODEL_NOT_FOUND';
      if (message.includes('context') && message.includes('length')) return 'CONTEXT_LENGTH_EXCEEDED';
      if (message.includes('content') && message.includes('filter')) return 'CONTENT_FILTER_ERROR';
      if (message.includes('network') || message.includes('econnrefused')) return 'NETWORK_ERROR';
      if (message.includes('500') || message.includes('502') || message.includes('503')) return 'SERVER_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Log a message if logging is enabled
   */
  protected log(message: string): void {
    if (this.options.enableLogging) {
      console.log(`[${this.getProviderDisplayName()}] ${message}`);
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get the base URL for API requests
   */
  protected getBaseUrl(): string {
    return this.credentials.baseUrl ?? this.getDefaultBaseUrl();
  }

  /**
   * Get the default base URL for the provider
   */
  protected abstract getDefaultBaseUrl(): string;

  /**
   * Build HTTP headers for requests
   */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.options.customHeaders,
    };

    return headers;
  }

  /**
   * Convert messages to prompt format
   */
  protected messagesToPrompt(request: LLMRequest): string {
    if (request.prompt) {
      return request.prompt;
    }

    if (!request.messages || request.messages.length === 0) {
      return '';
    }

    const parts: string[] = [];

    if (request.systemPrompt) {
      parts.push(`System: ${request.systemPrompt}`);
    }

    for (const message of request.messages) {
      const prefix = message.role === 'assistant' ? 'Assistant' : 'Human';
      parts.push(`${prefix}: ${message.content}`);
    }

    return parts.join('\n\n');
  }
}
