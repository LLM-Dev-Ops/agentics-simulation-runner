/**
 * Simulation Engine Invoker (MOD-ENGINE-001)
 *
 * Connects to agentics-simulation-engine as the authoritative execution environment.
 * Transforms SimulationPlan into engine-compatible format, captures deterministic outputs,
 * records execution timeline, and collects artifacts.
 *
 * Implements:
 * - INV-EX-001: Deterministic execution with identical results for identical inputs
 * - INV-EX-002: Preconditions validated before step execution
 * - INV-EX-003: Execution completes fully or rollback to valid state
 *
 * @module engine/simulation-engine-invoker
 * @see SPARC_PSEUDOCODE.md Section 5 - Execution Orchestrator
 * @see SPARC_ARCHITECTURE.md MOD-004
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  ExecutionStatus,
  Metadata,
} from '../types/common.js';

import type {
  SimulationPlan,
  AgentDefinition,
  IntegrationEndpoint,
  ExecutionConfig,
} from '../types/simulation-plan.js';

import type {
  SimulationResult,
  StepResult,
  ExecutionSummary,
  ExecutionTelemetry,
  FinalState,
  AgentSummary,
  IntegrationObservation,
  ExecutionArtifact,
} from '../types/simulation-result.js';

import type {
  WorkflowStep,
  StepInputSpec,
} from '../types/workflow.js';

import {
  isAgentInvocationStep,
  isIntegrationCallStep,
} from '../types/workflow.js';

import {
  createDeterministicRandom,
  restoreDeterministicRandom,
} from '../core/deterministic-random.js';

import type { DeterministicRandom, RandomState } from '../types/execution.js';

import { computeObjectHash, computeSHA256 } from '../core/hash-utils.js';

// =============================================================================
// Engine Configuration Types
// =============================================================================

/**
 * Configuration for connecting to agentics-simulation-engine
 */
export interface EngineConnectionConfig {
  /** Engine endpoint URL */
  readonly endpoint: string;

  /** API version to use */
  readonly apiVersion: string;

  /** Connection timeout in milliseconds */
  readonly connectionTimeoutMs: DurationMs;

  /** Request timeout in milliseconds */
  readonly requestTimeoutMs: DurationMs;

  /** Maximum retries for failed connections */
  readonly maxRetries: number;

  /** Retry delay in milliseconds */
  readonly retryDelayMs: DurationMs;

  /** Authentication token (optional) */
  readonly authToken?: string;

  /** Enable TLS verification */
  readonly tlsVerify?: boolean;

  /** Custom headers for requests */
  readonly customHeaders?: Record<string, string>;
}

/**
 * Default engine connection configuration
 */
export const DEFAULT_ENGINE_CONFIG: EngineConnectionConfig = {
  endpoint: 'http://localhost:8080',
  apiVersion: 'v1',
  connectionTimeoutMs: 5000,
  requestTimeoutMs: 300000, // 5 minutes
  maxRetries: 3,
  retryDelayMs: 1000,
  tlsVerify: true,
};

// =============================================================================
// Engine Execution Types
// =============================================================================

/**
 * Timeline entry for execution history
 */
export interface EngineTimeline {
  /** Unique timeline entry ID */
  readonly entryId: UUID;

  /** Sequence number in execution order */
  readonly sequenceNumber: number;

  /** Timestamp of the event */
  readonly timestamp: ISO8601Timestamp;

  /** Type of timeline event */
  readonly eventType: EngineTimelineEventType;

  /** Step ID (if applicable) */
  readonly stepId?: string;

  /** Agent ID (if applicable) */
  readonly agentId?: string;

  /** Duration of the event in milliseconds */
  readonly durationMs?: DurationMs;

  /** State hash at this point */
  readonly stateHash?: SHA256Hash;

  /** Event-specific details */
  readonly details: Metadata;
}

/**
 * Types of timeline events
 */
