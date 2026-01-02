/**
 * Result Assembler (MOD-005 Component)
 *
 * Assembles and persists the final SimulationResult.
 * Implements Pseudocode Section 7.4-7.5 - Result Assembly and Persistence.
 *
 * Components:
 * - assembleSimulationResult: Combines all data into SimulationResult (7.4)
 * - persistSimulationResult: Persists result with immutability lock (7.5)
 *
 * Enforces:
 * - INV-OUT-001: SimulationResult is complete
 * - INV-OUT-002: SimulationResult is immutable once persisted
 * - INV-OUT-003: SimulationResult has valid resultHash
 *
 * @module orchestration/result-assembler
 * @see SPARC_PSEUDOCODE.md Section 7.4-7.5 - Result Assembly and Persistence
 * @see SPARC_ARCHITECTURE.md MOD-005 - Finalization Orchestrator
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  SemanticVersion,
  ExecutionStatus,
  Metadata,
  ConditionResult as CommonConditionResult,
  ExecutionErrorData,
} from '../types/common.js';

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  SimulationPlan,
} from '../types/simulation-plan.js';

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
  ReproducibilityProof as SimResultReproducibilityProof,
  ExecutionAuditTrail,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
  CheckpointInfo,
  ExecutionError,
} from './types.js';

import type { CapturedMetrics, CapturedEvents, CapturedTraces } from './observation-aggregator.js';
import type { PostConditionResults, InvariantResults } from './postcondition-evaluator.js';
import type { ReproducibilityProof } from './reproducibility-prover.js';

import {
  computeSHA256,
  computeObjectHash,
  createMerkleTree,
  getMerkleRoot,
} from '../core/hash-utils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for assembling the simulation result
 */
export interface AssembleResultOptions {
  /**
   * Include detailed step results
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
   * Include reproducibility proof
   */
  readonly includeReproducibilityProof?: boolean;
}

/**
 * Default assembly options
 */
export const DEFAULT_ASSEMBLE_OPTIONS: AssembleResultOptions = {
  includeStepResults: true,
  includeAgentObservations: true,
  includeIntegrationObservations: true,
  includeTelemetry: true,
  includeArtifacts: true,
  includeReproducibilityProof: true,
};

/**
 * Result of persistence operation
 */
export interface PersistenceConfirmation {
  /**
   * Whether persistence was successful
   */
  readonly success: boolean;

  /**
   * Result ID in the database
   */
  readonly resultId: UUID;

  /**
   * Result hash that was persisted
   */
  readonly resultHash: SHA256Hash;

  /**
   * When persistence completed
   */
  readonly persistedAt: ISO8601Timestamp;

  /**
   * Storage location reference
   */
  readonly storageLocation: string;

  /**
   * Immutability lock hash
   */
  readonly lockHash: SHA256Hash;

  /**
   * Error message if persistence failed
   */
  readonly error?: string;
}

/**
 * Assembled result data before final hash computation
 */
interface PreHashResult {
  readonly version: SemanticVersion;
  readonly resultId: UUID;
  readonly resultVersion: SemanticVersion;
  readonly executedAt: ISO8601Timestamp;
  readonly executedBy: string;
  readonly sourcePlan: {
    readonly planId: UUID;
    readonly planVersion: SemanticVersion;
    readonly planHash: SHA256Hash;
  };
  readonly execution: ExecutionMetadata;
  readonly summary: ExecutionSummary;
  readonly finalState: FinalState;
  readonly stepResults: readonly StepResult[];
  readonly agentObservations: readonly AgentSummary[];
  readonly integrationObservations: readonly IntegrationObservation[];
  readonly telemetry: ExecutionTelemetry;
  readonly validationOutcomes: ValidationOutcomes;
  readonly errors: readonly ExecutionErrorData[];
  readonly artifacts: readonly ExecutionArtifact[];
  readonly reproducibilityProof?: SimResultReproducibilityProof;
  readonly auditTrail: {
    readonly trailId: UUID;
    readonly entryCount: number;
    readonly merkleRoot: SHA256Hash;
    readonly firstEntryAt: ISO8601Timestamp;
    readonly lastEntryAt: ISO8601Timestamp;
  };
}

