/**
 * Structured Result Emitter
 *
 * Transforms engine execution results into exportable formats for:
 * - Exporters (JSON, CSV, streaming outputs)
 * - enterprise-roi-engine (for further processing)
 *
 * All outputs are deterministic and include verification hashes.
 * Does NOT perform financial calculations - that is delegated to enterprise-roi-engine.
 *
 * @module engine/structured-result-emitter
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  SemanticVersion,
  ExecutionStatus,
  StepStatus,
  Metadata,
} from '../types/common.js';

import type {
  SimulationResult,
  ExecutionMetadata,
  ExecutionSummary,
  FinalState,
  StepResult,
  AgentSummary,
  IntegrationObservation,
  ExecutionTelemetry,
  ValidationOutcomes,
  ExecutionArtifact,
  ReproducibilityProof,
} from '../types/simulation-result.js';

import type { WorkflowResult, CheckpointInfo } from '../orchestration/types.js';

import { computeObjectHash, computeSHA256 } from '../core/hash-utils.js';

// =============================================================================
// Export Format Types
// =============================================================================

/**
 * Supported export formats
 */
export type ExportFormat = 'json' | 'csv' | 'ndjson' | 'stream';

/**
 * Engine execution result - input to the emitter
 * This is the raw result from the ExecutionOrchestrator
 */
export interface EngineExecutionResult {
  readonly executionId: UUID;
  readonly planId: UUID;
  readonly planVersion: SemanticVersion;
  readonly planHash: SHA256Hash;
  readonly status: ExecutionStatus;
  readonly startedAt: ISO8601Timestamp;
  readonly completedAt: ISO8601Timestamp;
  readonly durationMs: DurationMs;
  readonly stepResults: readonly StepResult[];
  readonly agentSummaries: readonly AgentSummary[];
  readonly integrationObservations: readonly IntegrationObservation[];
  readonly finalState: FinalState;
  readonly summary: ExecutionSummary;
  readonly telemetry: ExecutionTelemetry;
  readonly validationOutcomes: ValidationOutcomes;
  readonly artifacts: readonly ExecutionArtifact[];
  readonly reproducibilityProof?: ReproducibilityProof;
  readonly checkpoints: readonly CheckpointInfo[];
  readonly errors: readonly {
    readonly errorId: UUID;
    readonly stepId?: string;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly timestamp: ISO8601Timestamp;
  }[];
  readonly deterministicSeed?: number;
}

// =============================================================================
// Emitted Result Types
// =============================================================================

/**
 * Emitted result - the standardized output from the emitter
 */
export interface EmittedResult {
  readonly emittedAt: ISO8601Timestamp;
  readonly emissionId: UUID;
  readonly sourceExecutionId: UUID;
  readonly contentHash: SHA256Hash;
  readonly format: ExportFormat;
  readonly metadata: EmittedResultMetadata;
  readonly timeline: readonly TimelineEvent[];
  readonly execution: ExecutionSummaryData;
  readonly agents: readonly AgentExecutionData[];
  readonly integrations: readonly IntegrationExecutionData[];
  readonly artifacts: readonly ArtifactReference[];
  readonly determinism: DeterminismData;
}

/**
 * Metadata for the emitted result
 */
export interface EmittedResultMetadata {
  readonly version: SemanticVersion;
  readonly planId: UUID;
  readonly planVersion: SemanticVersion;
  readonly planHash: SHA256Hash;
  readonly executionStartedAt: ISO8601Timestamp;
  readonly executionCompletedAt: ISO8601Timestamp;
  readonly totalDurationMs: DurationMs;
  readonly status: ExecutionStatus;
  readonly environment?: {
    readonly hostname?: string;
    readonly version?: string;
    readonly region?: string;
  };
}

/**
 * Timeline event for step-by-step execution history
 */
export interface TimelineEvent {
  readonly sequence: number;
  readonly timestamp: ISO8601Timestamp;
  readonly eventType: TimelineEventType;
  readonly stepId?: string;
  readonly agentId?: string;
  readonly integrationId?: string;
  readonly durationMs?: DurationMs;
  readonly status?: StepStatus;
  readonly details?: Metadata;
  readonly stateHashBefore?: SHA256Hash;
  readonly stateHashAfter?: SHA256Hash;
}

/**
 * Timeline event types
 */
