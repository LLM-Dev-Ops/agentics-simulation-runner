/**
 * Telemetry Export Types
 *
 * Type definitions for MOD-013: Telemetry Export Surface
 * Defines types for telemetry backend interactions, metric/trace/log export.
 *
 * @module surfaces/telemetry-types
 */

import type {
  UUID,
  ISO8601Timestamp,
  DurationMs,
  LogLevel,
  SpanType,
  MetricEntry,
  TraceSpan,
  LogEntry,
  AgentLifecycleEvent,
} from '../types/common.js';

// =============================================================================
// Telemetry Backend Types
// =============================================================================

/**
 * Supported telemetry backend types
 */
export type TelemetryBackendType =
  | 'prometheus'      // Prometheus metrics
  | 'jaeger'          // Jaeger tracing
  | 'elasticsearch'   // Elasticsearch logs
  | 'datadog'         // Datadog APM
  | 'otlp'            // OpenTelemetry Protocol
  | 'newrelic'        // New Relic
  | 'grafana'         // Grafana Cloud
  | 'custom';         // Custom backend

/**
 * Authentication method for backend
 */
export type TelemetryAuthMethod =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'basic'
  | 'oauth2'
  | 'mtls';

/**
 * Credentials for backend authentication
 */
export interface TelemetryCredentials {
  /**
   * Authentication method
   */
  readonly method: TelemetryAuthMethod;

  /**
   * API key (for api_key method)
   */
  readonly apiKey?: string;

  /**
   * Bearer token (for bearer_token method)
   */
  readonly bearerToken?: string;

  /**
   * Basic auth username (for basic method)
   */
  readonly username?: string;

  /**
   * Basic auth password (for basic method)
   */
  readonly password?: string;

  /**
   * OAuth2 client ID (for oauth2 method)
   */
  readonly clientId?: string;

  /**
   * OAuth2 client secret (for oauth2 method)
   */
  readonly clientSecret?: string;

  /**
   * OAuth2 token URL (for oauth2 method)
   */
  readonly tokenUrl?: string;

  /**
   * mTLS certificate path (for mtls method)
   */
  readonly certPath?: string;

  /**
   * mTLS key path (for mtls method)
   */
  readonly keyPath?: string;

  /**
   * CA certificate path (for mtls method)
   */
  readonly caPath?: string;
}

/**
 * Retry configuration for export operations
 */
export interface TelemetryRetryConfig {
  /**
   * Maximum number of retry attempts
   */
  readonly maxRetries: number;

  /**
   * Initial delay between retries in milliseconds
   */
  readonly initialDelayMs: number;

  /**
   * Maximum delay between retries in milliseconds
   */
  readonly maxDelayMs: number;

  /**
   * Backoff multiplier for exponential backoff
   */
  readonly backoffMultiplier: number;

  /**
   * Whether to use jitter in retry delays
   */
  readonly useJitter: boolean;
}

/**
 * Telemetry backend configuration
 */
export interface TelemetryBackend {
  /**
   * Backend type
   */
  readonly type: TelemetryBackendType;

  /**
   * Backend endpoint URL
   */
  readonly endpoint: string;

  /**
   * Backend display name
   */
  readonly name?: string;

  /**
   * Credentials for authentication
   */
  readonly credentials?: TelemetryCredentials;

  /**
   * Batch size for export (number of items per batch)
   */
  readonly batchSize?: number;

  /**
   * Flush interval in milliseconds
   */
  readonly flushIntervalMs?: number;

  /**
   * Request timeout in milliseconds
   */
  readonly timeoutMs?: number;

  /**
   * Retry configuration
   */
  readonly retryConfig?: TelemetryRetryConfig;

  /**
   * Custom headers to include in requests
   */
  readonly headers?: Record<string, string>;

  /**
   * Compression method for payloads
   */
  readonly compression?: 'none' | 'gzip' | 'snappy' | 'zstd';

  /**
   * Whether TLS verification should be enabled
   */
  readonly tlsVerify?: boolean;

  /**
   * Backend-specific configuration options
   */
  readonly options?: Record<string, unknown>;
}

// =============================================================================
// Export Result Types
// =============================================================================

/**
 * Status of an export operation
 */
export type ExportStatus = 'success' | 'partial' | 'failed';

/**
 * Individual export error
 */
export interface ExportError {
  /**
   * Error code
   */
  readonly code: string;

  /**
   * Error message
   */
  readonly message: string;

  /**
   * Index or ID of the item that failed
   */
  readonly itemIndex?: number;

  /**
   * Item ID that failed
   */
  readonly itemId?: string;

