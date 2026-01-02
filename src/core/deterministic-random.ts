/**
 * Deterministic Random Number Generator
 *
 * Implements INV-EX-001: Given identical SimulationPlan and deterministicSeed,
 * execution MUST produce byte-identical SimulationResult
 *
 * Implements GUA-REP-002: Random operations use deterministicSeed
 *
 * References:
 * - SPARC_SPECIFICATION.md Section 5.1 INV-EX-001
 * - SPARC_PSEUDOCODE.md Section 4.1 createExecutionContext
 */

import seedrandom from 'seedrandom';
import type { DeterministicRandom, RandomState } from '../types/execution.js';

/**
 * Creates a deterministic random number generator from a seed
 * All random operations are logged for reproducibility proof generation
 */
export function createDeterministicRandom(seed: bigint): DeterministicRandom {
  // Convert bigint seed to string for seedrandom
  const seedStr = seed.toString();
  const rng = seedrandom(seedStr, { state: true });

  let callCount = 0;

  return {
    initialSeed: seed,

    /**
     * Generate next random number in [0, 1)
     */
    next(): number {
      callCount++;
      return rng();
    },

    /**
     * Generate random integer in [min, max] inclusive
     */
    nextInt(min: number, max: number): number {
      callCount++;
      const range = max - min + 1;
      return Math.floor(rng() * range) + min;
    },

    /**
     * Generate random bytes
     */
    nextBytes(length: number): Uint8Array {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        callCount++;
        bytes[i] = Math.floor(rng() * 256);
      }
      return bytes;
    },

    /**
     * Get current state for checkpointing
     */
    getState(): RandomState {
      return {
        seed,
        callCount,
        state: rng.state(),
      };
    },

    /**
     * Get current seed for LLM invocations
     */
    currentSeed(): bigint {
      // Combine initial seed with call count for unique per-call seed
      return seed + BigInt(callCount);
    },
  };
}

/**
 * Restore a deterministic random generator from a saved state
 * Used for checkpoint restoration
 */
export function restoreDeterministicRandom(state: RandomState): DeterministicRandom {
  const seedStr = state.seed.toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rng = seedrandom(seedStr, { state: state.state as any });

  let callCount = state.callCount;

  return {
    initialSeed: state.seed,

    next(): number {
      callCount++;
      return rng();
    },

    nextInt(min: number, max: number): number {
      callCount++;
      const range = max - min + 1;
      return Math.floor(rng() * range) + min;
    },

    nextBytes(length: number): Uint8Array {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        callCount++;
        bytes[i] = Math.floor(rng() * 256);
      }
      return bytes;
    },

    getState(): RandomState {
      return {
        seed: state.seed,
        callCount,
        state: rng.state(),
      };
    },

    currentSeed(): bigint {
      return state.seed + BigInt(callCount);
    },
  };
}
