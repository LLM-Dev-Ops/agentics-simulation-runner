/**
 * Checkpoint Manager for Execution State Snapshots
 *
 * Creates and restores execution checkpoints for pause/resume capability
 * and rollback support. Enforces GUA-REP-003 (reproducibility) by
 * capturing complete state including PRNG state.
 *
 * @module orchestration/checkpoint-manager
 * @see SPARC_PSEUDOCODE.md Section 5.5 - Checkpoint Creation
 * @see SPARC_ARCHITECTURE.md MOD-004 - Execution Orchestrator
 * @see GUA-REP-003 - Reproducibility through state snapshots
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
  AgentContext,
} from '../types/execution-context.js';

import type { StepResult } from '../types/simulation-result.js';

import type {
  CheckpointDefinition,
  CheckpointData,
  CheckpointInfo as OrchestratorCheckpointInfo,
} from './types.js';

import { computeObjectHash } from '../core/hash-utils.js';

// =============================================================================
// Checkpoint Creation Options
// =============================================================================

/**
 * Options for creating a checkpoint
 */
export interface CreateCheckpointOptions {
  /**
   * Checkpoint label
   */
  readonly label: string;

  /**
   * Step ID this checkpoint is associated with
   */
  readonly stepId?: string;

  /**
   * Step result at checkpoint time
   */
  readonly stepResult?: StepResult;

  /**
   * Whether to capture full state data
   */
  readonly captureState: boolean;

  /**
   * Whether to capture metrics
   */
  readonly captureMetrics: boolean;

  /**
   * Whether to capture vector memory state
   */
  readonly captureVectorMemory: boolean;

  /**
   * Specific state keys to include (undefined = all)
   */
  readonly includeStateKeys?: readonly string[];

  /**
   * Additional metadata to store
   */
  readonly metadata?: Metadata;
}

/**
 * Default checkpoint creation options
 */
export const DEFAULT_CHECKPOINT_OPTIONS: CreateCheckpointOptions = {
  label: 'auto-checkpoint',
  captureState: true,
  captureMetrics: true,
  captureVectorMemory: true,
};

// =============================================================================
// Checkpoint Storage Interface
// =============================================================================

/**
 * Interface for checkpoint storage backend
 */
export interface CheckpointStorage {
  /**
   * Store checkpoint data
   */
  store(
    executionId: UUID,
    checkpoint: CheckpointData
  ): Promise<void>;

  /**
   * Retrieve checkpoint data
   */
  retrieve(
    executionId: UUID,
    checkpointId: UUID
  ): Promise<CheckpointData | undefined>;

  /**
   * List checkpoints for an execution
   */
  list(executionId: UUID): Promise<CheckpointInfo[]>;

  /**
   * Delete a checkpoint
   */
  delete(executionId: UUID, checkpointId: UUID): Promise<boolean>;

  /**
   * Get the latest checkpoint
   */
  getLatest(executionId: UUID): Promise<CheckpointData | undefined>;
}

// =============================================================================
// In-Memory Checkpoint Storage
// =============================================================================

/**
 * In-memory checkpoint storage implementation
 * Used for testing and single-execution scenarios
 */
export class InMemoryCheckpointStorage implements CheckpointStorage {
  private readonly checkpoints = new Map<string, Map<UUID, CheckpointData>>();

  async store(
    executionId: UUID,
    checkpoint: CheckpointData
  ): Promise<void> {
    if (!this.checkpoints.has(executionId)) {
      this.checkpoints.set(executionId, new Map());
    }
    this.checkpoints.get(executionId)!.set(checkpoint.checkpointId, checkpoint);
  }

  async retrieve(
    executionId: UUID,
    checkpointId: UUID
  ): Promise<CheckpointData | undefined> {
    return this.checkpoints.get(executionId)?.get(checkpointId);
  }

  async list(executionId: UUID): Promise<CheckpointInfo[]> {
    const executionCheckpoints = this.checkpoints.get(executionId);
    if (!executionCheckpoints) {
      return [];
    }

    return Array.from(executionCheckpoints.values())
      .map((cp) => ({
        checkpointId: cp.checkpointId,
        label: cp.label,
        stepId: cp.stepId,
        sequenceNumber: cp.sequenceNumber,
        createdAt: cp.createdAt,
        stateHash: cp.stateHash,
      }))
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async delete(executionId: UUID, checkpointId: UUID): Promise<boolean> {
    const executionCheckpoints = this.checkpoints.get(executionId);
    if (!executionCheckpoints) {
      return false;
    }
    return executionCheckpoints.delete(checkpointId);
  }

  async getLatest(executionId: UUID): Promise<CheckpointData | undefined> {
    const executionCheckpoints = this.checkpoints.get(executionId);
    if (!executionCheckpoints || executionCheckpoints.size === 0) {
      return undefined;
    }

    let latest: CheckpointData | undefined;
    let maxSequence = -1;

    for (const checkpoint of executionCheckpoints.values()) {
      if (checkpoint.sequenceNumber > maxSequence) {
        maxSequence = checkpoint.sequenceNumber;
        latest = checkpoint;
      }
    }

    return latest;
  }

  /**
   * Clear all checkpoints (for testing)
   */
  clear(): void {
    this.checkpoints.clear();
  }
}

// =============================================================================
// Execution Checkpoint Manager
// =============================================================================

/**
 * Manages checkpoint creation and restoration for execution orchestration
 *
 * Responsibilities:
 * - Creates state snapshots at defined checkpoints
 * - Captures PRNG state for reproducibility (GUA-REP-003)
 * - Stores agent states and working memory
 * - Enables rollback to previous checkpoints
 */
export class ExecutionCheckpointManager {
  private sequenceNumber = 0;
  private readonly createdCheckpoints: OrchestratorCheckpointInfo[] = [];

