/**
 * Deterministic Utilities for Agentics Simulation Runner
 *
 * This module exports all utility functions required for deterministic
 * simulation execution as specified in the SPARC documentation.
 *
 * @module src/utils
 *
 * Key invariants:
 * - INV-EX-001: All utilities maintain determinism given identical seed
 * - GUA-REP-002: All random values are logged for reproducibility
 * - INV-EX-004: Dependency ordering is enforced by topological sort
 *
 * @see SPARC_REFINEMENT.md for detailed specifications
 */

// Deterministic Random Number Generation (Refinement 2.3)
export {
  DeterministicRandom,
  createDeterministicRandom,
  type DeterministicRandomState,
  type RandomnessLogEntry,
  type RandomnessLogger,
  InMemoryRandomnessLogger,
} from './deterministic-random.js';

// SHA256 Hashing and Canonical Serialization (Refinement 2.5)
export {
  computeSHA256,
  computeSHA256Raw,
  computeSHA256Combined,
  verifySHA256,
  canonicalize,
  computeExecutionFingerprint,
  computeRandomnessEntryHash,
  type SHA256Hash,
  type ExecutionFingerprintData,
} from './hash.js';

// Topological Sort for Dependency Ordering (Pseudocode 3.2, Refinement 4)
export {
  topologicalSort,
  hasCycles,
  detectCycle,
  validateDependencies,
  getDependencies,
  getDependents,
  findParallelGroups,
  CyclicDependencyError,
  InvalidDependencyError,
  type Dependency,
  type Step,
} from './topological-sort.js';

// Retry with Exponential Backoff (Refinement 5.2)
export {
  computeRetryDelay,
  executeWithRetry,
  createRetryContext,
  computeAllRetryDelays,
  isRetryableError,
  noopRetryLogger,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryContext,
  type RetryDelayResult,
  type RetryResult,
  type RetryAttemptInfo,
  type RetryLogger,
} from './retry.js';