export type TimelineEventType =
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'
  | 'agent_invoked'
  | 'agent_completed'
  | 'integration_called'
  | 'integration_completed'
  | 'checkpoint_created'
  | 'validation_passed'
  | 'validation_failed';

/**
 * Execution summary data
 */
export interface ExecutionSummaryData {
  readonly totalSteps: number;
  readonly successfulSteps: number;
  readonly failedSteps: number;
  readonly skippedSteps: number;
  readonly totalAgentInvocations: number;
  readonly totalIntegrationCalls: number;
  readonly totalTokensConsumed: number;
  readonly totalStateMutations: number;
  readonly checkpointsCreated: number;
  readonly validationsPassed: number;
  readonly validationsFailed: number;
}

/**
 * Agent execution data
 */
export interface AgentExecutionData {
  readonly agentId: string;
  readonly invocationCount: number;
  readonly totalTokensConsumed: number;
  readonly averageLatencyMs: number;
  readonly minLatencyMs?: number;
  readonly maxLatencyMs?: number;
  readonly errorCount: number;
  readonly successRate: number;
}

/**
 * Integration execution data
 */
export interface IntegrationExecutionData {
  readonly integrationId: string;
  readonly callCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly averageLatencyMs: number;
  readonly totalDurationMs: DurationMs;
  readonly usedMockCount: number;
}

/**
 * Artifact reference for the result
 */
export interface ArtifactReference {
  readonly artifactId: UUID;
  readonly type: string;
  readonly name: string;
  readonly location: string;
  readonly sizeBytes: number;
  readonly hash: SHA256Hash;
  readonly createdAt: ISO8601Timestamp;
}

/**
 * Determinism data for verification
 */
export interface DeterminismData {
  readonly isDeterministic: boolean;
  readonly seed?: number;
  readonly normalizedResultHash: SHA256Hash;
  readonly stateHashes: readonly StateHashEntry[];
  readonly verificationMethod: string;
}

/**
 * State hash entry for verification chain
 */
export interface StateHashEntry {
  readonly sequence: number;
  readonly stepId?: string;
  readonly hash: SHA256Hash;
  readonly timestamp: ISO8601Timestamp;
}

// =============================================================================
// Exportable Result Types
// =============================================================================

/**
 * Result formatted for exporters
 */
export interface ExportableResult {
  readonly format: ExportFormat;
  readonly contentType: string;
  readonly data: unknown;
  readonly hash: SHA256Hash;
  readonly generatedAt: ISO8601Timestamp;
  readonly metadata: ExportMetadata;
}

/**
 * Export metadata
 */
export interface ExportMetadata {
  readonly executionId: UUID;
  readonly planId: UUID;
  readonly exportedAt: ISO8601Timestamp;
  readonly itemCount: number;
  readonly format: ExportFormat;
}

// =============================================================================
// ROI Engine Input Types
// =============================================================================

/**
 * Input format for enterprise-roi-engine
 * Contains execution metrics without financial calculations
 */
export interface ROIEngineInput {
  readonly schemaVersion: SemanticVersion;
  readonly executionId: UUID;
  readonly planId: UUID;
  readonly generatedAt: ISO8601Timestamp;
  readonly contentHash: SHA256Hash;
  readonly execution: ROIExecutionMetrics;
  readonly agents: readonly ROIAgentMetrics[];
  readonly integrations: readonly ROIIntegrationMetrics[];
  readonly timeline: readonly ROITimelineEntry[];
  readonly validation: ROIValidationSummary;
  readonly determinism: {
    readonly verified: boolean;
    readonly seed?: number;
    readonly resultHash: SHA256Hash;
  };
}

/**
 * Execution metrics for ROI engine
 */
export interface ROIExecutionMetrics {
  readonly status: ExecutionStatus;
  readonly startedAt: ISO8601Timestamp;
  readonly completedAt: ISO8601Timestamp;
  readonly durationMs: DurationMs;
  readonly totalSteps: number;
  readonly successfulSteps: number;
  readonly failedSteps: number;
  readonly totalTokensConsumed: number;
  readonly totalAgentInvocations: number;
  readonly totalIntegrationCalls: number;
}

/**
 * Agent metrics for ROI engine
 */
export interface ROIAgentMetrics {
  readonly agentId: string;
  readonly invocationCount: number;
  readonly totalTokensConsumed: number;
  readonly totalDurationMs: DurationMs;
  readonly errorCount: number;
}

