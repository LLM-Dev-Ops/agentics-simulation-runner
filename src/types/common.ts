/**
 * Common Type Definitions for Agentics Simulation Runner
 *
 * These types are used throughout the system and align with the SPARC specification.
 * @module types/common
 */

import { z } from 'zod';

// =============================================================================
// Primitive Type Aliases
// =============================================================================

/**
 * UUID v4 string identifier
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export type UUID = string;

/**
 * SHA-256 hash string (64 hexadecimal characters)
 */
export type SHA256Hash = string;

/**
 * ISO 8601 timestamp string
 * Format: YYYY-MM-DDTHH:mm:ss.sssZ
 */
export type ISO8601Timestamp = string;

/**
 * Duration in milliseconds
 */
export type DurationMs = number;

/**
 * Duration in seconds
 */
export type DurationSeconds = number;

/**
 * Semantic version string
 * Format: MAJOR.MINOR.PATCH
 */
export type SemanticVersion = string;

/**
 * Secret reference (pointer to secret in vault, NOT the actual secret)
 */
export type SecretReference = string;

/**
 * URL template with variable substitution support
 */
export type URLTemplate = string;

/** Percentage as decimal (0.0 - 1.0) */
export type Percentage = number;

/** Count type for numeric counts */
export type Count = number;

/** Token count for LLM usage */
export type TokenCount = number;

// =============================================================================
// Zod Schemas for Validation (INV-IN-001)
// =============================================================================

export const UUIDSchema = z.string().uuid();

export const SHA256HashSchema = z.string().regex(/^[a-f0-9]{64}$/i, {
  message: 'Must be a valid SHA256 hash (64 hex characters)',
});

export const SemanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, {
  message: 'Must be a valid semantic version (e.g., 1.0.0)',
});

export const ISO8601TimestampSchema = z.string().datetime();

export const DurationMsSchema = z.number().int().nonnegative();

export const PercentageSchema = z.number().min(0).max(1);

// =============================================================================
// Identifier Types
// =============================================================================

export interface PlannerIdentifier {
  readonly name: string;
  readonly version: SemanticVersion;
  readonly instanceId: UUID;
}

export interface RunnerIdentifier {
  readonly name: string;
  readonly version: SemanticVersion;
  readonly instanceId: UUID;
}

export interface IntentReference {
  readonly intentId: UUID;
  readonly intentHash: SHA256Hash;
}

export interface PlanReference {
  readonly planId: UUID;
  readonly planHash: SHA256Hash;
}

export interface ResultReference {
  readonly resultId: UUID;
  readonly resultHash: SHA256Hash;
}

// =============================================================================
// Execution Status Types
// =============================================================================

/**
 * Status of a simulation execution
 * From Section 5.1: SimulationResult.execution_metadata.status
 */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/**
 * Status of a workflow step
 * From Section 5.1: step_results[].status
 */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'skipped';

/**
 * Status of an agent instance
 * From Section 11.1: AgentInstance.status
 */
export type AgentStatus =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'terminated';

/**
 * Actor types for audit entries
 * From Section 5.5: audit_trail.entries[].actor
 */
export type ActorType = 'system' | 'agent' | 'external';

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Type of agent behavior
 * From Section 4.1: agents[].type
 */
export type AgentType = 'autonomous' | 'reactive' | 'hybrid';

/**
 * Action types that agents can perform
 * From Section 4.4: workflow_definition.steps[].action_type
 */
export type AgentActionType =
  | 'invoke'
  | 'observe'
  | 'decide'
  | 'mutate'
  | 'emit';

// =============================================================================
// LLM Provider Types
// =============================================================================

/**
 * Supported LLM providers
 * From Section 4.6: llm_configuration.provider_config.provider
 */
export type LLMProvider =
  | 'anthropic'
  | 'openai'
  | 'azure_openai'
  | 'google'
  | 'local';

/**
 * LLM model configuration
 * From Section 4.6: llm_configuration.model_config
 */
export interface LLMModelConfig {
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number; // 0.0-2.0
  readonly topP?: number; // 0.0-1.0
  readonly topK?: number;
  readonly frequencyPenalty?: number; // -2.0 to 2.0
  readonly presencePenalty?: number; // -2.0 to 2.0
  readonly stopSequences?: readonly string[];
}

/**
 * LLM safety configuration
 * From Section 4.6: llm_configuration.safety_config
 */
export interface LLMSafetyConfig {
  readonly contentFiltering: boolean;
  readonly piiRedaction: boolean;
  readonly maxRetriesOnSafetyBlock: number;
}

