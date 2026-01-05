/**
 * Engine Integration Type Definitions for Agentics Simulation Runner
 *
 * These types define the interface between agentics-simulation-runner and
 * agentics-simulation-engine, the authoritative execution environment for
 * enterprise decision simulations.
 *
 * The engine provides:
 * - Deterministic execution with seed-based reproducibility
 * - Step-by-step timeline capture for audit and replay
 * - Artifact management for generated outputs
 * - Hash-based integrity verification for all outputs
 *
 * @module types/engine-types
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  SemanticVersion,
  ExecutionStatus,
  StepStatus,
  Metadata,
  LogLevel,
} from './common.js';

import type { SimulationPlan } from './simulation-plan.js';
import type { SimulationResult, StepResult } from './simulation-result.js';

// =============================================================================
// Engine Connection Configuration
// =============================================================================

/**
 * Transport protocol for engine communication
 */
export type EngineTransport = 'grpc' | 'http' | 'websocket' | 'local';

/**
 * Engine connection mode
 * - 'direct': Direct connection to engine process
 * - 'pool': Connection pool for high-throughput scenarios
 * - 'embedded': Engine runs in-process (for testing/development)
 */
export type EngineConnectionMode = 'direct' | 'pool' | 'embedded';

/**
 * TLS configuration for secure engine connections
 */
export interface EngineTLSConfig {
  /**
   * Whether TLS is enabled
   */
  readonly enabled: boolean;

  /**
   * Path to CA certificate file (PEM format)
   */
  readonly caCertPath?: string;

  /**
   * Path to client certificate file (PEM format) for mTLS
   */
  readonly clientCertPath?: string;

  /**
   * Path to client key file (PEM format) for mTLS
   */
  readonly clientKeyPath?: string;

  /**
   * Whether to skip certificate verification (NOT recommended for production)
   */
  readonly insecureSkipVerify?: boolean;

  /**
   * Server name override for certificate validation
   */
  readonly serverNameOverride?: string;
}

/**
 * Connection pool configuration
 */
export interface EnginePoolConfig {
  /**
   * Minimum number of connections in pool
   */
  readonly minConnections: number;

  /**
   * Maximum number of connections in pool
   */
  readonly maxConnections: number;

  /**
   * Connection idle timeout in milliseconds
   */
  readonly idleTimeoutMs: DurationMs;

  /**
   * Maximum time to wait for a connection in milliseconds
   */
  readonly acquireTimeoutMs: DurationMs;

  /**
   * Whether to validate connections before use
   */
  readonly validateOnBorrow: boolean;
}

/**
 * Configuration for connecting to agentics-simulation-engine
 * Supports multiple transport protocols and connection modes
 */
export interface SimulationEngineConfig {
  /**
   * Engine endpoint URL
   * Examples:
   * - grpc://localhost:50051
   * - http://engine.internal:8080
   * - ws://engine.internal:8081
   * - local:// (for embedded mode)
   */
  readonly endpoint: string;

  /**
   * Transport protocol to use
   */
  readonly transport: EngineTransport;

  /**
   * Connection mode
   */
  readonly connectionMode: EngineConnectionMode;

  /**
   * Connection timeout in milliseconds
   */
  readonly connectionTimeoutMs: DurationMs;

  /**
   * Request timeout in milliseconds
   */
  readonly requestTimeoutMs: DurationMs;

  /**
   * Maximum time to wait for engine response during execution
   */
  readonly executionTimeoutMs: DurationMs;

  /**
   * TLS configuration for secure connections
   */
  readonly tls?: EngineTLSConfig;

  /**
   * Connection pool configuration (only used when connectionMode is 'pool')
   */
  readonly pool?: EnginePoolConfig;

  /**
   * Engine version compatibility constraint
   * Uses semver range (e.g., ">=1.0.0 <2.0.0")
   */
  readonly engineVersionConstraint?: string;

  /**
   * Maximum retry attempts for transient failures
   */
  readonly maxRetries: number;