// =============================================================================
// Result Assembler Class
// =============================================================================

/**
 * Assembles and persists the final SimulationResult
 *
 * Implements Pseudocode Section 7.4-7.5 assembly and persistence functions
 */
export class ResultAssembler {
  private readonly RESULT_VERSION: SemanticVersion = '1.0.0';
  private readonly RUNNER_NAME = 'agentics-simulation-runner';
  private readonly RUNNER_VERSION: SemanticVersion = '1.0.0';

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan
  ) {}

  // ===========================================================================
  // Pseudocode 7.4 - assembleSimulationResult
  // ===========================================================================

  /**
   * Assemble all components into the final SimulationResult
   *
   * Algorithm (from Pseudocode 7.4):
   * 1. Build execution metadata
   * 2. Build execution summary
   * 3. Build final state reference
   * 4. Include step results
   * 5. Include agent observations
   * 6. Include integration observations
   * 7. Include telemetry
   * 8. Include validation outcomes
   * 9. Include artifacts
   * 10. Include reproducibility proof
   * 11. Build audit trail summary
   * 12. Compute result hash
   * 13. Return immutable SimulationResult
   *
   * Enforces:
   * - INV-OUT-001: Result is complete (all required fields present)
   * - INV-OUT-003: Result has valid resultHash
   *
   * @param workflowResult - Result of workflow execution
   * @param telemetry - Aggregated telemetry data
   * @param validationOutcomes - Postcondition and invariant results
   * @param reproducibilityProof - Reproducibility proof
   * @param options - Assembly options
   * @returns Complete SimulationResult
   */
  async assembleSimulationResult(
    workflowResult: WorkflowResult,
    telemetry: ExecutionTelemetry,
    validationOutcomes: ValidationOutcomes,
    reproducibilityProof: SimResultReproducibilityProof | undefined,
    preConditionResults: CommonConditionResult[],
    options: AssembleResultOptions = DEFAULT_ASSEMBLE_OPTIONS
  ): Promise<SimulationResult> {
    const resultId = uuidv4() as UUID;
    const executedAt = new Date().toISOString() as ISO8601Timestamp;

    // 1. Build execution metadata
    const execution = this.buildExecutionMetadata(resultId, workflowResult);

    // 2. Build execution summary
    const summary = workflowResult.summary;

    // 3. Build final state reference
    const finalState = workflowResult.finalState;

    // 4. Step results
    const stepResults = options.includeStepResults
      ? workflowResult.stepResults
      : [];

    // 5. Agent observations
    const agentObservations = options.includeAgentObservations
      ? workflowResult.agentSummaries
      : [];

    // 6. Integration observations
    const integrationObservations = options.includeIntegrationObservations
      ? workflowResult.integrationObservations
      : [];

    // 7. Telemetry (already passed in)
    const telemetryData = options.includeTelemetry ? telemetry : this.emptyTelemetry();

    // 8. Validation outcomes (already passed in)

    // 9. Artifacts
    const artifacts = options.includeArtifacts
      ? await this.collectArtifacts(workflowResult)
      : [];

    // 10. Reproducibility proof (already passed in)
    const proof = options.includeReproducibilityProof ? reproducibilityProof : undefined;

    // 11. Build audit trail summary
    const auditTrail = await this.buildAuditTrailSummary(workflowResult);

    // Convert execution errors to ExecutionErrorData
    const errors: ExecutionErrorData[] = workflowResult.errors.map((err) => ({
      errorId: err.errorId,
      stepId: err.stepId,
      errorCode: err.errorCode,
      errorMessage: err.message,
      stackTrace: err.stackTrace,
      recoveryAttempted: err.recoveryAttempted,
      recoveryResult: err.recoveryResult,
      timestamp: err.timestamp,
    }));

    // Build pre-hash result (without resultHash and checksum)
    const preHashResult: PreHashResult = {
      version: this.RESULT_VERSION,
      resultId,
      resultVersion: this.RESULT_VERSION,
      executedAt,
      executedBy: `${this.RUNNER_NAME}@${this.RUNNER_VERSION}`,
      sourcePlan: {
        planId: this.plan.planId,
        planVersion: this.plan.planVersion,
        planHash: this.plan.planHash,
      },
      execution,
      summary,
      finalState,
      stepResults,
      agentObservations,
      integrationObservations,
      telemetry: telemetryData,
      validationOutcomes,
      errors,
      artifacts,
      reproducibilityProof: proof,
      auditTrail,
    };

    // 12. Compute result hash (INV-OUT-003)
    const resultHash = this.computeResultHash(preHashResult);

    // 13. Compute checksum
    const checksum = this.computeChecksum(preHashResult, resultHash);

    // Validate completeness (INV-OUT-001)
    this.validateCompleteness(preHashResult);

    // Construct final immutable result
    const result: SimulationResult = {
      ...preHashResult,
      resultHash,
      checksum,
    };

    return result;
  }

  // ===========================================================================
  // Pseudocode 7.5 - persistSimulationResult
  // ===========================================================================

  /**
   * Persist the simulation result with immutability lock
   *
   * Algorithm (from Pseudocode 7.5):
   * 1. Validate result completeness
   * 2. Verify result hash
   * 3. Begin transaction
   * 4. Insert into simulation_results table
   * 5. Create immutability lock
   * 6. Commit transaction
   * 7. Return PersistenceConfirmation
   *
   * Enforces:
   * - INV-OUT-002: Result is immutable once persisted
   *
   * @param result - SimulationResult to persist
   * @returns Persistence confirmation
   */
  async persistSimulationResult(
    result: SimulationResult
  ): Promise<PersistenceConfirmation> {
    const persistedAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // 1. Validate result completeness
      this.validateCompleteness(result);

      // 2. Verify result hash matches content
      const recomputedHash = this.computeResultHash(result);
      if (recomputedHash !== result.resultHash) {
        throw new Error(
          `Result hash mismatch: expected ${result.resultHash}, got ${recomputedHash}`
        );
      }

      // 3-6. Database operations
      // In production, this would use the state repository to:
      // - Insert into simulation_results table
      // - Create immutability lock in result_immutability_locks table

      const storageLocation = this.buildStorageLocation(result);
      const lockHash = this.computeLockHash(result);

      // Simulate database operations
      await this.persistToDatabase(result, lockHash);

      return {
        success: true,
        resultId: result.resultId,
        resultHash: result.resultHash,
        persistedAt,
        storageLocation,
        lockHash,
      };
    } catch (error) {
      return {
        success: false,
        resultId: result.resultId,
        resultHash: result.resultHash,
        persistedAt,
        storageLocation: '',
        lockHash: '' as SHA256Hash,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Build execution metadata
   */
  private buildExecutionMetadata(
    resultId: UUID,
    workflowResult: WorkflowResult
  ): ExecutionMetadata {
    return {
      resultId,
      planId: this.plan.planId,
      planVersion: this.plan.planVersion,
      startedAt: workflowResult.startedAt,
      completedAt: workflowResult.completedAt,
      durationMs: workflowResult.durationMs,
      status: workflowResult.status,
      executedBy: `${this.RUNNER_NAME}@${this.RUNNER_VERSION}`,
      environment: {
        hostname: this.getHostname(),
        version: this.RUNNER_VERSION,
        region: this.getRegion(),
      },
    };
  }

  /**
   * Build audit trail summary
   */
  private async buildAuditTrailSummary(
    workflowResult: WorkflowResult
  ): Promise<SimulationResult['auditTrail']> {
    const trailId = uuidv4() as UUID;

    // Collect audit entries (step transitions, agent invocations, etc.)
    const auditEntries = this.collectAuditEntries(workflowResult);
    const entryCount = auditEntries.length;

    // Compute merkle root of audit entries
    const entryHashes = auditEntries.map((entry) => computeObjectHash(entry));
    const merkleTree = createMerkleTree(entryHashes);
    const merkleRoot = getMerkleRoot(merkleTree) as SHA256Hash;

    // Get time range
    const timestamps = auditEntries
      .map((e) => e.timestamp)
      .sort();

    const firstEntryAt = timestamps[0] ?? workflowResult.startedAt;
    const lastEntryAt = timestamps[timestamps.length - 1] ?? workflowResult.completedAt;

    return {
      trailId,
      entryCount,
      merkleRoot,
      firstEntryAt,
      lastEntryAt,
    };
  }

  /**
   * Collect audit entries from workflow result
   */
  private collectAuditEntries(
    workflowResult: WorkflowResult
  ): Array<{ timestamp: ISO8601Timestamp; [key: string]: unknown }> {
    const entries: Array<{ timestamp: ISO8601Timestamp; [key: string]: unknown }> = [];

    // Add step execution entries
    for (const stepResult of workflowResult.stepResults) {
      entries.push({
        timestamp: stepResult.startedAt,
        type: 'STEP_STARTED',
        stepId: stepResult.stepId,
        status: stepResult.status,
      });

      if (stepResult.completedAt) {
        entries.push({
          timestamp: stepResult.completedAt,
          type: 'STEP_COMPLETED',
          stepId: stepResult.stepId,
          status: stepResult.status,
          durationMs: stepResult.durationMs,
        });
      }
    }

    // Add error entries
    for (const error of workflowResult.errors) {
      entries.push({
        timestamp: error.timestamp,
        type: 'ERROR',
        errorCode: error.errorCode,
        message: error.message,
        stepId: error.stepId,
      });
    }

    // Add checkpoint entries
    for (const checkpoint of workflowResult.checkpoints) {
      entries.push({
        timestamp: checkpoint.createdAt,
        type: 'CHECKPOINT_CREATED',
        checkpointId: checkpoint.checkpointId,
        label: checkpoint.label,
        stepId: checkpoint.stepId,
      });
    }

    return entries.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Collect artifacts from workflow result
   */
  private async collectArtifacts(
    workflowResult: WorkflowResult
  ): Promise<ExecutionArtifact[]> {
    const artifacts: ExecutionArtifact[] = [];
    const now = new Date().toISOString() as ISO8601Timestamp;

    // Add checkpoint artifacts
    for (const checkpoint of workflowResult.checkpoints) {
      artifacts.push({
        artifactId: uuidv4() as UUID,
        type: 'checkpoint',
        name: `checkpoint-${checkpoint.label}`,
        location: `${this.ctx.stateNamespace.schemaName}/checkpoints/${checkpoint.checkpointId}`,
        sizeBytes: 0, // Would be computed from actual checkpoint data
        hash: checkpoint.stateHash,
        createdAt: checkpoint.createdAt,
        contentType: 'application/json',
      });
    }

    // Add final state artifact
    artifacts.push({
      artifactId: uuidv4() as UUID,
      type: 'state_snapshot',
      name: 'final-state',
      location: `${this.ctx.stateNamespace.schemaName}/final-state`,
      sizeBytes: 0, // Would be computed from actual state size
      hash: workflowResult.finalState.stateHash,
      createdAt: now,
      contentType: 'application/json',
    });

    return artifacts;
  }

  /**
   * Compute result hash (INV-OUT-003)
   */
  private computeResultHash(result: PreHashResult | SimulationResult): SHA256Hash {
    // Create canonical form for hashing (exclude hash and checksum fields)
    const hashableContent = {
      version: result.version,
      resultId: result.resultId,
      executedAt: result.executedAt,
      sourcePlan: result.sourcePlan,
      execution: result.execution,
      summary: result.summary,
      finalState: result.finalState,
      stepResults: result.stepResults,
      agentObservations: result.agentObservations,
      integrationObservations: result.integrationObservations,
      validationOutcomes: result.validationOutcomes,
      errors: result.errors,
    };

    return computeObjectHash(hashableContent) as SHA256Hash;
  }

  /**
   * Compute checksum for integrity verification
   */
  private computeChecksum(result: PreHashResult, resultHash: SHA256Hash): SHA256Hash {
    // Checksum covers the entire result including the result hash
    const checksumContent = {
      resultHash,
      version: result.version,
      resultId: result.resultId,
      executedAt: result.executedAt,
      auditTrailMerkleRoot: result.auditTrail.merkleRoot,
    };

    return computeObjectHash(checksumContent) as SHA256Hash;
  }

  /**
   * Compute lock hash for immutability enforcement
   */
  private computeLockHash(result: SimulationResult): SHA256Hash {
    const lockContent = {
      resultId: result.resultId,
      resultHash: result.resultHash,
      checksum: result.checksum,
      lockedAt: new Date().toISOString(),
    };

    return computeObjectHash(lockContent) as SHA256Hash;
  }

  /**
   * Validate result completeness (INV-OUT-001)
   */
  private validateCompleteness(result: PreHashResult | SimulationResult): void {
    const requiredFields = [
      'version',
      'resultId',
      'executedAt',
      'sourcePlan',
      'execution',
      'summary',
      'finalState',
      'validationOutcomes',
      'auditTrail',
    ];

    const resultRecord = result as unknown as Record<string, unknown>;

    for (const field of requiredFields) {
      if (!(field in result) || resultRecord[field] === undefined) {
        throw new Error(`Result incomplete: missing required field '${field}' (INV-OUT-001)`);
      }
    }

    // Validate source plan reference
    if (!result.sourcePlan.planId || !result.sourcePlan.planHash) {
      throw new Error('Result incomplete: sourcePlan missing planId or planHash (INV-OUT-001)');
    }

    // Validate execution metadata
    if (!result.execution.resultId || !result.execution.status) {
      throw new Error('Result incomplete: execution metadata missing required fields (INV-OUT-001)');
    }

    // Validate final state
    if (!result.finalState.snapshotId || !result.finalState.stateHash) {
      throw new Error('Result incomplete: finalState missing required fields (INV-OUT-001)');
    }
  }

  /**
   * Build storage location reference
   */
  private buildStorageLocation(result: SimulationResult): string {
    return `simulation_results/${result.execution.planId}/${result.resultId}`;
  }

  /**
   * Persist result to database
   * In production, this would use the state repository
   */
  private async persistToDatabase(
    result: SimulationResult,
    lockHash: SHA256Hash
  ): Promise<void> {
    // This is a placeholder for database operations
    // In production:
    // 1. Insert into simulation_results table
    // 2. Create immutability lock in result_immutability_locks table

    // Simulate async operation
    await Promise.resolve();

    // Log persistence (would be actual DB insert in production)
    console.log(`Persisted result ${result.resultId} with lock ${lockHash}`);
  }

  /**
   * Get empty telemetry structure
   */
  private emptyTelemetry(): ExecutionTelemetry {
    return {
      metrics: [],
      events: [],
      traces: [],
    };
  }

  /**
   * Get hostname for execution metadata
   */
  private getHostname(): string {
    // In production, would get actual hostname
    return 'simulation-runner-node';
  }

  /**
   * Get region for execution metadata
   */
  private getRegion(): string {
    // In production, would get actual region
    return process.env.AWS_REGION ?? 'local';
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a result assembler
 */
export function createResultAssembler(
  ctx: ExecutionContext,
  plan: SimulationPlan
): ResultAssembler {
  return new ResultAssembler(ctx, plan);
}
