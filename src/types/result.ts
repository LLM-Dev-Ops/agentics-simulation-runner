/**
 * SimulationResult type definitions
 * Defines the output artifact schema consumed by agentics-deployment-intent
 *
 * References:
 * - SPARC_SPECIFICATION.md Section 4.1
 * - SPARC_ARCHITECTURE.md MOD-005
 */

import type {
  UUID,
  SHA256Hash,
  SemanticVersion,
  ISO8601Timestamp,
  DurationMs,
  Percentage,
  Count,
  TokenCount,
  ExecutionStatus,
  StepStatus,
  StepId,
  AgentId,
  IntegrationId,
  ArtifactId,
  SpanId,
} from './common.js';
import type { PlanReference } from './common.js';

// ============================================================================
// Step Results
// ============================================================================

export interface StepOutput {
  readonly name: string;
  readonly value: unknown;
  readonly type: string;
}

export interface StepMetrics {
  readonly durationMs: DurationMs;
  readonly memoryUsedBytes?: number;
  readonly cpuTimeMs?: number;
  readonly customMetrics?: Record<string, number>;
}

export interface StepError {
  readonly errorType: string;
  readonly message: string;
  readonly stackTrace?: string;
  readonly recoverable: boolean;
}

export interface StepResult {
  readonly stepId: StepId;
  readonly status: StepStatus;
  readonly startTime: ISO8601Timestamp;
  readonly endTime: ISO8601Timestamp;
  readonly outputs: StepOutput[];
  readonly metrics: StepMetrics;
  readonly errors: StepError[];
}

// ============================================================================
// Agent Observations
// ============================================================================

export interface AgentInvocation {
  readonly invocationId: UUID;
  readonly stepId: StepId;
  readonly startTime: ISO8601Timestamp;
  readonly endTime: ISO8601Timestamp;
  readonly prompt: string;
  readonly response: string;
  readonly inputTokens: TokenCount;
  readonly outputTokens: TokenCount;
  readonly latencyMs: DurationMs;
  readonly finishReason: string;
  readonly modelId: string;
}

export interface AgentObservation {
  readonly agentId: AgentId;
  readonly agentName: string;
  readonly invocations: AgentInvocation[];
  readonly totalTokens: TokenCount;
  readonly totalLatency: DurationMs;
  readonly completionRate: Percentage;
  readonly averageLatencyMs: DurationMs;
  readonly errorCount: Count;
}

// ============================================================================
// Integration Observations
// ============================================================================

export interface IntegrationCall {
  readonly callId: UUID;
  readonly stepId: StepId;
  readonly method: string;
  readonly path: string;
  readonly startTime: ISO8601Timestamp;
  readonly endTime: ISO8601Timestamp;
  readonly statusCode?: number;
  readonly latencyMs: DurationMs;
  readonly success: boolean;
  readonly errorMessage?: string;
}

export interface IntegrationError {
  readonly callId: UUID;
  readonly errorType: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly timestamp: ISO8601Timestamp;
}

export interface IntegrationObservation {
  readonly integrationId: IntegrationId;
  readonly integrationName: string;
  readonly callCount: Count;
  readonly successRate: Percentage;
  readonly avgLatency: DurationMs;
  readonly totalLatency: DurationMs;
  readonly errors: IntegrationError[];
}

// ============================================================================
// Telemetry Types
// ============================================================================

export interface CapturedMetric {
  readonly metricId: string;
  readonly metricName: string;
  readonly aggregationType: string;
  readonly value: number | number[] | Record<string, number>;
  readonly sampleCount: Count;
  readonly timeRange: {
    readonly start: ISO8601Timestamp;
    readonly end: ISO8601Timestamp;
  };
  readonly labels?: Record<string, string>;
}

export interface CapturedEvent {
  readonly eventId: UUID;
  readonly eventType: string;
  readonly data: Record<string, unknown>;
  readonly occurredAt: ISO8601Timestamp;
}

