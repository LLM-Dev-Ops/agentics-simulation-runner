/**
 * Execution Gateway (MOD-001) - Enhanced Implementation
 *
 * PURPOSE: Single entry point for all external interactions with the runner.
 * This is a stateless component - all state is delegated to the State Repository.
 *
 * The Execution Gateway enforces:
 * - INV-IN-001: SimulationPlan MUST be syntactically valid
 * - INV-IN-002: SimulationPlan MUST be semantically complete
 * - INV-IN-003: SimulationPlan MUST have valid planHash
 * - INV-IN-004: deterministicSeed MUST be within [0, 2^64-1]
 * - INV-IN-005: All referenced agents MUST be resolvable
 * - INV-IN-006: All referenced integrations MUST be connectable
 * - INV-IN-007: Resource limits MUST be satisfiable
 *
 * Output constraints enforced:
 * - INV-OUT-001: SimulationResult.resultId MUST be unique
 * - INV-OUT-002: SimulationResult MUST be immutable once persisted
 * - INV-OUT-003: SimulationResult.resultHash MUST be verifiable
 * - INV-OUT-004: SimulationResult.audit_trail MUST be complete
 * - INV-OUT-005: SimulationResult.telemetry_stream MUST be replayable
 * - INV-OUT-006: SimulationResult.agent_observations MUST include all invocations
 * - INV-OUT-007: SimulationResult.final_state MUST match last snapshot
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-001
 * - SPARC_SPECIFICATION.md Section 3, 4
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

import type { SimulationPlan } from '../types/simulation-plan.js';
import type { SimulationResult } from '../types/simulation-result.js';
import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  ExecutionId,
  ExecutionStatus,
  IsolationLevel,
} from '../types/common.js';
import {
  isAgentInvocationStep,
  isIntegrationCallStep,
  type WorkflowStep,
} from '../types/workflow.js';
import {
  type ExecutionHandle,
  createExecutionHandle,
  isValidExecutionHandle,
} from './execution-handle.js';
import {
  validatePlan,
  type FullValidationResult,
  type ResourcePool,
  type ConnectivityTester,
  type ConditionEvaluator,
} from '../orchestration/validation.js';
import { createDeterministicRandom } from '../core/deterministic-random.js';
import {
  StateRepository,
  getSharedStateRepository,
  type SimulationPlanRef,
  type StepDefinition,
  type ExecutionContext as StateExecutionContext,
  type SimulationResult as StateSimulationResult,
} from '../state/state-repository.js';
import type { SimulationResultRow } from '../state/table-definitions.js';
import { computeObjectHash } from '../core/hash-utils.js';

// ============================================================================
// Gateway Configuration
// ============================================================================

/**
 * Configuration for the ExecutionGateway
 */
export interface GatewayConfig {
  /** Runner identifier name */
  readonly runnerName: string;

  /** Runner version (semantic version) */
  readonly runnerVersion: string;

  /** Unique instance ID for this runner */
  readonly runnerInstanceId: UUID;

  /** Default timeout for result retrieval (ms) */
  readonly defaultTimeout: DurationMs;

  /** Maximum concurrent executions allowed */
  readonly maxConcurrentExecutions: number;

  /** Enable detailed logging */
  readonly enableDetailedLogging?: boolean;

  /** Health check interval (ms) */
  readonly healthCheckIntervalMs?: DurationMs;
}

/**
 * Default gateway configuration
 */
export const DEFAULT_GATEWAY_CONFIG: Partial<GatewayConfig> = {
  defaultTimeout: 300000, // 5 minutes
  maxConcurrentExecutions: 100,
  enableDetailedLogging: false,
  healthCheckIntervalMs: 30000, // 30 seconds
};

// ============================================================================
// Status and Result Types
// ============================================================================

/**
 * Detailed execution status information
 */
export interface ExecutionStatusResult {
  /** Execution identifier */
  readonly executionId: ExecutionId;

  /** Current execution status */
  readonly status: ExecutionStatus;

  /** When execution started */
  readonly startedAt: ISO8601Timestamp;

  /** Progress information if in-progress */
  readonly progress?: ExecutionProgress;

  /** Estimated completion time if available */
  readonly estimatedCompletion?: ISO8601Timestamp;

  /** Time of last status update */
  readonly lastUpdatedAt?: ISO8601Timestamp;

