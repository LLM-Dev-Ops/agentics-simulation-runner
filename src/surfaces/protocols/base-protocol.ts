/**
 * Base Protocol Abstract Class
 *
 * Abstract base class for all protocol implementations in the External Integration Surface.
 * Defines the common interface that all protocol adapters must implement.
 *
 * @module surfaces/protocols/base-protocol
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
} from '../../types/common.js';

// =============================================================================
// Protocol Types
// =============================================================================

/**
 * Supported protocol types for external integrations
 */
export type ProtocolType =
  | 'http'
  | 'https'
  | 'grpc'
  | 'websocket'
  | 'database'
  | 'messagequeue';

/**
 * Connection status for protocol connections
 */
export type ProtocolConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'connecting'
  | 'reconnecting';

/**
 * Base credential type for protocol authentication
 */
export interface ProtocolCredentials {
  /**
   * Credential type
   */
  readonly type: 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'mtls' | 'certificate' | 'none';

  /**
   * Primary credential value
   */
  readonly value?: string;

  /**
   * Secondary credential (e.g., username for basic auth)
   */
  readonly secondary?: string;

  /**
   * Additional authentication parameters
   */
  readonly parameters?: Record<string, unknown>;

  /**
   * Certificate data for mTLS
   */
  readonly certificate?: {
    readonly cert?: string;
    readonly key?: string;
    readonly ca?: string;
  };
}

/**
 * Base connection specification
 */
export interface BaseConnectionSpec {
  /**
   * Protocol type
   */
  readonly protocol: ProtocolType;

  /**
   * Host address
   */
  readonly host: string;

  /**
   * Port number
   */
  readonly port: number;

  /**
   * Optional path prefix
   */
  readonly path?: string;

  /**
   * Connection timeout in milliseconds
   */
  readonly connectionTimeoutMs?: DurationMs;

  /**
   * Request timeout in milliseconds
   */
  readonly requestTimeoutMs?: DurationMs;

  /**
   * Additional protocol-specific options
   */
  readonly options?: Map<string, string> | Record<string, string>;
}

/**
 * Base integration request
 */
export interface BaseIntegrationRequest {
  /**
   * Request method/operation
   */
  readonly method: string;

  /**
   * Request path (optional)
   */
  readonly path?: string;

  /**
   * Request headers
   */
  readonly headers?: Map<string, string> | Record<string, string>;

  /**
   * Request body
   */
  readonly body?: unknown;

  /**
   * Request timeout in milliseconds
   */
  readonly timeout?: DurationMs;

  /**
   * Idempotency key for safe retries
   */
  readonly idempotencyKey?: string;

  /**
   * Additional request parameters
   */
  readonly parameters?: Record<string, unknown>;
}

/**
 * Base integration response
 */
export interface BaseIntegrationResponse {
  /**
   * Response status code
   */
  readonly statusCode: number;

  /**
   * Response headers
   */
  readonly headers: Map<string, string>;

  /**
   * Response body
   */
  readonly body: unknown;

  /**
   * Response latency in milliseconds
   */
  readonly latencyMs: DurationMs;

  /**
   * Whether the response indicates success
   */
  readonly success: boolean;

  /**
   * Error message if not successful
   */
  readonly error?: string;

  /**
   * Response metadata
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Protocol connection handle
 */
export interface ProtocolConnection {
  /**
   * Unique connection identifier
   */
  readonly connectionId: string;

  /**
   * Protocol type
   */
  readonly protocol: ProtocolType;

  /**
   * Current connection status
   */
  status: ProtocolConnectionStatus;

  /**
   * When the connection was created
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * When the connection was last active
   */
  lastActivityAt?: ISO8601Timestamp;

  /**
   * Connection metadata
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Protocol metrics for monitoring
 */
export interface ProtocolMetrics {
  /**
   * Total requests made
   */
  totalRequests: number;

  /**
   * Successful requests
   */
  successfulRequests: number;

  /**
   * Failed requests
   */
  failedRequests: number;

  /**
   * Total latency in milliseconds
   */
  totalLatencyMs: DurationMs;

  /**
   * Average latency in milliseconds
   */
  averageLatencyMs: DurationMs;