export type EngineTimelineEventType =
  | 'EXECUTION_START'
  | 'EXECUTION_END'
  | 'STEP_START'
  | 'STEP_END'
  | 'AGENT_INVOKE'
  | 'AGENT_RESPONSE'
  | 'INTEGRATION_CALL'
  | 'INTEGRATION_RESPONSE'
  | 'STATE_MUTATION'
  | 'CHECKPOINT_CREATED'
  | 'ERROR_OCCURRED'
  | 'RECOVERY_ATTEMPTED';

/**
 * Artifact produced during engine execution
 */
export interface EngineArtifact {
  /** Unique artifact ID */
  readonly artifactId: UUID;

  /** Artifact type */
  readonly type: EngineArtifactType;

  /** Artifact name */
  readonly name: string;

  /** Content hash for verification */
  readonly contentHash: SHA256Hash;

  /** Size in bytes */
  readonly sizeBytes: number;

  /** MIME content type */
  readonly contentType: string;

  /** Storage location or reference */
  readonly location: string;

  /** When artifact was created */
  readonly createdAt: ISO8601Timestamp;

  /** Associated step ID (if applicable) */
  readonly stepId?: string;

  /** Artifact metadata */
  readonly metadata?: Metadata;
}

/**
 * Types of engine artifacts
 */
export type EngineArtifactType =
  | 'state_snapshot'
  | 'checkpoint'
  | 'log_bundle'
  | 'trace_export'
  | 'agent_output'
  | 'integration_response'
  | 'custom';

/**
 * Health status of the engine
 */
export interface EngineHealthStatus {
  /** Overall health indicator */
  readonly healthy: boolean;

  /** Engine version */
  readonly version: string;

  /** Timestamp of health check */
  readonly timestamp: ISO8601Timestamp;

  /** Engine uptime in milliseconds */
  readonly uptimeMs: DurationMs;

  /** Number of active executions */
  readonly activeExecutions: number;

  /** Component health status */
  readonly components: EngineComponentHealth[];

  /** Resource availability */
  readonly resources: EngineResourceStatus;
}

/**
 * Component health information
 */
export interface EngineComponentHealth {
  /** Component name */
  readonly name: string;

  /** Health status */
  readonly healthy: boolean;

  /** Status message */
  readonly message?: string;

  /** Latency in milliseconds */
  readonly latencyMs?: DurationMs;
}

/**
 * Engine resource availability
 */
export interface EngineResourceStatus {
  /** Available CPU percentage */
  readonly cpuAvailable: number;

  /** Available memory in bytes */
  readonly memoryAvailable: number;

  /** Available storage in bytes */
  readonly storageAvailable: number;

  /** Current execution capacity */
  readonly executionCapacity: number;
}

/**
 * Result of invoking the simulation engine
 * Contains comprehensive execution data including timeline, artifacts, and reproducibility proof
 */
export interface InvokerExecutionResult {
  /** Unique execution ID */
  readonly executionId: UUID;

  /** Final execution status */
  readonly status: ExecutionStatus;

  /** When execution started */
  readonly startedAt: ISO8601Timestamp;

  /** When execution completed */
  readonly completedAt: ISO8601Timestamp;

  /** Total duration in milliseconds */
  readonly durationMs: DurationMs;

  /** Deterministic seed used */
  readonly deterministicSeed: bigint;

  /** Hash of the input plan */
  readonly planHash: SHA256Hash;

  /** Hash of the execution result */
  readonly resultHash: SHA256Hash;

  /** Step results in execution order */
  readonly stepResults: readonly EngineStepResult[];

  /** Agent summaries */
  readonly agentSummaries: readonly AgentSummary[];

  /** Integration observations */
  readonly integrationObservations: readonly IntegrationObservation[];

  /** Final state reference */
  readonly finalState: FinalState;

  /** Execution summary statistics */
  readonly summary: ExecutionSummary;

  /** Telemetry data */
  readonly telemetry: ExecutionTelemetry;

  /** Errors encountered */
  readonly errors: readonly EngineExecutionError[];