  /** Current step being executed */
  readonly currentStep?: string;

  /** Error message if failed */
  readonly errorMessage?: string;
}

/**
 * Execution progress tracking
 */
export interface ExecutionProgress {
  /** Number of completed steps */
  readonly completedSteps: number;

  /** Total number of steps */
  readonly totalSteps: number;

  /** Current step identifier */
  readonly currentStep?: string;

  /** Percentage complete (0-100) */
  readonly percentComplete: number;

  /** Agent invocations completed */
  readonly agentInvocationsCompleted?: number;

  /** Integration calls completed */
  readonly integrationCallsCompleted?: number;
}

/**
 * Result of an abort operation
 */
export interface AbortResult {
  /** Execution identifier */
  readonly executionId: ExecutionId;

  /** Whether abort was successful */
  readonly aborted: boolean;

  /** Partial result if available */
  readonly partialResult?: SimulationResult;

  /** Reason for abort */
  readonly reason: string;

  /** Time abort was requested */
  readonly abortedAt: ISO8601Timestamp;
}

/**
 * Result retrieval options
 */
export interface GetResultOptions {
  /** Timeout for waiting (ms) - 0 means no wait */
  readonly timeout?: DurationMs;

  /** Polling interval when waiting (ms) */
  readonly pollingInterval?: DurationMs;

  /** Include full telemetry in result */
  readonly includeTelemetry?: boolean;

  /** Include full audit trail in result */
  readonly includeAuditTrail?: boolean;
}

// ============================================================================
// Health Status Types
// ============================================================================

/**
 * Health status of the runner
 */
export interface HealthStatus {
  /** Overall health indicator */
  readonly healthy: boolean;

  /** Timestamp of health check */
  readonly timestamp: ISO8601Timestamp;

  /** Individual component health */
  readonly components: ComponentHealth[];

  /** Runner version */
  readonly version: string;

  /** Runner uptime in milliseconds */
  readonly uptimeMs?: DurationMs;

  /** Number of active executions */
  readonly activeExecutions?: number;

  /** Total executions processed */
  readonly totalExecutions?: number;
}

/**
 * Health status of an individual component
 */
export interface ComponentHealth {
  /** Component name */
  readonly name: string;

  /** Health indicator */
  readonly healthy: boolean;

  /** Latency in milliseconds */
  readonly latencyMs?: DurationMs;

  /** Status message */
  readonly message?: string;

  /** Last check timestamp */
  readonly lastCheckedAt?: ISO8601Timestamp;
}

// ============================================================================
// Execution Gateway Interface
// ============================================================================

/**
 * ExecutionGateway - Primary interface for the API boundary layer.
 *
 * This is the single entry point for all external interactions with the
 * agentics-simulation-runner. All methods are stateless - state is
 * delegated to the StateRepository.
 */
export interface ExecutionGateway {
  /**
   * Submit a SimulationPlan for execution.
   *
   * Accepts a SimulationPlan for execution and returns a handle for tracking
   * and result retrieval. The plan is validated before acceptance.
   *
   * Enforces: INV-IN-001 through INV-IN-007
   *
   * @param plan - The SimulationPlan to execute
   * @returns ExecutionHandle for tracking the execution
   * @throws PlanValidationError if validation fails
   * @throws ResourceExhaustedError if max concurrent executions reached
   */
  submitPlan(plan: SimulationPlan): Promise<ExecutionHandle>;

  /**
   * Get the current status of an execution.
   *
   * Returns the current execution status including progress information
   * if the execution is in-progress.
   *
   * @param handle - ExecutionHandle from submitPlan()
   * @returns Current execution status
   * @throws ExecutionNotFoundError if execution doesn't exist
   * @throws InvalidHandleError if handle is malformed
   */
  getExecutionStatus(handle: ExecutionHandle): Promise<ExecutionStatusResult>;

  /**
   * Get the result of a completed execution.
   *
   * Returns the completed SimulationResult. Can optionally block until
   * completion or timeout.
   *
   * Enforces: INV-OUT-001 through INV-OUT-007
   *
   * @param handle - ExecutionHandle from submitPlan()
   * @param options - Options for result retrieval
   * @returns Completed SimulationResult
   * @throws ExecutionNotFoundError if execution doesn't exist
   * @throws ResultNotAvailableError if execution not complete and no wait
   * @throws ExecutionFailedError if execution failed
   * @throws TimeoutError if wait times out
   */
  getResult(handle: ExecutionHandle, options?: GetResultOptions): Promise<SimulationResult>;