  /**
   * Base delay for exponential backoff (in milliseconds)
   */
  readonly retryBaseDelayMs: DurationMs;

  /**
   * Health check interval in milliseconds (0 to disable)
   */
  readonly healthCheckIntervalMs: DurationMs;

  /**
   * Whether to enable execution streaming
   * When enabled, timeline entries are streamed during execution
   */
  readonly enableStreaming: boolean;

  /**
   * Additional engine-specific options
   */
  readonly options?: Metadata;
}

// =============================================================================
// Engine Invocation Request
// =============================================================================

/**
 * Execution mode for the engine
 */
export type EngineExecutionMode =
  | 'full'          // Complete execution
  | 'dry_run'       // Validate plan without execution
  | 'step_through'  // Pause after each step
  | 'replay';       // Replay from recorded interactions

/**
 * Streaming configuration for real-time execution updates
 */
export interface EngineStreamingConfig {
  /**
   * Whether to stream timeline entries during execution
   */
  readonly streamTimeline: boolean;

  /**
   * Whether to stream log entries during execution
   */
  readonly streamLogs: boolean;

  /**
   * Whether to stream metrics during execution
   */
  readonly streamMetrics: boolean;

  /**
   * Buffering strategy for streamed data
   */
  readonly bufferStrategy: 'unbuffered' | 'line_buffered' | 'block_buffered';

  /**
   * Buffer flush interval in milliseconds (for buffered strategies)
   */
  readonly flushIntervalMs?: DurationMs;
}

/**
 * Checkpoint behavior configuration
 */
export interface EngineCheckpointConfig {
  /**
   * Whether to enable automatic checkpointing
   */
  readonly enabled: boolean;

  /**
   * Checkpoint interval (number of steps between checkpoints)
   */
  readonly intervalSteps: number;

  /**
   * Whether to checkpoint on failure
   */
  readonly checkpointOnFailure: boolean;

  /**
   * Maximum checkpoints to retain
   */
  readonly maxCheckpoints: number;
}

/**
 * Request format for invoking the simulation engine
 * Contains all information needed to execute a simulation
 */
export interface EngineInvocationRequest {
  /**
   * Unique invocation identifier (UUID v4)
   * Used for tracking and correlation
   */
  readonly invocationId: UUID;

  /**
   * Request timestamp
   */
  readonly requestedAt: ISO8601Timestamp;

  /**
   * The simulation plan to execute
   * Must be a valid, complete SimulationPlan
   */
  readonly plan: SimulationPlan;

  /**
   * Execution mode
   */
  readonly executionMode: EngineExecutionMode;

  /**
   * Deterministic seed for reproducible execution
   * Required for deterministic replay
   */
  readonly seed: number;

  /**
   * Priority level (higher = more urgent)
   * Range: 1-10, default 5
   */
  readonly priority?: number;

  /**
   * Deadline by which execution must complete
   * Engine will abort if deadline is exceeded
   */
  readonly deadline?: ISO8601Timestamp;

  /**
   * Streaming configuration
   */
  readonly streaming?: EngineStreamingConfig;

  /**
   * Checkpoint configuration
   */
  readonly checkpointing?: EngineCheckpointConfig;

  /**
   * Resume from a specific checkpoint (if replaying or resuming)
   */
  readonly resumeFromCheckpoint?: {
    readonly checkpointId: UUID;
    readonly checkpointHash: SHA256Hash;
  };

  /**
   * Recorded interactions for replay mode
   * Contains captured LLM and integration responses
   */
  readonly recordedInteractions?: {
    readonly storageLocation: string;
    readonly interactionsHash: SHA256Hash;
  };

  /**
   * Caller identification for audit
   */
  readonly caller: {
    readonly callerId: string;
    readonly callerType: 'user' | 'service' | 'scheduler';
    readonly correlationId?: string;
  };

