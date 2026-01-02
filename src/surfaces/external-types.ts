/**
 * External Integration Surface Type Definitions
 *
 * Defines all types used by the External Integration Surface (MOD-011).
 * Provides type-safe abstractions for external system interactions.
 *
 * @module surfaces/external-types
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
} from '../types/common.js';

// =============================================================================
// Protocol Types
// =============================================================================

/**
 * Supported protocol types for external integrations
 * From MOD-011: Protocol type enumeration
 */
export type ProtocolType =
  | 'http'
  | 'https'
  | 'grpc'
  | 'websocket'
  | 'database'
  | 'messagequeue';

// =============================================================================
// Connection Specification
// =============================================================================

/**
 * Connection specification for external systems
 * From MOD-011: ConnectionSpec type
 */
export interface ConnectionSpec {
  /**
   * Protocol type for the connection
   */
  readonly protocol: ProtocolType;

  /**
   * Host address (hostname or IP)
   */
  readonly host: string;

  /**
   * Port number
   */
  readonly port: number;

  /**
   * Optional path prefix for all requests
   */
  readonly path?: string;

  /**
   * Protocol-specific options
   */
  readonly options?: Map<string, string>;

  /**
   * Connection timeout in milliseconds
   */
  readonly connectionTimeoutMs?: DurationMs;

  /**
   * Request timeout in milliseconds
   */
  readonly requestTimeoutMs?: DurationMs;

  /**
   * SSL/TLS configuration
   */
  readonly tls?: TLSConfig;

  /**
   * Connection pool configuration
   */
  readonly pool?: ConnectionPoolConfig;

  /**
   * Retry configuration
   */
  readonly retry?: RetryConfig;
}

/**
 * TLS/SSL configuration
 */
export interface TLSConfig {
  /**
   * Enable TLS
   */
  readonly enabled: boolean;

  /**
   * Verify server certificate
   */
  readonly verifyServer?: boolean;

  /**
   * CA certificate (PEM format)
   */
  readonly caCert?: string;

  /**
   * Client certificate for mTLS (PEM format)
   */
  readonly clientCert?: string;

  /**
   * Client key for mTLS (PEM format)
   */
  readonly clientKey?: string;

  /**
   * Server name for SNI
   */
  readonly serverName?: string;

  /**
   * Allowed TLS versions
   */
  readonly minVersion?: 'TLS1.2' | 'TLS1.3';
}

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  /**
   * Minimum connections in pool
   */
  readonly minSize?: number;

  /**
   * Maximum connections in pool
   */
  readonly maxSize?: number;

  /**
   * Idle timeout in milliseconds
   */
  readonly idleTimeoutMs?: DurationMs;

  /**
   * Connection acquire timeout
   */
  readonly acquireTimeoutMs?: DurationMs;
}

/**
 * Retry configuration for transient failures
 */
export interface RetryConfig {
  /**
   * Maximum retry attempts
   */
  readonly maxRetries: number;

  /**
   * Initial delay in milliseconds
   */
  readonly initialDelayMs: DurationMs;

  /**
   * Maximum delay in milliseconds
   */
  readonly maxDelayMs: DurationMs;

  /**
   * Backoff multiplier
   */
  readonly multiplier: number;

  /**
   * Jitter factor (0-1)
   */
  readonly jitterFactor?: number;

  /**
   * Retryable error codes
   */
  readonly retryableErrors?: string[];
}

// =============================================================================
// Credentials
// =============================================================================

/**
 * Credential types for authentication
 */
export type CredentialType =
  | 'api_key'
  | 'bearer'
  | 'basic'
  | 'oauth2'
  | 'mtls'
  | 'certificate'
  | 'none';

/**
 * Credentials for external system authentication
 * From MOD-011: Credentials type
 */
export interface Credentials {
  /**
   * Credential type
   */
  readonly type: CredentialType;

  /**
   * Primary credential value (API key, token, password)
   */
  readonly value?: string;

  /**
   * Secondary credential (username for basic auth)
   */
  readonly secondary?: string;

  /**
   * OAuth2-specific configuration
   */
  readonly oauth2?: OAuth2Config;

  /**
   * Certificate configuration
   */
  readonly certificate?: CertificateConfig;

  /**
   * Additional authentication parameters
   */
  readonly parameters?: Record<string, unknown>;
}

/**
 * OAuth2 configuration
 */
export interface OAuth2Config {
  /**
   * OAuth2 token endpoint
   */
  readonly tokenEndpoint: string;

  /**
   * Client ID
   */
  readonly clientId: string;

  /**
   * Client secret reference
   */
  readonly clientSecretRef: string;

  /**
   * OAuth2 scopes
   */
  readonly scopes?: string[];

  /**
   * Grant type
   */
  readonly grantType: 'client_credentials' | 'authorization_code' | 'refresh_token';

  /**
   * Refresh token (for refresh_token grant)
   */
  readonly refreshToken?: string;
}