export interface TraceSpan {
  readonly spanId: SpanId;
  readonly traceId: UUID;
  readonly parentSpanId?: SpanId;
  readonly operationName: string;
  readonly startTime: ISO8601Timestamp;
  readonly endTime: ISO8601Timestamp;
  readonly tags: Record<string, string | number | boolean>;
  readonly logs?: TraceLog[];
  readonly children?: TraceSpan[];
}

export interface TraceLog {
  readonly timestamp: ISO8601Timestamp;
  readonly fields: Record<string, unknown>;
}

export interface CapturedTrace {
  readonly traceId: UUID;
  readonly rootSpan: TraceSpan;
  readonly spanCount: Count;
  readonly duration: DurationMs;
}

export interface Telemetry {
  readonly metrics: CapturedMetric[];
  readonly events: CapturedEvent[];
  readonly traces: CapturedTrace[];
}

// ============================================================================
// Validation Outcomes
// ============================================================================

export interface ConditionResult {
  readonly conditionId: string;
  readonly passed: boolean;
  readonly message: string;
  readonly evaluatedAt: ISO8601Timestamp;
  readonly details?: Record<string, unknown>;
}

export interface InvariantViolation {
  readonly occurredAt: ISO8601Timestamp;
  readonly data: Record<string, unknown>;
  readonly stepId?: StepId;
}

export interface InvariantResult {
  readonly invariantId: string;
  readonly held: boolean;
  readonly violations: InvariantViolation[];
}

export interface ValidationOutcomes {
  readonly preConditionResults: ConditionResult[];
  readonly postConditionResults: ConditionResult[];
  readonly invariantResults: InvariantResult[];
}

// ============================================================================
// Artifacts
// ============================================================================

export type ArtifactType =
  | 'LOG'
  | 'REPORT'
  | 'DATA'
  | 'MODEL'
  | 'CONFIGURATION'
  | 'SCREENSHOT'
  | 'OTHER';

export interface Artifact {
  readonly artifactId: ArtifactId;
  readonly artifactType: ArtifactType;
  readonly name: string;
  readonly description?: string;
  readonly contentHash: SHA256Hash;
  readonly storageRef: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly createdAt: ISO8601Timestamp;
}

// ============================================================================
// Reproducibility Proof
// ============================================================================

export interface StateSnapshot {
  readonly snapshotId: UUID;
  readonly checkpointId: string;
  readonly stepId: StepId;
  readonly snapshotHash: SHA256Hash;
  readonly createdAt: ISO8601Timestamp;
}

export interface RandomnessEntry {
  readonly sequenceNum: number;
  readonly operation: string;
  readonly randomValue: Uint8Array;
  readonly usedAt: ISO8601Timestamp;
}

export interface ReproducibilityProof {
  readonly executionFingerprint: SHA256Hash;
  readonly stateSnapshots: StateSnapshot[];
  readonly randomnessLog: RandomnessEntry[];
}

// ============================================================================
// Execution Summary
// ============================================================================

export interface ExecutionSummary {
  readonly status: ExecutionStatus;
  readonly startTime: ISO8601Timestamp;
  readonly endTime: ISO8601Timestamp;
  readonly duration: DurationMs;
  readonly deterministicSeed: bigint;
  readonly abortReason?: string;
}

// ============================================================================
// SimulationResult (Primary Output)
// ============================================================================

export interface SimulationResult {
  // Identity
  readonly resultId: UUID;
  readonly resultVersion: SemanticVersion;
  readonly resultHash: SHA256Hash;

  // Provenance
  readonly executedAt: ISO8601Timestamp;
  readonly executedBy: {
    readonly name: string;
    readonly version: SemanticVersion;
    readonly instanceId: UUID;
  };
  readonly sourcePlan: PlanReference;

  // Execution Summary
  readonly execution: ExecutionSummary;

  // Step Outcomes
  readonly stepResults: StepResult[];

  // Agent Observations
  readonly agentObservations: AgentObservation[];

  // Integration Observations
  readonly integrationObservations: IntegrationObservation[];

  // Telemetry
  readonly telemetry: Telemetry;

  // Validation Outcomes
  readonly validation: ValidationOutcomes;

  // Artifacts
  readonly artifacts: Artifact[];

  // Reproducibility Proof
  readonly reproducibility: ReproducibilityProof;
}