  /**
   * Additional request metadata
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Engine Timeline Types
// =============================================================================

/**
 * Timeline entry type classification
 */
export type TimelineEntryType =
  | 'EXECUTION_START'
  | 'EXECUTION_END'
  | 'STEP_START'
  | 'STEP_END'
  | 'AGENT_INVOKE'
  | 'AGENT_RESPONSE'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
  | 'STATE_READ'
  | 'STATE_WRITE'
  | 'INTEGRATION_CALL'
  | 'INTEGRATION_RESPONSE'
  | 'CHECKPOINT_CREATE'
  | 'CHECKPOINT_RESTORE'
  | 'ERROR'
  | 'WARNING'
  | 'CUSTOM';

/**
 * Timeline entry for step-by-step execution history
 * Captures every significant event during simulation execution
 */
export interface EngineTimelineEntry {
  /**
   * Unique entry identifier
   */
  readonly entryId: UUID;

  /**
   * Entry sequence number (monotonically increasing)
   */
  readonly sequenceNumber: number;

  /**
   * Entry type classification
   */
  readonly entryType: TimelineEntryType;

  /**
   * High-precision timestamp when entry was created
   */
  readonly timestamp: ISO8601Timestamp;

  /**
   * Elapsed time since execution start (in milliseconds)
   */
  readonly elapsedMs: DurationMs;

  /**
   * Associated step ID (if applicable)
   */
  readonly stepId?: string;

  /**
   * Associated agent ID (if applicable)
   */
  readonly agentId?: string;

  /**
   * Entry title/summary
   */
  readonly title: string;

  /**
   * Detailed entry description
   */
  readonly description?: string;

  /**
   * Entry-specific data payload
   * Structure depends on entryType
   */
  readonly data: TimelineEntryData;

  /**
   * State hash before this entry
   */
  readonly preStateHash?: SHA256Hash;

  /**
   * State hash after this entry
   */
  readonly postStateHash?: SHA256Hash;

  /**
   * Duration of the operation (if applicable)
   */
  readonly durationMs?: DurationMs;

  /**
   * Parent entry ID (for nested operations)
   */
  readonly parentEntryId?: UUID;

