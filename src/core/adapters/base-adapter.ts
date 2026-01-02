/**
 * Base Integration Adapter
 *
 * Abstract base class for all integration adapters. Defines the common
 * interface that all adapter implementations must follow.
 *
 * @module core/adapters/base-adapter
 * @see SPARC_ARCHITECTURE.md MOD-008 - Integration Adapter Manager
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
  CallId,
  IntegrationId,
} from '../../types/common.js';

import type {
  IntegrationCallResult,
  IntegrationCallRequest,
  IntegrationCallMetrics,
  IntegrationCallError,
  IntegrationErrorCode,
} from '../integration-call-result.js';

import {
  createSuccessResult,
  createErrorResult,
  createIntegrationError,
  generateIdempotencyKey,
} from '../integration-call-result.js';

import { computeObjectHash } from '../hash-utils.js';

// =============================================================================
// Adapter Types and Interfaces
// =============================================================================

/**
 * Adapter types supported by the integration manager
 * From SPARC Architecture MOD-008
 */
export type AdapterType =
  | 'HTTP_REST'
  | 'GRAPHQL'
  | 'GRPC'
  | 'DATABASE'
  | 'MESSAGE_QUEUE'
  | 'FILE_SYSTEM'
  | 'AGENTICS_ECOSYSTEM'
  | 'CUSTOM';

/**
 * Connection status for an adapter
 */
export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

/**
 * Credential configuration for adapter authentication
 */
export interface AdapterCredentials {
  /**
   * Credential type
   */
  readonly type: 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'mtls' | 'none';

  /**
   * Reference to credential in vault (NOT the actual secret)
   */
  readonly credentialRef: string;

  /**
   * Additional authentication parameters
   */
  readonly parameters?: Record<string, unknown>;
}

/**
 * Resolved credentials (actual values from vault)
 */
export interface ResolvedCredentials {
  /**
   * Credential type
   */
  readonly type: AdapterCredentials['type'];

  /**
   * The actual credential value (API key, token, etc.)
   */
  readonly value: string;

  /**
   * Secondary credential (e.g., username for basic auth)
   */
  readonly secondary?: string;

  /**
   * Additional resolved parameters
   */
  readonly parameters?: Record<string, unknown>;
}

/**
 * Base connection configuration
 */
export interface BaseConnectionConfig {
  /**
   * Base URL or host
   */
  readonly baseUrl?: string;

  /**
   * Host address
   */
  readonly host?: string;

  /**
   * Port number
   */
  readonly port?: number;

  /**
   * Connection timeout in milliseconds
   */
  readonly connectionTimeoutMs?: DurationMs;

  /**
   * Request timeout in milliseconds
   */
  readonly requestTimeoutMs?: DurationMs;

  /**
   * Connection pool size
   */
  readonly poolSize?: number;

  /**
   * Additional options
   */
  readonly options?: Record<string, unknown>;
}

/**
 * Adapter connection handle
 */
export interface AdapterConnection {
  /**
   * Unique connection ID
   */
  readonly connectionId: UUID;

  /**
   * Integration ID this connection belongs to
   */
  readonly integrationId: IntegrationId;

  /**
   * Adapter type
   */
  readonly adapterType: AdapterType;

  /**
   * Current connection status
   */
  status: ConnectionStatus;

  /**
   * When the connection was established
   */
  readonly connectedAt?: ISO8601Timestamp;

  /**
   * Last activity timestamp
   */
  lastActivityAt?: ISO8601Timestamp;

  /**
   * Connection metadata
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Adapter request (normalized from IntegrationCallRequest)
 */
export interface AdapterRequest {
  /**
   * Request ID for tracking
   */
  readonly requestId: UUID;

  /**
   * Operation to perform
   */
  readonly operation: string;

  /**
   * Request path (if applicable)
   */
  readonly path?: string;

  /**
   * Request parameters
   */
  readonly parameters?: Record<string, unknown>;

  /**
   * Request body
   */
  readonly body?: unknown;

  /**
   * Request headers
   */
  readonly headers?: Record<string, string>;

  /**
   * Idempotency key
   */
  readonly idempotencyKey: string;

  /**
   * Request timeout
   */
  readonly timeoutMs?: DurationMs;
}

/**
 * Adapter response (before conversion to IntegrationCallResult)
 */
export interface AdapterResponse {
  /**
   * Response status (adapter-specific)
   */
  readonly status: number | string;

  /**
   * Response body/data
   */
  readonly body: unknown;

  /**
   * Response headers
   */
  readonly headers?: Record<string, string>;