/**
 * LLM observability configuration
 * From Section 4.6: llm_configuration.observability
 */
export interface LLMObservabilityConfig {
  readonly logPrompts: boolean;
  readonly logCompletions: boolean;
  readonly traceEnabled: boolean;
}

/**
 * Complete LLM configuration
 * From Section 4.6
 */
export interface LLMConfiguration {
  readonly providerConfig: {
    readonly provider: LLMProvider;
    readonly baseUrl?: string;
    readonly apiVersion?: string;
  };
  readonly modelConfig: LLMModelConfig;
  readonly safetyConfig?: LLMSafetyConfig;
  readonly observability?: LLMObservabilityConfig;
}

// =============================================================================
// Resource Management Types
// =============================================================================

/**
 * Resource limits for execution
 * Based on execution constraints throughout the specification
 */
export interface ResourceLimits {
  readonly maxMemoryBytes?: number;
  readonly maxCpuPercent?: number;
  readonly maxConcurrentAgents?: number;
  readonly maxStateSize?: number;
  readonly maxTokensPerAgent?: number;
  readonly maxTokensTotal?: number;
  readonly maxCpu?: number;
  readonly maxMemory?: number;
  readonly maxStorage?: number;
  readonly maxConcurrency?: number;
}

export const ResourceLimitsSchema = z.object({
  maxCpu: z.number().positive().optional(),
  maxMemory: z.number().positive().optional(),
  maxStorage: z.number().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  maxMemoryBytes: z.number().positive().optional(),
  maxCpuPercent: z.number().positive().optional(),
  maxConcurrentAgents: z.number().int().positive().optional(),
  maxStateSize: z.number().positive().optional(),
  maxTokensPerAgent: z.number().int().positive().optional(),
  maxTokensTotal: z.number().int().positive().optional(),
});

/**
 * Retry policy configuration
 * From Section 4.1: execution_config.retry_policy
 */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffStrategy: 'fixed' | 'exponential';
  readonly initialDelayMs: number;
  readonly maxDelayMs?: number;
  readonly retryableErrors?: readonly string[];
}

// =============================================================================
// Database/State Types
// =============================================================================

/**
 * Transaction isolation levels
 * From Section 4.1: state_config.isolation_level
 */
export type IsolationLevel =
  | 'read_committed'
  | 'repeatable_read'
  | 'serializable';

/**
 * Database connection configuration
 * From Section 4.1: state_config
 */
export interface DatabaseConfig {
  readonly connectionId: string;
  readonly schemaNamespace: string;
  readonly isolationLevel: IsolationLevel;
  readonly vectorDimensions?: number;
}

/**
 * Memory type configuration
 * From Section 4.3: agent_manifest.memory_binding.working_memory.type
 */
export type MemoryType = 'in_memory' | 'redis' | 'postgres';

/**
 * Working memory configuration
 * From Section 4.3: agent_manifest.memory_binding.working_memory
 */
export interface WorkingMemoryConfig {
  readonly type: MemoryType;
  readonly maxItems: number;
  readonly ttlSeconds: number;
}

/**
 * Long-term memory configuration
 * From Section 4.3: agent_manifest.memory_binding.long_term_memory
 */
export interface LongTermMemoryConfig {
  readonly enabled: boolean;
  readonly vectorCollection?: string;
  readonly embeddingModel?: string;
  readonly similarityThreshold?: number;
}

// =============================================================================
// Concurrency and Isolation Types
// =============================================================================

export type ConcurrencyModel = 'sequential' | 'parallel' | 'bounded' | 'adaptive';

// =============================================================================
// Condition and Validation Types
// =============================================================================

/**
 * Result of a condition evaluation
 */
export interface ConditionResult {
  readonly satisfied: boolean;
  readonly condition: string;
  readonly evaluatedAt: ISO8601Timestamp;
  readonly context?: Record<string, unknown>;
  readonly message?: string;
}

/**
 * Pre/post condition specification
 */
export interface Condition {
  readonly id: string;
  readonly expression: string;
  readonly description?: string;
  readonly severity: 'error' | 'warning';
}

/**
 * Validation outcome
 */