/**
 * Integration metrics for ROI engine
 */
export interface ROIIntegrationMetrics {
  readonly integrationId: string;
  readonly callCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalDurationMs: DurationMs;
}

/**
 * Timeline entry for ROI engine
 */
export interface ROITimelineEntry {
  readonly sequence: number;
  readonly timestamp: ISO8601Timestamp;
  readonly type: string;
  readonly entityId: string;
  readonly durationMs?: DurationMs;
  readonly success: boolean;
}

/**
 * Validation summary for ROI engine
 */
export interface ROIValidationSummary {
  readonly preConditionsPassed: boolean;
  readonly postConditionsPassed: boolean;
  readonly invariantViolations: number;
  readonly allPassed: boolean;
}

// =============================================================================
// Structured Result Emitter Class
// =============================================================================

/**
 * StructuredResultEmitter transforms engine execution results into
 * exportable formats for various consumers.
 *
 * Key features:
 * - Deterministic output with verification hashes
 * - Support for multiple export formats (JSON, CSV, NDJSON, streaming)
 * - Timeline data for step-by-step execution history
 * - ROI engine input format without financial calculations
 */
export class StructuredResultEmitter {
  private readonly SCHEMA_VERSION: SemanticVersion = '1.0.0';

  /**
   * Emit a structured result from engine execution result
   *
   * @param result - The engine execution result to transform
   * @returns EmittedResult ready for consumption
   */
  async emit(result: EngineExecutionResult): Promise<EmittedResult> {
    const emittedAt = new Date().toISOString() as ISO8601Timestamp;
    const emissionId = uuidv4() as UUID;

    // Build timeline from step results
    const timeline = this.buildTimeline(result);

    // Build execution summary data
    const execution = this.buildExecutionSummary(result);

    // Build agent data
    const agents = this.buildAgentData(result.agentSummaries);

    // Build integration data
    const integrations = this.buildIntegrationData(result.integrationObservations);

    // Build artifact references
    const artifacts = this.buildArtifactReferences(result.artifacts);

    // Build determinism data
    const determinism = this.buildDeterminismData(result);

    // Build metadata
    const metadata: EmittedResultMetadata = {
      version: this.SCHEMA_VERSION,
      planId: result.planId,
      planVersion: result.planVersion,
      planHash: result.planHash,
      executionStartedAt: result.startedAt,
      executionCompletedAt: result.completedAt,
      totalDurationMs: result.durationMs,
      status: result.status,
    };

    // Build pre-hash content for deterministic hash
    const preHashContent = {
      emittedAt,
      emissionId,
      sourceExecutionId: result.executionId,
      metadata,
      timeline,
      execution,
      agents,
      integrations,
      artifacts,
      determinism,
    };

    // Compute content hash
    const contentHash = computeObjectHash(preHashContent) as SHA256Hash;

    return {
      emittedAt,
      emissionId,
      sourceExecutionId: result.executionId,
      contentHash,
      format: 'json',
      metadata,
      timeline,
      execution,
      agents,
      integrations,
      artifacts,
      determinism,
    };
  }