  /**
   * Tags for categorization
   */
  readonly tags?: readonly string[];
}

/**
 * Timeline entry data payload types
 * Discriminated union based on entry type
 */
export type TimelineEntryData =
  | ExecutionStartData
  | ExecutionEndData
  | StepStartData
  | StepEndData
  | AgentInvokeData
  | AgentResponseData
  | LLMRequestData
  | LLMResponseData
  | StateReadData
  | StateWriteData
  | IntegrationCallData
  | IntegrationResponseData
  | CheckpointData
  | ErrorData
  | WarningData
  | CustomData;

/**
 * Data for EXECUTION_START entry
 */
export interface ExecutionStartData {
  readonly type: 'EXECUTION_START';
  readonly planId: UUID;
  readonly planHash: SHA256Hash;
  readonly seed: number;
  readonly executionMode: EngineExecutionMode;
  readonly totalSteps: number;
}

/**
 * Data for EXECUTION_END entry
 */
export interface ExecutionEndData {
  readonly type: 'EXECUTION_END';
  readonly status: ExecutionStatus;
  readonly totalDurationMs: DurationMs;
  readonly stepsCompleted: number;
  readonly stepsFailed: number;
  readonly stepsSkipped: number;
  readonly finalStateHash: SHA256Hash;
}

/**
 * Data for STEP_START entry
 */
export interface StepStartData {
  readonly type: 'STEP_START';
  readonly stepId: string;
  readonly stepType: string;
  readonly stepName?: string;
  readonly inputsHash: SHA256Hash;
}

/**
 * Data for STEP_END entry
 */
export interface StepEndData {
  readonly type: 'STEP_END';
  readonly stepId: string;
  readonly status: StepStatus;
  readonly outputsHash?: SHA256Hash;
  readonly errorCode?: string;
}

/**
 * Data for AGENT_INVOKE entry
 */
export interface AgentInvokeData {
  readonly type: 'AGENT_INVOKE';
  readonly agentId: string;
  readonly action: string;
  readonly inputsHash: SHA256Hash;
}

/**
 * Data for AGENT_RESPONSE entry
 */
export interface AgentResponseData {
  readonly type: 'AGENT_RESPONSE';
  readonly agentId: string;
  readonly outputsHash: SHA256Hash;
  readonly tokensConsumed: number;
}

/**
 * Data for LLM_REQUEST entry
 */
export interface LLMRequestData {
  readonly type: 'LLM_REQUEST';
  readonly provider: string;
  readonly model: string;
  readonly promptHash: SHA256Hash;
  readonly promptTokens: number;
}

/**
 * Data for LLM_RESPONSE entry
 */
export interface LLMResponseData {
  readonly type: 'LLM_RESPONSE';
  readonly provider: string;
  readonly model: string;
  readonly responseHash: SHA256Hash;
  readonly completionTokens: number;
  readonly finishReason: string;
}

/**
 * Data for STATE_READ entry
 */
export interface StateReadData {
  readonly type: 'STATE_READ';
  readonly keys: readonly string[];
  readonly valuesHash: SHA256Hash;
}

/**
 * Data for STATE_WRITE entry
 */
export interface StateWriteData {
  readonly type: 'STATE_WRITE';
  readonly keys: readonly string[];
  readonly previousHash: SHA256Hash;
  readonly newHash: SHA256Hash;
}

/**
 * Data for INTEGRATION_CALL entry
 */
export interface IntegrationCallData {
  readonly type: 'INTEGRATION_CALL';
  readonly integrationId: string;
  readonly endpoint: string;
  readonly method?: string;
  readonly requestHash: SHA256Hash;
}

/**
 * Data for INTEGRATION_RESPONSE entry
 */
export interface IntegrationResponseData {
  readonly type: 'INTEGRATION_RESPONSE';
  readonly integrationId: string;
  readonly statusCode?: number;
  readonly responseHash: SHA256Hash;
  readonly usedMock: boolean;
}

/**
 * Data for CHECKPOINT_CREATE and CHECKPOINT_RESTORE entries
 */
export interface CheckpointData {
  readonly type: 'CHECKPOINT_CREATE' | 'CHECKPOINT_RESTORE';
  readonly checkpointId: UUID;
  readonly checkpointHash: SHA256Hash;
  readonly stepId?: string;
  readonly label?: string;
}

/**
 * Data for ERROR entry
 */
export interface ErrorData {
  readonly type: 'ERROR';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly recoverable: boolean;
  readonly stackTrace?: string;
}

/**
 * Data for WARNING entry
 */
export interface WarningData {
  readonly type: 'WARNING';
  readonly warningCode: string;
  readonly warningMessage: string;
}

/**
 * Data for CUSTOM entry
 */
export interface CustomData {
  readonly type: 'CUSTOM';
  readonly customType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Complete execution timeline
 * Ordered collection of all timeline entries
 */
export interface EngineTimeline {
  /**
   * Timeline identifier
   */
  readonly timelineId: UUID;

  /**
   * Execution ID this timeline belongs to
   */
  readonly executionId: UUID;

  /**
   * Timeline entries in chronological order
   */
  readonly entries: readonly EngineTimelineEntry[];

  /**
   * Total number of entries
   */
  readonly entryCount: number;

  /**
   * First entry timestamp
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * Last entry timestamp
   */
  readonly endedAt?: ISO8601Timestamp;

  /**
   * Total execution duration
   */
  readonly totalDurationMs: DurationMs;

  /**
   * Merkle root of all entry hashes (for integrity verification)
   */
  readonly merkleRoot: SHA256Hash;

