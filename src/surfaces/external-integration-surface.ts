/**
 * External Integration Surface
 *
 * PURPOSE: Abstracts interactions with external systems
 * From Architecture MOD-011
 *
 * The External Integration Surface provides a unified interface for connecting to
 * and communicating with external systems, including REST APIs, databases,
 * message queues, gRPC services, and WebSocket endpoints.
 *
 * Features:
 * - Protocol-agnostic connection management
 * - Request execution with retry logic for transient failures
 * - Metrics tracking for all integration calls
 * - Idempotency key support for safe retries
 * - Connection pooling and lifecycle management
 *
 * @module surfaces/external-integration-surface
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
} from '../types/common.js';

import {
  type ProtocolType,
  type ProtocolCredentials,
  type ProtocolConnection,
  BaseProtocol,
  DefaultProtocolRegistry,
  type ProtocolRegistry,
} from './protocols/base-protocol.js';

import {
  HttpProtocol,
  createHttpProtocol,
  type HttpConnectionSpec,
  type HttpIntegrationRequest,
  type HttpIntegrationResponse,
} from './protocols/http-protocol.js';

import {
  DatabaseProtocol,
  createDatabaseProtocol,
  type DatabaseConnectionSpec,
  type DatabaseIntegrationRequest,
  type DatabaseIntegrationResponse,
} from './protocols/database-protocol.js';

import type {
  ConnectionSpec,
  Credentials,
  ExternalConnection,
  IntegrationRequest,
  IntegrationResponse,
  IntegrationMetrics,
  RetryConfig,
  ResponseError,
} from './external-types.js';

// =============================================================================
// External Connection Implementation
// =============================================================================

/**
 * External connection implementation that wraps protocol connections
 */
class ExternalConnectionImpl implements ExternalConnection {
  readonly connectionId: string;
  readonly protocol: ProtocolType;
  status: 'connected' | 'disconnected' | 'error' | 'connecting' | 'reconnecting';
  readonly createdAt: ISO8601Timestamp;
  lastActivityAt?: ISO8601Timestamp;
  readonly metadata?: Record<string, unknown>;

  private readonly protocolInstance: BaseProtocol;
  private readonly protocolConnection: ProtocolConnection;
  private readonly surface: ExternalIntegrationSurface;

  constructor(
    protocolInstance: BaseProtocol,
    protocolConnection: ProtocolConnection,
    surface: ExternalIntegrationSurface
  ) {
    this.protocolInstance = protocolInstance;
    this.protocolConnection = protocolConnection;
    this.surface = surface;

    this.connectionId = protocolConnection.connectionId;
    this.protocol = protocolConnection.protocol;
    this.status = protocolConnection.status as ExternalConnection['status'];
    this.createdAt = protocolConnection.createdAt;
    this.lastActivityAt = protocolConnection.lastActivityAt;
    this.metadata = protocolConnection.metadata;
  }

  /**
   * Execute a request on this connection
   */
  async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
    return this.surface.execute(this, request);
  }

  /**
   * Close this connection
   */
  close(): void {
    this.surface.close(this);
  }

  /**
   * Test connection health
   */
  async testHealth(): Promise<boolean> {
    return this.protocolInstance.testConnection();
  }

  /**
   * Get the underlying protocol instance
   */
  getProtocol(): BaseProtocol {
    return this.protocolInstance;
  }

  /**
   * Get the underlying protocol connection
   */
  getProtocolConnection(): ProtocolConnection {
    return this.protocolConnection;
  }

  /**
   * Update connection status
   */
  updateStatus(status: ExternalConnection['status']): void {
    this.status = status;
    this.lastActivityAt = new Date().toISOString() as ISO8601Timestamp;
  }
}

// =============================================================================
// External Integration Surface
// =============================================================================

/**
 * External Integration Surface
 *
 * Main entry point for external system integrations. Provides:
 * - createConnection(): Establish connection to external system
 * - execute(): Execute request with retry handling
 * - close(): Gracefully close connection
 *
 * Supports protocols:
 * - HTTP/HTTPS (REST APIs)
 * - GraphQL (via HTTP)
 * - gRPC (placeholder)
 * - WebSocket (placeholder)
 * - Database (PostgreSQL, MySQL, etc.)
 * - Message Queue (RabbitMQ, Kafka, etc.)
 */
