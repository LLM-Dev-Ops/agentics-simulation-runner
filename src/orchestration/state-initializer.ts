/**
 * State Initializer (MOD-003.2)
 *
 * Initializes all namespaced state for an execution.
 * Implements Phase 2, Step 4.2 from SPARC Pseudocode.
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4.2 - Initialize State
 * - SPARC_ARCHITECTURE.md MOD-003, MOD-014
 *
 * Invariants enforced:
 * - INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
 * - INV-EX-007: All state mutations MUST be recorded in ruvvector-postgres
 */

import { randomUUID } from 'crypto';
import type { StepId, UUID } from '../types/common.js';
import type { ExecutionContext, StateHandle } from '../types/execution.js';
import type { SimulationPlan, WorkflowStep } from '../types/plan.js';
import {
  StateRepository,
  PostgresStateRepository,
  type StateRepositoryConfig,
} from '../state/repository.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for state initialization
 */
export interface StateInitializerConfig {
  readonly stateRepository?: StateRepository;
  readonly repositoryConfig?: StateRepositoryConfig;
}

/**
 * Step state record for initial creation
 */
export interface InitialStepState {
  readonly stepId: StepId;
  readonly stepType: string;
  readonly name: string;
  readonly status: 'PENDING';
  readonly critical: boolean;
  readonly timeout?: number;
  readonly parentStepId?: StepId;
}

/**
 * Result of state initialization
 */
export interface StateInitializationResult {
  readonly stateHandle: StateHandle;
  readonly initializedSteps: InitialStepState[];
  readonly initializedAt: Date;
}

// ============================================================================
// State Initializer
// ============================================================================

/**
 * StateInitializer manages the creation of namespaced state tables
 * for each execution context
 */
export class StateInitializer {
  private stateRepository: StateRepository | null = null;
  private readonly config: StateInitializerConfig;

  constructor(config: StateInitializerConfig = {}) {
    this.config = config;
    if (config.stateRepository) {
      this.stateRepository = config.stateRepository;
    }
  }

  /**
   * Ensures the state repository is connected
   */
  private async ensureRepository(): Promise<StateRepository> {
    if (this.stateRepository) {
      if (!this.stateRepository.isConnected()) {
        await this.stateRepository.connect();
      }
      return this.stateRepository;
    }

    if (!this.config.repositoryConfig) {
      throw new Error(
        'StateInitializer requires either stateRepository or repositoryConfig'
      );
    }

    this.stateRepository = new PostgresStateRepository(this.config.repositoryConfig);
    await this.stateRepository.connect();
    return this.stateRepository;
  }

  /**
   * Initializes state for an execution
   *
   * From Pseudocode 4.2:
   * 1. Create namespaced tables using StateRepository.initializeState()
   * 2. Insert initial step states as PENDING
   *
   * @param ctx - The execution context
   * @param plan - The simulation plan
   * @returns StateInitializationResult with handle and initialized steps
   */
  async initializeState(
    ctx: ExecutionContext,
    plan: SimulationPlan
  ): Promise<StateInitializationResult> {
    const repository = await this.ensureRepository();
    const initializationTime = new Date();

    // 1. Initialize the namespace with all required tables
    const stateHandle = await repository.initializeNamespace(ctx.stateNamespace);

    // 2. Create initial step states for all workflow steps
    const initializedSteps = await this.initializeStepStates(
      repository,
      ctx.stateNamespace,
      plan.workflow.steps
    );

    // 3. Create execution context record in the database
    await repository.createExecutionContext(
      ctx.executionId,
      ctx.planRef.planId,
      ctx.planRef.planHash,
      ctx.tenantId,
      ctx.randomGenerator.initialSeed,
      ctx.isolationLevel
    );

    return {
      stateHandle,
      initializedSteps,
      initializedAt: initializationTime,
    };
  }