  /**
   * Response metadata
   */
  readonly metadata?: Record<string, unknown>;
}

// =============================================================================
// Abstract Base Adapter
// =============================================================================

/**
 * Abstract base class for all integration adapters
 *
 * Provides common functionality for:
 * - Connection lifecycle management
 * - Request/response handling
 * - Metrics collection
 * - Error handling
 * - Idempotency key generation
 *
 * All concrete adapters must implement:
 * - testConnection(): Test connectivity
 * - connect(): Establish connection
 * - executeRequest(): Execute an operation
 * - close(): Close connection
 */
export abstract class BaseAdapter {
  protected readonly adapterType: AdapterType;
  protected readonly integrationId: IntegrationId;
  protected readonly config: BaseConnectionConfig;
  protected _credentials?: ResolvedCredentials;
  protected connection?: AdapterConnection;

  /**
   * Default request timeout (30 seconds)
   */
  protected static readonly DEFAULT_TIMEOUT_MS: DurationMs = 30000;

  /**
   * Default connection timeout (10 seconds)
   */
  protected static readonly DEFAULT_CONNECT_TIMEOUT_MS: DurationMs = 10000;

  constructor(
    adapterType: AdapterType,
    integrationId: IntegrationId,
    config: BaseConnectionConfig
  ) {
    this.adapterType = adapterType;
    this.integrationId = integrationId;
    this.config = config;
  }

  // ===========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================================================================

  /**
   * Test connection to the integration endpoint
   *
   * @returns true if connection is healthy, false otherwise
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Establish connection with the integration endpoint
   *
   * @param credentials - Resolved credentials for authentication
   * @returns Connection handle
   * @throws Error if connection fails
   */
  abstract connect(credentials: ResolvedCredentials): Promise<AdapterConnection>;

  /**
   * Execute a request on the established connection
   *
   * @param request - The request to execute
   * @returns Adapter response
   * @throws Error if execution fails
   */
  protected abstract executeRequest(request: AdapterRequest): Promise<AdapterResponse>;

  /**
   * Close the connection and release resources
   */
  abstract close(): Promise<void>;

  // ===========================================================================
  // Common Implementation Methods
  // ===========================================================================

  /**
   * Execute an integration call
   *
   * This is the main entry point for adapter calls. It:
   * 1. Validates the connection
   * 2. Builds the adapter request
   * 3. Executes with timing
   * 4. Handles errors
   * 5. Returns structured result
   *
   * @param request - Integration call request
   * @returns Integration call result
   */
  async execute(request: IntegrationCallRequest): Promise<IntegrationCallResult> {
    const callId = uuidv4() as CallId;
    const initiatedAt = new Date().toISOString() as ISO8601Timestamp;
    const startTime = Date.now();

    // Generate idempotency key if not provided
    const idempotencyKey = request.idempotencyKey ?? this.generateIdempotencyKey(request);

    try {
      // Validate connection
      this.validateConnection();

      // Build adapter request
      const adapterRequest = this.buildAdapterRequest(request, idempotencyKey);

      // Execute with timing
      const response = await this.executeRequest(adapterRequest);

      // Build metrics
      const metrics = this.buildMetrics(startTime, response);

      // Update connection activity
      this.updateConnectionActivity();

      // Create success result
      return createSuccessResult(
        callId,
        response.body,
        metrics,
        idempotencyKey,
        initiatedAt,
        {
          responseHeaders: response.headers,
        }
      );
    } catch (error) {
      // Build error result
      const metrics = this.buildMetrics(startTime);
      const integrationError = this.handleError(error);

      return createErrorResult(
        callId,
        integrationError,
        metrics,
        idempotencyKey,
        initiatedAt
      );
    }
  }

  /**
   * Get the current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return this.connection?.status ?? 'DISCONNECTED';
  }

  /**
   * Get the adapter type
   */
  getAdapterType(): AdapterType {
    return this.adapterType;
  }

  /**
   * Get the integration ID
   */
  getIntegrationId(): IntegrationId {
    return this.integrationId;
  }

  /**
   * Check if the adapter is connected
   */
  isConnected(): boolean {
    return this.connection?.status === 'CONNECTED';
  }

  // ===========================================================================
  // Protected Helper Methods
  // ===========================================================================

  /**
   * Validate that the connection is established
   */
  protected validateConnection(): void {
    if (!this.connection) {
      throw new Error('Adapter not connected');
    }

    if (this.connection.status !== 'CONNECTED') {
      throw new Error(`Invalid connection status: ${this.connection.status}`);
    }
  }