  /**
   * Whether timeline is complete (no missing entries)
   */
  readonly isComplete: boolean;
}

// =============================================================================
// Engine Artifact Types
// =============================================================================

/**
 * Artifact type classification
 */
export type EngineArtifactType =
  | 'state_snapshot'       // Point-in-time state capture
  | 'checkpoint'           // Resumable checkpoint
  | 'timeline_export'      // Exported timeline data
  | 'log_bundle'           // Aggregated log entries
  | 'trace_export'         // OpenTelemetry trace export
  | 'llm_transcript'       // LLM conversation transcript
  | 'integration_recording'// Recorded integration calls
  | 'generated_output'     // Any output generated by agents
  | 'report'               // Analysis or summary report
  | 'custom';              // Custom artifact type

/**
 * Artifact storage location types
 */
export type ArtifactStorageType = 'inline' | 'file' | 'database' | 'object_store';

/**
 * Artifact content encoding
 */
export type ArtifactEncoding = 'utf-8' | 'base64' | 'binary' | 'gzip';

/**
 * Artifact storage location reference
 */
export interface ArtifactStorageLocation {
  /**
   * Storage type
   */
  readonly storageType: ArtifactStorageType;

  /**
   * Storage-specific location path/URI
   */
  readonly path: string;

  /**
   * For inline storage: the actual content
   * For other types: undefined
   */
  readonly inlineContent?: string;

  /**
   * Content encoding
   */
  readonly encoding: ArtifactEncoding;

  /**
   * For database storage: table/collection name
   */
  readonly table?: string;

  /**
   * For database storage: primary key
   */
  readonly primaryKey?: string;

  /**
   * For object store: bucket name
   */
  readonly bucket?: string;

  /**
   * Expiration time for temporary artifacts
   */
  readonly expiresAt?: ISO8601Timestamp;
}

/**
 * Artifact metadata and content reference
 * Represents any output generated during simulation execution
 */
export interface EngineArtifact {
  /**
   * Unique artifact identifier
   */
  readonly artifactId: UUID;

  /**
   * Artifact type classification
   */
  readonly artifactType: EngineArtifactType;

  /**
   * Human-readable artifact name
   */
  readonly name: string;

  /**
   * Artifact description
   */
  readonly description?: string;

  /**
   * MIME content type
   */
  readonly contentType: string;

  /**
   * Artifact size in bytes
   */
  readonly sizeBytes: number;

  /**
   * SHA-256 hash of artifact content
   * Used for integrity verification
   */
  readonly contentHash: SHA256Hash;

  /**
   * When artifact was created
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * Associated step ID (if applicable)
   */
  readonly stepId?: string;

  /**
   * Associated agent ID (if applicable)
   */
  readonly agentId?: string;

  /**
   * Storage location reference
   */
  readonly storage: ArtifactStorageLocation;

  /**
   * Whether artifact is marked for retention
   */
  readonly retain: boolean;

  /**
   * Retention policy (if applicable)
   */
  readonly retentionPolicy?: string;

  /**
   * Additional artifact metadata
   */
  readonly metadata?: Metadata;

  /**
   * Related artifact IDs
   */
  readonly relatedArtifacts?: readonly UUID[];
}

// =============================================================================
// Engine Execution Result
// =============================================================================

/**
 * Deterministic output capture
 * Contains hash-verified outputs for reproducibility
 */
export interface DeterministicOutputs {
  /**
   * Seed used for this execution
   */
  readonly seed: number;

  /**
   * Hash of the normalized final state
   */
  readonly finalStateHash: SHA256Hash;

  /**
   * Hash of the complete timeline
   */
  readonly timelineHash: SHA256Hash;

  /**
   * Hash of all artifacts combined
   */
  readonly artifactsHash: SHA256Hash;

  /**
   * Combined hash of all outputs (for quick verification)
   */
  readonly combinedOutputHash: SHA256Hash;

  /**
   * PRNG state at end of execution (for verification)
   */
  readonly finalPrngState?: string;

  /**
   * Whether execution was fully deterministic
   * May be false if non-deterministic operations occurred
   */
  readonly isDeterministic: boolean;

  /**
   * Non-deterministic operations detected (if any)
   */
  readonly nonDeterministicOperations?: readonly string[];
}

/**
 * Engine health and performance metrics
 */
export interface EngineMetrics {
  /**
   * Total wall-clock execution time
   */
  readonly wallClockMs: DurationMs;

  /**
   * Total CPU time consumed
   */
  readonly cpuTimeMs: DurationMs;