/**
 * Certificate configuration for mTLS
 */
export interface CertificateConfig {
  /**
   * Client certificate (PEM format)
   */
  readonly cert: string;

  /**
   * Client key (PEM format)
   */
  readonly key: string;

  /**
   * CA certificate (PEM format)
   */
  readonly ca?: string;

  /**
   * Certificate passphrase
   */
  readonly passphrase?: string;
}

// =============================================================================
// External Connection
// =============================================================================

/**
 * Connection status enumeration
 */
export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'connecting'
  | 'reconnecting';

/**
 * External connection handle
 * From MOD-011: ExternalConnection interface
 */
export interface ExternalConnection {
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
  status: ConnectionStatus;

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

  /**
   * Execute a request on this connection
   */
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;

  /**
   * Close the connection
   */
  close(): void;

  /**
   * Test connection health
   */
  testHealth(): Promise<boolean>;
}

// =============================================================================
// Integration Request
// =============================================================================

/**
 * Integration request for external system calls
 * From MOD-011: IntegrationRequest type
 */
export interface IntegrationRequest {
  /**
   * Request method
   * - HTTP: GET, POST, PUT, PATCH, DELETE, etc.
   * - Database: query, execute, transaction
   * - Message Queue: publish, subscribe, ack
   * - gRPC: method name
   */
  readonly method: string;

  /**
   * Request path (optional, for HTTP/gRPC)
   */
  readonly path?: string;

  /**
   * Request headers
   */
  readonly headers?: Map<string, string>;

  /**
   * Request body/payload
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
   * Query parameters (for HTTP)
   */
  readonly queryParams?: Record<string, string | number | boolean | string[]>;

  /**
   * Additional request options
   */
  readonly options?: RequestOptions;
}

/**
 * Additional request options
 */
export interface RequestOptions {
  /**
   * Skip retry on failure
   */
  readonly skipRetry?: boolean;

  /**
   * Custom retry configuration
   */
  readonly retryConfig?: Partial<RetryConfig>;

  /**
   * Cache control
   */
  readonly cacheControl?: 'no-cache' | 'no-store' | 'max-age';

  /**
   * Cache max age in seconds
   */
  readonly cacheMaxAge?: number;

  /**
   * Priority (for queue ordering)
   */
  readonly priority?: 'low' | 'normal' | 'high' | 'critical';

  /**
   * Trace context for distributed tracing
   */
  readonly traceContext?: TraceContext;
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  /**
   * Trace ID
   */
  readonly traceId: string;

  /**
   * Span ID
   */
  readonly spanId: string;

  /**
   * Parent span ID
   */
  readonly parentSpanId?: string;

  /**
   * Sampling decision
   */
  readonly sampled?: boolean;
}

// =============================================================================
// Integration Response
// =============================================================================

/**
 * Integration response from external system
 * From MOD-011: IntegrationResponse type
 */
export interface IntegrationResponse {
  /**
   * Response status code
   * - HTTP: 200, 404, 500, etc.
   * - Database: affected rows or custom code
   * - Message Queue: delivery status
   */
  readonly statusCode: number;

  /**
   * Response headers
   */
  readonly headers: Map<string, string>;

  /**
   * Response body/payload
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
   * Error information if not successful
   */
  readonly error?: ResponseError;

  /**
   * Response metadata
   */
  readonly metadata?: ResponseMetadata;
}

/**
 * Response error information
 */
export interface ResponseError {
  /**
   * Error code
   */
  readonly code: string;

  /**
   * Error message
   */
  readonly message: string;

  /**
   * Error details
   */
  readonly details?: Record<string, unknown>;

  /**
   * Whether error is retryable
   */
  readonly retryable: boolean;

  /**
   * Suggested retry delay in milliseconds
   */
  readonly retryAfterMs?: DurationMs;
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /**
   * Request ID from server
   */
  readonly requestId?: string;

  /**
   * Server timing information
   */
  readonly serverTiming?: ServerTiming;

  /**
   * Rate limit information
   */
  readonly rateLimit?: RateLimitInfo;

  /**
   * Whether response was cached
   */
  readonly cached?: boolean;

  /**
   * Retry information
   */
  readonly retry?: RetryInfo;
}

/**
 * Server timing information
 */
export interface ServerTiming {
  /**
   * Server processing time in milliseconds
   */
  readonly processingMs?: DurationMs;

  /**
   * Queue wait time in milliseconds
   */
  readonly queueMs?: DurationMs;

  /**
   * Database query time in milliseconds
   */
  readonly databaseMs?: DurationMs;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  /**
   * Maximum requests allowed
   */
  readonly limit: number;

  /**
   * Remaining requests in window
   */
  readonly remaining: number;

  /**
   * When the rate limit resets
   */
  readonly resetAt: ISO8601Timestamp;
}

/**
 * Retry information
 */
export interface RetryInfo {
  /**
   * Number of retries attempted
   */
  readonly attempts: number;