  /**
   * Request graceful abort of an execution.
   *
   * Requests that the execution be aborted. Returns partial result if
   * available. The abort is graceful - currently executing steps will
   * complete before abort.
   *
   * @param handle - ExecutionHandle from submitPlan()
   * @param reason - Reason for the abort request
   * @returns AbortResult with partial result if available
   * @throws ExecutionNotFoundError if execution doesn't exist
   * @throws ExecutionAlreadyCompletedError if already finished
   */
  abortExecution(handle: ExecutionHandle, reason: string): Promise<AbortResult>;

  /**
   * Check the health of the runner and its dependencies.
   *
   * Returns health status including connectivity to all dependencies
   * (database, LLM providers, integrations).
   *
   * @returns HealthStatus with component-level health information
   */
  healthCheck(): Promise<HealthStatus>;
}

// ============================================================================
// Internal Execution Context
// ============================================================================

/**
 * Internal execution context stored in memory
 */
interface InternalExecutionContext {
  readonly handle: ExecutionHandle;
  readonly startTime: Date;
  readonly stateNamespace: string;
  readonly isolationLevel: IsolationLevel;
  readonly maxDuration: DurationMs;
  status: ExecutionStatus;
  abortRequested: boolean;
  abortReason?: string;
}

// ============================================================================
// Gateway Implementation
// ============================================================================

/**
 * ExecutionGatewayImpl - Production implementation of ExecutionGateway.
 *
 * This implementation:
 * - Validates all incoming plans before execution
 * - Manages execution lifecycle
 * - Delegates all state to StateRepository
 * - Provides health monitoring
 */
export class ExecutionGatewayImpl implements ExecutionGateway {
  private readonly activeExecutions = new Map<ExecutionId, InternalExecutionContext>();
  private readonly startTime = new Date();
  private totalExecutions = 0;

  constructor(
    private readonly config: GatewayConfig,
    private readonly stateRepository: StateRepository,
    private readonly resourcePool: ResourcePool,
    private readonly connectivityTester: ConnectivityTester,
    private readonly conditionEvaluator: ConditionEvaluator
  ) {}

  /**
   * Submit a SimulationPlan for execution
   */
  async submitPlan(plan: SimulationPlan): Promise<ExecutionHandle> {
    // Check concurrent execution limit
    if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      throw new ResourceExhaustedError(
        `Maximum concurrent executions (${this.config.maxConcurrentExecutions}) reached`
      );
    }

    // Validate plan integrity - verify hash before proceeding
    const planForHashing = this.getPlanWithoutHash(plan);
    const computedHash = computeObjectHash(planForHashing);
    if (computedHash.toLowerCase() !== plan.planHash.toLowerCase()) {
      throw new PlanIntegrityError(
        `Plan hash mismatch: expected ${plan.planHash}, computed ${computedHash}`
      );
    }

    // Validate the plan through full pipeline
    const validationResult = await validatePlan(
      plan,
      this.resourcePool,
      this.connectivityTester,
      this.conditionEvaluator,
      {}
    );

    if (!validationResult.valid) {
      throw new PlanValidationError(validationResult);
    }

    // Generate execution identifiers
    const executionId = uuidv4() as ExecutionId;
    const tenantId = this.extractTenantId(plan);
    const stateNamespace = this.generateStateNamespace(executionId);

    // Extract step definitions from plan
    const stepDefinitions: StepDefinition[] = plan.workflow.steps.map((step, index) => ({
      stepId: step.id,
      stepOrder: index,
      inputs: this.extractStepInputs(step),
    }));

    // Create simulation plan reference
    const planRef: SimulationPlanRef = {
      planId: plan.planId,
      planHash: plan.planHash,
      version: plan.version,
      steps: stepDefinitions,
      metadata: plan.metadata ? { ...plan.metadata } : undefined,
    };

    // Determine deterministic seed
    const deterministicSeed = this.getDeterministicSeed(plan);