  /**
   * Peak memory usage in bytes
   */
  readonly peakMemoryBytes: number;

  /**
   * Total tokens consumed across all LLM calls
   */
  readonly totalTokensConsumed: number;

  /**
   * Number of LLM calls made
   */
  readonly llmCallCount: number;

  /**
   * Number of integration calls made
   */
  readonly integrationCallCount: number;

  /**
   * Number of state mutations performed
   */
  readonly stateMutationCount: number;

  /**
   * Number of checkpoints created
   */
  readonly checkpointCount: number;

  /**
   * Average step duration
   */
  readonly avgStepDurationMs: DurationMs;

  /**
   * P95 step duration
   */
  readonly p95StepDurationMs: DurationMs;

  /**
   * Engine version that executed the simulation
   */
  readonly engineVersion: SemanticVersion;
}

/**
 * Complete result from engine execution
 * Contains all outputs, timeline, and artifacts for audit and replay
 */
export interface EngineExecutionResult {
  /**
   * Result identifier
   */
  readonly resultId: UUID;

  /**
   * Original invocation ID
   */
  readonly invocationId: UUID;

  /**
   * Engine execution ID (may differ from resultId)
   */
  readonly engineExecutionId: UUID;

  /**
   * Result schema version
   */
  readonly version: SemanticVersion;

  /**
   * When execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total execution duration
   */
  readonly durationMs: DurationMs;

  /**
   * Final execution status
   */
  readonly status: ExecutionStatus;

  // =========================================================================
  // Plan Reference
  // =========================================================================

  /**
   * Reference to the executed plan
   */
  readonly planReference: {
    readonly planId: UUID;
    readonly planVersion: SemanticVersion;
    readonly planHash: SHA256Hash;
  };

  // =========================================================================
  // Deterministic Outputs
  // =========================================================================

  /**
   * Deterministic output hashes for reproducibility verification
   */
  readonly deterministicOutputs: DeterministicOutputs;

  // =========================================================================
  // Timeline Data
  // =========================================================================

  /**
   * Complete execution timeline
   */
  readonly timeline: EngineTimeline;

  // =========================================================================
  // Artifacts
  // =========================================================================

  /**
   * All artifacts produced during execution
   */
  readonly artifacts: readonly EngineArtifact[];

  // =========================================================================
  // Step Results
  // =========================================================================

  /**
   * Per-step execution results
   * Compatible with SimulationResult.stepResults
   */
  readonly stepResults: readonly StepResult[];

  // =========================================================================
  // Final State
  // =========================================================================

  /**
   * Reference to final state snapshot
   */
  readonly finalState: {
    readonly snapshotId: UUID;
    readonly stateHash: SHA256Hash;
    readonly storageLocation: string;
    readonly keySummary?: Record<string, unknown>;
  };

  // =========================================================================
  // Metrics
  // =========================================================================

  /**
   * Engine performance metrics
   */
  readonly metrics: EngineMetrics;

  // =========================================================================
  // Errors
  // =========================================================================

  /**
   * Errors encountered during execution (if any)
   */
  readonly errors: readonly {
    readonly errorId: UUID;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly stepId?: string;
    readonly agentId?: string;
    readonly timestamp: ISO8601Timestamp;
    readonly recoverable: boolean;
    readonly recovered: boolean;
  }[];

  // =========================================================================
  // Integrity
  // =========================================================================

  /**
   * SHA-256 hash of the entire result (excluding this field)
   */
  readonly resultHash: SHA256Hash;