export interface ValidationOutcome {
  readonly conditionId: string;
  readonly result: ConditionResult;
  readonly validatedAt: ISO8601Timestamp;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes from Section 4.2: Plan Validation Requirements
 */
export type PlanValidationErrorCode =
  | 'PLAN_SCHEMA_INVALID'
  | 'PLAN_ID_MALFORMED'
  | 'PLAN_AGENT_DUPLICATE'
  | 'PLAN_REF_INVALID'
  | 'PLAN_TIMEOUT_BOUNDS'
  | 'PLAN_LLM_UNAVAILABLE'
  | 'PLAN_DB_UNREACHABLE';

/**
 * Error severity levels
 */
export type ErrorSeverity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO';

/**
 * Structured error for plan validation
 */
export interface ValidationErrorData {
  readonly code: PlanValidationErrorCode;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly path?: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Simulation error interface
 */
export interface SimulationError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly stack?: string;
  readonly timestamp: ISO8601Timestamp;
}

/**
 * Execution error details
 * From Section 5.1: error_details[]
 */
export interface ExecutionErrorData {
  readonly errorId: UUID;
  readonly stepId?: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly stackTrace?: string;
  readonly recoveryAttempted: boolean;
  readonly recoveryResult?: string;
  readonly timestamp: ISO8601Timestamp;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VALIDATION_ERROR',
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'EXECUTION_ERROR',
    public readonly stepId?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly integrationId: string,
    public readonly code: string = 'INTEGRATION_ERROR',
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

// =============================================================================
// Telemetry Types
// =============================================================================

/**
 * Log levels
 * From Section 5.2: telemetry_stream.logs.levels
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/**
 * Span types for tracing
 * From Section 5.2: telemetry_stream.traces.span_types
 */
export type SpanType =
  | 'simulation_execution'
  | 'workflow_execution'
  | 'step_execution'
  | 'agent_invocation'
  | 'state_mutation'
  | 'llm_call'
  | 'integration_call';

/**
 * Structured log entry
 * From Section 5.2: telemetry_stream.logs
 */
export interface LogEntry {
  readonly timestamp: ISO8601Timestamp;
  readonly level: LogLevel;
  readonly executionId: UUID;
  readonly component: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Metric entry
 */
export interface MetricEntry {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly timestamp: ISO8601Timestamp;
  readonly labels?: Record<string, string>;
}

/**
 * Trace span
 */
export interface TraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly spanType: SpanType;
  readonly startTime: ISO8601Timestamp;
  readonly endTime?: ISO8601Timestamp;
  readonly durationMs?: DurationMs;
  readonly status: 'ok' | 'error';
  readonly attributes?: Record<string, string | number | boolean>;
}

// =============================================================================
// Agent Event Types
// =============================================================================

/**
 * Agent lifecycle event types
 * From Section 5.3: agent_lifecycle_events.event_types
 */
export type AgentEventType =
  | 'AGENT_SPAWNED'
  | 'AGENT_INITIALIZED'
  | 'AGENT_INVOKED'
  | 'AGENT_COMPLETED'
  | 'AGENT_FAILED'
  | 'AGENT_TIMEOUT'
  | 'AGENT_TERMINATED';

/**
 * Agent lifecycle event
 * From Section 5.3: agent_lifecycle_events.event_schema
 */
export interface AgentLifecycleEvent {
  readonly eventId: UUID;
  readonly eventType: AgentEventType;
  readonly timestamp: ISO8601Timestamp;
  readonly executionId: UUID;
  readonly agentId: string;
  readonly payload: {
    readonly invocationId?: string;
    readonly action?: string;
    readonly inputs?: Record<string, unknown>;
    readonly outputs?: Record<string, unknown>;
    readonly error?: ExecutionErrorData;
    readonly metrics?: {
      readonly durationMs: DurationMs;
      readonly tokensConsumed: number;
      readonly memoryUsedBytes: number;
    };
  };
}

// =============================================================================
// Audit Types
// =============================================================================

/**
 * Audit entry
 * From Section 5.5: audit_trail.entries[]
 */
export interface AuditEntry {
  readonly entryId: UUID;
  readonly sequence: number;
  readonly timestamp: ISO8601Timestamp;
  readonly actor: ActorType;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly beforeStateHash?: SHA256Hash;
  readonly afterStateHash?: SHA256Hash;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Audit trail integrity information
 * From Section 5.5: audit_trail.integrity
 */
export interface AuditIntegrity {
  readonly merkleRoot: SHA256Hash;
  readonly previousTrailHash?: SHA256Hash;
  readonly signature?: string;
}

/**
 * Audit compliance information
 * From Section 5.5: audit_trail.compliance
 */
export interface AuditCompliance {
  readonly retentionPolicy: string;
  readonly classification: string;
  readonly gdprRelevant: boolean;
}

// =============================================================================
// State Snapshot Types
// =============================================================================

/**
 * State snapshot type
 * From Section 5.4: state_snapshot.state_content.type
 */
export type SnapshotType = 'full' | 'incremental';

/**
 * State snapshot
 * From Section 5.4
 */
export interface StateSnapshot {
  readonly snapshotId: UUID;
  readonly executionId: UUID;
  readonly stepId?: string;
  readonly sequenceNumber: number;
  readonly timestamp: ISO8601Timestamp;
  readonly stateContent: {
    readonly type: SnapshotType;
    readonly data: Record<string, unknown>;
    readonly hash: SHA256Hash;
  };
  readonly storageLocation: {
    readonly database: string;
    readonly schema: string;
    readonly table: string;
    readonly primaryKey: string;
  };
  readonly vectorIndices?: ReadonlyArray<{
    readonly collection: string;
    readonly vectorCount: number;
    readonly dimension: number;
  }>;
}

// =============================================================================
// Integration Types
// =============================================================================

/**
 * Integration endpoint types
 * From Section 4.1: integration_endpoints[].type
 */
export type IntegrationEndpointType =
  | 'http'
  | 'grpc'
  | 'websocket'
  | 'message_queue';

/**
 * Message queue types
 * From Section 4.5: integration_endpoint.message_queue.type
 */
export type MessageQueueType = 'kafka' | 'rabbitmq' | 'sqs' | 'pubsub';

/**
 * HTTP methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * HTTP integration configuration
 * From Section 4.5: integration_endpoint.http
 */
export interface HttpIntegrationConfig {
  readonly url: URLTemplate;
  readonly method: HttpMethod;
  readonly headers?: Record<string, string>;
  readonly bodyTemplate?: string;
  readonly timeoutMs: DurationMs;
  readonly retryConfig?: RetryPolicy;
}

/**
 * gRPC integration configuration
 * From Section 4.5: integration_endpoint.grpc
 */
export interface GrpcIntegrationConfig {
  readonly host: string;
  readonly port: number;
  readonly service: string;
  readonly method: string;
  readonly protoDescriptor: string; // base64 encoded
}

/**
 * WebSocket integration configuration
 * From Section 4.5: integration_endpoint.websocket
 */
export interface WebSocketIntegrationConfig {
  readonly url: string;
  readonly protocols?: readonly string[];
  readonly heartbeatIntervalMs?: DurationMs;
}

/**
 * Message queue integration configuration
 * From Section 4.5: integration_endpoint.message_queue
 */
export interface MessageQueueIntegrationConfig {
  readonly type: MessageQueueType;
  readonly connectionConfig: Record<string, unknown>;
  readonly topicOrQueue: string;
  readonly consumerGroup?: string;
}

// =============================================================================
// Workflow Types (Control Flow)
// =============================================================================

/**
 * Workflow execution mode
 * From Section 4.4: workflow_definition.execution_mode
 */
export type WorkflowExecutionMode = 'sequential' | 'parallel' | 'dag';

/**
 * Workflow trigger type
 * From Section 4.1: workflows[].trigger.type
 */
export type WorkflowTriggerType = 'immediate' | 'scheduled' | 'event_driven';

/**
 * Control flow action for step completion
 * From Section 4.4: workflow_definition.steps[].control_flow
 */
export interface StepControlFlow {
  readonly onSuccess: string; // next step_id or "complete"
  readonly onFailure: string; // step_id or "abort" or "retry"
  readonly onTimeout: string; // step_id or "abort"
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Generic key-value metadata
 */
export type Metadata = Record<string, unknown>;

/**
 * Deep readonly type utility
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Nullable type utility
 */
export type Nullable<T> = T | null;

/**
 * Optional type utility
 */
export type Optional<T> = T | undefined;

/** Branded type for type-safe identifiers */
export type Brand<T, B> = T & { readonly __brand: B };

/** Branded UUID types for type safety */
export type ExecutionId = Brand<UUID, 'ExecutionId'>;
export type StepId = Brand<UUID, 'StepId'>;
export type AgentId = Brand<UUID, 'AgentId'>;
export type IntegrationId = Brand<UUID, 'IntegrationId'>;
export type CheckpointId = Brand<UUID, 'CheckpointId'>;
export type SnapshotId = Brand<UUID, 'SnapshotId'>;
export type InvocationId = Brand<UUID, 'InvocationId'>;
export type CallId = Brand<UUID, 'CallId'>;
export type MetricId = Brand<UUID, 'MetricId'>;
export type EventId = Brand<UUID, 'EventId'>;
export type SpanId = Brand<UUID, 'SpanId'>;
export type ArtifactId = Brand<UUID, 'ArtifactId'>;