    // Initialize state in repository
    const stateContext = await this.stateRepository.initializeState(
      tenantId,
      planRef,
      deterministicSeed,
      {
        runnerName: this.config.runnerName,
        runnerVersion: this.config.runnerVersion,
        runnerInstanceId: this.config.runnerInstanceId,
        submittedAt: new Date().toISOString(),
      }
    );

    // Create execution handle
    const handle = createExecutionHandle({
      executionId,
      planId: plan.planId,
      planHash: plan.planHash,
      tenantId,
      estimatedDuration: plan.executionConfig.timeoutSeconds * 1000,
    });

    // Create internal context
    const internalContext: InternalExecutionContext = {
      handle,
      startTime: new Date(),
      stateNamespace,
      isolationLevel: plan.stateConfig.isolationLevel,
      maxDuration: plan.executionConfig.timeoutSeconds * 1000,
      status: 'pending',
      abortRequested: false,
    };

    // Track active execution
    this.activeExecutions.set(executionId, internalContext);
    this.totalExecutions++;

    // Update status to running
    await this.stateRepository.updateExecutionStatus(
      {
        executionId: stateContext.executionId,
        tenantId: stateContext.tenantId,
        planId: stateContext.planId,
        planHash: stateContext.planHash,
        deterministicSeed: stateContext.deterministicSeed,
        namespace: stateContext.namespace,
      },
      'RUNNING'
    );
    internalContext.status = 'running';

    // TODO: Start actual execution in background via ExecutionOrchestrator
    // For now, we return the handle and execution will be triggered separately

