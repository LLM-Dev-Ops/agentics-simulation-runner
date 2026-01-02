/**
 * Integration Call Result Types
 *
 * Defines the result structure for integration adapter calls including
 * metrics, idempotency tracking, and response data.
 *
 * @module core/integration-call-result
 * @see SPARC_ARCHITECTURE.md MOD-008 - Integration Adapter Manager
 * @see SPARC_PSEUDOCODE.md Section 5.4 - Integration Call
 */

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
  CallId,
} from '../types/common.js';

// =============================================================================
// Integration Call Metrics
// =============================================================================

/**
 * Metrics captured during an integration call
 */
export interface IntegrationCallMetrics {
  /**
   * Total latency of the call in milliseconds
   */
  readonly latencyMs: DurationMs;

  /**
   * HTTP status code for HTTP-based integrations
   */
  readonly statusCode?: number;

  /**
   * Number of bytes sent in the request
   */
  readonly bytesSent?: number;

  /**
   * Number of bytes received in the response
   */
  readonly bytesReceived?: number;

  /**
   * Time to first byte in milliseconds
   */
  readonly ttfbMs?: DurationMs;

  /**
   * DNS lookup time in milliseconds
   */
  readonly dnsLookupMs?: DurationMs;

  /**
   * TCP connection time in milliseconds
   */
  readonly tcpConnectMs?: DurationMs;

  /**
   * TLS handshake time in milliseconds (if applicable)
   */
  readonly tlsHandshakeMs?: DurationMs;

  /**
   * Number of retry attempts made
   */
  readonly retryAttempts?: number;

  /**
   * Total time spent in retries in milliseconds
   */
  readonly totalRetryDelayMs?: DurationMs;
}

// =============================================================================
// Integration Call Result
// =============================================================================

/**
 * Result of an integration call
 *
 * Contains the call ID, output data, metrics, and idempotency key
 * as specified in the SPARC Architecture MOD-008.
 *
 * Invariants enforced:
 * - INV-IN-002: Idempotency key must be present for non-idempotent operations
 * - INV-IN-003: All calls captured in telemetry
 */
export interface IntegrationCallResult {
  /**
   * Unique identifier for this call (UUID v4)
   * Used for correlation in telemetry and audit trails
   */
  readonly callId: CallId;

  /**
   * Output data from the integration call
   * The structure depends on the adapter type and operation
   */
  readonly output: unknown;

  /**
   * Metrics captured during the call
   */
  readonly metrics: IntegrationCallMetrics;

  /**
   * Idempotency key used for this call
   * Ensures replay safety for non-idempotent operations
   *
   * Format: {integration_id}:{operation}:{content_hash}
   */
  readonly idempotencyKey: string;

  /**
   * Whether the call was successful
   */
  readonly success: boolean;

  /**
   * Error information if the call failed
   */
  readonly error?: IntegrationCallError;

  /**
   * Timestamp when the call was initiated
   */
  readonly initiatedAt: ISO8601Timestamp;

  /**
   * Timestamp when the call completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Raw response headers (for HTTP-based integrations)
   */
  readonly responseHeaders?: Record<string, string>;

  /**
   * Whether this result was served from cache
   */
  readonly cached?: boolean;

  /**
   * Whether the operation was retried
   */
  readonly retried?: boolean;
}

// =============================================================================
// Integration Call Error
// =============================================================================

/**
 * Error details for failed integration calls
 */
export interface IntegrationCallError {
  /**
   * Error code for categorization
   */
  readonly code: IntegrationErrorCode;

  /**
   * Human-readable error message
   */
  readonly message: string;

  /**
   * Additional error details
   */
  readonly details?: Record<string, unknown>;

  /**
   * Whether the error is retryable
   */
  readonly retryable: boolean;

  /**
   * Underlying cause if available
   */
  readonly cause?: string;

  /**
   * Stack trace for debugging (not included in production)
   */
  readonly stack?: string;
}

/**
 * Integration error codes
 */
export type IntegrationErrorCode =
  // Connection errors
  | 'CONNECTION_FAILED'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'DNS_RESOLUTION_FAILED'
  | 'TLS_HANDSHAKE_FAILED'
  // Request errors
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_TOO_LARGE'
  | 'INVALID_REQUEST'
  | 'SERIALIZATION_FAILED'
  // Response errors
  | 'RESPONSE_TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'DESERIALIZATION_FAILED'
  // Authentication errors
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_INVALID'
  // Rate limiting
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  // Server errors
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_ERROR'
  // Protocol errors
  | 'PROTOCOL_ERROR'
  | 'UNSUPPORTED_OPERATION'
  // Internal errors
  | 'INTERNAL_ERROR'
  | 'ADAPTER_ERROR'
  | 'CONFIGURATION_ERROR'
  // Idempotency errors
  | 'IDEMPOTENCY_CONFLICT'
  | 'DUPLICATE_REQUEST';