  /**
   * Whether the error is retryable
   */
  readonly retryable: boolean;

  /**
   * Timestamp when error occurred
   */
  readonly timestamp: ISO8601Timestamp;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  /**
   * Whether the export was successful
   */
  readonly success: boolean;

  /**
   * Export status
   */
  readonly status: ExportStatus;

  /**
   * Number of items successfully exported
   */
  readonly itemsExported: number;

  /**
   * Total number of items attempted
   */
  readonly itemsAttempted: number;

  /**
   * Number of items that failed
   */
  readonly itemsFailed: number;

  /**
   * Export errors (if any)
   */
  readonly errors?: readonly ExportError[];

  /**
   * Duration of the export operation in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Bytes transferred
   */
  readonly bytesTransferred?: number;

  /**
   * Number of retries performed
   */
  readonly retriesPerformed?: number;

  /**
   * When the export started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When the export completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Backend that was targeted
   */
  readonly backend: {
    readonly type: TelemetryBackendType;
    readonly endpoint: string;
    readonly name?: string;
  };

  /**
   * Response from the backend (if available)
   */
  readonly backendResponse?: Record<string, unknown>;
}

// =============================================================================
// Captured Telemetry Types
// =============================================================================

/**
 * Captured metrics ready for export
 */
export interface CapturedMetrics {
  /**
   * Unique batch ID
   */
  readonly batchId: UUID;

  /**
   * Execution ID these metrics belong to
   */
  readonly executionId: UUID;

  /**
   * When the metrics were captured
   */
  readonly capturedAt: ISO8601Timestamp;

  /**
   * Metric entries
   */
  readonly metrics: readonly MetricEntry[];

  /**
   * Total count of metrics
   */
  readonly count: number;

  /**
   * Resource attributes (common labels)
   */
  readonly resourceAttributes?: Record<string, string>;
}

/**
 * Captured traces ready for export
 */
export interface CapturedTraces {
  /**
   * Unique batch ID
   */
  readonly batchId: UUID;

  /**
   * Execution ID these traces belong to
   */
  readonly executionId: UUID;

  /**
   * When the traces were captured
   */
  readonly capturedAt: ISO8601Timestamp;

  /**
   * Trace spans
   */
  readonly spans: readonly TraceSpan[];

  /**
   * Total count of spans
   */
  readonly count: number;

  /**
   * Root trace ID
   */
  readonly rootTraceId?: string;

  /**
   * Service name
   */
  readonly serviceName?: string;

  /**
   * Resource attributes
   */
  readonly resourceAttributes?: Record<string, string>;
}

/**
 * Captured events/logs ready for export
 */
export interface CapturedEvents {
  /**
   * Unique batch ID
   */
  readonly batchId: UUID;

  /**
   * Execution ID these events belong to
   */
  readonly executionId: UUID;

  /**
   * When the events were captured
   */
  readonly capturedAt: ISO8601Timestamp;

  /**
   * Log entries
   */
  readonly logs?: readonly LogEntry[];

  /**
   * Agent lifecycle events
   */
  readonly lifecycleEvents?: readonly AgentLifecycleEvent[];

  /**
   * Total count of events
   */
  readonly count: number;

  /**
   * Resource attributes
   */
  readonly resourceAttributes?: Record<string, string>;
}

// =============================================================================
// Export Configuration Types
// =============================================================================

/**
 * Filter configuration for what to export
 */
export interface ExportFilter {
  /**
   * Minimum log level to export
   */
  readonly minLogLevel?: LogLevel;

  /**
   * Span types to include
   */
  readonly spanTypes?: readonly SpanType[];

  /**
   * Metric names to include (regex patterns)
   */
  readonly metricPatterns?: readonly string[];

  /**
   * Time range start
   */
  readonly startTime?: ISO8601Timestamp;

  /**
   * Time range end
   */
  readonly endTime?: ISO8601Timestamp;

  /**
   * Agent IDs to include (if empty, include all)
   */
  readonly agentIds?: readonly string[];

  /**
   * Step IDs to include (if empty, include all)
   */
  readonly stepIds?: readonly string[];

  /**
   * Custom filter predicate expression
   */
  readonly customFilter?: string;
}

/**
 * Transformation configuration for export data
 */
export interface ExportTransform {
  /**
   * Fields to redact (for privacy)
   */
  readonly redactFields?: readonly string[];

  /**
   * Fields to hash
   */
  readonly hashFields?: readonly string[];

  /**
   * Label mappings (rename labels)
   */
  readonly labelMappings?: Record<string, string>;

  /**
   * Add static labels
   */
  readonly additionalLabels?: Record<string, string>;

