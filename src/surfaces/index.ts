/**
 * Invocation Surfaces Module Exports
 *
 * MOD-010: LLM Invocation Surface
 * MOD-011: External Integration Surface
 * MOD-012: Agentics Ecosystem Surface
 * MOD-013: Telemetry Export Surface
 *
 * @module surfaces
 * @see SPARC_ARCHITECTURE.md - Invocation Surfaces Layer
 */

// =============================================================================
// Version
// =============================================================================

export const SURFACES_VERSION = '1.0.0';

// =============================================================================
// MOD-011: External Integration Surface
// =============================================================================

// Main Surface Class
export {
  ExternalIntegrationSurface,
  createExternalIntegrationSurface,
  getDefaultExternalIntegrationSurface,
  resetDefaultExternalIntegrationSurface,
} from './external-integration-surface.js';

// External Types
export {
  // Connection Types
  type ProtocolType,
  type ConnectionSpec,
  type TLSConfig,
  type ConnectionPoolConfig,
  type RetryConfig,
  // Credential Types
  type CredentialType,
  type Credentials,
  type OAuth2Config,
  type CertificateConfig,
  // Connection Types
  type ConnectionStatus,
  type ExternalConnection,
  // Request Types
  type IntegrationRequest,
  type RequestOptions,
  type TraceContext,
  // Response Types
  type IntegrationResponse,
  type ResponseError,
  type ResponseMetadata,
  type ServerTiming,
  type RateLimitInfo,
  type RetryInfo,
  // Protocol-Specific Types
  type HttpRequestOptions,
  type DatabaseRequestOptions,
  type MessageQueueRequestOptions,
  type WebSocketRequestOptions,
  type GrpcRequestOptions,
  // Metrics Types
  type IntegrationMetrics,
  // Type Guards
  isHttpRequest,
  isDatabaseRequest,
  isMessageQueueRequest,
  isWebSocketRequest,
  isGrpcRequest,
  isSuccessResponse,
  isRetryableError,
} from './external-types.js';

// =============================================================================
// Protocol Implementations
// =============================================================================

// Base Protocol
export {
  type ProtocolConnectionStatus,
  type ProtocolCredentials,
  type BaseConnectionSpec,
  type BaseIntegrationRequest,
  type BaseIntegrationResponse,
  type ProtocolConnection,
  type ProtocolMetrics,
  type ProtocolFactory,
  type ProtocolRegistry,
  BaseProtocol,
  DefaultProtocolRegistry,
} from './protocols/base-protocol.js';

// HTTP Protocol
export {
  type HttpMethod,
  type HttpConnectionSpec,
  type HttpIntegrationRequest,
  type HttpIntegrationResponse,
  type HttpTiming,
  HttpProtocol,
  createHttpProtocol,
  createHttpsProtocol,
} from './protocols/http-protocol.js';

// Database Protocol
export {
  type DatabaseType,
  type DatabaseOperation,
  type QueryParameters,
  type DatabaseConnectionSpec,
  type DatabaseIntegrationRequest,
  type DatabaseIntegrationResponse,
  type TransactionOptions,
  type BatchStatement,
  type ColumnMetadata,
  DatabaseProtocol,
  createDatabaseProtocol,
} from './protocols/database-protocol.js';

// =============================================================================
// MOD-012: Agentics Ecosystem Surface
// =============================================================================

export {
  AgenticsEcosystemSurface,
  createEcosystemSurface,
  validateEcosystemAvailability,
  emitResult,
} from './agentics-ecosystem-surface.js';

export {
  // Component types
  type EcosystemComponent,
  type EcosystemComponentStatus,
  type EcosystemComponentType,
  type EcosystemRepository,

  // Status types
  type EcosystemStatus,
  type EcosystemHealthStatus,

  // Emit types
  type EmitConfirmation,
  type EmitError,
  type EmitTarget,
  type EmitTargetType,

  // Handoff types
  type HandoffRequest,
  type HandoffResponse,
  type HandoffProtocolVersion,

  // Configuration types
  type EcosystemSurfaceConfig,
  type EcosystemDiscoveryConfig,

  // Type guards
  isComponentAvailable,
  isEcosystemHealthy,
  isEmitAcknowledged,
  isHandoffAccepted,
} from './ecosystem-types.js';

// =============================================================================
// MOD-013: Telemetry Export Surface
// =============================================================================

export {
  TelemetryExportSurface,
  createTelemetryExportSurface,
  exportMetrics,
  exportTraces,
  exportLogs,
} from './telemetry-export-surface.js';

export {
  // Backend types
  type TelemetryBackend,
  type TelemetryBackendType,
  type TelemetryCredentials,
  type TelemetryRetryConfig,
  type TelemetryAuthMethod,

  // Export types
  type ExportResult,
  type ExportError,
  type ExportStatus,

  // Captured telemetry types
  type CapturedMetrics,
  type CapturedTraces,
  type CapturedEvents,

  // Configuration types
  type ExportConfig,
  type ExportFilter,
  type ExportTransform,

  // Backend-specific configs
  type PrometheusConfig,
  type JaegerConfig,
  type ElasticsearchConfig,
  type DatadogConfig,
  type OTLPConfig,

  // Type guards
  isExportSuccessful,
  isExportPartial,
  isExportFailed,
  requiresAuthentication,
  isRetryableError as isRetryableTelemetryError,
} from './telemetry-types.js';

// =============================================================================
// MOD-010: LLM Invocation Surface
// =============================================================================

// Main Surface
export {
  LLMInvocationSurface,
  getDefaultLLMInvocationSurface,
  createLLMInvocationSurface,
  quickInvoke,
} from './llm-invocation-surface.js';

export type {
  LLMInvocationSurfaceConfig,
  LLMInvocationMetrics,
  LLMMetricsCollector,
} from './llm-invocation-surface.js';

// LLM Types
export {
  LLMProviders,
  LLMError,
  DEFAULT_LLM_REQUEST,
  DEFAULT_CLIENT_OPTIONS,
  isAnthropicCredentials,
  isOpenAICredentials,
  isAzureOpenAICredentials,
  isGoogleCredentials,
  isCohereCredentials,
  isCustomCredentials,
  isRetryableLLMError,
  getLLMErrorCode,
} from './llm-types.js';

export type {
  LLMProviderType,
  LLMCredentialsBase,
  AnthropicCredentials,
  OpenAICredentials,
  AzureOpenAICredentials,
  GoogleCredentials,
  CohereCredentials,
  CustomCredentials,
  LLMCredentials,
  MessageRole,
  ChatMessage,
  LLMRequest,
  TokenUsage,
  FinishReason,
  LLMResponse,
  LLMErrorCode,
  ModelCapabilities,
  ModelInfo,
  LLMClientOptions,
} from './llm-types.js';

// Client Factory
export {
  LLMClientFactory,
  getDefaultFactory,
  createLLMClient,
  createCredentialsFromEnv,
  validateCredentials,
} from './llm-client-factory.js';

export type {
  LLMClientFactoryConfig,
} from './llm-client-factory.js';

// Provider Clients
export {
  BaseLLMClient,
  AnthropicClient,
  OpenAIClient,
  AzureOpenAIClient,
  createAnthropicClient,
  createOpenAIClient,
  createAzureOpenAIClient,
} from './providers/index.js';

export type { LLMClient } from './providers/index.js';
