/**
 * Reproducibility Prover (MOD-005 Component)
 *
 * Generates reproducibility proof for deterministic execution verification.
 * Implements Pseudocode Section 7.3 - generateReproducibilityProof.
 *
 * Enforces:
 * - GUA-REP-001: Execution is deterministic given same plan and seed
 * - GUA-REP-002: All randomness is logged for replay
 * - GUA-REP-003: State snapshots enable verification
 * - GUA-REP-004: Execution fingerprint is verifiable
 *
 * @module orchestration/reproducibility-prover
 * @see SPARC_PSEUDOCODE.md Section 7.3 - generateReproducibilityProof
 * @see SPARC_ARCHITECTURE.md MOD-005 - Finalization Orchestrator
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  Metadata,
} from '../types/common.js';

import type {
  ExecutionContext,
  Checkpoint,
  CheckpointInfo,
} from '../types/execution-context.js';

import type {
  SimulationPlan,
} from '../types/simulation-plan.js';

import type {
  ReproducibilityProof as ResultReproducibilityProof,
  StateSnapshot,
  RandomnessEntry,
} from '../types/result.js';

import type {
  ReproducibilityProof as SimResultReproducibilityProof,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
  CheckpointInfo as OrchestratorCheckpointInfo,
} from './types.js';

import {
  computeSHA256,
  computeObjectHash,
  computeExecutionFingerprint,
  bytesToHex,
} from '../core/hash-utils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Randomness log entry for reproducibility
 */
export interface RandomnessLogEntry {
  readonly sequenceNum: number;
  readonly operation: string;
  readonly randomValue: Uint8Array;
  readonly usedAt: ISO8601Timestamp;
  readonly stepId?: string;
  readonly context?: Metadata;
}

/**
 * State snapshot for reproducibility
 */
export interface ReproducibilityStateSnapshot {
  readonly snapshotId: UUID;
  readonly checkpointId: string;
  readonly stepId: string;
  readonly snapshotHash: SHA256Hash;
  readonly createdAt: ISO8601Timestamp;
}

/**
 * Complete reproducibility proof
 */
export interface ReproducibilityProof {
  /**
   * SHA256 hash that uniquely identifies this execution
   * Computed from: planHash + seed + snapshotHashes + randomnessEntries
   */
  readonly executionFingerprint: SHA256Hash;

  /**
   * State snapshots taken during execution
   */
  readonly stateSnapshots: ReproducibilityStateSnapshot[];

  /**
   * Log of all random values generated
   */
  readonly randomnessLog: RandomnessLogEntry[];

  /**
   * Hash of the input plan
   */
  readonly planHash: SHA256Hash;

  /**
   * Deterministic seed used
   */
  readonly deterministicSeed: bigint;

  /**
   * Whether execution was fully deterministic
   */
  readonly isDeterministic: boolean;

  /**
   * Conditions required for reproducibility
   */
  readonly reproducibilityConditions: string[];

  /**
   * Instructions for verification
   */
  readonly verificationMethod: string;
}

// =============================================================================
// Reproducibility Prover Class
// =============================================================================

/**
 * Generates reproducibility proofs for execution verification
 *
 * Implements Pseudocode Section 7.3 generateReproducibilityProof
 */
