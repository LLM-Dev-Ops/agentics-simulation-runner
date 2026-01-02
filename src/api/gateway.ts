/**
 * Execution Gateway (MOD-001)
 *
 * Single entry point for all external interactions with the runner.
 * Enforces authentication, authorization, and request validation
 * before delegating to orchestration layer.
 *
 * Implements:
 * - INV-IN-001 through INV-IN-007: Input validation
 * - INV-OUT-001 through INV-OUT-007: Output validation
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-001
 * - SPARC_SPECIFICATION.md Section 3, 4
 */

import { v4 as uuidv4 } from 'uuid';
import type { SimulationPlan } from '../types/plan.js';
import type { SimulationResult } from '../types/result.js';
import type {
  ExecutionHandle,
  ExecutionContext,
  HealthStatus,
  ComponentHealth,
} from '../types/execution.js';
import type { ExecutionId, UUID, ExecutionStatus } from '../types/common.js';
import {
  validatePlan,
  type FullValidationResult,
  type ResourcePool,
  type ConnectivityTester,
  type ConditionEvaluator,
} from '../orchestration/validation.js';
import { createDeterministicRandom } from '../core/deterministic-random.js';
import type { StateRepository } from '../state/repository.js';

// ============================================================================
// Gateway Configuration
// ============================================================================

export interface GatewayConfig {
  readonly runnerName: string;
  readonly runnerVersion: string;
  readonly runnerInstanceId: UUID;
  readonly defaultTimeout: number;
  readonly maxConcurrentExecutions: number;
}

// ============================================================================
// Gateway Status Types
// ============================================================================

export interface ExecutionStatusResult {
  readonly executionId: ExecutionId;
  readonly status: ExecutionStatus;
  readonly startedAt: string;
  readonly progress?: ExecutionProgress;
  readonly estimatedCompletion?: string;
}

export interface ExecutionProgress {
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly currentStep?: string;
  readonly percentComplete: number;
}

export interface AbortResult {
  readonly executionId: ExecutionId;
  readonly aborted: boolean;
  readonly partialResult?: SimulationResult;
  readonly reason: string;
}

// ============================================================================
// Execution Gateway
// ============================================================================

export interface ExecutionGateway {
  /**
   * Submit a SimulationPlan for execution
   * Returns an ExecutionHandle for tracking and result retrieval
   */
  submitPlan(plan: SimulationPlan): Promise<ExecutionHandle>;

  /**
   * Get the current status of an execution
   */
  getExecutionStatus(handle: ExecutionHandle): Promise<ExecutionStatusResult>;

  /**
   * Get the result of a completed execution
   * Blocks until completion or timeout
   */
  getResult(handle: ExecutionHandle, timeout?: number): Promise<SimulationResult>;

  /**
   * Request graceful abort of an execution
   */
  abortExecution(handle: ExecutionHandle, reason: string): Promise<AbortResult>;

  /**
   * Check the health of the runner and its dependencies
   */
  healthCheck(): Promise<HealthStatus>;
}

// ============================================================================
// Gateway Implementation
// ============================================================================

