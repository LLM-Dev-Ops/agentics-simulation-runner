/**
 * Context Factory (MOD-003.1)
 *
 * Creates isolated ExecutionContext for each simulation run.
 * Implements Phase 2, Step 4.1 from SPARC Pseudocode.
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4.1 - Create Execution Context
 * - SPARC_ARCHITECTURE.md MOD-003 - Instantiation Orchestrator
 *
 * Invariants enforced:
 * - INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
 */

import { randomUUID } from 'crypto';
import type {
  ExecutionId,
  UUID,
  SHA256Hash,
  IsolationLevel,
  ResourceLimits,
  DurationMs,
} from '../types/common.js';
import type {
  ExecutionContext,
  DeterministicRandom,
  RandomState,
} from '../types/execution.js';
import type { SimulationPlan } from '../types/plan.js';
import {
  DeterministicRandom as DeterministicRandomImpl,
  type DeterministicRandomState,
} from '../utils/deterministic-random.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating an execution context
 */
export interface ExecutionContextConfig {
  readonly tenantId: UUID;
  readonly plan: SimulationPlan;
  readonly overrideResourceLimits?: Partial<ResourceLimits>;
  readonly overrideMaxDuration?: DurationMs;
  readonly overrideIsolationLevel?: IsolationLevel;
}

/**
 * Result of context creation
 */
export interface ExecutionContextResult {
  readonly context: ExecutionContext;
  readonly stateNamespace: string;
  readonly createdAt: Date;
}

// ============================================================================
// DeterministicRandom Adapter
// ============================================================================

/**
 * Adapter class that wraps the utility DeterministicRandom to match
 * the ExecutionContext.DeterministicRandom interface
 */
class DeterministicRandomAdapter implements DeterministicRandom {
  private readonly impl: DeterministicRandomImpl;
  readonly initialSeed: bigint;

  constructor(seed: bigint) {
    this.initialSeed = seed;
    this.impl = new DeterministicRandomImpl(seed.toString());
  }

  /**
   * Get next random float in [0, 1)
   */
  next(): number {
    return this.impl.nextFloat('next');
  }

  /**
   * Get next random integer in [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return this.impl.nextInt(min, max, `nextInt:${min}-${max}`);
  }

  /**
   * Get next random bytes
   */
  nextBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = this.impl.nextInt(0, 255, `nextBytes:${i}`);
    }
    return bytes;
  }

  /**
   * Get current generator state for checkpointing
   */
  getState(): RandomState {
    const internalState = this.impl.getState();
    return {
      seed: this.initialSeed,
      callCount: this.impl.getSequenceNumber(),
      state: internalState,
    };
  }

  /**
   * Get the current seed (same as initial in this implementation)
   */
  currentSeed(): bigint {
    return this.initialSeed;
  }

  /**
   * Create a subsequence for parallel operations
   */
  createSubsequence(id: string): DeterministicRandomAdapter {
    const subImpl = this.impl.createSubsequence(id);
    const subAdapter = new DeterministicRandomAdapter(this.initialSeed);
    // @ts-expect-error - Replacing internal implementation
    subAdapter.impl = subImpl;
    return subAdapter;
  }
}

// ============================================================================
// Context Factory
// ============================================================================

/**
 * Creates a new ExecutionContext for a simulation plan
 *
 * From Pseudocode 4.1:
 * 1. Generate executionId (UUID)
 * 2. Initialize DeterministicRandom from plan.executionConfig.deterministicSeed
 * 3. Create context in ruvvector-postgres execution_contexts table
 * 4. Create stateNamespace = "execution:" + executionId (for INV-EX-002 isolation)
 *
 * @param config - Configuration for the execution context
 * @returns ExecutionContextResult with the created context
 */