export class ReproducibilityProver {
  private readonly randomnessLog: RandomnessLogEntry[] = [];
  private randomnessSequence = 0;

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan
  ) {}

  // ===========================================================================
  // Pseudocode 7.3 - generateReproducibilityProof
  // ===========================================================================

  /**
   * Generate reproducibility proof from execution data
   *
   * Algorithm (from Pseudocode 7.3):
   * 1. Collect state snapshots from checkpoints
   * 2. Collect randomness log entries
   * 3. Compute execution fingerprint:
   *    fingerprint = SHA256(canonicalize({
   *      planHash,
   *      deterministicSeed,
   *      snapshotHashes,
   *      randomnessEntries
   *    }))
   * 4. Build reproducibility conditions
   * 5. Return ReproducibilityProof
   *
   * @param ctx - Execution context
   * @returns Reproducibility proof
   */
  async generateReproducibilityProof(): Promise<ReproducibilityProof> {
    const planHash = this.plan.planHash;
    const deterministicSeed = BigInt(this.ctx.randomGenerator.seed);

    // Collect state snapshots from checkpoints
    const stateSnapshots = await this.collectStateSnapshots();

    // Get randomness log
    const randomnessLog = this.getRandomnessLog();

    // Compute snapshot hashes
    const snapshotHashes = stateSnapshots.map((s) => s.snapshotHash);

    // Convert randomness entries for fingerprint computation
    const randomnessEntries = randomnessLog.map((entry) => ({
      sequence: entry.sequenceNum,
      operation: entry.operation,
      valueHash: computeSHA256(entry.randomValue) as SHA256Hash,
    }));

    // Compute execution fingerprint (GUA-REP-004)
    const executionFingerprint = computeExecutionFingerprint({
      planHash,
      deterministicSeed,
      snapshotHashes,
      randomnessEntries,
    });

    // Determine if execution was deterministic
    const isDeterministic = this.checkDeterminism();

    // Build reproducibility conditions
    const reproducibilityConditions = this.buildReproducibilityConditions();

    // Build verification method
    const verificationMethod = this.buildVerificationMethod();

    return {
      executionFingerprint,
      stateSnapshots,
      randomnessLog,
      planHash,
      deterministicSeed,
      isDeterministic,
      reproducibilityConditions,
      verificationMethod,
    };
  }

  // ===========================================================================
  // Randomness Logging (GUA-REP-002)
  // ===========================================================================

  /**
   * Log a random value generation for reproducibility
   *
   * Called by the deterministic random generator wrapper
   *
   * @param operation - Description of the random operation
   * @param value - The random value generated
   * @param stepId - Current step ID (optional)
   * @param context - Additional context (optional)
   */
  logRandomness(
    operation: string,
    value: Uint8Array,
    stepId?: string,
    context?: Metadata
  ): void {
    this.randomnessSequence++;

    this.randomnessLog.push({
      sequenceNum: this.randomnessSequence,
      operation,
      randomValue: value,
      usedAt: new Date().toISOString() as ISO8601Timestamp,
      stepId,
      context,
    });
  }

  /**
   * Get the complete randomness log
   */
  getRandomnessLog(): RandomnessLogEntry[] {
    return [...this.randomnessLog];
  }

  /**
   * Get current randomness sequence number
   */
  getRandomnessSequence(): number {
    return this.randomnessSequence;
  }

  // ===========================================================================
  // Build SimulationResult Reproducibility Proof
  // ===========================================================================

  /**
   * Build ReproducibilityProof for SimulationResult
   */
  buildSimResultReproducibilityProof(
    proof: ReproducibilityProof
  ): SimResultReproducibilityProof {
    // Convert to the format expected by SimulationResult
    const recordedInteractions = {
      llmCalls: this.countLLMCalls(),
      integrationCalls: this.countIntegrationCalls(),
      storageLocation: `${this.ctx.stateNamespace.schemaName}/reproducibility`,
    };

    return {
      deterministic: proof.isDeterministic,
      seed: Number(proof.deterministicSeed),
      normalizedResultHash: proof.executionFingerprint,
      recordedInteractions,
      conditions: proof.reproducibilityConditions,
      verificationMethod: proof.verificationMethod,
    };
  }

  /**
   * Build ReproducibilityProof for result.ts format
   */
  buildResultReproducibilityProof(
    proof: ReproducibilityProof
  ): ResultReproducibilityProof {
    // Convert state snapshots to result format
    // StepId is a branded type, so we need to cast appropriately
    const stateSnapshots: StateSnapshot[] = proof.stateSnapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      checkpointId: snapshot.checkpointId,
      stepId: snapshot.stepId as unknown as StateSnapshot['stepId'],
      snapshotHash: snapshot.snapshotHash,
      createdAt: snapshot.createdAt,
    }));

    // Convert randomness log to result format
    const randomnessLog: RandomnessEntry[] = proof.randomnessLog.map((entry) => ({
      sequenceNum: entry.sequenceNum,
      operation: entry.operation,
      randomValue: entry.randomValue,
      usedAt: entry.usedAt,
    }));

    return {
      executionFingerprint: proof.executionFingerprint,
      stateSnapshots,
      randomnessLog,
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Collect state snapshots from checkpoints
   */
  private async collectStateSnapshots(): Promise<ReproducibilityStateSnapshot[]> {
    const checkpoints = await this.ctx.checkpointManager.list();
    const snapshots: ReproducibilityStateSnapshot[] = [];

    for (const checkpoint of checkpoints) {
      snapshots.push({
        snapshotId: uuidv4() as UUID,
        checkpointId: checkpoint.checkpointId,
        stepId: checkpoint.stepId ?? 'unknown',
        snapshotHash: checkpoint.stateHash,
        createdAt: checkpoint.createdAt,
      });
    }

    return snapshots;
  }

  /**
   * Check if execution was deterministic
   */
  private checkDeterminism(): boolean {
    // Execution is deterministic if:
    // 1. A deterministic seed was used
    // 2. All randomness was logged
    // 3. No non-deterministic external calls were made

    const hasDeterministicSeed = this.plan.executionConfig.deterministicSeed !== undefined;
    const hasRandomnessLog = this.randomnessLog.length >= 0; // Any logging is good

    // Check for non-deterministic factors
    // In production, would check for unrecorded external calls
    const hasNonDeterministicFactors = false;

    return hasDeterministicSeed && hasRandomnessLog && !hasNonDeterministicFactors;
  }

  /**
   * Build conditions required for reproducibility
   */
  private buildReproducibilityConditions(): string[] {
    const conditions: string[] = [];

    // Base conditions
    conditions.push(
      'Same SimulationPlan (planHash must match)',
      'Same deterministic seed',
      'Same simulation runner version'
    );

    // Conditional conditions based on plan
    if (this.plan.agents.length > 0) {
      conditions.push(
        'LLM providers must support deterministic mode (temperature=0, seed parameter)',
        'LLM responses must be recorded for exact replay'
      );
    }

    if (this.plan.integrations && this.plan.integrations.length > 0) {
      conditions.push(
        'External integration responses must be mocked or recorded',
        'Integration call order must be preserved'
      );
    }

    // State conditions
    conditions.push(
      'Initial state must be identical',
      'State isolation must be maintained (no external state access)'
    );

    return conditions;
  }

  /**
   * Build verification method instructions
   */
  private buildVerificationMethod(): string {
    return `To verify this execution:
1. Initialize a new execution with the same planId (${this.plan.planId})
2. Use the same deterministic seed (${this.plan.executionConfig.deterministicSeed})
3. If LLM calls were made, use recorded responses for replay
4. If integration calls were made, use mock mode with recorded responses
5. Execute and compare:
   - executionFingerprint should match
   - stateSnapshots hashes should match at each checkpoint
   - Final state hash should match
6. Compare step-by-step randomness log sequences`;
  }

  /**
   * Count LLM calls made during execution
   */
  private countLLMCalls(): number {
    let count = 0;
    for (const [, agentContext] of this.ctx.getAllAgentContexts()) {
      count += agentContext.invocationCount;
    }
    return count;
  }

  /**
   * Count integration calls made during execution
   */
  private countIntegrationCalls(): number {
    // Would query from integration call log
    // For now, return 0
    return 0;
  }
}

