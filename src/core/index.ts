/**
 * Core module exports
 *
 * MOD-006: Workflow Scheduler
 * MOD-007: Agent Lifecycle Manager
 * MOD-008: Integration Adapter Manager
 * MOD-009: Telemetry Collector
 */

// Deterministic random number generation (INV-EX-001)
export * from './deterministic-random.js';

// Hash utilities
export * from './hash-utils.js';

// MOD-006: Workflow Scheduler
// Note: workflow-scheduler.js re-exports from sub-modules, so we only export from there
// to avoid duplicate export conflicts
export * from './workflow-scheduler.js';

// MOD-007: Agent Lifecycle Manager
export * from './agent-lifecycle-manager.js';
export * from './agent-instance.js';
export * from './prompt-renderer.js';
export * from './invocation-result.js';

// MOD-008: Integration Adapter Manager
// Note: Selective exports to avoid naming conflicts with other modules
export {
  // Integration call result types
  type IntegrationCallResult,
  type IntegrationCallMetrics,
  type IntegrationCallError,
  type IntegrationErrorCode,
  type IntegrationCallRequest,
  type IntegrationCacheEntry,
  isSuccessfulResult,
  isFailedResult,
  createSuccessResult as createIntegrationSuccessResult,
  createErrorResult as createIntegrationErrorResult,
  createIntegrationError,
  generateIdempotencyKey,
} from './integration-call-result.js';

export {
  // Integration adapter manager
  IntegrationAdapterManager,
  type CredentialVault,
  type IntegrationTelemetry,
  type TelemetrySpan,
  type ManagedIntegrationConnection,
  type IntegrationAdapterManagerOptions,
  EnvironmentCredentialVault,
  createIntegrationAdapterManager,
  createIntegrationAdapterManagerWithEnvCredentials,
} from './integration-adapter-manager.js';

export {
  // Adapter types and factory
  type AdapterType,
  type ConnectionStatus,
  type AdapterCredentials,
  type ResolvedCredentials,
  type BaseConnectionConfig,
  type AdapterConnection,
  type AdapterRequest,
  type AdapterResponse,
  type AdapterConfig,
  type AdapterCreationOptions,
  BaseAdapter,
  AdapterFactory,
  createAdapter,
  isAdapterSupported,
  getSupportedAdapterTypes,
  // HTTP adapter
  type HttpMethod,
  type HttpConnectionConfig,
  type HttpRequestOptions,
  type HttpResponse,
  type HttpTiming,
  HttpAdapter,
  createHttpAdapter,
  // Database adapter
  type DatabaseType,
  type DatabaseConnectionConfig,
  type DatabaseOperation,
  type QueryParameters,
  type DatabaseQueryRequest,
  type TransactionOptions,
  type DatabaseQueryResult,
  type ColumnMetadata,
  type DatabaseTransaction,
  DatabaseAdapter,
  createDatabaseAdapter,
  // Message queue adapter
  type MessageQueueType,
  type MessageQueueConnectionConfig,
  type MessageQueueOperation,
  type MessageHeaders,
  type PublishMessage,
  type MessageProperties,
  type ConsumedMessage,
  type PublishResult,
  type SubscribeOptions,
  type Subscription,
  MessageQueueAdapter,
  createMessageQueueAdapter,
} from './adapters/index.js';

// MOD-009: Telemetry Collector
export {
  // Metric types
  type MetricAggregationType,
  type MetricValue,
  type HistogramValue,
  type HistogramBucket,
  type MetricTimeRange,
  type CapturedMetric,
  type MetricRequirements,
  type CapturedMetrics,
  type RawMetricSample,
  type MetricStorage,
  type MetricAggregator,
  createCapturedMetric,
  createRawMetricSample,
  createMetricRequirements,
  isHistogramValue,
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_TOKEN_BUCKETS,
} from './metric-types.js';

export {
  // Event types
  type EventSeverity,
  type EventCategory,
  type CapturedEvent,
  type EventRequirements,
  type CapturedEvents,
  type EventStorage,
  StandardEventTypes,
  createCapturedEvent,
  createEventRequirements,
  inferEventCategory,
  inferEventSeverity,
  compareSeverity,
  meetsSeverityThreshold,
} from './event-types.js';

export {
  // Trace types
  type SpanStatus,
  type SpanKind,
  type SpanLog,
  type TraceSpan,
  type CapturedTrace,
  type CapturedTraces,
  type TracingConfig,
  type SpanStorage,
  DEFAULT_TRACING_CONFIG,
  createTraceSpan,
  endTraceSpan,
  addSpanLog,
  addSpanTag,
  createCapturedTrace,
  assembleTraceTree,
  flattenTraceTree,
  createTracingConfig,
} from './trace-types.js';

export {
  // Span handle
  type ISpanHandle,
  type SpanHandleData,
  SpanHandle,
  SpanHandleError,
  createSpanHandle,
  createChildSpanHandle,
  type TraceContext,
  extractTraceContext,
  spanHandleFromContext,
  serializeTraceContext,
  parseTraceContext,
  SpanRegistry,
} from './span-handle.js';

export {
  // Telemetry collector
  type TelemetryCollectorConfig,
  DEFAULT_TELEMETRY_CONFIG,
  TelemetryCollector,
  createTelemetryCollector,
  TelemetryCollectorAdapter,
  createTelemetryAdapter,
} from './telemetry-collector.js';