// =============================================================================
// Integration Request (for building calls)
// =============================================================================

/**
 * Request specification for an integration call
 */
export interface IntegrationCallRequest {
  /**
   * Integration ID (references the integration definition)
   */
  readonly integrationId: string;

  /**
   * Operation/method to invoke
   */
  readonly operation: string;

  /**
   * Request path (for HTTP/GraphQL)
   */
  readonly path?: string;

  /**
   * Request parameters (query params, gRPC metadata)
   */
  readonly parameters?: Record<string, unknown>;

  /**
   * Request body/payload
   */
  readonly body?: unknown;

  /**
   * Request headers
   */
  readonly headers?: Record<string, string>;

  /**
   * Explicit idempotency key (auto-generated if not provided)
   */
  readonly idempotencyKey?: string;

  /**
   * Operation timeout in milliseconds (overrides default)
   */
  readonly timeoutMs?: DurationMs;

  /**
   * Whether to skip retry on failure
   */
  readonly skipRetry?: boolean;
}

// =============================================================================
// Cached Result Types
// =============================================================================

/**
 * Cache entry for integration call results
 */
export interface IntegrationCacheEntry {
  /**
   * The cached result
   */
  readonly result: IntegrationCallResult;

  /**
   * When the entry was cached
   */
  readonly cachedAt: ISO8601Timestamp;

  /**
   * Time-to-live in milliseconds
   */
  readonly ttlMs: DurationMs;

  /**
   * Cache key (usually the idempotency key)
   */
  readonly cacheKey: string;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a result is successful
 */
export function isSuccessfulResult(
  result: IntegrationCallResult
): result is IntegrationCallResult & { success: true; error: undefined } {
  return result.success && result.error === undefined;
}

/**
 * Type guard to check if a result is a failure
 */
export function isFailedResult(
  result: IntegrationCallResult
): result is IntegrationCallResult & { success: false; error: IntegrationCallError } {
  return !result.success && result.error !== undefined;
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: IntegrationCallError): boolean {
  return error.retryable;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a successful integration call result
 */
export function createSuccessResult(
  callId: CallId,
  output: unknown,
  metrics: IntegrationCallMetrics,
  idempotencyKey: string,
  initiatedAt: ISO8601Timestamp,
  options?: {
    responseHeaders?: Record<string, string>;
    cached?: boolean;
    retried?: boolean;
  }
): IntegrationCallResult {
  return {
    callId,
    output,
    metrics,
    idempotencyKey,
    success: true,
    initiatedAt,
    completedAt: new Date().toISOString() as ISO8601Timestamp,
    responseHeaders: options?.responseHeaders,
    cached: options?.cached,
    retried: options?.retried,
  };
}

/**
 * Create a failed integration call result
 */
export function createErrorResult(
  callId: CallId,
  error: IntegrationCallError,
  metrics: IntegrationCallMetrics,
  idempotencyKey: string,
  initiatedAt: ISO8601Timestamp,
  options?: {
    retried?: boolean;
  }
): IntegrationCallResult {
  return {
    callId,
    output: null,
    metrics,
    idempotencyKey,
    success: false,
    error,
    initiatedAt,
    completedAt: new Date().toISOString() as ISO8601Timestamp,
    retried: options?.retried,
  };
}

/**
 * Create an integration call error
 */
export function createIntegrationError(
  code: IntegrationErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    retryable?: boolean;
    cause?: string;
    stack?: string;
  }
): IntegrationCallError {
  return {
    code,
    message,
    details: options?.details,
    retryable: options?.retryable ?? isRetryableErrorCode(code),
    cause: options?.cause,
    stack: options?.stack,
  };
}

/**
 * Determine if an error code is typically retryable
 */
function isRetryableErrorCode(code: IntegrationErrorCode): boolean {
  const retryableCodes: IntegrationErrorCode[] = [
    'CONNECTION_TIMEOUT',
    'CONNECTION_REFUSED',
    'DNS_RESOLUTION_FAILED',
    'REQUEST_TIMEOUT',
    'RESPONSE_TIMEOUT',
    'RATE_LIMITED',
    'SERVICE_UNAVAILABLE',
    'GATEWAY_ERROR',
  ];
  return retryableCodes.includes(code);
}

/**
 * Generate an idempotency key for a request
 */
export function generateIdempotencyKey(
  integrationId: string,
  operation: string,
  contentHash: string
): string {
  return `${integrationId}:${operation}:${contentHash}`;
}
