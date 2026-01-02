/**
 * Deterministic Random Number Generator
 *
 * Implements deterministic PRNG using seedrandom for reproducible simulations.
 * MUST be seeded from plan.executionConfig.deterministicSeed (Refinement 2.3)
 *
 * @module src/utils/deterministic-random
 * @see SPARC_REFINEMENT.md Section 2.3 - Deterministic Random Number Generation
 *
 * Invariant: INV-EX-001 - Given identical seed, produces identical random sequences
 * Guarantee: GUA-REP-002 - All random values logged for reproducibility verification
 */

import seedrandom from 'seedrandom';

// Extend the seedrandom types to include the state method
declare module 'seedrandom' {
  interface PRNG {
    state(): object;
  }
}

/**
 * Represents a single entry in the randomness log for audit/replay
 */
export interface RandomnessLogEntry {
  sequenceNum: number;
  operation: string;
  randomValue: bigint;
  usedAt: Date;
}

/**
 * Serializable state for snapshots (Refinement 3.3)
 */
export interface DeterministicRandomState {
  seed: string;
  sequenceNumber: number;
  internalState: string;
}

/**
 * Logger interface for randomness log entries
 * Can be implemented to persist to database or memory
 */
export interface RandomnessLogger {
  log(entry: RandomnessLogEntry): void;
}

/**
 * Default in-memory logger for testing
 */
export class InMemoryRandomnessLogger implements RandomnessLogger {
  private entries: RandomnessLogEntry[] = [];

  log(entry: RandomnessLogEntry): void {
    this.entries.push(entry);
  }

  getEntries(): ReadonlyArray<RandomnessLogEntry> {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * DeterministicRandom - Seeded PRNG for reproducible random number generation
 *
 * Uses seedrandom (Mersenne Twister based) for high-quality deterministic randomness.
 * All random values are logged for reproducibility verification per GUA-REP-002.
 *
 * @example
 * ```typescript
 * const prng = new DeterministicRandom(plan.executionConfig.deterministicSeed);
 * const value = prng.next('step_1_selection');
 *
 * // For parallel steps, create subsequences (Refinement 4.3)
 * const subPrng = prng.createSubsequence('step_2');
 * ```
 */
export class DeterministicRandom {
  private rng: seedrandom.PRNG;
  private readonly initialSeed: string;
  private sequenceNumber: number = 0;
  private logger: RandomnessLogger;

  /**
   * Creates a new deterministic random generator
   *
   * @param seed - The deterministic seed (from plan.executionConfig.deterministicSeed)
   * @param logger - Optional logger for randomness log entries
   * @param initialSequence - Starting sequence number (for restoration from snapshot)
   */
  constructor(
    seed: string | number,
    logger?: RandomnessLogger,
    initialSequence: number = 0
  ) {
    this.initialSeed = String(seed);
    this.rng = seedrandom(this.initialSeed, { state: true });
    this.sequenceNumber = initialSequence;
    this.logger = logger ?? new InMemoryRandomnessLogger();

    // Advance to the initial sequence position if resuming
    for (let i = 0; i < initialSequence; i++) {
      this.rng();
    }
  }

  /**
   * Get the next random UInt64 value
   *
   * @param operation - Description of the operation using this random value
   *                    (e.g., "retry:integration_call", "step_selection")
   * @returns A 64-bit unsigned integer as bigint
   *
   * @see SPARC_REFINEMENT.md Section 2.3 - USAGE PATTERN
   */
  next(operation: string = 'unspecified'): bigint {
    // Generate two 32-bit values and combine into 64-bit
    const high = Math.floor(this.rng() * 0x100000000);
    const low = Math.floor(this.rng() * 0x100000000);

    const value = (BigInt(high) << 32n) | BigInt(low);

    // Log the random value for reproducibility verification (GUA-REP-002)
    this.logger.log({
      sequenceNum: this.sequenceNumber,
      operation,
      randomValue: value,
      usedAt: new Date(),
    });

    this.sequenceNumber++;
    return value;
  }

  /**
   * Get a random float in [0, 1)
   *
   * @param operation - Description of the operation
   * @returns A float in the range [0, 1)
   */
  nextFloat(operation: string = 'unspecified'): number {
    const value = this.rng();

    // Log with bigint representation for consistency
    this.logger.log({
      sequenceNum: this.sequenceNumber,
      operation,
      randomValue: BigInt(Math.floor(value * Number.MAX_SAFE_INTEGER)),
      usedAt: new Date(),
    });

    this.sequenceNumber++;
    return value;
  }

  /**
   * Get a random integer in [min, max] (inclusive)
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @param operation - Description of the operation
   * @returns Random integer in the specified range
   */
  nextInt(min: number, max: number, operation: string = 'unspecified'): number {
    const range = max - min + 1;
    const value = Math.floor(this.nextFloat(operation) * range) + min;
    return value;
  }

  /**
   * Get the current serializable state for snapshots
   *
   * @returns Serializable state that can be persisted
   * @see SPARC_REFINEMENT.md Section 3.3 - StateSnapshot.prngState
   */
  getState(): DeterministicRandomState {
    return {
      seed: this.initialSeed,
      sequenceNumber: this.sequenceNumber,
      internalState: JSON.stringify(this.rng.state()),
    };
  }

  /**
   * Restore state from a snapshot
   *
   * @param state - Previously captured state from getState()
   * @see SPARC_REFINEMENT.md Section 3.3 - State Snapshot Strategy
   */
  setState(state: DeterministicRandomState): void {
    if (state.seed !== this.initialSeed) {
      throw new Error(
        `Cannot restore state with different seed. ` +
        `Expected: ${this.initialSeed}, Got: ${state.seed}`
      );
    }

    // Restore internal seedrandom state
    const parsedState = JSON.parse(state.internalState);
    this.rng = seedrandom('', { state: parsedState });
    this.sequenceNumber = state.sequenceNumber;
  }

  /**
   * Create a subsequence for parallel step execution
   *
   * Each parallel step gets its own deterministic random stream derived
   * from the parent stream + step ID, ensuring reproducibility regardless
   * of execution order.
   *
   * @param id - Unique identifier for the subsequence (typically stepId)
   * @returns A new DeterministicRandom instance for the subsequence
   *
   * @see SPARC_REFINEMENT.md Section 4.3 - RANDOM SUBSEQUENCE ALLOCATION
   */
  createSubsequence(id: string): DeterministicRandom {
    // Derive a new seed from the parent seed + subsequence ID
    // This ensures deterministic but independent random streams
    const derivedSeed = `${this.initialSeed}:subsequence:${id}`;

    return new DeterministicRandom(derivedSeed, this.logger);
  }

  /**
   * Get the initial seed used to create this generator
   */
  getInitialSeed(): string {
    return this.initialSeed;
  }

  /**
   * Get the current sequence number
   */
  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  /**
   * Get the logger instance
   */
  getLogger(): RandomnessLogger {
    return this.logger;
  }
}

/**
 * Factory function to create a DeterministicRandom from plan configuration
 *
 * @param deterministicSeed - The seed from plan.executionConfig.deterministicSeed
 * @param logger - Optional logger for audit trail
 * @returns Configured DeterministicRandom instance
 */
export function createDeterministicRandom(
  deterministicSeed: string | number,
  logger?: RandomnessLogger
): DeterministicRandom {
  return new DeterministicRandom(deterministicSeed, logger);
}