  /**
   * Optional cryptographic signature
   */
  readonly signature?: string;
}

// =============================================================================
// Engine Adapter Interface
// =============================================================================

/**
 * Streaming callback for timeline entries
 */
export type TimelineStreamCallback = (entry: EngineTimelineEntry) => void;

/**
 * Streaming callback for log entries
 */
export type LogStreamCallback = (
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
) => void;

/**
 * Progress callback for execution updates
 */
export interface ExecutionProgress {
  readonly executionId: UUID;
  readonly status: ExecutionStatus;
  readonly currentStep?: string;
  readonly stepsCompleted: number;
  readonly totalSteps: number;
  readonly elapsedMs: DurationMs;
  readonly estimatedRemainingMs?: DurationMs;
}

export type ProgressCallback = (progress: ExecutionProgress) => void;

/**
 * Engine adapter interface for simulation execution
 * Abstracts the connection and communication with agentics-simulation-engine
 */
export interface EngineAdapter {
  /**
   * Connect to the simulation engine
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the simulation engine
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected to the engine
   */
  isConnected(): boolean;

  /**
   * Get engine version and capabilities
   */
  getEngineInfo(): Promise<{
    readonly version: SemanticVersion;
    readonly capabilities: readonly string[];
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
  }>;

  /**
   * Execute a simulation plan
   */
  execute(request: EngineInvocationRequest): Promise<EngineExecutionResult>;

  /**
   * Execute with streaming callbacks
   */
  executeWithStreaming(
    request: EngineInvocationRequest,
    callbacks: {
      onTimeline?: TimelineStreamCallback;
      onLog?: LogStreamCallback;
      onProgress?: ProgressCallback;
    }
  ): Promise<EngineExecutionResult>;

  /**
   * Cancel an in-progress execution
   */
  cancel(executionId: UUID): Promise<boolean>;

  /**
   * Get execution status
   */
  getStatus(executionId: UUID): Promise<ExecutionProgress>;

  /**
   * Validate a plan without executing
   */
  validatePlan(plan: SimulationPlan): Promise<{
    readonly valid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
  }>;
}

// =============================================================================
// Conversion Utilities Interface
// =============================================================================

/**
 * Options for converting engine result to simulation result
 */
export interface ResultConversionOptions {
  /**
   * Whether to include full timeline in result
   */
  readonly includeTimeline: boolean;

  /**
   * Whether to include all artifacts
   */
  readonly includeArtifacts: boolean;

  /**
   * Maximum step results to include
   */
  readonly maxStepResults?: number;

  /**
   * Whether to compute additional summary statistics
   */
  readonly computeSummary: boolean;
}

/**
 * Converter interface for engine results
 */
export interface EngineResultConverter {
  /**
   * Convert EngineExecutionResult to SimulationResult
   * Makes engine outputs compatible with existing exporters
   */
  toSimulationResult(
    engineResult: EngineExecutionResult,
    options?: ResultConversionOptions
  ): SimulationResult;

  /**
   * Extract timeline as standalone artifact
   */
  extractTimeline(engineResult: EngineExecutionResult): EngineTimeline;

  /**
   * Extract artifacts by type
   */
  extractArtifactsByType(
    engineResult: EngineExecutionResult,
    artifactType: EngineArtifactType
  ): readonly EngineArtifact[];
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for EngineExecutionResult
 */
export function isEngineExecutionResult(
  result: unknown
): result is EngineExecutionResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'engineExecutionId' in result &&
    'timeline' in result &&
    'deterministicOutputs' in result
  );
}

/**
 * Type guard for checking if timeline entry is an error
 */
export function isErrorTimelineEntry(
  entry: EngineTimelineEntry
): entry is EngineTimelineEntry & { data: ErrorData } {
  return entry.entryType === 'ERROR';
}

/**
 * Type guard for checking if timeline entry is step-related
 */
export function isStepTimelineEntry(
  entry: EngineTimelineEntry
): boolean {
  return (
    entry.entryType === 'STEP_START' ||
    entry.entryType === 'STEP_END'
  );
}

/**
 * Type guard for checking if artifact is a checkpoint
 */
export function isCheckpointArtifact(
  artifact: EngineArtifact
): boolean {
  return artifact.artifactType === 'checkpoint';
}

/**
 * Type guard for deterministic execution result
 */
export function isDeterministicResult(
  result: EngineExecutionResult
): boolean {
  return (
    result.deterministicOutputs.isDeterministic &&
    (result.deterministicOutputs.nonDeterministicOperations?.length ?? 0) === 0
  );
}