  /**
   * Format result for a specific exporter
   *
   * @param result - The engine execution result
   * @param format - The export format to use
   * @returns ExportableResult in the specified format
   */
  formatForExporter(
    result: EngineExecutionResult,
    format: ExportFormat
  ): ExportableResult {
    const generatedAt = new Date().toISOString() as ISO8601Timestamp;

    let data: unknown;
    let contentType: string;

    switch (format) {
      case 'json':
        data = this.formatAsJSON(result);
        contentType = 'application/json';
        break;
      case 'csv':
        data = this.formatAsCSV(result);
        contentType = 'text/csv';
        break;
      case 'ndjson':
        data = this.formatAsNDJSON(result);
        contentType = 'application/x-ndjson';
        break;
      case 'stream':
        data = this.formatAsStreamable(result);
        contentType = 'application/octet-stream';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const hash = computeObjectHash(data) as SHA256Hash;

    return {
      format,
      contentType,
      data,
      hash,
      generatedAt,
      metadata: {
        executionId: result.executionId,
        planId: result.planId,
        exportedAt: generatedAt,
        itemCount: result.stepResults.length,
        format,
      },
    };
  }

  /**
   * Format result for enterprise-roi-engine consumption
   *
   * @param result - The engine execution result
   * @returns ROIEngineInput for further processing
   */
  formatForROIEngine(result: EngineExecutionResult): ROIEngineInput {
    const generatedAt = new Date().toISOString() as ISO8601Timestamp;

    // Build execution metrics
    const execution: ROIExecutionMetrics = {
      status: result.status,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      totalSteps: result.summary.totalStepsExecuted,
      successfulSteps: result.summary.successfulSteps,
      failedSteps: result.summary.failedSteps,
      totalTokensConsumed: result.summary.totalTokensConsumed ?? 0,
      totalAgentInvocations: result.summary.totalAgentInvocations,
      totalIntegrationCalls: result.integrationObservations.length,
    };

    // Build agent metrics
    const agents: ROIAgentMetrics[] = result.agentSummaries.map((agent) => ({
      agentId: agent.agentId,
      invocationCount: agent.invocationCount,
      totalTokensConsumed: agent.totalTokensConsumed,
      totalDurationMs: agent.averageLatencyMs * agent.invocationCount,
      errorCount: agent.errorCount,
    }));

    // Build integration metrics
    const integrationMap = new Map<string, ROIIntegrationMetrics>();
    for (const obs of result.integrationObservations) {
      const existing = integrationMap.get(obs.integrationId);
      if (existing) {
        integrationMap.set(obs.integrationId, {
          ...existing,
          callCount: existing.callCount + 1,
          successCount: existing.successCount + (obs.success ? 1 : 0),
          failureCount: existing.failureCount + (obs.success ? 0 : 1),
          totalDurationMs: existing.totalDurationMs + obs.durationMs,
        });
      } else {
        integrationMap.set(obs.integrationId, {
          integrationId: obs.integrationId,
          callCount: 1,
          successCount: obs.success ? 1 : 0,
          failureCount: obs.success ? 0 : 1,
          totalDurationMs: obs.durationMs,
        });
      }
    }
    const integrations = Array.from(integrationMap.values());

    // Build timeline entries
    const timeline: ROITimelineEntry[] = result.stepResults.map((step, idx) => ({
      sequence: idx + 1,
      timestamp: step.startedAt,
      type: 'step',
      entityId: step.stepId,
      durationMs: step.durationMs,
      success: step.status === 'success',
    }));

    // Build validation summary
    const validation: ROIValidationSummary = {
      preConditionsPassed: result.validationOutcomes.preConditions.every(
        (c) => c.satisfied
      ),
      postConditionsPassed: result.validationOutcomes.postConditions.every(
        (c) => c.satisfied
      ),
      invariantViolations: result.validationOutcomes.invariantViolations.length,
      allPassed: result.validationOutcomes.allPassed,
    };

    // Build determinism verification
    const resultHash = computeObjectHash({
      executionId: result.executionId,
      planHash: result.planHash,
      status: result.status,
      stepResults: result.stepResults,
    }) as SHA256Hash;

    // Compute content hash for the entire input
    const contentHash = computeObjectHash({
      schemaVersion: this.SCHEMA_VERSION,
      executionId: result.executionId,
      execution,
      agents,
      integrations,
      timeline,
      validation,
    }) as SHA256Hash;

    return {
      schemaVersion: this.SCHEMA_VERSION,
      executionId: result.executionId,
      planId: result.planId,
      generatedAt,
      contentHash,
      execution,
      agents,
      integrations,
      timeline,
      validation,
      determinism: {
        verified: result.reproducibilityProof?.deterministic ?? false,
        seed: result.deterministicSeed,
        resultHash,
      },
    };
  }

  /**
   * Stream timeline events as an async iterable
   *
   * @param executionId - The execution ID to stream timeline for
   * @returns AsyncIterableIterator of TimelineEvent
   */
  async *streamTimeline(
    result: EngineExecutionResult
  ): AsyncIterableIterator<TimelineEvent> {
    const timeline = this.buildTimeline(result);
    for (const event of timeline) {
      yield event;
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Build timeline from step results and other events
   */
  private buildTimeline(result: EngineExecutionResult): readonly TimelineEvent[] {
    const events: TimelineEvent[] = [];
    let sequence = 0;

    // Execution started event
    events.push({
      sequence: ++sequence,
      timestamp: result.startedAt,
      eventType: 'execution_started',
      details: {
        planId: result.planId,
        planVersion: result.planVersion,
      },
    });

    // Step events
    for (const step of result.stepResults) {
      // Step started
      events.push({
        sequence: ++sequence,
        timestamp: step.startedAt,
        eventType: 'step_started',
        stepId: step.stepId,
        stateHashBefore: step.preStateHash,
      });

      // Step completion based on status
      const eventType = this.getStepCompletionEventType(step.status);
      if (step.completedAt) {
        events.push({
          sequence: ++sequence,
          timestamp: step.completedAt,
          eventType,
          stepId: step.stepId,
          durationMs: step.durationMs,
          status: step.status,
          stateHashAfter: step.postStateHash,
          details: step.outputs ? { outputs: step.outputs } : undefined,
        });
      }

      // LLM interaction event if present
      if (step.llmInteraction) {
        events.push({
          sequence: ++sequence,
          timestamp: step.completedAt ?? step.startedAt,
          eventType: 'agent_completed',
          stepId: step.stepId,
          durationMs: step.llmInteraction.latencyMs,
          details: {
            provider: step.llmInteraction.provider,
            model: step.llmInteraction.model,
            totalTokens: step.llmInteraction.totalTokens,
          },
        });
      }
    }

    // Integration call events
    for (const obs of result.integrationObservations) {
      events.push({
        sequence: ++sequence,
        timestamp: obs.calledAt,
        eventType: obs.success ? 'integration_completed' : 'integration_called',
        integrationId: obs.integrationId,
        stepId: obs.stepId,
        durationMs: obs.durationMs,
        details: {
          usedMock: obs.usedMock,
          statusCode: obs.responseSummary?.statusCode,
        },
      });
    }

    // Checkpoint events
    for (const checkpoint of result.checkpoints) {
      events.push({
        sequence: ++sequence,
        timestamp: checkpoint.createdAt,
        eventType: 'checkpoint_created',
        stepId: checkpoint.stepId,
        details: {
          checkpointId: checkpoint.checkpointId,
          label: checkpoint.label,
          stateHash: checkpoint.stateHash,
        },
      });
    }

    // Validation events
    for (const condition of result.validationOutcomes.preConditions) {
      events.push({
        sequence: ++sequence,
        timestamp: condition.evaluatedAt,
        eventType: condition.satisfied ? 'validation_passed' : 'validation_failed',
        details: {
          type: 'precondition',
          condition: condition.condition,
          message: condition.message,
        },
      });
    }

    for (const condition of result.validationOutcomes.postConditions) {
      events.push({
        sequence: ++sequence,
        timestamp: condition.evaluatedAt,
        eventType: condition.satisfied ? 'validation_passed' : 'validation_failed',
        details: {
          type: 'postcondition',
          condition: condition.condition,
          message: condition.message,
        },
      });
    }

    // Execution completed/failed event
    const finalEventType =
      result.status === 'completed' ? 'execution_completed' : 'execution_failed';
    events.push({
      sequence: ++sequence,
      timestamp: result.completedAt,
      eventType: finalEventType,
      durationMs: result.durationMs,
      details: {
        status: result.status,
        finalStateHash: result.finalState.stateHash,
      },
    });

    // Sort by timestamp, then by sequence for determinism
    return events.sort((a, b) => {
      const timeDiff =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.sequence - b.sequence;
    });
  }

  /**
   * Get the completion event type based on step status
   */
  private getStepCompletionEventType(status: StepStatus): TimelineEventType {
    switch (status) {
      case 'success':
        return 'step_completed';
      case 'failure':
        return 'step_failed';
      case 'skipped':
        return 'step_skipped';
      case 'timeout':
        return 'step_failed';
      default:
        return 'step_completed';
    }
  }

  /**
   * Build execution summary data
   */
  private buildExecutionSummary(result: EngineExecutionResult): ExecutionSummaryData {
    const passedPre = result.validationOutcomes.preConditions.filter(
      (c) => c.satisfied
    ).length;
    const passedPost = result.validationOutcomes.postConditions.filter(
      (c) => c.satisfied
    ).length;
    const totalValidations =
      result.validationOutcomes.preConditions.length +
      result.validationOutcomes.postConditions.length;
    const failedValidations = totalValidations - passedPre - passedPost;

    return {
      totalSteps: result.summary.totalStepsExecuted,
      successfulSteps: result.summary.successfulSteps,
      failedSteps: result.summary.failedSteps,
      skippedSteps: result.summary.skippedSteps,
      totalAgentInvocations: result.summary.totalAgentInvocations,
      totalIntegrationCalls: result.integrationObservations.length,
      totalTokensConsumed: result.summary.totalTokensConsumed ?? 0,
      totalStateMutations: result.summary.totalStateMutations,
      checkpointsCreated: result.checkpoints.length,
      validationsPassed: passedPre + passedPost,
      validationsFailed: failedValidations,
    };
  }

  /**
   * Build agent execution data
   */
  private buildAgentData(
    agentSummaries: readonly AgentSummary[]
  ): readonly AgentExecutionData[] {
    return agentSummaries.map((agent) => ({
      agentId: agent.agentId,
      invocationCount: agent.invocationCount,
      totalTokensConsumed: agent.totalTokensConsumed,
      averageLatencyMs: agent.averageLatencyMs,
      minLatencyMs: agent.minLatencyMs,
      maxLatencyMs: agent.maxLatencyMs,
      errorCount: agent.errorCount,
      successRate:
        agent.invocationCount > 0
          ? (agent.invocationCount - agent.errorCount) / agent.invocationCount
          : 1,
    }));
  }

  /**
   * Build integration execution data
   */
  private buildIntegrationData(
    observations: readonly IntegrationObservation[]
  ): readonly IntegrationExecutionData[] {
    const integrationMap = new Map<
      string,
      {
        callCount: number;
        successCount: number;
        failureCount: number;
        totalDurationMs: number;
        usedMockCount: number;
      }
    >();

    for (const obs of observations) {
      const existing = integrationMap.get(obs.integrationId);
      if (existing) {
        integrationMap.set(obs.integrationId, {
          callCount: existing.callCount + 1,
          successCount: existing.successCount + (obs.success ? 1 : 0),
          failureCount: existing.failureCount + (obs.success ? 0 : 1),
          totalDurationMs: existing.totalDurationMs + obs.durationMs,
          usedMockCount: existing.usedMockCount + (obs.usedMock ? 1 : 0),
        });
      } else {
        integrationMap.set(obs.integrationId, {
          callCount: 1,
          successCount: obs.success ? 1 : 0,
          failureCount: obs.success ? 0 : 1,
          totalDurationMs: obs.durationMs,
          usedMockCount: obs.usedMock ? 1 : 0,
        });
      }
    }

    return Array.from(integrationMap.entries()).map(([id, data]) => ({
      integrationId: id,
      callCount: data.callCount,
      successCount: data.successCount,
      failureCount: data.failureCount,
      averageLatencyMs:
        data.callCount > 0 ? data.totalDurationMs / data.callCount : 0,
      totalDurationMs: data.totalDurationMs,
      usedMockCount: data.usedMockCount,
    }));
  }

  /**
   * Build artifact references
   */
  private buildArtifactReferences(
    artifacts: readonly ExecutionArtifact[]
  ): readonly ArtifactReference[] {
    return artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      name: artifact.name,
      location: artifact.location,
      sizeBytes: artifact.sizeBytes,
      hash: artifact.hash,
      createdAt: artifact.createdAt,
    }));
  }