  /**
   * Total delay from retries in milliseconds
   */
  readonly totalDelayMs: DurationMs;

  /**
   * Final attempt succeeded
   */
  readonly succeeded: boolean;
}

// =============================================================================
// Protocol-Specific Types
// =============================================================================

/**
 * HTTP-specific request options
 */
export interface HttpRequestOptions extends IntegrationRequest {
  /**
   * HTTP method
   */
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

  /**
   * Content type
   */
  readonly contentType?: string;

  /**
   * Accept header
   */
  readonly accept?: string;

  /**
   * Follow redirects
   */
  readonly followRedirects?: boolean;

  /**
   * Maximum redirects to follow
   */
  readonly maxRedirects?: number;
}

/**
 * Database-specific request options
 */
export interface DatabaseRequestOptions extends IntegrationRequest {
  /**
   * Database operation
   */
  readonly method: 'query' | 'execute' | 'transaction' | 'batch' | 'call';

  /**
   * SQL query or statement
   */
  readonly sql?: string;

  /**
   * Query parameters
   */
  readonly parameters?: unknown[] | Record<string, unknown>;

  /**
   * Transaction options
   */
  readonly transaction?: {
    readonly isolationLevel?: 'read_committed' | 'repeatable_read' | 'serializable';
    readonly readOnly?: boolean;
  };
}

/**
 * Message queue-specific request options
 */
export interface MessageQueueRequestOptions extends IntegrationRequest {
  /**
   * Queue operation
   */
  readonly method: 'publish' | 'subscribe' | 'ack' | 'nack' | 'peek';

  /**
   * Queue or topic name
   */
  readonly destination?: string;

  /**
   * Message properties
   */
  readonly messageProperties?: {
    readonly contentType?: string;
    readonly correlationId?: string;
    readonly replyTo?: string;
    readonly expiration?: DurationMs;
    readonly priority?: number;
  };
}

/**
 * WebSocket-specific request options
 */
export interface WebSocketRequestOptions extends IntegrationRequest {
  /**
   * WebSocket operation
   */
  readonly method: 'send' | 'subscribe' | 'unsubscribe' | 'ping';

  /**
   * Message type
   */
  readonly messageType?: 'text' | 'binary';

  /**
   * Subscription topic/channel
   */
  readonly channel?: string;
}

/**
 * gRPC-specific request options
 */
export interface GrpcRequestOptions extends IntegrationRequest {
  /**
   * gRPC service name
   */
  readonly service: string;

  /**
   * gRPC method name
   */
  readonly method: string;

  /**
   * gRPC metadata
   */
  readonly grpcMetadata?: Record<string, string>;

  /**
   * Streaming mode
   */
  readonly streaming?: 'unary' | 'server' | 'client' | 'bidirectional';
}

// =============================================================================
// Metrics and Monitoring
// =============================================================================

/**
 * Integration metrics (mutable for internal tracking)
 */
export interface IntegrationMetrics {
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
   * Average latency in milliseconds
   */
  averageLatencyMs: DurationMs;

  /**
   * P99 latency in milliseconds
   */
  p99LatencyMs?: DurationMs;

  /**
   * Total bytes sent
   */
  bytesSent?: number;

  /**
   * Total bytes received
   */
  bytesReceived?: number;

  /**
   * Retry count
   */
  retryCount: number;

  /**
   * Active connections
   */
  activeConnections: number;

  /**
   * Last request timestamp
   */
  lastRequestAt?: ISO8601Timestamp;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for HTTP request
 */
export function isHttpRequest(request: IntegrationRequest): request is HttpRequestOptions {
  const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return httpMethods.includes(request.method);
}

/**
 * Type guard for database request
 */
export function isDatabaseRequest(request: IntegrationRequest): request is DatabaseRequestOptions {
  const dbMethods = ['query', 'execute', 'transaction', 'batch', 'call'];
  return dbMethods.includes(request.method);
}

/**
 * Type guard for message queue request
 */
export function isMessageQueueRequest(request: IntegrationRequest): request is MessageQueueRequestOptions {
  const mqMethods = ['publish', 'subscribe', 'ack', 'nack', 'peek'];
  return mqMethods.includes(request.method);
}

/**
 * Type guard for WebSocket request
 */
export function isWebSocketRequest(request: IntegrationRequest): request is WebSocketRequestOptions {
  const wsMethods = ['send', 'subscribe', 'unsubscribe', 'ping'];
  return wsMethods.includes(request.method);
}

/**
 * Type guard for gRPC request
 */
export function isGrpcRequest(request: IntegrationRequest): request is GrpcRequestOptions {
  return 'service' in request && typeof (request as GrpcRequestOptions).service === 'string';
}

/**
 * Check if response indicates success
 */
export function isSuccessResponse(response: IntegrationResponse): boolean {
  return response.success && response.statusCode >= 200 && response.statusCode < 300;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(response: IntegrationResponse): boolean {
  if (!response.error) return false;
  return response.error.retryable;
}