export function createExecutionContext(config: ExecutionContextConfig): ExecutionContextResult {
  const { tenantId, plan, overrideResourceLimits, overrideMaxDuration, overrideIsolationLevel } =
    config;

  // 1. Generate unique execution ID (UUID v4)
  const executionId = randomUUID() as ExecutionId;

  // 2. Create state namespace for isolation (INV-EX-002)
  // Format: "execution:{executionId}" to ensure unique namespace per execution
  const stateNamespace = `execution:${executionId}`;

  // 3. Initialize deterministic random generator from plan seed
  const randomGenerator = new DeterministicRandomAdapter(plan.executionConfig.deterministicSeed);

  // 4. Merge resource limits (plan defaults + overrides)
  const resourceLimits: ResourceLimits = {
    ...plan.executionConfig.resourceLimits,
    ...overrideResourceLimits,
  };

  // 5. Determine max duration (override or from plan)
  const maxDuration = overrideMaxDuration ?? plan.executionConfig.maxDuration;

  // 6. Determine isolation level
  const isolationLevel = overrideIsolationLevel ?? mapIsolationLevel(plan.executionConfig.isolationLevel);

  // 7. Record creation timestamp
  const createdAt = new Date();

  // 8. Build the ExecutionContext
  const context: ExecutionContext = {
    executionId,
    planRef: {
      planId: plan.planId,
      planHash: plan.planHash,
    },
    tenantId,
    stateNamespace,
    randomGenerator,
    startTime: createdAt,
    resourceLimits,
    maxDuration,
    isolationLevel,
  };

  return {
    context,
    stateNamespace,
    createdAt,
  };
}

/**
 * Maps plan isolation level string to common IsolationLevel type
 */
function mapIsolationLevel(level: string): IsolationLevel {
  switch (level) {
    case 'READ_COMMITTED':
      return 'read_committed';
    case 'REPEATABLE_READ':
      return 'repeatable_read';
    case 'SERIALIZABLE':
      return 'serializable';
    default:
      return 'read_committed';
  }
}

/**
 * Validates that an execution context is properly initialized
 *
 * @param context - The context to validate
 * @returns true if valid, throws if invalid
 */
export function validateExecutionContext(context: ExecutionContext): boolean {
  if (!context.executionId) {
    throw new Error('ExecutionContext missing executionId');
  }

  if (!context.planRef?.planId || !context.planRef?.planHash) {
    throw new Error('ExecutionContext missing plan reference');
  }

  if (!context.stateNamespace) {
    throw new Error('ExecutionContext missing stateNamespace');
  }

  if (!context.randomGenerator) {
    throw new Error('ExecutionContext missing randomGenerator');
  }

  if (!context.startTime) {
    throw new Error('ExecutionContext missing startTime');
  }

  // Validate namespace format
  if (!context.stateNamespace.startsWith('execution:')) {
    throw new Error('ExecutionContext stateNamespace must start with "execution:"');
  }

  return true;
}

/**
 * Creates a derived context for a sub-execution (e.g., nested workflows)
 *
 * @param parentContext - The parent execution context
 * @param subExecutionId - ID for the sub-execution
 * @returns A new context derived from the parent
 */
export function createDerivedContext(
  parentContext: ExecutionContext,
  subExecutionId: string
): ExecutionContext {
  // Create a derived namespace
  const derivedNamespace = `${parentContext.stateNamespace}:sub:${subExecutionId}`;

  // Create a derived random generator
  const parentRandomAdapter = parentContext.randomGenerator as DeterministicRandomAdapter;
  const derivedRandom = parentRandomAdapter.createSubsequence(subExecutionId);

  return {
    ...parentContext,
    stateNamespace: derivedNamespace,
    randomGenerator: derivedRandom,
    startTime: new Date(),
  };
}

/**
 * Computes a deterministic execution fingerprint for reproducibility verification
 *
 * @param context - The execution context
 * @returns A fingerprint string
 */
export function computeContextFingerprint(context: ExecutionContext): string {
  const components = [
    context.planRef.planHash,
    context.randomGenerator.initialSeed.toString(),
    context.isolationLevel,
    context.maxDuration.toString(),
    JSON.stringify(context.resourceLimits),
  ];

  // Simple hash computation (in production, use crypto hash)
  return components.join(':');
}