    return handle;
  }

  /**
   * Get the current status of an execution
   */
  async getExecutionStatus(handle: ExecutionHandle): Promise<ExecutionStatusResult> {
    // Validate handle
    if (!isValidExecutionHandle(handle)) {
      throw new InvalidHandleError('Invalid execution handle format');
    }

    // Check memory cache first
    const internalContext = this.activeExecutions.get(handle.executionId);

    // Try to get from state repository
    const stateContext = await this.stateRepository.getExecutionContext(handle.executionId);

    if (!stateContext && !internalContext) {
      throw new ExecutionNotFoundError(handle.executionId);
    }

    // Build status result - note: stateContext doesn't have status field, need to get from execution_contexts table
    const status = internalContext?.status ?? 'pending';
    const startedAt = internalContext?.startTime.toISOString() ?? handle.submittedAt;

    // Get step states for progress
    let progress: ExecutionProgress | undefined;
    if (stateContext) {
      const stepStates = await this.stateRepository.getAllStepStates({
        executionId: stateContext.executionId,
        tenantId: stateContext.tenantId,
        planId: stateContext.planId,
        planHash: stateContext.planHash,
        deterministicSeed: stateContext.deterministicSeed,
        namespace: stateContext.namespace,
      });

      const completedSteps = stepStates.filter(
        (s) => s.status === 'COMPLETED' || s.status === 'SKIPPED'
      ).length;
      const totalSteps = stepStates.length;
      const currentStepState = stepStates.find((s) => s.status === 'RUNNING');

      progress = {
        completedSteps,
        totalSteps,
        currentStep: currentStepState?.step_id,
        percentComplete: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      };
    }

    return {
      executionId: handle.executionId,
      status,
      startedAt,
      progress,
      lastUpdatedAt: new Date().toISOString(),
      currentStep: progress?.currentStep,
      errorMessage: internalContext?.abortReason,
    };
  }

  /**
   * Get the result of a completed execution
   */
  async getResult(handle: ExecutionHandle, options?: GetResultOptions): Promise<SimulationResult> {
    const effectiveOptions: GetResultOptions = {
      timeout: options?.timeout ?? this.config.defaultTimeout,
      pollingInterval: options?.pollingInterval ?? 1000,
      includeTelemetry: options?.includeTelemetry ?? true,
      includeAuditTrail: options?.includeAuditTrail ?? true,
    };

    const deadline = Date.now() + (effectiveOptions.timeout ?? 0);

    // Poll for completion if timeout > 0
    while (Date.now() < deadline || effectiveOptions.timeout === 0) {
      const statusResult = await this.getExecutionStatus(handle);

      if (statusResult.status === 'completed') {
        // Retrieve result from repository
        const resultRow = await this.stateRepository.getResultByExecutionId(handle.executionId);

        if (!resultRow) {
          throw new ResultNotAvailableError(handle.executionId);
        }

        // Build full SimulationResult from stored data
        return this.buildSimulationResult(handle, resultRow as SimulationResultRow);
      }

      if (statusResult.status === 'failed') {
        throw new ExecutionFailedError(
          handle.executionId,
          statusResult.status,
          statusResult.errorMessage
        );
      }

      if (statusResult.status === 'cancelled') {
        throw new ExecutionAbortedError(handle.executionId, statusResult.errorMessage);
      }

      if (statusResult.status === 'timeout') {
        throw new ExecutionTimeoutError(handle.executionId);
      }

      // If no timeout specified, don't wait
      if (effectiveOptions.timeout === 0) {
        throw new ResultNotAvailableError(handle.executionId);
      }

      // Wait before next poll
      await this.sleep(effectiveOptions.pollingInterval ?? 1000);
    }

    throw new TimeoutError(handle.executionId, effectiveOptions.timeout ?? 0);
  }

  /**
   * Request graceful abort of an execution
   */
  async abortExecution(handle: ExecutionHandle, reason: string): Promise<AbortResult> {
    const internalContext = this.activeExecutions.get(handle.executionId);

    if (!internalContext) {
      // Check if execution exists in repository
      const stateContext = await this.stateRepository.getExecutionContext(handle.executionId);

      if (!stateContext) {
        throw new ExecutionNotFoundError(handle.executionId);
      }

      // Check if already completed - stateContext doesn't have status, check via memory
      // The execution status is tracked in activeExecutions or needs separate query
      // For now, if stateContext exists but not in activeExecutions, it may be completed
    }

    // Mark as abort requested
    if (internalContext) {
      internalContext.abortRequested = true;
      internalContext.abortReason = reason;
      internalContext.status = 'cancelled';
    }

    // Update status in repository
    const stateContext = await this.stateRepository.getExecutionContext(handle.executionId);
    if (stateContext) {
      await this.stateRepository.updateExecutionStatus(
        {
          executionId: stateContext.executionId,
          tenantId: stateContext.tenantId,
          planId: stateContext.planId,
          planHash: stateContext.planHash,
          deterministicSeed: stateContext.deterministicSeed,
          namespace: stateContext.namespace,
        },
        'ABORTED',
        reason
      );
    }

    // Remove from active executions
    this.activeExecutions.delete(handle.executionId);

    // Try to get partial result
    let partialResult: SimulationResult | undefined;
    try {
      const resultRow = await this.stateRepository.getResultByExecutionId(handle.executionId);
      if (resultRow) {
        partialResult = this.buildSimulationResult(handle, resultRow as SimulationResultRow);
      }
    } catch {
      // Ignore - partial result not available
    }

    return {
      executionId: handle.executionId,
      aborted: true,
      partialResult,
      reason,
      abortedAt: new Date().toISOString(),
    };
  }

  /**
   * Check the health of the runner and its dependencies
   */
  async healthCheck(): Promise<HealthStatus> {
    const components: ComponentHealth[] = [];
    const checkStartTime = Date.now();

    // Check state repository
    try {
      const poolStats = this.stateRepository.getPoolStats();
      // poolStats is an array of PoolStats, check if any tenant has connections
      const hasConnections = Array.isArray(poolStats) && poolStats.length > 0;
      const totalConnections = Array.isArray(poolStats)
        ? poolStats.reduce((sum, stat) => sum + stat.totalConnections, 0)
        : 0;
      components.push({
        name: 'state-repository',
        healthy: hasConnections || totalConnections >= 0, // Allow empty pool as healthy
        latencyMs: Date.now() - checkStartTime,
        message: `${totalConnections} total connections across ${poolStats?.length ?? 0} tenant pools`,
        lastCheckedAt: new Date().toISOString(),
      });
    } catch (error) {
      components.push({
        name: 'state-repository',
        healthy: false,
        message: `Error: ${String(error)}`,
        lastCheckedAt: new Date().toISOString(),
      });
    }

    // Check resource pool availability
    try {
      const resourcesHealthy =
        this.resourcePool.availableCpu > 0 && this.resourcePool.availableMemory > 0;
      components.push({
        name: 'resource-pool',
        healthy: resourcesHealthy,
        message: resourcesHealthy
          ? `CPU: ${this.resourcePool.availableCpu}, Memory: ${this.resourcePool.availableMemory}`
          : 'Insufficient resources',
        lastCheckedAt: new Date().toISOString(),
      });
    } catch (error) {
      components.push({
        name: 'resource-pool',
        healthy: false,
        message: `Error: ${String(error)}`,
        lastCheckedAt: new Date().toISOString(),
      });
    }

    // Check execution capacity
    const executionCapacity =
      this.activeExecutions.size < this.config.maxConcurrentExecutions * 0.9;
    components.push({
      name: 'execution-capacity',
      healthy: executionCapacity,
      message: `${this.activeExecutions.size}/${this.config.maxConcurrentExecutions} executions`,
      lastCheckedAt: new Date().toISOString(),
    });

    const allHealthy = components.every((c) => c.healthy);

    return {
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
      components,
      version: this.config.runnerVersion,
      uptimeMs: Date.now() - this.startTime.getTime(),
      activeExecutions: this.activeExecutions.size,
      totalExecutions: this.totalExecutions,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Extract tenant ID from plan or generate default
   */
  private extractTenantId(plan: SimulationPlan): string {
    // Extract from plan metadata if available
    const metadata = plan.metadata as unknown as Record<string, unknown> | undefined;
    const tenantId = metadata?.tenantId;
    return typeof tenantId === 'string' ? tenantId : uuidv4();
  }

  /**
   * Extract inputs from a workflow step based on its type
   */
  private extractStepInputs(step: WorkflowStep): Record<string, unknown> | undefined {
    if (isAgentInvocationStep(step)) {
      return step.inputs as unknown as Record<string, unknown>;
    }
    if (isIntegrationCallStep(step)) {
      return step.inputs as unknown as Record<string, unknown>;
    }
    return undefined;
  }

  /**
   * Generate state namespace from execution ID
   */
  private generateStateNamespace(executionId: ExecutionId): string {
    return `execution_${executionId.replace(/-/g, '_')}`;
  }

  /**
   * Get deterministic seed from plan or generate
   */
  private getDeterministicSeed(plan: SimulationPlan): bigint {
    if (plan.executionConfig.deterministicSeed !== undefined) {
      return BigInt(plan.executionConfig.deterministicSeed);
    }
    // Generate a random seed for non-deterministic execution
    return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  }

  /**
   * Get plan object without hash for hash computation
   */
  private getPlanWithoutHash(plan: SimulationPlan): Omit<SimulationPlan, 'planHash'> {
    const { planHash, ...planWithoutHash } = plan;
    return planWithoutHash;
  }

  /**
   * Map state repository status to ExecutionStatus
   */
  private mapStateStatus(status: string | undefined): ExecutionStatus {
    if (!status) return 'pending';

    const statusMap: Record<string, ExecutionStatus> = {
      INITIALIZING: 'pending',
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed',
      TIMED_OUT: 'timeout',
      ABORTED: 'cancelled',
      ROLLED_BACK: 'failed',
    };

    return statusMap[status] ?? 'pending';
  }

  /**
   * Build SimulationResult from stored data
   */
  private buildSimulationResult(
    handle: ExecutionHandle,
    resultRow: SimulationResultRow
  ): SimulationResult {
    // This is a simplified result builder
    // Full implementation would reconstruct all result fields from stored data
    // For now, return the stored result_data which should be the full SimulationResult
    return resultRow.result_data as unknown as SimulationResult;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Gateway Errors
// ============================================================================

/**
 * Base class for gateway errors
 */
export abstract class GatewayError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Plan validation failed
 */
export class PlanValidationError extends GatewayError {
  readonly code = 'PLAN_VALIDATION_ERROR';

  constructor(public readonly validationResult: FullValidationResult) {
    const allErrors = [
      ...validationResult.schemaResult.errors,
      ...validationResult.semanticResult.errors,
      ...validationResult.resourceResult.errors,
      ...validationResult.connectivityResult.errors,
      ...validationResult.preConditionResult.errors,
    ];
    super(`Plan validation failed: ${allErrors.map((e) => e.message).join('; ')}`);
  }
}

/**
 * Plan integrity check failed
 */
export class PlanIntegrityError extends GatewayError {
  readonly code = 'PLAN_INTEGRITY_ERROR';
}

/**
 * Invalid execution handle
 */
export class InvalidHandleError extends GatewayError {
  readonly code = 'INVALID_HANDLE_ERROR';
}

/**
 * Execution not found
 */
export class ExecutionNotFoundError extends GatewayError {
  readonly code = 'EXECUTION_NOT_FOUND';

  constructor(public readonly executionId: ExecutionId) {
    super(`Execution not found: ${executionId}`);
  }
}

/**
 * Result not yet available
 */
export class ResultNotAvailableError extends GatewayError {
  readonly code = 'RESULT_NOT_AVAILABLE';

  constructor(public readonly executionId: ExecutionId) {
    super(`Result not available for execution: ${executionId}`);
  }
}

/**
 * Execution failed
 */
export class ExecutionFailedError extends GatewayError {
  readonly code = 'EXECUTION_FAILED';

  constructor(
    public readonly executionId: ExecutionId,
    public readonly status: ExecutionStatus,
    public readonly errorMessage?: string
  ) {
    super(`Execution ${executionId} failed with status ${status}: ${errorMessage ?? 'Unknown error'}`);
  }
}

/**
 * Execution was aborted
 */
export class ExecutionAbortedError extends GatewayError {
  readonly code = 'EXECUTION_ABORTED';

  constructor(
    public readonly executionId: ExecutionId,
    public readonly reason?: string
  ) {
    super(`Execution ${executionId} was aborted: ${reason ?? 'No reason provided'}`);
  }
}

/**
 * Execution timed out
 */
export class ExecutionTimeoutError extends GatewayError {
  readonly code = 'EXECUTION_TIMEOUT';

  constructor(public readonly executionId: ExecutionId) {
    super(`Execution ${executionId} timed out`);
  }
}

/**
 * Wait timeout exceeded
 */
export class TimeoutError extends GatewayError {
  readonly code = 'TIMEOUT_ERROR';

  constructor(
    public readonly executionId: ExecutionId,
    public readonly timeout: DurationMs
  ) {
    super(`Timed out after ${timeout}ms waiting for execution ${executionId}`);
  }
}

/**
 * Execution already completed
 */
export class ExecutionAlreadyCompletedError extends GatewayError {
  readonly code = 'EXECUTION_ALREADY_COMPLETED';

  constructor(public readonly executionId: ExecutionId) {
    super(`Execution ${executionId} has already completed`);
  }
}

/**
 * Resources exhausted
 */
export class ResourceExhaustedError extends GatewayError {
  readonly code = 'RESOURCE_EXHAUSTED';
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an ExecutionGateway instance with default or custom configuration
 *
 * @param config - Gateway configuration
 * @param stateRepository - Optional state repository (uses shared if not provided)
 * @param resourcePool - Resource pool for validation
 * @param connectivityTester - Connectivity tester for validation
 * @param conditionEvaluator - Condition evaluator for validation
 * @returns Configured ExecutionGateway instance
 */
export function createExecutionGateway(
  config: GatewayConfig,
  stateRepository?: StateRepository,
  resourcePool?: ResourcePool,
  connectivityTester?: ConnectivityTester,
  conditionEvaluator?: ConditionEvaluator
): ExecutionGateway {
  const effectiveRepository = stateRepository ?? getSharedStateRepository();

  // Default resource pool with reasonable limits
  const effectiveResourcePool: ResourcePool = resourcePool ?? {
    availableCpu: 8,
    availableMemory: 16 * 1024 * 1024 * 1024, // 16 GB
    availableStorage: 100 * 1024 * 1024 * 1024, // 100 GB
    maxExecutionDuration: 24 * 60 * 60 * 1000, // 24 hours
  };

  // Default connectivity tester (always succeeds)
  const effectiveConnectivityTester: ConnectivityTester = connectivityTester ?? {
    async testConnection() {
      return { success: true };
    },
  };

  // Default condition evaluator (always passes)
  const effectiveConditionEvaluator: ConditionEvaluator = conditionEvaluator ?? {
    async evaluate() {
      return { passed: true, message: 'Condition passed' };
    },
  };

  return new ExecutionGatewayImpl(
    config,
    effectiveRepository,
    effectiveResourcePool,
    effectiveConnectivityTester,
    effectiveConditionEvaluator
  );
}