  /**
   * Build determinism data for verification
   */
  private buildDeterminismData(result: EngineExecutionResult): DeterminismData {
    // Collect state hashes from step results
    const stateHashes: StateHashEntry[] = [];
    let seq = 0;

    for (const step of result.stepResults) {
      if (step.postStateHash) {
        stateHashes.push({
          sequence: ++seq,
          stepId: step.stepId,
          hash: step.postStateHash,
          timestamp: step.completedAt ?? step.startedAt,
        });
      }
    }

    // Add final state hash
    stateHashes.push({
      sequence: ++seq,
      hash: result.finalState.stateHash,
      timestamp: result.completedAt,
    });

    // Compute normalized result hash (excludes timestamps and UUIDs)
    const normalizedContent = {
      planHash: result.planHash,
      status: result.status,
      stepStatuses: result.stepResults.map((s) => ({
        stepId: s.stepId,
        status: s.status,
      })),
      finalStateHash: result.finalState.stateHash,
      deterministicSeed: result.deterministicSeed,
    };
    const normalizedResultHash = computeObjectHash(normalizedContent) as SHA256Hash;

    return {
      isDeterministic: result.reproducibilityProof?.deterministic ?? false,
      seed: result.deterministicSeed,
      normalizedResultHash,
      stateHashes,
      verificationMethod:
        result.reproducibilityProof?.verificationMethod ??
        'Compare normalizedResultHash with same planHash and seed',
    };
  }

