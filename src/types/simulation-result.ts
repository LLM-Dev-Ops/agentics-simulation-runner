/**
 * SimulationResult Type Definitions for Agentics Simulation Runner
 *
 * The SimulationResult is the immutable output artifact produced by
 * the simulation runner after executing a SimulationPlan.
 *
 * Based on SPARC Specification Section 5.1.
 *
 * @module types/simulation-result
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  SemanticVersion,
  ExecutionStatus,
  StepStatus,
  AuditEntry,
  AuditIntegrity,
  AuditCompliance,
  MetricEntry,
  TraceSpan,
  AgentLifecycleEvent,
  LogEntry,
  ExecutionErrorData,
  ConditionResult,
  StateSnapshot,
  Metadata,
} from './common.js';

import type { WorkflowStepResult } from './workflow.js';

// =============================================================================
// Execution Metadata
// =============================================================================

/**
 * Execution metadata
 * From Section 5.1: simulation_result.execution_metadata
 */
export interface ExecutionMetadata {
  /**
   * Unique result identifier (UUID v4)
   */
  readonly resultId: UUID;

  /**
   * Reference to the input plan ID
   */
  readonly planId: UUID;

  /**
   * Version of the executed plan
   */
  readonly planVersion: SemanticVersion;

  /**
   * When execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total execution duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Final execution status
   */
  readonly status: ExecutionStatus;

  /**
   * Who/what triggered the execution
   */
  readonly executedBy?: string;

  /**
   * Execution environment information
   */
  readonly environment?: {
    readonly hostname: string;
    readonly version: string;
    readonly region?: string;
  };
}

// =============================================================================
// Execution Summary
// =============================================================================

/**
 * Execution summary statistics
 * From Section 5.1: simulation_result.execution_summary
 */
export interface ExecutionSummary {
  /**
   * Total number of steps executed
   */
  readonly totalStepsExecuted: number;

  /**
   * Number of successful steps
   */
  readonly successfulSteps: number;

  /**
   * Number of failed steps
   */
  readonly failedSteps: number;

  /**
   * Number of skipped steps
   */
  readonly skippedSteps: number;

  /**
   * Total agent invocations across all agents
   */
  readonly totalAgentInvocations: number;

  /**
   * Total state mutations performed
   */
  readonly totalStateMutations: number;

  /**
   * Total events emitted
   */
  readonly totalEventsEmitted: number;

  /**
   * Total tokens consumed by all agents
   */
  readonly totalTokensConsumed?: number;

  /**
   * Deterministic seed used (if deterministic execution)
   */
  readonly deterministicSeed?: number;

  /**
   * Number of checkpoints created
   */
  readonly checkpointsCreated?: number;
}

// =============================================================================
// Final State
// =============================================================================

/**
 * Final state reference
 * From Section 5.1: simulation_result.final_state
 */
export interface FinalState {
  /**
   * Snapshot identifier
   */
  readonly snapshotId: UUID;

  /**
   * SHA-256 hash of the final state
   */
  readonly stateHash: SHA256Hash;

  /**
   * Location reference in ruvvector-postgres
   */
  readonly stateLocation: string;

  /**
   * Key state values (summary, not full state)
   */
  readonly keySummary?: Record<string, unknown>;

  /**
   * Vector memory statistics
   */
  readonly vectorMemoryStats?: {
    readonly totalVectors: number;
    readonly collections: readonly string[];
    readonly dimensions: number;
  };
}

// =============================================================================
// Agent Summary
// =============================================================================

/**
 * Per-agent execution summary
 * From Section 5.1: simulation_result.agents_summary[]
 */
export interface AgentSummary {
  /**
   * Agent identifier
   */
  readonly agentId: string;

  /**
   * Number of times agent was invoked
   */
  readonly invocationCount: number;

  /**
   * Total tokens consumed by this agent
   */
  readonly totalTokensConsumed: number;

  /**
   * Average invocation latency in milliseconds
   */
  readonly averageLatencyMs: number;