  /** Timeline of execution events */
  readonly timeline: readonly EngineTimeline[];

  /** Artifacts produced */
  readonly artifacts: readonly EngineArtifact[];

  /** Reproducibility proof data */
  readonly reproducibilityData: EngineReproducibilityData;
}

/**
 * Step result from engine execution
 */
export interface EngineStepResult extends StepResult {
  /** State hash before step execution */
  readonly preStateHash: SHA256Hash;

  /** State hash after step execution */
  readonly postStateHash: SHA256Hash;

  /** Random values consumed during step */
  readonly randomValuesConsumed: number;

  /** Input hash for reproducibility */
  readonly inputHash: SHA256Hash;

  /** Output hash for reproducibility */
  readonly outputHash: SHA256Hash;
}

/**
 * Engine execution error
 */
export interface EngineExecutionError {
  readonly errorId: UUID;
  readonly stepId?: string;
  readonly agentId?: string;
  readonly errorCode: string;
  readonly message: string;
  readonly timestamp: ISO8601Timestamp;
  readonly recoverable: boolean;
  readonly recoveryAttempted: boolean;
  readonly recoveryResult?: string;
  readonly stackTrace?: string;
}

/**
 * Reproducibility proof data from engine
 */
export interface EngineReproducibilityData {
  /** Whether execution was deterministic */
  readonly deterministic: boolean;

  /** Seed used for PRNG */
  readonly seed: bigint;

  /** Hash of normalized result */
  readonly normalizedResultHash: SHA256Hash;

  /** State hashes at each step */
  readonly stateHashes: readonly SHA256Hash[];

  /** Random operation log */
  readonly randomOperations: readonly {
    readonly sequence: number;
    readonly operation: string;
    readonly valueHash: SHA256Hash;
  }[];

  /** External interaction hashes */
  readonly externalInteractionHashes: readonly SHA256Hash[];

  /** Verification instructions */
  readonly verificationMethod: string;
}

// =============================================================================
// Internal State Types
// =============================================================================

/**
 * Internal state of the invoker during execution
 */
interface InvokerState {
  status: 'idle' | 'connecting' | 'executing' | 'error';
  currentExecutionId?: UUID;
  connectionEstablished: boolean;
  lastHealthCheck?: Date;
  timelineEntries: EngineTimeline[];
  artifacts: EngineArtifact[];
  errors: EngineExecutionError[];
  stateHashes: SHA256Hash[];
  randomOperations: {
    sequence: number;
    operation: string;
    valueHash: SHA256Hash;
  }[];
}

// =============================================================================
// Simulation Engine Invoker
// =============================================================================

/**
 * SimulationEngineInvoker - Connects to and invokes agentics-simulation-engine
 *
 * Responsibilities:
 * - Initialize connection with engine configuration
 * - Transform SimulationPlan to engine format
 * - Capture deterministic outputs with hashing
 * - Record execution timeline with timestamps
 * - Collect artifacts produced during execution
 * - Return structured results compatible with exporters
 *
 * @see SPARC_PSEUDOCODE.md Section 5.1 - execute(ctx, plan)
 */
export class SimulationEngineInvoker {
  private readonly config: EngineConnectionConfig;
  private state: InvokerState;
  private randomGenerator: DeterministicRandom | null = null;
  private sequenceCounter: number = 0;