  /**
   * Sampling rate (0.0 - 1.0)
   */
  readonly samplingRate?: number;

  /**
   * Aggregation window in milliseconds (for metrics)
   */
  readonly aggregationWindowMs?: number;
}

/**
 * Complete export configuration
 */
export interface ExportConfig {
  /**
   * Target backend
   */
  readonly backend: TelemetryBackend;

  /**
   * Filter configuration
   */
  readonly filter?: ExportFilter;

  /**
   * Transform configuration
   */
  readonly transform?: ExportTransform;

  /**
   * Whether to export synchronously (wait for completion)
   */
  readonly synchronous?: boolean;

  /**
   * Callback URL for async completion notification
   */
  readonly callbackUrl?: string;

  /**
   * Correlation ID for tracking
   */
  readonly correlationId?: UUID;
}

// =============================================================================
// Backend-Specific Configuration Types
// =============================================================================

/**
 * Prometheus-specific configuration
 */
export interface PrometheusConfig {
  /**
   * Job name for metrics
   */
  readonly jobName: string;

  /**
   * Instance name
   */
  readonly instance?: string;

  /**
   * Push gateway URL (for push-based export)
   */
  readonly pushGatewayUrl?: string;

  /**
   * Metric prefix
   */
  readonly metricPrefix?: string;

  /**
   * Whether to use remote write protocol
   */
  readonly useRemoteWrite?: boolean;
}

/**
 * Jaeger-specific configuration
 */
export interface JaegerConfig {
  /**
   * Service name
   */
  readonly serviceName: string;

  /**
   * Agent host (for UDP export)
   */
  readonly agentHost?: string;

  /**
   * Agent port
   */
  readonly agentPort?: number;

  /**
   * Whether to use collector endpoint
   */
  readonly useCollector?: boolean;

  /**
   * Sampling type
   */
  readonly samplingType?: 'const' | 'probabilistic' | 'ratelimiting' | 'remote';

  /**
   * Sampling param
   */
  readonly samplingParam?: number;
}

/**
 * Elasticsearch-specific configuration
 */
export interface ElasticsearchConfig {
  /**
   * Index pattern for logs
   */
  readonly indexPattern: string;

  /**
   * Pipeline name for ingest
   */
  readonly pipeline?: string;

  /**
   * Bulk request size
   */
  readonly bulkSize?: number;

  /**
   * Whether to use data streams
   */
  readonly useDataStreams?: boolean;

  /**
   * ILM policy name
   */
  readonly ilmPolicy?: string;
}

/**
 * Datadog-specific configuration
 */
export interface DatadogConfig {
  /**
   * Datadog site (e.g., datadoghq.com, datadoghq.eu)
   */
  readonly site: string;

  /**
   * Service name
   */
  readonly service: string;

  /**
   * Environment tag
   */
  readonly env?: string;

  /**
   * Version tag
   */
  readonly version?: string;

  /**
   * Additional tags
   */
  readonly tags?: Record<string, string>;
}

/**
 * OTLP-specific configuration
 */
export interface OTLPConfig {
  /**
   * Protocol (grpc or http/protobuf)
   */
  readonly protocol: 'grpc' | 'http/protobuf' | 'http/json';

  /**
   * Resource attributes
   */
  readonly resourceAttributes?: Record<string, string>;

  /**
   * Whether to export metrics
   */
  readonly exportMetrics?: boolean;

  /**
   * Whether to export traces
   */
  readonly exportTraces?: boolean;

  /**
   * Whether to export logs
   */
  readonly exportLogs?: boolean;

  /**
   * Metrics endpoint (if different from main endpoint)
   */
  readonly metricsEndpoint?: string;

  /**
   * Traces endpoint (if different from main endpoint)
   */
  readonly tracesEndpoint?: string;

  /**
   * Logs endpoint (if different from main endpoint)
   */
  readonly logsEndpoint?: string;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if export was successful
 */
export function isExportSuccessful(result: ExportResult): boolean {
  return result.success && result.status === 'success';
}

/**
 * Type guard to check if export was partial
 */
export function isExportPartial(result: ExportResult): boolean {
  return result.status === 'partial';
}

/**
 * Type guard to check if export failed completely
 */
export function isExportFailed(result: ExportResult): boolean {
  return result.status === 'failed' || !result.success;
}

/**
 * Type guard to check if backend requires authentication
 */
export function requiresAuthentication(backend: TelemetryBackend): boolean {
  return (
    backend.credentials !== undefined &&
    backend.credentials.method !== 'none'
  );
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: ExportError): boolean {
  return error.retryable;
}