export class ExternalIntegrationSurface {
  /**
   * Protocol registry for creating protocol instances
   */
  private readonly protocolRegistry: ProtocolRegistry;

  /**
   * Active connections
   */
  private readonly connections = new Map<string, ExternalConnectionImpl>();

  /**
   * Global metrics
   */
  private readonly globalMetrics: IntegrationMetrics;

  /**
   * Default retry configuration
   */
  private readonly defaultRetryConfig: RetryConfig;

  /**
   * Create an External Integration Surface instance
   *
   * @param options - Surface configuration options
   */
  constructor(options?: {
    retryConfig?: Partial<RetryConfig>;
  }) {
    // Initialize protocol registry
    this.protocolRegistry = new DefaultProtocolRegistry();
    this.registerDefaultProtocols();

    // Initialize metrics
    this.globalMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      retryCount: 0,
      activeConnections: 0,
    };

    // Set default retry config
    this.defaultRetryConfig = {
      maxRetries: options?.retryConfig?.maxRetries ?? 3,
      initialDelayMs: options?.retryConfig?.initialDelayMs ?? 100,
      maxDelayMs: options?.retryConfig?.maxDelayMs ?? 30000,
      multiplier: options?.retryConfig?.multiplier ?? 2.0,
      jitterFactor: options?.retryConfig?.jitterFactor ?? 0.1,
      retryableErrors: options?.retryConfig?.retryableErrors ?? [
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
      ],
    };
  }

  // ===========================================================================
  // Main API Methods
  // ===========================================================================

  /**
   * Create a connection to an external system
   *
   * Creates and validates a connection using the appropriate protocol adapter.
   *
   * @param spec - Connection specification
   * @param credentials - Authentication credentials
   * @returns Promise resolving to external connection handle
   * @throws Error if connection fails
   *
   * @example
   * ```typescript
   * const surface = new ExternalIntegrationSurface();
   *
   * const connection = await surface.createConnection(
   *   {
   *     protocol: 'https',
   *     host: 'api.example.com',
   *     port: 443,
   *     path: '/v1',
   *   },
   *   {
   *     type: 'bearer',
   *     value: 'your-api-token',
   *   }
   * );
   * ```
   */
  async createConnection(
    spec: ConnectionSpec,
    credentials: Credentials
  ): Promise<ExternalConnection> {
    // Get or create protocol instance
    const protocolInstance = this.createProtocolInstance(spec.protocol);

    // Convert credentials to protocol format
    const protocolCredentials = this.convertCredentials(credentials);

    // Convert spec to protocol-specific format
    const protocolSpec = this.convertConnectionSpec(spec);

    // Establish connection
    const protocolConnection = await protocolInstance.connect(protocolSpec, protocolCredentials);

    // Wrap in external connection
    const externalConnection = new ExternalConnectionImpl(
      protocolInstance,
      protocolConnection,
      this
    );

    // Track connection
    this.connections.set(externalConnection.connectionId, externalConnection);
    this.globalMetrics.activeConnections = this.connections.size;

    return externalConnection;
  }

  /**
   * Execute a request on an established connection
   *
   * Handles request execution with retry logic for transient failures.
   * Tracks metrics for all requests.
   *
   * @param connection - Active connection handle
   * @param request - Request to execute
   * @returns Promise resolving to integration response
   *
   * @example
   * ```typescript
   * const response = await surface.execute(connection, {
   *   method: 'GET',
   *   path: '/users',
   *   headers: new Map([['Accept', 'application/json']]),
   * });
   *
   * if (response.success) {
   *   console.log('Users:', response.body);
   * }
   * ```
   */
  async execute(
    connection: ExternalConnection,
    request: IntegrationRequest
  ): Promise<IntegrationResponse> {
    const impl = this.getConnectionImpl(connection);

    if (!impl) {
      throw new Error(`Connection ${connection.connectionId} not found`);
    }

    if (impl.status !== 'connected') {
      throw new Error(`Connection ${connection.connectionId} is not connected`);
    }

    // Get retry configuration
    const retryConfig = request.options?.retryConfig
      ? { ...this.defaultRetryConfig, ...request.options.retryConfig }
      : this.defaultRetryConfig;

    // Execute with retry
    const result = await this.executeWithRetry(impl, request, retryConfig);

    // Update metrics
    this.updateMetrics(result);

    return result;
  }

  /**
   * Close a connection gracefully
   *
   * Releases resources and removes the connection from tracking.
   *
   * @param connection - Connection to close
   *
   * @example
   * ```typescript
   * surface.close(connection);
   * ```
   */
  close(connection: ExternalConnection): void {
    const impl = this.getConnectionImpl(connection);

    if (!impl) {
      return;
    }

    // Close the protocol connection
    const protocol = impl.getProtocol();
    protocol.close(impl.getProtocolConnection());

    // Update status
    impl.updateStatus('disconnected');

    // Remove from tracking
    this.connections.delete(connection.connectionId);
    this.globalMetrics.activeConnections = this.connections.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const connection of this.connections.values()) {
      this.close(connection);
    }
  }

  // ===========================================================================
  // Metrics and Status Methods
  // ===========================================================================

  /**
   * Get global integration metrics
   */
  getMetrics(): Readonly<IntegrationMetrics> {
    return { ...this.globalMetrics };
  }

  /**
   * Get metrics for a specific connection
   */
  getConnectionMetrics(connection: ExternalConnection): Readonly<IntegrationMetrics> | undefined {
    const impl = this.getConnectionImpl(connection);

    if (!impl) {
      return undefined;
    }

    const protocol = impl.getProtocol();
    const protocolMetrics = protocol.getMetrics();

    return {
      totalRequests: protocolMetrics.totalRequests,
      successfulRequests: protocolMetrics.successfulRequests,
      failedRequests: protocolMetrics.failedRequests,
      averageLatencyMs: protocolMetrics.averageLatencyMs,
      retryCount: protocolMetrics.retryCount,
      activeConnections: 1,
      lastRequestAt: protocolMetrics.lastRequestAt,
    };
  }

  /**
   * Get active connection count
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): ExternalConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Check if a connection is active
   */
  isConnectionActive(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    return connection?.status === 'connected';
  }

  // ===========================================================================
  // Protocol Management
  // ===========================================================================

  /**
   * Register a custom protocol factory
   */
  registerProtocol(type: ProtocolType, factory: () => BaseProtocol): void {
    this.protocolRegistry.register(type, factory);
  }

  /**
   * Get supported protocol types
   */
  getSupportedProtocols(): ProtocolType[] {
    return this.protocolRegistry.list();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Register default protocol factories
   */
  private registerDefaultProtocols(): void {
    this.protocolRegistry.register('http', () => createHttpProtocol());
    this.protocolRegistry.register('https', () => createHttpProtocol());
    this.protocolRegistry.register('database', () => createDatabaseProtocol());

    // Placeholder registrations for other protocols
    // These will throw descriptive errors when used
    this.protocolRegistry.register('grpc', () => {
      throw new Error('gRPC protocol not yet implemented');
    });
    this.protocolRegistry.register('websocket', () => {
      throw new Error('WebSocket protocol not yet implemented');
    });
    this.protocolRegistry.register('messagequeue', () => {
      throw new Error('Message queue protocol not yet implemented');
    });
  }

  /**
   * Create a protocol instance for the given type
   */
  private createProtocolInstance(type: ProtocolType): BaseProtocol {
    const factory = this.protocolRegistry.get(type);

    if (!factory) {
      throw new Error(`Unsupported protocol type: ${type}`);
    }

    return factory();
  }

  /**
   * Get connection implementation
   */
  private getConnectionImpl(connection: ExternalConnection): ExternalConnectionImpl | undefined {
    return this.connections.get(connection.connectionId);
  }

  /**
   * Convert external credentials to protocol credentials
   */
  private convertCredentials(credentials: Credentials): ProtocolCredentials {
    return {
      type: credentials.type,
      value: credentials.value,
      secondary: credentials.secondary,
      parameters: credentials.parameters,
      certificate: credentials.certificate,
    };
  }

  /**
   * Convert connection spec to protocol-specific spec
   */
  private convertConnectionSpec(spec: ConnectionSpec): HttpConnectionSpec | DatabaseConnectionSpec {
    const baseOptions = this.convertMapToRecord(spec.options);

    if (spec.protocol === 'http' || spec.protocol === 'https') {
      return {
        protocol: spec.protocol,
        host: spec.host,
        port: spec.port,
        path: spec.path,
        connectionTimeoutMs: spec.connectionTimeoutMs,
        requestTimeoutMs: spec.requestTimeoutMs,
        options: baseOptions,
      } as HttpConnectionSpec;
    }

    if (spec.protocol === 'database') {
      // Extract database-specific options
      const dbOptions = (baseOptions ?? {}) as Record<string, string>;

      return {
        protocol: 'database',
        host: spec.host,
        port: spec.port,
        databaseType: (dbOptions.databaseType ?? 'postgresql') as DatabaseConnectionSpec['databaseType'],
        database: dbOptions.database ?? 'default',
        schema: dbOptions.schema,
        connectionTimeoutMs: spec.connectionTimeoutMs,
        requestTimeoutMs: spec.requestTimeoutMs,
        options: baseOptions,
      } as DatabaseConnectionSpec;
    }

    // For unsupported protocols, still return an HTTP-like spec structure
    // The protocol factory will throw an appropriate error
    return {
      protocol: 'http' as const,
      host: spec.host,
      port: spec.port,
      path: spec.path,
      connectionTimeoutMs: spec.connectionTimeoutMs,
      requestTimeoutMs: spec.requestTimeoutMs,
      options: baseOptions,
    } as HttpConnectionSpec;
  }

  /**
   * Convert request to protocol-specific format
   */
  private convertRequest(request: IntegrationRequest): HttpIntegrationRequest | DatabaseIntegrationRequest {
    const headers = this.convertMapToRecord(request.headers);

    return {
      method: request.method as HttpIntegrationRequest['method'],
      path: request.path,
      headers: headers ? new Map(Object.entries(headers)) : undefined,
      body: request.body,
      timeout: request.timeout,
      idempotencyKey: request.idempotencyKey,
      queryParams: request.queryParams,
    } as HttpIntegrationRequest;
  }

  /**
   * Convert protocol response to integration response
   */
  private convertResponse(
    protocolResponse: HttpIntegrationResponse | DatabaseIntegrationResponse
  ): IntegrationResponse {
    let error: ResponseError | undefined;

    if (!protocolResponse.success && protocolResponse.error) {
      error = {
        code: `HTTP_${protocolResponse.statusCode}`,
        message: protocolResponse.error,
        retryable: this.isRetryableStatus(protocolResponse.statusCode),
      };
    }

    return {
      statusCode: protocolResponse.statusCode,
      headers: protocolResponse.headers,
      body: protocolResponse.body,
      latencyMs: protocolResponse.latencyMs,
      success: protocolResponse.success,
      error,
      metadata: protocolResponse.metadata as Record<string, unknown> | undefined,
    };
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry(
    connection: ExternalConnectionImpl,
    request: IntegrationRequest,
    retryConfig: RetryConfig
  ): Promise<IntegrationResponse> {
    const protocol = connection.getProtocol();
    const protocolConnection = connection.getProtocolConnection();
    const protocolRequest = this.convertRequest(request);

    let lastError: Error | undefined;
    let lastResponse: IntegrationResponse | undefined;
    let totalRetryDelayMs = 0;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Execute request
        const protocolResponse = await protocol.execute(
          protocolConnection,
          protocolRequest as HttpIntegrationRequest
        );

        const response = this.convertResponse(protocolResponse as HttpIntegrationResponse);

        // Check if we should retry
        if (!response.success && response.error?.retryable && attempt < retryConfig.maxRetries) {
          lastResponse = response;

          // Calculate delay
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          totalRetryDelayMs += delay;
          this.globalMetrics.retryCount++;

          await this.sleep(delay);
          continue;
        }

        // Add retry info if we retried
        if (attempt > 0 && response.metadata) {
          (response.metadata as Record<string, unknown>).retry = {
            attempts: attempt,
            totalDelayMs: totalRetryDelayMs,
            succeeded: response.success,
          };
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!request.options?.skipRetry && this.isRetryableError(lastError, retryConfig)) {
          if (attempt < retryConfig.maxRetries) {
            const delay = this.calculateRetryDelay(attempt, retryConfig);
            totalRetryDelayMs += delay;
            this.globalMetrics.retryCount++;

            await this.sleep(delay);
            continue;
          }
        }

        // Final failure
        return {
          statusCode: 0,
          headers: new Map(),
          body: null,
          latencyMs: 0,
          success: false,
          error: {
            code: 'REQUEST_FAILED',
            message: lastError.message,
            retryable: false,
          },
          metadata: {
            retry: {
              attempts: attempt,
              totalDelayMs: totalRetryDelayMs,
              succeeded: false,
            },
          },
        };
      }
    }

    // Should not reach here, but return last response or error
    return lastResponse ?? {
      statusCode: 0,
      headers: new Map(),
      body: null,
      latencyMs: 0,
      success: false,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: lastError?.message ?? 'Maximum retries exceeded',
        retryable: false,
      },
    };
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    // Exponential backoff
    const exponentialDelay = config.initialDelayMs * Math.pow(config.multiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

    // Add jitter
    const jitter = config.jitterFactor ?? 0.1;
    const jitterRange = cappedDelay * jitter;
    const jitterOffset = (Math.random() * jitterRange * 2) - jitterRange;

    return Math.max(0, Math.round(cappedDelay + jitterOffset));
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: Error, config: RetryConfig): boolean {
    const message = error.message.toLowerCase();
    const retryablePatterns = config.retryableErrors ?? [];

    // Check against retryable error codes
    for (const pattern of retryablePatterns) {
      if (message.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    // Check for common retryable patterns
    if (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('network') ||
      message.includes('socket')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if HTTP status code is retryable
   */
  private isRetryableStatus(statusCode: number): boolean {
    // 429 Too Many Requests
    if (statusCode === 429) return true;

    // 5xx Server Errors (except 501 Not Implemented)
    if (statusCode >= 500 && statusCode !== 501) return true;

    return false;
  }

  /**
   * Update global metrics
   */
  private updateMetrics(response: IntegrationResponse): void {
    this.globalMetrics.totalRequests++;

    if (response.success) {
      this.globalMetrics.successfulRequests++;
    } else {
      this.globalMetrics.failedRequests++;
    }

    // Update average latency
    const totalLatency =
      this.globalMetrics.averageLatencyMs * (this.globalMetrics.totalRequests - 1) +
      response.latencyMs;
    this.globalMetrics.averageLatencyMs = Math.round(
      totalLatency / this.globalMetrics.totalRequests
    );

    this.globalMetrics.lastRequestAt = new Date().toISOString() as ISO8601Timestamp;
  }

  /**
   * Convert Map to Record
   */
  private convertMapToRecord(
    map?: Map<string, string> | Record<string, string>
  ): Record<string, string> | undefined {
    if (!map) return undefined;

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
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an External Integration Surface instance
 */
export function createExternalIntegrationSurface(options?: {
  retryConfig?: Partial<RetryConfig>;
}): ExternalIntegrationSurface {
  return new ExternalIntegrationSurface(options);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultInstance: ExternalIntegrationSurface | undefined;

/**
 * Get the default External Integration Surface instance
 */
export function getDefaultExternalIntegrationSurface(): ExternalIntegrationSurface {
  if (!defaultInstance) {
    defaultInstance = new ExternalIntegrationSurface();
  }
  return defaultInstance;
}

/**
 * Reset the default instance (for testing)
 */
export function resetDefaultExternalIntegrationSurface(): void {
  if (defaultInstance) {
    defaultInstance.closeAll();
    defaultInstance = undefined;
  }
}