  /**
   * Minimum invocation latency
   */
  readonly minLatencyMs?: number;

  /**
   * Maximum invocation latency
   */
  readonly maxLatencyMs?: number;

  /**
   * Number of errors encountered
   */
  readonly errorCount: number;

  /**
   * Number of retries performed
   */
  readonly retryCount?: number;

  /**
   * Final agent state summary
   */
  readonly finalState?: Record<string, unknown>;

  /**
   * Actions performed by this agent
   */
  readonly actionsSummary?: Record<string, number>;
}

// =============================================================================
// Step Results
// =============================================================================

/**
 * Extended step result with full details
 * From Section 5.1: simulation_result.step_results[]
 */
export interface StepResult extends WorkflowStepResult {
  /**
   * Sequence number in execution order
   */
  readonly sequenceNumber: number;

  /**
   * State hash before step execution
   */
  readonly preStateHash?: SHA256Hash;

  /**
   * State hash after step execution
   */
  readonly postStateHash?: SHA256Hash;

  /**
   * LLM interaction details (if agent invocation)
   */
  readonly llmInteraction?: {
    readonly provider: string;
    readonly model: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
    readonly latencyMs: DurationMs;
  };

  /**
   * Memory operations performed
   */
  readonly memoryOperations?: {
    readonly reads: number;
    readonly writes: number;
    readonly vectorQueries: number;
    readonly vectorInserts: number;
  };
}

// =============================================================================
// Integration Observations
// =============================================================================

/**
 * Integration call observation
 */
export interface IntegrationObservation {
  /**
   * Integration endpoint ID
   */
  readonly integrationId: string;

  /**
   * Step that triggered the call
   */
  readonly stepId: string;

  /**
   * When the call was made
   */
  readonly calledAt: ISO8601Timestamp;

  /**
   * Call duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Whether the call succeeded
   */
  readonly success: boolean;

  /**
   * Request summary (sanitized)
   */
  readonly requestSummary?: {
    readonly method?: string;
    readonly url?: string;
    readonly contentType?: string;
    readonly bodySize?: number;
  };

  /**
   * Response summary
   */
  readonly responseSummary?: {
    readonly statusCode?: number;
    readonly contentType?: string;
    readonly bodySize?: number;
  };

  /**
   * Error details if failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };

  /**
   * Whether mock was used
   */
  readonly usedMock: boolean;
}

// =============================================================================
// Telemetry
// =============================================================================

/**
 * Telemetry data collected during execution
 * From Section 5.2
 */
export interface ExecutionTelemetry {
  /**
   * Metrics collected during execution
   */
  readonly metrics: readonly MetricEntry[];

  /**
   * Events emitted during execution
   */
  readonly events: readonly AgentLifecycleEvent[];

  /**
   * Trace spans (if tracing enabled)
   */
  readonly traces?: readonly TraceSpan[];

  /**
   * Log entries (subset, not complete logs)
   */
  readonly logsSummary?: {
    readonly totalEntries: number;
    readonly byLevel: Record<string, number>;
    readonly errors: readonly LogEntry[];
  };

  /**
   * Performance metrics summary
   */
  readonly performanceSummary?: {
    readonly avgStepLatencyMs: number;
    readonly p50StepLatencyMs: number;
    readonly p95StepLatencyMs: number;
    readonly p99StepLatencyMs: number;
    readonly peakMemoryBytes: number;
    readonly avgCpuPercent: number;
  };
}

// =============================================================================
// Validation Outcomes
// =============================================================================

/**
 * Validation outcome summary
 */
export interface ValidationOutcomes {
  /**
   * Precondition validation results
   */
  readonly preConditions: readonly ConditionResult[];

  /**
   * Postcondition validation results
   */
  readonly postConditions: readonly ConditionResult[];

  /**
   * Invariant check results (any violations)
   */
  readonly invariantViolations: readonly {
    readonly invariantId: string;
    readonly violatedAt: ISO8601Timestamp;
    readonly stepId?: string;
    readonly message: string;
  }[];

  /**
   * Overall validation passed
   */
  readonly allPassed: boolean;
}