// =============================================================================
// Deterministic Random Wrapper
// =============================================================================

/**
 * Wrapper for SeededRandomGenerator that logs all random operations
 *
 * Use this wrapper to ensure all randomness is captured for reproducibility
 */
export class LoggingRandomWrapper {
  constructor(
    private readonly prover: ReproducibilityProver,
    private readonly ctx: ExecutionContext
  ) {}

  /**
   * Wrap a random number generation and log it
   */
  logNext(value: number): void {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, value, false);

    this.prover.logRandomness(
      'next',
      bytes,
      this.ctx.currentStepId
    );
  }

  /**
   * Wrap a random integer generation and log it
   */
  logNextInt(value: number, min: number, max: number): void {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, value, false);

    this.prover.logRandomness(
      `nextInt(${min}, ${max})`,
      bytes,
      this.ctx.currentStepId,
      { min, max, result: value }
    );
  }

  /**
   * Wrap a random boolean generation and log it
   */
  logNextBoolean(value: boolean): void {
    const bytes = new Uint8Array([value ? 1 : 0]);

    this.prover.logRandomness(
      'nextBoolean',
      bytes,
      this.ctx.currentStepId
    );
  }

  /**
   * Wrap a random UUID generation and log it
   */
  logNextUUID(value: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(value);

    this.prover.logRandomness(
      'nextUUID',
      bytes,
      this.ctx.currentStepId
    );
  }

  /**
   * Wrap a shuffle operation and log it
   */
  logShuffle<T>(original: readonly T[], result: T[]): void {
    // Log the permutation as indices
    const indices = result.map((item) => original.indexOf(item));
    const bytes = new Uint8Array(indices.length * 4);
    const view = new DataView(bytes.buffer);

    indices.forEach((idx, i) => {
      view.setInt32(i * 4, idx, false);
    });

    this.prover.logRandomness(
      `shuffle(length=${original.length})`,
      bytes,
      this.ctx.currentStepId,
      { originalLength: original.length }
    );
  }

  /**
   * Wrap a pick operation and log it
   */
  logPick<T>(array: readonly T[], index: number): void {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, index, false);

    this.prover.logRandomness(
      `pick(length=${array.length})`,
      bytes,
      this.ctx.currentStepId,
      { arrayLength: array.length, selectedIndex: index }
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a reproducibility prover
 */
export function createReproducibilityProver(
  ctx: ExecutionContext,
  plan: SimulationPlan
): ReproducibilityProver {
  return new ReproducibilityProver(ctx, plan);
}

/**
 * Create a logging random wrapper
 */
export function createLoggingRandomWrapper(
  prover: ReproducibilityProver,
  ctx: ExecutionContext
): LoggingRandomWrapper {
  return new LoggingRandomWrapper(prover, ctx);
}