  /**
   * Build an adapter request from an integration call request
   */
  protected buildAdapterRequest(
    request: IntegrationCallRequest,
    idempotencyKey: string
  ): AdapterRequest {
    return {
      requestId: uuidv4() as UUID,
      operation: request.operation,
      path: request.path,
      parameters: request.parameters,
      body: request.body,
      headers: request.headers,
      idempotencyKey,
      timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs ?? BaseAdapter.DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Build metrics from timing and response
   */
  protected buildMetrics(
    startTime: number,
    response?: AdapterResponse
  ): IntegrationCallMetrics {
    const latencyMs = Date.now() - startTime;

    return {
      latencyMs,
      statusCode: typeof response?.status === 'number' ? response.status : undefined,
    };
  }

  /**
   * Handle and normalize errors
   */
  protected handleError(error: unknown): IntegrationCallError {
    if (error instanceof Error) {
      const code = this.classifyError(error);
      return createIntegrationError(code, error.message, {
        cause: error.cause?.toString(),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }

    return createIntegrationError(
      'INTERNAL_ERROR',
      String(error)
    );
  }

  /**
   * Classify an error into an error code
   */
  protected classifyError(error: Error): IntegrationErrorCode {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Timeout errors
    if (message.includes('timeout') || name.includes('timeout')) {
      if (message.includes('connect')) {
        return 'CONNECTION_TIMEOUT';
      }
      return 'REQUEST_TIMEOUT';
    }

    // Connection errors
    if (message.includes('econnrefused') || message.includes('refused')) {
      return 'CONNECTION_REFUSED';
    }
    if (message.includes('econnreset') || message.includes('reset')) {
      return 'CONNECTION_FAILED';
    }
    if (message.includes('dns') || message.includes('enotfound')) {
      return 'DNS_RESOLUTION_FAILED';
    }
    if (message.includes('tls') || message.includes('ssl') || message.includes('certificate')) {
      return 'TLS_HANDSHAKE_FAILED';
    }

    // Authentication errors
    if (message.includes('unauthorized') || message.includes('401')) {
      return 'AUTHENTICATION_FAILED';
    }
    if (message.includes('forbidden') || message.includes('403')) {
      return 'AUTHORIZATION_FAILED';
    }

    // Rate limiting
    if (message.includes('rate limit') || message.includes('429')) {
      return 'RATE_LIMITED';
    }

    // Server errors
    if (message.includes('503') || message.includes('service unavailable')) {
      return 'SERVICE_UNAVAILABLE';
    }
    if (message.includes('502') || message.includes('504') || message.includes('gateway')) {
      return 'GATEWAY_ERROR';
    }
    if (message.includes('500') || message.includes('internal server error')) {
      return 'SERVER_ERROR';
    }

    // Default to internal error
    return 'INTERNAL_ERROR';
  }

  /**
   * Generate an idempotency key for a request
   */
  protected generateIdempotencyKey(request: IntegrationCallRequest): string {
    const contentHash = computeObjectHash({
      operation: request.operation,
      path: request.path,
      parameters: request.parameters,
      body: request.body,
    });

    return generateIdempotencyKey(
      this.integrationId as string,
      request.operation,
      contentHash
    );
  }

  /**
   * Update the connection's last activity timestamp
   */
  protected updateConnectionActivity(): void {
    if (this.connection) {
      this.connection.lastActivityAt = new Date().toISOString() as ISO8601Timestamp;
    }
  }

  /**
   * Create a connection object
   */
  protected createConnection(
    status: ConnectionStatus,
    metadata?: Record<string, unknown>
  ): AdapterConnection {
    return {
      connectionId: uuidv4() as UUID,
      integrationId: this.integrationId,
      adapterType: this.adapterType,
      status,
      connectedAt: status === 'CONNECTED' ? new Date().toISOString() as ISO8601Timestamp : undefined,
      metadata,
    };
  }

  /**
   * Get request timeout with fallback to default
   */
  protected getTimeout(requestTimeout?: DurationMs): DurationMs {
    return requestTimeout ?? this.config.requestTimeoutMs ?? BaseAdapter.DEFAULT_TIMEOUT_MS;
  }

  /**
   * Create a timeout promise for request cancellation
   */
  protected createTimeoutPromise(timeoutMs: DurationMs): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Execute a request with timeout
   */
  protected async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: DurationMs
  ): Promise<T> {
    return Promise.race([
      promise,
      this.createTimeoutPromise(timeoutMs),
    ]);
  }
}

// =============================================================================
// Adapter Factory Interface
// =============================================================================

/**
 * Factory function signature for creating adapters
 */
export type AdapterFactory = (
  adapterType: AdapterType,
  integrationId: IntegrationId,
  config: BaseConnectionConfig
) => BaseAdapter;