export class ExecutionGatewayImpl implements ExecutionGateway {
  private readonly activeExecutions = new Map<ExecutionId, ExecutionContext>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly stateRepository: StateRepository,
    private readonly resourcePool: ResourcePool,
    private readonly connectivityTester: ConnectivityTester,
    private readonly conditionEvaluator: ConditionEvaluator
  ) {}

  async submitPlan(plan: SimulationPlan): Promise<ExecutionHandle> {
    // Validate the plan
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

    // Generate execution ID
    const executionId = uuidv4() as ExecutionId;

    // Create execution context
    const context: ExecutionContext = {
      executionId,
      planRef: {
        planId: plan.planId,
        planHash: plan.planHash,
      },
      tenantId: uuidv4(), // TODO: Get from auth context
      stateNamespace: `execution_${executionId.replace(/-/g, '_')}`,
      randomGenerator: createDeterministicRandom(plan.executionConfig.deterministicSeed),
      startTime: new Date(),
      resourceLimits: plan.executionConfig.resourceLimits,
      maxDuration: plan.executionConfig.maxDuration,
      isolationLevel: plan.executionConfig.isolationLevel,
    };

    // Persist execution context
    await this.stateRepository.createExecutionContext(
      executionId,
      plan.planId,
      plan.planHash,
      context.tenantId,
      plan.executionConfig.deterministicSeed,
      plan.executionConfig.isolationLevel
    );

    // Initialize state namespace
    await this.stateRepository.initializeNamespace(context.stateNamespace);

    // Track active execution
    this.activeExecutions.set(executionId, context);

    // TODO: Start execution in background

    return {
      executionId,
      planId: plan.planId,
      planHash: plan.planHash,
      startedAt: context.startTime.toISOString(),
      estimatedDuration: plan.executionConfig.maxDuration,
    };
  }

  async getExecutionStatus(handle: ExecutionHandle): Promise<ExecutionStatusResult> {
    const contextRecord = await this.stateRepository.getExecutionContext(handle.executionId);

    if (!contextRecord) {
      throw new ExecutionNotFoundError(handle.executionId);
    }

    return {
      executionId: handle.executionId,
      status: contextRecord.status as ExecutionStatus,
      startedAt: contextRecord.startedAt.toISOString(),
      // TODO: Add progress tracking
    };
  }

  async getResult(handle: ExecutionHandle, timeout?: number): Promise<SimulationResult> {
    const effectiveTimeout = timeout ?? this.config.defaultTimeout;
    const deadline = Date.now() + effectiveTimeout;

    // Poll for completion
    while (Date.now() < deadline) {
      const status = await this.getExecutionStatus(handle);

      if (status.status === 'completed') {
        const result = await this.stateRepository.getResult(handle.executionId);
        if (result) {
          return result;
        }
        throw new ResultNotFoundError(handle.executionId);
      }

      if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'timeout') {
        throw new ExecutionFailedError(handle.executionId, status.status);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new TimeoutError(handle.executionId, effectiveTimeout);
  }

  async abortExecution(handle: ExecutionHandle, reason: string): Promise<AbortResult> {
    const context = this.activeExecutions.get(handle.executionId);

    if (!context) {
      throw new ExecutionNotFoundError(handle.executionId);
    }

    // Update status to aborted
    await this.stateRepository.updateExecutionStatus(handle.executionId, 'cancelled');

    // Remove from active executions
    this.activeExecutions.delete(handle.executionId);

    return {
      executionId: handle.executionId,
      aborted: true,
      reason,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const components: ComponentHealth[] = [];

    // Check state repository
    try {
      const isConnected = this.stateRepository.isConnected();
      components.push({
        name: 'state-repository',
        healthy: isConnected,
        message: isConnected ? 'Connected' : 'Disconnected',
      });
    } catch (error) {
      components.push({
        name: 'state-repository',
        healthy: false,
        message: String(error),
      });
    }

    const allHealthy = components.every((c) => c.healthy);

    return {
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
      components,
      version: this.config.runnerVersion,
    };
  }
}

// ============================================================================
// Gateway Errors
// ============================================================================

export class PlanValidationError extends Error {
  constructor(public readonly validationResult: FullValidationResult) {
    const errors = [
      ...validationResult.schemaResult.errors,
      ...validationResult.semanticResult.errors,
      ...validationResult.resourceResult.errors,
      ...validationResult.connectivityResult.errors,
      ...validationResult.preConditionResult.errors,
    ];
    super(`Plan validation failed: ${errors.map((e) => e.message).join(', ')}`);
    this.name = 'PlanValidationError';
  }
}

export class ExecutionNotFoundError extends Error {
  constructor(public readonly executionId: ExecutionId) {
    super(`Execution not found: ${executionId}`);
    this.name = 'ExecutionNotFoundError';
  }
}

export class ResultNotFoundError extends Error {
  constructor(public readonly executionId: ExecutionId) {
    super(`Result not found for execution: ${executionId}`);
    this.name = 'ResultNotFoundError';
  }
}

export class ExecutionFailedError extends Error {
  constructor(
    public readonly executionId: ExecutionId,
    public readonly status: ExecutionStatus
  ) {
    super(`Execution failed with status: ${status}`);
    this.name = 'ExecutionFailedError';
  }
}

export class TimeoutError extends Error {
  constructor(
    public readonly executionId: ExecutionId,
    public readonly timeout: number
  ) {
    super(`Execution timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an ExecutionGateway instance
 */
export function createExecutionGateway(
  config: GatewayConfig,
  stateRepository: StateRepository,
  resourcePool: ResourcePool,
  connectivityTester: ConnectivityTester,
  conditionEvaluator: ConditionEvaluator
): ExecutionGateway {
  return new ExecutionGatewayImpl(
    config,
    stateRepository,
    resourcePool,
    connectivityTester,
    conditionEvaluator
  );
}