  constructor(
    private readonly storage: CheckpointStorage,
    private readonly executionId: UUID
  ) {}

  /**
   * Create a checkpoint from the current execution state
   *
   * Captures:
   * - State namespace data
   * - Random generator state (for reproducibility)
   * - Agent contexts and working memory
   * - Metrics and resource usage
   *
   * @param ctx - Execution context to checkpoint
   * @param options - Checkpoint creation options
   * @returns Created checkpoint data
   *
   * @see SPARC_PSEUDOCODE.md Section 5.5 - createCheckpoint
   */
  async createCheckpoint(
    ctx: ExecutionContext,
    options: CreateCheckpointOptions
  ): Promise<CheckpointData> {
    const checkpointId = uuidv4() as UUID;
    const createdAt = new Date().toISOString() as ISO8601Timestamp;
    this.sequenceNumber++;

    // Capture state data
    let stateData: Record<string, unknown> = {};
    if (options.captureState) {
      stateData = await this.captureStateData(ctx, options.includeStateKeys);
    }

    // Capture agent states
    const agentStates = this.captureAgentStates(ctx);

    // Capture random generator state for reproducibility (GUA-REP-003)
    const randomGeneratorState = ctx.randomGenerator.getState();

    // Compute state hash
    const stateHash = computeObjectHash({
      stateData,
      agentStates,
      randomGeneratorState,
    }) as SHA256Hash;

    // Capture metrics if requested
    let metrics: CheckpointData['metrics'];
    if (options.captureMetrics) {
      metrics = this.captureMetrics(ctx);
    }

    // Capture vector memory state if requested
    let vectorMemoryState: CheckpointData['vectorMemoryState'];
    if (options.captureVectorMemory) {
      vectorMemoryState = await this.captureVectorMemoryState(ctx);
    }

    const checkpoint: CheckpointData = {
      checkpointId,
      label: options.label,
      executionId: this.executionId,
      stepId: options.stepId,
      sequenceNumber: this.sequenceNumber,
      createdAt,
      stateHash,
      randomGeneratorState,
      agentStates,
      stateData,
      metrics,
      vectorMemoryState,
    };

    // Store the checkpoint
    await this.storage.store(this.executionId, checkpoint);

    // Track created checkpoint
    this.createdCheckpoints.push({
      checkpointId,
      label: options.label,
      stepId: options.stepId,
      sequenceNumber: this.sequenceNumber,
      createdAt,
      stateHash,
    });

    return checkpoint;
  }

  /**
   * Create a checkpoint from a checkpoint definition in the plan
   */
  async createFromDefinition(
    ctx: ExecutionContext,
    definition: CheckpointDefinition,
    stepResult?: StepResult
  ): Promise<CheckpointData> {
    return this.createCheckpoint(ctx, {
      label: definition.name,
      stepId: definition.stepRef,
      stepResult,
      captureState: definition.captureState,
      captureMetrics: definition.captureMetrics,
      captureVectorMemory: definition.captureState,
    });
  }

  /**
   * Restore execution state from a checkpoint
   *
   * Restores:
   * - State namespace data
   * - Random generator state
   * - Agent contexts
   *
   * @param ctx - Execution context to restore into
   * @param checkpointId - ID of checkpoint to restore
   * @returns True if restore was successful
   */
  async restoreCheckpoint(
    ctx: ExecutionContext,
    checkpointId: UUID
  ): Promise<boolean> {
    const checkpoint = await this.storage.retrieve(this.executionId, checkpointId);
    if (!checkpoint) {
      return false;
    }

    try {
      // Restore state data
      await this.restoreStateData(ctx, checkpoint.stateData);

      // Restore random generator state (critical for reproducibility)
      ctx.randomGenerator.setState(checkpoint.randomGeneratorState);

      // Restore agent states
      await this.restoreAgentStates(ctx, checkpoint.agentStates);

      // Update sequence number
      this.sequenceNumber = checkpoint.sequenceNumber;

      return true;
    } catch (error) {
      console.error('Failed to restore checkpoint:', error);
      return false;
    }
  }