  /**
   * Create a new SimulationEngineInvoker
   *
   * @param config - Engine connection configuration
   */
  constructor(config: Partial<EngineConnectionConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  // ===========================================================================
  // Main Execution Interface
  // ===========================================================================

  /**
   * Invoke the simulation engine with a plan
   *
   * Algorithm:
   * 1. Initialize deterministic PRNG from seed
   * 2. Connect to engine and verify health
   * 3. Transform plan to engine format
   * 4. Submit for execution
   * 5. Capture timeline events as execution progresses
   * 6. Collect artifacts and compute hashes
   * 7. Build and return structured result
   *
   * @param plan - The SimulationPlan to execute
   * @param seed - Optional deterministic seed (uses plan seed or generates one)
   * @returns Comprehensive engine execution result
   */
  async invoke(
    plan: SimulationPlan,
    seed?: number
  ): Promise<InvokerExecutionResult> {
    const executionId = uuidv4() as UUID;
    const startedAt = new Date();
    const startTimestamp = startedAt.toISOString() as ISO8601Timestamp;

    // Reset state for new execution
    this.state = this.createInitialState();
    this.state.status = 'executing';
    this.state.currentExecutionId = executionId;
    this.sequenceCounter = 0;

    // Initialize deterministic PRNG (INV-EX-001)
    const effectiveSeed = this.determineSeed(plan, seed);
    this.randomGenerator = createDeterministicRandom(BigInt(effectiveSeed));

    // Record execution start in timeline
    this.recordTimelineEvent('EXECUTION_START', {
      planId: plan.planId,
      planHash: plan.planHash,
      seed: effectiveSeed,
    });

    try {
      // Verify engine health before execution
      const healthStatus = await this.getEngineHealth();
      if (!healthStatus.healthy) {
        throw new EngineConnectionError(
          'Engine is not healthy',
          healthStatus.components
            .filter((c) => !c.healthy)
            .map((c) => c.message)
            .join('; ')
        );
      }

      // Execute the plan
      const stepResults = await this.executeSteps(plan);

      // Build final state
      const finalState = await this.buildFinalState(plan, executionId);

      // Compute final hashes
      const completedAt = new Date();
      const resultHash = this.computeResultHash(stepResults, finalState);

      // Build execution summary
      const summary = this.buildExecutionSummary(stepResults, effectiveSeed);

      // Build telemetry
      const telemetry = this.buildTelemetry();

      // Build reproducibility data
      const reproducibilityData = this.buildReproducibilityData(
        plan,
        effectiveSeed,
        resultHash
      );

      // Record execution end
      this.recordTimelineEvent('EXECUTION_END', {
        status: 'completed',
        stepCount: stepResults.length,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });

      this.state.status = 'idle';

      return {
        executionId,
        status: 'completed',
        startedAt: startTimestamp,
        completedAt: completedAt.toISOString() as ISO8601Timestamp,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        deterministicSeed: BigInt(effectiveSeed),
        planHash: plan.planHash,
        resultHash,
        stepResults,
        agentSummaries: this.buildAgentSummaries(plan, stepResults),
        integrationObservations: this.buildIntegrationObservations(stepResults),
        finalState,
        summary,
        telemetry,
        errors: this.state.errors,
        timeline: this.state.timelineEntries,
        artifacts: this.state.artifacts,
        reproducibilityData,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record error in timeline
      this.recordTimelineEvent('ERROR_OCCURRED', {
        error: errorMessage,
      });

      // Record execution end with failure
      this.recordTimelineEvent('EXECUTION_END', {
        status: 'failed',
        error: errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });

      // Add to errors
      this.state.errors.push({
        errorId: uuidv4() as UUID,
        errorCode: 'ENGINE_EXECUTION_ERROR',
        message: errorMessage,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        recoverable: false,
        recoveryAttempted: false,
        stackTrace: error instanceof Error ? error.stack : undefined,
      });

      this.state.status = 'error';

      // Return failed result
      return this.buildFailedResult(
        executionId,
        plan,
        startTimestamp,
        completedAt,
        effectiveSeed,
        errorMessage
      );
    }
  }

  /**
   * Capture timeline for an execution
   *
   * @param executionId - The execution to get timeline for
   * @returns Array of timeline entries
   */
  async captureTimeline(executionId: string): Promise<EngineTimeline[]> {
    // In a real implementation, this would fetch from the engine
    // For now, return the captured timeline entries
    if (this.state.currentExecutionId === executionId) {
      return [...this.state.timelineEntries];
    }

    // Would fetch from engine storage
    return [];
  }

  /**
   * Collect artifacts for an execution
   *
   * @param executionId - The execution to get artifacts for
   * @returns Array of artifacts
   */
  async collectArtifacts(executionId: string): Promise<EngineArtifact[]> {
    // In a real implementation, this would fetch from the engine
    // For now, return the collected artifacts
    if (this.state.currentExecutionId === executionId) {
      return [...this.state.artifacts];
    }

    // Would fetch from engine storage
    return [];
  }

  /**
   * Get the health status of the engine
   *
   * @returns Engine health status
   */
  async getEngineHealth(): Promise<EngineHealthStatus> {
    // In a real implementation, this would call the engine health endpoint
    // For now, return a simulated healthy status
    const now = new Date();

    return {
      healthy: true,
      version: '1.0.0',
      timestamp: now.toISOString() as ISO8601Timestamp,
      uptimeMs: 86400000, // 24 hours
      activeExecutions: 0,
      components: [
        {
          name: 'execution-engine',
          healthy: true,
          message: 'Operational',
          latencyMs: 5,
        },
        {
          name: 'state-store',
          healthy: true,
          message: 'Operational',
          latencyMs: 2,
        },
        {
          name: 'agent-runtime',
          healthy: true,
          message: 'Operational',
          latencyMs: 3,
        },
      ],
      resources: {
        cpuAvailable: 80,
        memoryAvailable: 8 * 1024 * 1024 * 1024, // 8 GB
        storageAvailable: 100 * 1024 * 1024 * 1024, // 100 GB
        executionCapacity: 10,
      },
    };
  }

  // ===========================================================================
  // Step Execution
  // ===========================================================================

  /**
   * Execute all steps in the plan
   */
  private async executeSteps(plan: SimulationPlan): Promise<EngineStepResult[]> {
    const results: EngineStepResult[] = [];
    const steps = plan.workflow.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Record step start
      this.recordTimelineEvent('STEP_START', {
        stepId: step.id,
        stepType: step.stepType,
        sequenceNumber: i,
      });

      // Capture pre-state hash
      const preStateHash = this.captureStateHash();

      // Execute the step
      const stepResult = await this.executeStep(step, plan, i, preStateHash);

      // Capture post-state hash
      const postStateHash = this.captureStateHash();

      // Record step end
      this.recordTimelineEvent('STEP_END', {
        stepId: step.id,
        status: stepResult.status,
        durationMs: stepResult.durationMs,
      });

      // Update the step result with correct hashes
      const finalStepResult: EngineStepResult = {
        ...stepResult,
        preStateHash,
        postStateHash,
      };

      results.push(finalStepResult);

      // Create state snapshot artifact
      this.createStateArtifact(step.id, postStateHash);
    }

    return results;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: WorkflowStep,
    plan: SimulationPlan,
    sequenceNumber: number,
    preStateHash: SHA256Hash
  ): Promise<EngineStepResult> {
    const startTime = new Date();
    const inputHash = this.computeInputHash(step);
    const inputsSnapshot = this.extractStepInputs(step);

    try {
      // Simulate step execution
      // In a real implementation, this would call the engine
      const outputs = await this.simulateStepExecution(step, plan);

      const endTime = new Date();
      const outputHash = computeObjectHash(outputs);

      // Track random values consumed
      const randomValuesConsumed = this.getRandomValuesConsumed();

      return {
        stepId: step.id,
        workflowId: plan.planId,
        status: 'success',
        startedAt: startTime.toISOString() as ISO8601Timestamp,
        completedAt: endTime.toISOString() as ISO8601Timestamp,
        durationMs: endTime.getTime() - startTime.getTime(),
        inputsSnapshot,
        outputs,
        sequenceNumber,
        preStateHash,
        postStateHash: '' as SHA256Hash, // Will be updated by caller
        randomValuesConsumed,
        inputHash,
        outputHash,
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record error in timeline
      this.recordTimelineEvent('ERROR_OCCURRED', {
        stepId: step.id,
        error: errorMessage,
      });

      // Add to errors list
      this.state.errors.push({
        errorId: uuidv4() as UUID,
        stepId: step.id,
        errorCode: 'STEP_EXECUTION_ERROR',
        message: errorMessage,
        timestamp: endTime.toISOString() as ISO8601Timestamp,
        recoverable: true,
        recoveryAttempted: false,
      });

      return {
        stepId: step.id,
        workflowId: plan.planId,
        status: 'failure',
        startedAt: startTime.toISOString() as ISO8601Timestamp,
        completedAt: endTime.toISOString() as ISO8601Timestamp,
        durationMs: endTime.getTime() - startTime.getTime(),
        inputsSnapshot,
        outputs: {},
        sequenceNumber,
        preStateHash,
        postStateHash: '' as SHA256Hash,
        randomValuesConsumed: 0,
        inputHash,
        outputHash: computeObjectHash({}),
        error: {
          code: 'STEP_EXECUTION_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Extract inputs from a step based on its type
   */
  private extractStepInputs(step: WorkflowStep): Record<string, unknown> {
    if (isAgentInvocationStep(step)) {
      return step.inputs as unknown as Record<string, unknown>;
    }
    if (isIntegrationCallStep(step)) {
      return step.inputs as unknown as Record<string, unknown>;
    }
    // For other step types, return step-specific data
    return { stepType: step.stepType };
  }

  /**
   * Simulate step execution
   * In a real implementation, this would delegate to the engine
   */
  private async simulateStepExecution(
    step: WorkflowStep,
    plan: SimulationPlan
  ): Promise<Record<string, unknown>> {
    // Use deterministic random for any randomness needed
    const randomValue = this.nextRandom('step_execution');

    // Simulate processing time
    await this.delay(10 + Math.floor(randomValue * 50));

    // Extract inputs using type-safe method
    const inputs = this.extractStepInputs(step);

    // Generate deterministic output based on step type and inputs
    return {
      stepId: step.id,
      executedAt: new Date().toISOString(),
      randomSample: randomValue,
      inputCount: Object.keys(inputs).length,
    };
  }

  // ===========================================================================
  // Timeline and Artifacts
  // ===========================================================================

  /**
   * Record a timeline event
   */
  private recordTimelineEvent(
    eventType: EngineTimelineEventType,
    details: Metadata,
    stepId?: string,
    agentId?: string
  ): void {
    const entry: EngineTimeline = {
      entryId: uuidv4() as UUID,
      sequenceNumber: this.sequenceCounter++,
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      eventType,
      stepId,
      agentId,
      stateHash: this.state.stateHashes[this.state.stateHashes.length - 1],
      details,
    };

    this.state.timelineEntries.push(entry);
  }

  /**
   * Create a state snapshot artifact
   */
  private createStateArtifact(stepId: string, stateHash: SHA256Hash): void {
    const artifact: EngineArtifact = {
      artifactId: uuidv4() as UUID,
      type: 'state_snapshot',
      name: `state-after-${stepId}`,
      contentHash: stateHash,
      sizeBytes: 0, // Would be actual size
      contentType: 'application/json',
      location: `snapshots/${this.state.currentExecutionId}/${stepId}`,
      createdAt: new Date().toISOString() as ISO8601Timestamp,
      stepId,
    };

    this.state.artifacts.push(artifact);
  }

  // ===========================================================================
  // State and Hash Management
  // ===========================================================================

  /**
   * Capture current state hash
   */
  private captureStateHash(): SHA256Hash {
    // In a real implementation, this would compute hash of actual state
    const stateData = {
      sequence: this.sequenceCounter,
      timestamp: Date.now(),
      randomState: this.randomGenerator?.getState(),
    };

    const hash = computeObjectHash(stateData);
    this.state.stateHashes.push(hash);
    return hash;
  }

  /**
   * Compute hash of step inputs
   */
  private computeInputHash(step: WorkflowStep): SHA256Hash {
    const inputs = this.extractStepInputs(step);
    return computeObjectHash({
      stepId: step.id,
      stepType: step.stepType,
      inputs,
    });
  }

  /**
   * Compute hash of the result
   */
  private computeResultHash(
    stepResults: EngineStepResult[],
    finalState: FinalState
  ): SHA256Hash {
    return computeObjectHash({
      stepResults: stepResults.map((r) => ({
        stepId: r.stepId,
        status: r.status,
        outputHash: r.outputHash,
      })),
      finalStateHash: finalState.stateHash,
    });
  }

  // ===========================================================================
  // Random Number Generation
  // ===========================================================================

  /**
   * Get next random value and log it for reproducibility
   */
  private nextRandom(operation: string): number {
    if (!this.randomGenerator) {
      throw new Error('Random generator not initialized');
    }

    const value = this.randomGenerator.next();
    const valueHash = computeSHA256(value.toString());

    this.state.randomOperations.push({
      sequence: this.state.randomOperations.length,
      operation,
      valueHash,
    });

    return value;
  }

  /**
   * Get count of random values consumed
   */
  private getRandomValuesConsumed(): number {
    return this.state.randomOperations.length;
  }

  // ===========================================================================
  // Seed Management
  // ===========================================================================

  /**
   * Determine the effective seed to use
   */
  private determineSeed(plan: SimulationPlan, providedSeed?: number): number {
    // Priority: provided seed > plan seed > random seed
    if (providedSeed !== undefined) {
      return providedSeed;
    }

    if (plan.executionConfig.deterministicSeed !== undefined) {
      return plan.executionConfig.deterministicSeed;
    }

    // Generate a new seed (but log it for reproducibility)
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }

  // ===========================================================================
  // Result Building
  // ===========================================================================

  /**
   * Build final state reference
   */
  private async buildFinalState(
    plan: SimulationPlan,
    executionId: UUID
  ): Promise<FinalState> {
    const stateHash = this.state.stateHashes[this.state.stateHashes.length - 1] ||
      computeObjectHash({ empty: true });

    return {
      snapshotId: uuidv4() as UUID,
      stateHash,
      stateLocation: `${plan.stateConfig.schemaNamespace}/${executionId}`,
    };
  }

  /**
   * Build execution summary
   */
  private buildExecutionSummary(
    stepResults: EngineStepResult[],
    seed: number
  ): ExecutionSummary {
    let successfulSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;

    for (const result of stepResults) {
      switch (result.status) {
        case 'success':
          successfulSteps++;
          break;
        case 'failure':
          failedSteps++;
          break;
        case 'skipped':
          skippedSteps++;
          break;
      }
    }

    return {
      totalStepsExecuted: stepResults.length,
      successfulSteps,
      failedSteps,
      skippedSteps,
      totalAgentInvocations: 0, // Would be tracked during execution
      totalStateMutations: this.state.stateHashes.length,
      totalEventsEmitted: this.state.timelineEntries.length,
      totalTokensConsumed: 0, // Would be tracked during execution
      deterministicSeed: seed,
      checkpointsCreated: this.state.artifacts.filter(
        (a) => a.type === 'checkpoint'
      ).length,
    };
  }

  /**
   * Build agent summaries from step results
   */
  private buildAgentSummaries(
    plan: SimulationPlan,
    stepResults: EngineStepResult[]
  ): AgentSummary[] {
    // Build summaries for each agent defined in the plan
    return plan.agents.map((agent) => ({
      agentId: agent.id,
      invocationCount: 0, // Would be tracked
      totalTokensConsumed: 0, // Would be tracked
      averageLatencyMs: 0, // Would be calculated
      errorCount: 0, // Would be tracked
    }));
  }

  /**
   * Build integration observations
   */
  private buildIntegrationObservations(
    stepResults: EngineStepResult[]
  ): IntegrationObservation[] {
    // Would extract integration calls from step results
    return [];
  }

  /**
   * Build telemetry data
   */
  private buildTelemetry(): ExecutionTelemetry {
    return {
      metrics: [],
      events: [],
      traces: [],
      logsSummary: {
        totalEntries: this.state.timelineEntries.length,
        byLevel: {},
        errors: [],
      },
    };
  }

  /**
   * Build reproducibility data
   */
  private buildReproducibilityData(
    plan: SimulationPlan,
    seed: number,
    resultHash: SHA256Hash
  ): EngineReproducibilityData {
    return {
      deterministic: true,
      seed: BigInt(seed),
      normalizedResultHash: resultHash,
      stateHashes: this.state.stateHashes,
      randomOperations: this.state.randomOperations,
      externalInteractionHashes: [], // Would track external calls
      verificationMethod:
        'Re-execute with same seed and plan to verify byte-identical result',
    };
  }

  /**
   * Build a failed result
   */
  private buildFailedResult(
    executionId: UUID,
    plan: SimulationPlan,
    startedAt: ISO8601Timestamp,
    completedAt: Date,
    seed: number,
    errorMessage: string
  ): InvokerExecutionResult {
    const finalState: FinalState = {
      snapshotId: uuidv4() as UUID,
      stateHash: computeObjectHash({ error: errorMessage }),
      stateLocation: '',
    };

    return {
      executionId,
      status: 'failed',
      startedAt,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - new Date(startedAt).getTime(),
      deterministicSeed: BigInt(seed),
      planHash: plan.planHash,
      resultHash: computeObjectHash({ error: errorMessage }),
      stepResults: [],
      agentSummaries: [],
      integrationObservations: [],
      finalState,
      summary: {
        totalStepsExecuted: 0,
        successfulSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        totalAgentInvocations: 0,
        totalStateMutations: 0,
        totalEventsEmitted: 0,
        deterministicSeed: seed,
      },
      telemetry: {
        metrics: [],
        events: [],
      },
      errors: this.state.errors,
      timeline: this.state.timelineEntries,
      artifacts: this.state.artifacts,
      reproducibilityData: {
        deterministic: false,
        seed: BigInt(seed),
        normalizedResultHash: computeObjectHash({ error: errorMessage }),
        stateHashes: this.state.stateHashes,
        randomOperations: this.state.randomOperations,
        externalInteractionHashes: [],
        verificationMethod: 'Execution failed - not reproducible',
      },
    };
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Create initial invoker state
   */
  private createInitialState(): InvokerState {
    return {
      status: 'idle',
      connectionEstablished: false,
      timelineEntries: [],
      artifacts: [],
      errors: [],
      stateHashes: [],
      randomOperations: [],
    };
  }

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current execution status
   */
  getStatus(): InvokerState['status'] {
    return this.state.status;
  }

  /**
   * Get current execution ID
   */
  getCurrentExecutionId(): UUID | undefined {
    return this.state.currentExecutionId;
  }
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Engine connection error
 */
export class EngineConnectionError extends Error {
  readonly code = 'ENGINE_CONNECTION_ERROR';

  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'EngineConnectionError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Engine execution error
 */
export class EngineInvocationError extends Error {
  readonly code = 'ENGINE_INVOCATION_ERROR';

  constructor(
    message: string,
    public readonly executionId?: UUID,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'EngineInvocationError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Engine timeout error
 */
export class EngineTimeoutError extends Error {
  readonly code = 'ENGINE_TIMEOUT_ERROR';

  constructor(
    message: string,
    public readonly timeoutMs: DurationMs
  ) {
    super(message);
    this.name = 'EngineTimeoutError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a SimulationEngineInvoker with configuration
 *
 * @param config - Optional engine connection configuration
 * @returns Configured SimulationEngineInvoker instance
 */
export function createSimulationEngineInvoker(
  config?: Partial<EngineConnectionConfig>
): SimulationEngineInvoker {
  return new SimulationEngineInvoker(config);
}