  /**
   * Last request timestamp
   */
  lastRequestAt?: ISO8601Timestamp;

  /**
   * Retry count
   */
  retryCount: number;
}

// =============================================================================
// Abstract Base Protocol
// =============================================================================

/**
 * Abstract Base Protocol
 *
 * Defines the contract for all protocol implementations.
 * Provides common functionality for:
 * - Connection lifecycle management
 * - Request/response handling
 * - Metrics collection
 * - Error handling
 *
 * All concrete protocols must implement:
 * - connect(): Establish connection
 * - execute(): Execute a request
 * - close(): Close connection
 * - testConnection(): Test connectivity
 */
export abstract class BaseProtocol<
  TSpec extends BaseConnectionSpec = BaseConnectionSpec,
  TRequest extends BaseIntegrationRequest = BaseIntegrationRequest,
  TResponse extends BaseIntegrationResponse = BaseIntegrationResponse,
> {
  /**
   * Protocol type identifier
   */
  protected readonly protocolType: ProtocolType;

  /**
   * Connection specification
   */
  protected spec?: TSpec;

  /**
   * Protocol credentials
   */
  protected credentials?: ProtocolCredentials;

  /**
   * Active connection handle
   */
  protected connection?: ProtocolConnection;

  /**
   * Protocol metrics
   */
  protected readonly metrics: ProtocolMetrics;

  /**
   * Default connection timeout (10 seconds)
   */
  protected static readonly DEFAULT_CONNECTION_TIMEOUT_MS: DurationMs = 10000;

  /**
   * Default request timeout (30 seconds)
   */
  protected static readonly DEFAULT_REQUEST_TIMEOUT_MS: DurationMs = 30000;

  /**
   * Create a new protocol instance
   *
   * @param protocolType - The protocol type
   */
  constructor(protocolType: ProtocolType) {
    this.protocolType = protocolType;
    this.metrics = this.createInitialMetrics();
  }

  // ===========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================================================================

  /**
   * Establish connection with the external system
   *
   * @param spec - Connection specification
   * @param credentials - Authentication credentials
   * @returns Promise resolving to connection handle
   * @throws Error if connection fails
   */
  abstract connect(spec: TSpec, credentials: ProtocolCredentials): Promise<ProtocolConnection>;

  /**
   * Execute a request on the established connection
   *
   * @param connection - Active connection handle
   * @param request - Request to execute
   * @returns Promise resolving to response
   * @throws Error if execution fails
   */
  abstract execute(connection: ProtocolConnection, request: TRequest): Promise<TResponse>;

  /**
   * Close the connection gracefully
   *
   * @param connection - Connection to close
   */
  abstract close(connection: ProtocolConnection): void;

  /**
   * Test connection to the external system
   *
   * @returns Promise resolving to true if connection is healthy
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Validate connection specification
   *
   * @param spec - Connection specification to validate
   * @throws Error if specification is invalid
   */
  abstract validateSpec(spec: TSpec): void;

  // ===========================================================================
  // Common Implementation Methods
  // ===========================================================================

  /**
   * Get the protocol type
   */
  getProtocolType(): ProtocolType {
    return this.protocolType;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection?.status === 'connected';
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ProtocolConnectionStatus {
    return this.connection?.status ?? 'disconnected';
  }

  /**
   * Get the current connection
   */
  getConnection(): ProtocolConnection | undefined {
    return this.connection;
  }

  /**
   * Get protocol metrics
   */
  getMetrics(): Readonly<ProtocolMetrics> {
    return { ...this.metrics };
  }

  /**
   * Reset protocol metrics
   */
  resetMetrics(): void {
    Object.assign(this.metrics, this.createInitialMetrics());
  }

  // ===========================================================================
  // Protected Helper Methods
  // ===========================================================================

  /**
   * Create a connection object
   */
  protected createConnection(
    status: ProtocolConnectionStatus,
    metadata?: Record<string, unknown>
  ): ProtocolConnection {
    const now = new Date().toISOString() as ISO8601Timestamp;

    return {
      connectionId: uuidv4(),
      protocol: this.protocolType,
      status,
      createdAt: now,
      lastActivityAt: now,
      metadata,
    };
  }

  /**
   * Update connection status
   */
  protected updateConnectionStatus(status: ProtocolConnectionStatus): void {
    if (this.connection) {
      this.connection.status = status;
      this.connection.lastActivityAt = new Date().toISOString() as ISO8601Timestamp;
    }
  }

  /**
   * Update connection activity timestamp
   */
  protected updateConnectionActivity(): void {
    if (this.connection) {
      this.connection.lastActivityAt = new Date().toISOString() as ISO8601Timestamp;
    }
  }

  /**
   * Record a request in metrics
   */
  protected recordRequest(latencyMs: DurationMs, success: boolean): void {
    this.metrics.totalRequests++;
    this.metrics.totalLatencyMs += latencyMs;
    this.metrics.lastRequestAt = new Date().toISOString() as ISO8601Timestamp;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update average latency
    this.metrics.averageLatencyMs = Math.round(
      this.metrics.totalLatencyMs / this.metrics.totalRequests
    );
  }

  /**
   * Record a retry attempt
   */
  protected recordRetry(): void {
    this.metrics.retryCount++;
  }

  /**
   * Get timeout value with fallback
   */
  protected getTimeout(requestTimeout?: DurationMs, configTimeout?: DurationMs): DurationMs {
    return requestTimeout ?? configTimeout ?? BaseProtocol.DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Get connection timeout with fallback
   */
  protected getConnectionTimeout(configTimeout?: DurationMs): DurationMs {
    return configTimeout ?? BaseProtocol.DEFAULT_CONNECTION_TIMEOUT_MS;
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
   * Execute with timeout
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

  /**
   * Convert Map to Record
   */
  protected mapToRecord(map: Map<string, string> | Record<string, string>): Record<string, string> {
    if (map instanceof Map) {
      const record: Record<string, string> = {};
      map.forEach((value, key) => {
        record[key] = value;
      });
      return record;
    }
    return map;
  }

  /**
   * Convert Record to Map
   */
  protected recordToMap(record: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(record));
  }

  /**
   * Create initial metrics object
   */
  private createInitialMetrics(): ProtocolMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      retryCount: 0,
    };
  }

  /**
   * Generate idempotency key if not provided
   */
  protected generateIdempotencyKey(): string {
    return uuidv4();
  }

  /**
   * Build error response
   */
  protected buildErrorResponse(
    statusCode: number,
    error: string,
    latencyMs: DurationMs
  ): BaseIntegrationResponse {
    return {
      statusCode,
      headers: new Map(),
      body: null,
      latencyMs,
      success: false,
      error,
    };
  }

  /**
   * Build success response
   */
  protected buildSuccessResponse(
    statusCode: number,
    headers: Map<string, string>,
    body: unknown,
    latencyMs: DurationMs,
    metadata?: Record<string, unknown>
  ): BaseIntegrationResponse {
    return {
      statusCode,
      headers,
      body,
      latencyMs,
      success: statusCode >= 200 && statusCode < 300,
      metadata,
    };
  }
}

// =============================================================================
// Protocol Factory Interface
// =============================================================================

/**
 * Protocol factory function type
 */
export type ProtocolFactory<T extends BaseProtocol = BaseProtocol> = () => T;

/**
 * Protocol registry for dynamic protocol creation
 */
export interface ProtocolRegistry {
  /**
   * Register a protocol factory
   */
  register(type: ProtocolType, factory: ProtocolFactory): void;

  /**
   * Get a protocol factory
   */
  get(type: ProtocolType): ProtocolFactory | undefined;

  /**
   * Check if protocol is registered
   */
  has(type: ProtocolType): boolean;

  /**
   * List registered protocols
   */
  list(): ProtocolType[];
}

/**
 * Default protocol registry implementation
 */
export class DefaultProtocolRegistry implements ProtocolRegistry {
  private readonly factories = new Map<ProtocolType, ProtocolFactory>();

  register(type: ProtocolType, factory: ProtocolFactory): void {
    this.factories.set(type, factory);
  }

  get(type: ProtocolType): ProtocolFactory | undefined {
    return this.factories.get(type);
  }

  has(type: ProtocolType): boolean {
    return this.factories.has(type);
  }

  list(): ProtocolType[] {
    return Array.from(this.factories.keys());
  }
}