  /**
   * Get checkpoint by ID
   */
  async getCheckpoint(checkpointId: UUID): Promise<CheckpointData | undefined> {
    return this.storage.retrieve(this.executionId, checkpointId);
  }

  /**
   * List all checkpoints for this execution
   */
  async listCheckpoints(): Promise<CheckpointInfo[]> {
    return this.storage.list(this.executionId);
  }

  /**
   * Get the latest checkpoint
   */
  async getLatestCheckpoint(): Promise<CheckpointData | undefined> {
    return this.storage.getLatest(this.executionId);
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: UUID): Promise<boolean> {
    return this.storage.delete(this.executionId, checkpointId);
  }

  /**
   * Get created checkpoints info
   */
  getCreatedCheckpoints(): readonly OrchestratorCheckpointInfo[] {
    return this.createdCheckpoints;
  }

  /**
   * Get current sequence number
   */
  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Capture state data from the execution context
   */
  private async captureStateData(
    ctx: ExecutionContext,
    includeKeys?: readonly string[]
  ): Promise<Record<string, unknown>> {
    const stateData: Record<string, unknown> = {};

    // Get all keys from state namespace
    let keys = await ctx.stateNamespace.keys();

    // Filter keys if specific keys are requested
    if (includeKeys && includeKeys.length > 0) {
      const includeSet = new Set(includeKeys);
      keys = keys.filter((k) => includeSet.has(k));
    }

    // Capture each key's value
    for (const key of keys) {
      const value = await ctx.stateNamespace.get(key);
      if (value !== undefined) {
        stateData[key] = value;
      }
    }

    return stateData;
  }

  /**
   * Capture agent states from all agent contexts
   */
  private captureAgentStates(ctx: ExecutionContext): Record<string, unknown> {
    const agentStates: Record<string, unknown> = {};

    for (const [agentId, agentContext] of ctx.getAllAgentContexts()) {
      agentStates[agentId] = {
        status: agentContext.status,
        invocationCount: agentContext.invocationCount,
        totalTokensConsumed: agentContext.totalTokensConsumed,
        workingMemory: Object.fromEntries(agentContext.workingMemory),
      };
    }

    return agentStates;
  }

  /**
   * Capture execution metrics
   */
  private captureMetrics(ctx: ExecutionContext): CheckpointData['metrics'] {
    const usage = ctx.resourceManager.usage;

    return {
      tokensConsumed: usage.tokensConsumed,
      stepsCompleted: ctx.currentStepSequence,
      agentsActive: usage.activeAgents,
      elapsedMs: ctx.getElapsedMs(),
    };
  }

  /**
   * Capture vector memory state
   */
  private async captureVectorMemoryState(
    ctx: ExecutionContext
  ): Promise<CheckpointData['vectorMemoryState'] | undefined> {
    // This would capture vector collection metadata
    // Implementation depends on the state namespace's vector support
    return undefined;
  }

  /**
   * Restore state data to the execution context
   */
  private async restoreStateData(
    ctx: ExecutionContext,
    stateData: Record<string, unknown>
  ): Promise<void> {
    // Begin transaction for atomic restore
    const transaction = await ctx.stateNamespace.beginTransaction();

    try {
      // Clear existing state (optional - depends on requirements)
      // For now, we overwrite with checkpoint state

      for (const [key, value] of Object.entries(stateData)) {
        await transaction.set(key, value);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Restore agent states to the execution context
   */
  private async restoreAgentStates(
    ctx: ExecutionContext,
    agentStates: Record<string, unknown>
  ): Promise<void> {
    for (const [agentId, state] of Object.entries(agentStates)) {
      const agentContext = ctx.getAgentContext(agentId);
      if (agentContext && typeof state === 'object' && state !== null) {
        const stateObj = state as Record<string, unknown>;

        // Restore agent properties
        if (typeof stateObj.status === 'string') {
          agentContext.status = stateObj.status as AgentContext['status'];
        }
        if (typeof stateObj.invocationCount === 'number') {
          agentContext.invocationCount = stateObj.invocationCount;
        }
        if (typeof stateObj.totalTokensConsumed === 'number') {
          agentContext.totalTokensConsumed = stateObj.totalTokensConsumed;
        }

        // Restore working memory
        if (
          typeof stateObj.workingMemory === 'object' &&
          stateObj.workingMemory !== null
        ) {
          agentContext.workingMemory.clear();
          for (const [key, value] of Object.entries(
            stateObj.workingMemory as Record<string, unknown>
          )) {
            agentContext.workingMemory.set(key, value);
          }
        }
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a checkpoint manager with default in-memory storage
 */
export function createCheckpointManager(
  executionId: UUID
): ExecutionCheckpointManager {
  return new ExecutionCheckpointManager(
    new InMemoryCheckpointStorage(),
    executionId
  );
}

/**
 * Create a checkpoint manager with custom storage
 */
export function createCheckpointManagerWithStorage(
  executionId: UUID,
  storage: CheckpointStorage
): ExecutionCheckpointManager {
  return new ExecutionCheckpointManager(storage, executionId);
}