  /**
   * Format result as JSON
   */
  private formatAsJSON(result: EngineExecutionResult): object {
    return {
      executionId: result.executionId,
      planId: result.planId,
      planVersion: result.planVersion,
      status: result.status,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      summary: result.summary,
      stepResults: result.stepResults,
      agentSummaries: result.agentSummaries,
      integrationObservations: result.integrationObservations,
      finalState: result.finalState,
      validationOutcomes: result.validationOutcomes,
      errors: result.errors,
    };
  }

  /**
   * Format result as CSV
   */
  private formatAsCSV(result: EngineExecutionResult): string {
    const lines: string[] = [];

    // Header row
    lines.push(
      'stepId,status,startedAt,completedAt,durationMs,sequenceNumber,preStateHash,postStateHash'
    );

    // Data rows
    for (const step of result.stepResults) {
      lines.push(
        [
          this.escapeCSV(step.stepId),
          this.escapeCSV(step.status),
          this.escapeCSV(step.startedAt),
          this.escapeCSV(step.completedAt ?? ''),
          step.durationMs?.toString() ?? '',
          step.sequenceNumber?.toString() ?? '',
          this.escapeCSV(step.preStateHash ?? ''),
          this.escapeCSV(step.postStateHash ?? ''),
        ].join(',')
      );
    }

    return lines.join('\n');
  }