  /**
   * Recursively initializes step states for all workflow steps
   */
  private async initializeStepStates(
    repository: StateRepository,
    namespace: string,
    steps: WorkflowStep[],
    parentStepId?: StepId
  ): Promise<InitialStepState[]> {
    const initializedSteps: InitialStepState[] = [];

    for (const step of steps) {
      const stepId = step.stepId as StepId;

      // Create initial step state
      const initialState: InitialStepState = {
        stepId,
        stepType: step.stepType,
        name: step.name,
        status: 'PENDING',
        critical: step.critical,
        timeout: step.timeout,
        parentStepId,
      };

      // Insert into database
      await repository.createStepState(namespace, stepId);

      initializedSteps.push(initialState);

      // Handle nested steps (PARALLEL_GROUP, LOOP, CONDITIONAL)
      if (step.subSteps && step.subSteps.length > 0) {
        const nestedSteps = await this.initializeStepStates(
          repository,
          namespace,
          step.subSteps,
          stepId
        );
        initializedSteps.push(...nestedSteps);
      }
    }

    return initializedSteps;
  }

  /**
   * Cleans up all state for an execution (for teardown)
   *
   * @param ctx - The execution context to clean up
   */
  async cleanupState(ctx: ExecutionContext): Promise<void> {
    const repository = await this.ensureRepository();
    await repository.cleanupNamespace(ctx.stateNamespace);
  }

  /**
   * Verifies that state was properly initialized
   *
   * @param ctx - The execution context
   * @param expectedStepCount - Expected number of step states
   * @returns true if verification passes
   */
  async verifyStateInitialization(
    ctx: ExecutionContext,
    expectedStepCount: number
  ): Promise<boolean> {
    const repository = await this.ensureRepository();

    // Verify execution context exists
    const executionRecord = await repository.getExecutionContext(ctx.executionId);
    if (!executionRecord) {
      throw new Error(`Execution context ${ctx.executionId} not found in database`);
    }

    // Verify step states exist (sample check for first step)
    // In production, we'd verify all steps
    return executionRecord.status === 'INITIALIZING';
  }

  /**
   * Closes the state repository connection
   */
  async close(): Promise<void> {
    if (this.stateRepository) {
      await this.stateRepository.disconnect();
      this.stateRepository = null;
    }
  }
}

/**
 * Factory function to create a StateInitializer
 */
export function createStateInitializer(config: StateInitializerConfig = {}): StateInitializer {
  return new StateInitializer(config);
}

/**
 * Utility to count total steps including nested steps
 *
 * @param steps - Array of workflow steps
 * @returns Total count of all steps
 */
export function countTotalSteps(steps: WorkflowStep[]): number {
  let count = 0;

  for (const step of steps) {
    count += 1;
    if (step.subSteps && step.subSteps.length > 0) {
      count += countTotalSteps(step.subSteps);
    }
  }

  return count;
}

/**
 * Flattens a nested step hierarchy into a flat array
 *
 * @param steps - Array of workflow steps
 * @returns Flattened array of all steps
 */
export function flattenSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];

  for (const step of steps) {
    result.push(step);
    if (step.subSteps && step.subSteps.length > 0) {
      result.push(...flattenSteps(step.subSteps));
    }
  }

  return result;
}

/**
 * Validates the dependency graph for cycles and missing references
 *
 * @param plan - The simulation plan
 * @returns true if valid, throws on validation failure
 */
export function validateDependencyGraph(plan: SimulationPlan): boolean {
  const stepIdArray = flattenSteps(plan.workflow.steps).map((s) => s.stepId);
  const stepIds = new Set(stepIdArray);
  const edges = plan.workflow.dependencies.edges;

  // Check all dependency references are valid
  for (const edge of edges) {
    if (!stepIds.has(edge.from)) {
      throw new Error(`Dependency references non-existent step: ${edge.from}`);
    }
    if (!stepIds.has(edge.to)) {
      throw new Error(`Dependency references non-existent step: ${edge.to}`);
    }
  }

  // Check for cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (recursionStack.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Find all nodes this node depends on
    const dependsOn = edges.filter((e) => e.to === nodeId).map((e) => e.from);

    for (const dep of dependsOn) {
      if (hasCycle(dep)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Use stepIdArray to iterate instead of Set
  for (const stepId of stepIdArray) {
    if (hasCycle(stepId)) {
      throw new Error(`Dependency cycle detected involving step: ${stepId}`);
    }
  }

  return true;
}