// =============================================================================
// Artifacts
// =============================================================================

/**
 * Artifact produced during execution
 */
export interface ExecutionArtifact {
  /**
   * Artifact identifier
   */
  readonly artifactId: UUID;

  /**
   * Artifact type
   */
  readonly type: 'state_snapshot' | 'checkpoint' | 'log_bundle' | 'trace_export' | 'custom';

  /**
   * Artifact name
   */
  readonly name: string;

  /**
   * Storage location
   */
  readonly location: string;

  /**
   * Artifact size in bytes
   */
  readonly sizeBytes: number;

  /**
   * SHA-256 hash of artifact content
   */
  readonly hash: SHA256Hash;

  /**
   * When artifact was created
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * Content type (MIME)
   */
  readonly contentType: string;

  /**
   * Artifact metadata
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Reproducibility Proof
// =============================================================================

/**
 * Proof of reproducibility for deterministic execution
 * From Section 7.1 REP-001
 */
export interface ReproducibilityProof {
  /**
   * Whether execution was deterministic
   */
  readonly deterministic: boolean;

  /**
   * Seed used for PRNG
   */
  readonly seed: number;

  /**
   * Hash of normalized result (excluding timestamps/UUIDs)
   */
  readonly normalizedResultHash: SHA256Hash;

  /**
   * External interactions recorded for replay
   */
  readonly recordedInteractions?: {
    readonly llmCalls: number;
    readonly integrationCalls: number;
    readonly storageLocation: string;
  };

  /**
   * Conditions for reproducibility
   */
  readonly conditions: readonly string[];

  /**
   * Verification instructions
   */
  readonly verificationMethod: string;
}

// =============================================================================
// Audit Trail
// =============================================================================

/**
 * Complete audit trail for the execution
 * From Section 5.5
 */
export interface ExecutionAuditTrail {
  /**
   * Audit trail identifier
   */
  readonly trailId: UUID;

  /**
   * Execution ID this trail belongs to
   */
  readonly executionId: UUID;

  /**
   * Audit entries
   */
  readonly entries: readonly AuditEntry[];

  /**
   * Integrity information
   */
  readonly integrity: AuditIntegrity;

  /**
   * Compliance information
   */
  readonly compliance?: AuditCompliance;

  /**
   * Total entry count (entries may be paginated)
   */
  readonly totalEntries: number;
}

// =============================================================================
// SimulationResult
// =============================================================================

/**
 * Complete SimulationResult artifact
 *
 * This is the immutable output of the Simulation Runner. It captures
 * everything about the execution for audit, reproducibility, and analysis.
 *
 * From SPARC Specification Section 5.1
 */
export interface SimulationResult {
  /**
   * Result schema version
   */
  readonly version: SemanticVersion;

  // =========================================================================
  // Result Identity
  // =========================================================================

  /**
   * Unique result identifier (UUID v4)
   */
  readonly resultId: UUID;

  /**
   * Result version
   */
  readonly resultVersion: SemanticVersion;

  /**
   * SHA-256 hash of the result content
   */
  readonly resultHash: SHA256Hash;

  /**
   * When execution completed
   */
  readonly executedAt: ISO8601Timestamp;

  /**
   * Who/what executed the simulation
   */
  readonly executedBy: string;

  /**
   * Reference to source plan
   */
  readonly sourcePlan: {
    readonly planId: UUID;
    readonly planVersion: SemanticVersion;
    readonly planHash: SHA256Hash;
  };

  // =========================================================================
  // Execution Information
  // =========================================================================

  /**
   * Execution metadata
   */
  readonly execution: ExecutionMetadata;

  /**
   * Execution summary statistics
   */
  readonly summary: ExecutionSummary;

  /**
   * Final state reference
   */
  readonly finalState: FinalState;

  // =========================================================================
  // Detailed Results
  // =========================================================================

  /**
   * Step-by-step results
   */
  readonly stepResults: readonly StepResult[];

  /**
   * Per-agent summaries
   */
  readonly agentObservations: readonly AgentSummary[];