  /**
   * Escape a value for CSV
   */
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Format result as NDJSON (newline-delimited JSON)
   */
  private formatAsNDJSON(result: EngineExecutionResult): string {
    const lines: string[] = [];

    // Execution metadata line
    lines.push(
      JSON.stringify({
        type: 'execution',
        executionId: result.executionId,
        planId: result.planId,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
      })
    );

    // Step result lines
    for (const step of result.stepResults) {
      lines.push(
        JSON.stringify({
          type: 'step',
          ...step,
        })
      );
    }

    // Agent summary lines
    for (const agent of result.agentSummaries) {
      lines.push(
        JSON.stringify({
          type: 'agent',
          ...agent,
        })
      );
    }

    // Integration observation lines
    for (const obs of result.integrationObservations) {
      lines.push(
        JSON.stringify({
          type: 'integration',
          ...obs,
        })
      );
    }

    return lines.join('\n');
  }

  /**
   * Format result as streamable chunks
   */
  private formatAsStreamable(result: EngineExecutionResult): object[] {
    const chunks: object[] = [];

    // Header chunk
    chunks.push({
      chunkType: 'header',
      executionId: result.executionId,
      planId: result.planId,
      totalSteps: result.stepResults.length,
    });

    // Step chunks
    for (const step of result.stepResults) {
      chunks.push({
        chunkType: 'step',
        step,
      });
    }

    // Summary chunk
    chunks.push({
      chunkType: 'summary',
      summary: result.summary,
      finalState: result.finalState,
    });

    // Footer chunk
    chunks.push({
      chunkType: 'footer',
      status: result.status,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
    });

    return chunks;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new StructuredResultEmitter instance
 */
export function createStructuredResultEmitter(): StructuredResultEmitter {
  return new StructuredResultEmitter();
}

/**
 * Emit result using a one-off emitter
 */
export async function emitResult(
  result: EngineExecutionResult
): Promise<EmittedResult> {
  const emitter = new StructuredResultEmitter();
  return emitter.emit(result);
}

/**
 * Format result for export using a one-off emitter
 */
export function formatResultForExport(
  result: EngineExecutionResult,
  format: ExportFormat
): ExportableResult {
  const emitter = new StructuredResultEmitter();
  return emitter.formatForExporter(result, format);
}

/**
 * Format result for ROI engine using a one-off emitter
 */
export function formatResultForROIEngine(
  result: EngineExecutionResult
): ROIEngineInput {
  const emitter = new StructuredResultEmitter();
  return emitter.formatForROIEngine(result);
}