  /**
   * Integration call observations
   */
  readonly integrationObservations: readonly IntegrationObservation[];

  // =========================================================================
  // Telemetry
  // =========================================================================

  /**
   * Telemetry data
   */
  readonly telemetry: ExecutionTelemetry;

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validation outcomes
   */
  readonly validationOutcomes: ValidationOutcomes;

  // =========================================================================
  // Errors
  // =========================================================================

  /**
   * Error details (if any errors occurred)
   */
  readonly errors: readonly ExecutionErrorData[];

  // =========================================================================
  // Artifacts
  // =========================================================================

  /**
   * Artifacts produced during execution
   */
  readonly artifacts: readonly ExecutionArtifact[];

  // =========================================================================
  // Reproducibility
  // =========================================================================

  /**
   * Reproducibility proof
   */
  readonly reproducibilityProof?: ReproducibilityProof;

  // =========================================================================
  // Audit
  // =========================================================================

  /**
   * Audit trail summary (full trail available separately)
   */
  readonly auditTrail: {
    readonly trailId: UUID;
    readonly entryCount: number;
    readonly merkleRoot: SHA256Hash;
    readonly firstEntryAt: ISO8601Timestamp;
    readonly lastEntryAt: ISO8601Timestamp;
  };

  /**
   * Integrity checksum for the entire result
   */
  readonly checksum: SHA256Hash;

  /**
   * Optional cryptographic signature
   */
  readonly signature?: string;
}

// =============================================================================
// Result Builder Types
// =============================================================================

/**
 * Partial result during execution (for progress tracking)
 */
export interface PartialSimulationResult {
  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Current status
   */
  readonly status: ExecutionStatus;

  /**
   * Progress percentage (0-100)
   */
  readonly progressPercent: number;

  /**
   * Current step being executed
   */
  readonly currentStep?: {
    readonly stepId: string;
    readonly stepName?: string;
    readonly startedAt: ISO8601Timestamp;
  };

  /**
   * Steps completed so far
   */
  readonly stepsCompleted: number;

  /**
   * Total steps in plan
   */
  readonly totalSteps: number;

  /**
   * Agents currently active
   */
  readonly activeAgents: readonly string[];

  /**
   * Elapsed time in milliseconds
   */
  readonly elapsedMs: DurationMs;

  /**
   * Errors so far (if any)
   */
  readonly errors: readonly ExecutionErrorData[];

  /**
   * Last checkpoint (if any)
   */
  readonly lastCheckpoint?: {
    readonly checkpointId: UUID;
    readonly stepId: string;
    readonly createdAt: ISO8601Timestamp;
  };
}

// =============================================================================
// Result Query Types
// =============================================================================

/**
 * Query parameters for result retrieval
 */
export interface ResultQueryParams {
  /**
   * Include step results
   */
  readonly includeStepResults?: boolean;

  /**
   * Include agent observations
   */
  readonly includeAgentObservations?: boolean;

  /**
   * Include integration observations
   */
  readonly includeIntegrationObservations?: boolean;

  /**
   * Include full telemetry
   */
  readonly includeTelemetry?: boolean;

  /**
   * Include artifacts
   */
  readonly includeArtifacts?: boolean;

  /**
   * Maximum number of step results to include
   */
  readonly stepResultLimit?: number;

  /**
   * Step result offset for pagination
   */
  readonly stepResultOffset?: number;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if result is complete
 */
export function isCompleteResult(
  result: SimulationResult | PartialSimulationResult
): result is SimulationResult {
  return 'resultHash' in result && 'finalState' in result;
}

/**
 * Type guard to check if result indicates success
 */
export function isSuccessfulResult(result: SimulationResult): boolean {
  return result.execution.status === 'completed' && result.errors.length === 0;
}

/**
 * Type guard to check if result is reproducible
 */
export function isReproducibleResult(result: SimulationResult): boolean {
  return (
    result.reproducibilityProof !== undefined &&
    result.reproducibilityProof.deterministic
  );
}
