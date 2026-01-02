/**
 * Finalization Orchestrator (MOD-005)
 *
 * Coordinates all activities to finalize execution into an immutable SimulationResult.
 * Implements Phase 5 of the Master Execution Flow - FINALIZATION.
 *
 * Responsibilities:
 * - Aggregates all observations (metrics, events, traces)
 * - Evaluates postconditions
 * - Verifies invariants
 * - Generates reproducibility proof
 * - Assembles and persists immutable result
 *
 * Enforces:
 * - INV-OUT-001: SimulationResult is complete
 * - INV-OUT-002: SimulationResult is immutable once persisted
 * - INV-OUT-003: SimulationResult has valid resultHash
 * - GUA-REP-004: Execution fingerprint is verifiable
 *
 * @module orchestration/finalization-orchestrator
 * @see SPARC_PSEUDOCODE.md Sections 6-7 - Observation & Finalization
 * @see SPARC_ARCHITECTURE.md MOD-005 - Finalization Orchestrator
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  Metadata,
  ConditionResult as CommonConditionResult,
} from '../types/common.js';

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  SimulationPlan,
} from '../types/simulation-plan.js';

import type {
  SimulationResult,
  ExecutionTelemetry,
  ValidationOutcomes,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
} from './types.js';

import {
  ObservationAggregator,
  createObservationAggregator,
  type CapturedMetrics,
  type CapturedEvents,
  type CapturedTraces,
  type ObservabilityValidationResult,
} from './observation-aggregator.js';

import {
  PostconditionEvaluator,
  createPostconditionEvaluator,
  type PostConditionResults,
  type InvariantResults,
} from './postcondition-evaluator.js';

import {
  ReproducibilityProver,
  createReproducibilityProver,
  type ReproducibilityProof,
} from './reproducibility-prover.js';

import {
  ResultAssembler,
  createResultAssembler,
  type PersistenceConfirmation,
  type AssembleResultOptions,
} from './result-assembler.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for finalization
 */
export interface FinalizationOptions {
  /**
   * Whether to persist the result
   */
  readonly persistResult?: boolean;

  /**
   * Whether to generate reproducibility proof
   */
  readonly generateReproducibilityProof?: boolean;

  /**
   * Whether to include detailed telemetry
   */
  readonly includeDetailedTelemetry?: boolean;

  /**
   * Assembly options for result
   */
  readonly assembleOptions?: AssembleResultOptions;
}

/**
 * Default finalization options
 */
export const DEFAULT_FINALIZATION_OPTIONS: FinalizationOptions = {
  persistResult: true,
  generateReproducibilityProof: true,
  includeDetailedTelemetry: true,
};

/**
 * Result of finalization
 */
export interface FinalizationResult {
  /**
   * The assembled SimulationResult
   */
  readonly result: SimulationResult;

  /**
   * Persistence confirmation (if persisted)
   */
  readonly persistence?: PersistenceConfirmation;

  /**
   * Postcondition evaluation results
   */
  readonly postconditions: PostConditionResults;

  /**
   * Invariant verification results
   */
  readonly invariants: InvariantResults;

  /**
   * Observability validation result
   */
  readonly observabilityValidation: ObservabilityValidationResult;

  /**
   * Whether finalization was successful
   */
  readonly success: boolean;

  /**
   * Finalization errors (if any)
   */
  readonly errors: string[];

  /**
   * Finalization warnings
   */
  readonly warnings: string[];
}

// =============================================================================
// Finalization Orchestrator Class
// =============================================================================

/**
 * Finalization Orchestrator - MOD-005
 *
 * Coordinates the finalization of an execution into an immutable SimulationResult.
 *
 * Main method: finalize(ctx, workflowResult, plan)
 *
 * Sequence:
 * 1. Aggregate observations (metrics, events, traces) - Section 6
 * 2. Evaluate postconditions - Section 7.1
 * 3. Verify invariants - Section 7.2
 * 4. Generate reproducibility proof - Section 7.3
 * 5. Assemble SimulationResult - Section 7.4
 * 6. Persist result with immutability lock - Section 7.5
 */
export class FinalizationOrchestrator {
  private readonly observationAggregator: ObservationAggregator;
  private readonly postconditionEvaluator: PostconditionEvaluator;
  private readonly reproducibilityProver: ReproducibilityProver;
  private readonly resultAssembler: ResultAssembler;

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan
  ) {
    this.observationAggregator = createObservationAggregator(ctx, plan);
    this.postconditionEvaluator = createPostconditionEvaluator(ctx, plan);
    this.reproducibilityProver = createReproducibilityProver(ctx, plan);
    this.resultAssembler = createResultAssembler(ctx, plan);
  }

  // ===========================================================================
  // Main Finalization Method
  // ===========================================================================

  /**
   * Finalize execution into an immutable SimulationResult
   *
   * Master Algorithm (from Pseudocode Sections 6-7):
   *
   * 1. OBSERVATION AGGREGATION (Section 6):
   *    a. aggregateMetrics(ctx, plan) - Collect and summarize metrics
   *    b. compileEventLog(ctx, plan) - Assemble chronological events
   *    c. assembleTraces(ctx, plan) - Build distributed traces
   *    d. validateObservabilityCompleteness(...) - Verify all required data captured
   *
   * 2. VALIDATION (Section 7.1-7.2):
   *    a. evaluatePostConditions(ctx, plan, workflowResult) - Check postconditions
   *    b. verifyInvariants(ctx, plan, workflowResult) - Verify invariants held
   *
   * 3. REPRODUCIBILITY (Section 7.3):
   *    a. generateReproducibilityProof(ctx) - Compute execution fingerprint
   *
   * 4. RESULT ASSEMBLY (Section 7.4):
   *    a. assembleSimulationResult(...) - Combine all data
   *    b. Compute resultHash (INV-OUT-003)
   *    c. Validate completeness (INV-OUT-001)
   *
   * 5. PERSISTENCE (Section 7.5):
   *    a. persistSimulationResult(result) - Store with immutability lock (INV-OUT-002)
   *
   * @param workflowResult - Result of workflow execution
   * @param preConditionResults - Results of precondition evaluation
   * @param options - Finalization options
   * @returns Complete finalization result
   */
  async finalize(
    workflowResult: WorkflowResult,
    preConditionResults: CommonConditionResult[] = [],
    options: FinalizationOptions = DEFAULT_FINALIZATION_OPTIONS
  ): Promise<FinalizationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // =========================================================================
      // PHASE 1: Observation Aggregation (Section 6)
      // =========================================================================

      // 6.1 Aggregate metrics
      const metrics = await this.observationAggregator.aggregateMetrics();

      // 6.2 Compile event log
      const events = await this.observationAggregator.compileEventLog();

      // 6.3 Assemble traces
      const traces = await this.observationAggregator.assembleTraces();

      // Validate observability completeness
      const observabilityValidation = this.observationAggregator.validateObservabilityCompleteness(
        metrics,
        events,
        traces
      );

      if (!observabilityValidation.valid) {
        warnings.push(...observabilityValidation.warnings);
        warnings.push(`Missing metrics: ${observabilityValidation.missingMetrics.join(', ')}`);
      }

      // Build telemetry from observations
      const telemetry = this.observationAggregator.buildExecutionTelemetry(
        metrics,
        events,
        traces,
        workflowResult
      );

      // =========================================================================
      // PHASE 2: Validation (Section 7.1-7.2)
      // =========================================================================

      // 7.1 Evaluate postconditions
      const postconditions = await this.postconditionEvaluator.evaluatePostConditions(
        workflowResult
      );

      if (!postconditions.allPassed) {
        warnings.push(`${postconditions.failedCount} postcondition(s) failed`);
      }

      // 7.2 Verify invariants
      const invariants = await this.postconditionEvaluator.verifyInvariants(
        workflowResult
      );

      if (!invariants.allHeld) {
        warnings.push(`${invariants.violatedCount} invariant(s) violated with ${invariants.totalViolations} total violations`);
      }

      // Build validation outcomes
      const validationOutcomes = this.postconditionEvaluator.buildValidationOutcomes(
        preConditionResults,
        postconditions,
        invariants
      );

      // =========================================================================
      // PHASE 3: Reproducibility Proof (Section 7.3)
      // =========================================================================

      let reproducibilityProof: ReproducibilityProof | undefined;
      let simResultReproducibilityProof = undefined;

      if (options.generateReproducibilityProof) {
        reproducibilityProof = await this.reproducibilityProver.generateReproducibilityProof();
        simResultReproducibilityProof = this.reproducibilityProver.buildSimResultReproducibilityProof(
          reproducibilityProof
        );
      }

      // =========================================================================
      // PHASE 4: Result Assembly (Section 7.4)
      // =========================================================================

      const result = await this.resultAssembler.assembleSimulationResult(
        workflowResult,
        telemetry,
        validationOutcomes,
        simResultReproducibilityProof,
        preConditionResults,
        options.assembleOptions
      );

      // =========================================================================
      // PHASE 5: Persistence (Section 7.5)
      // =========================================================================

      let persistence: PersistenceConfirmation | undefined;

      if (options.persistResult) {
        persistence = await this.resultAssembler.persistSimulationResult(result);

        if (!persistence.success) {
          errors.push(`Persistence failed: ${persistence.error}`);
        }
      }

      // =========================================================================
      // Return Finalization Result
      // =========================================================================

      return {
        result,
        persistence,
        postconditions,
        invariants,
        observabilityValidation,
        success: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Finalization failed: ${errorMessage}`);

      // Return partial result on failure
      return {
        result: undefined as unknown as SimulationResult,
        postconditions: undefined as unknown as PostConditionResults,
        invariants: undefined as unknown as InvariantResults,
        observabilityValidation: undefined as unknown as ObservabilityValidationResult,
        success: false,
        errors,
        warnings,
      };
    }
  }

  // ===========================================================================
  // Component Accessors
  // ===========================================================================

  /**
   * Get the observation aggregator for direct access
   */
  getObservationAggregator(): ObservationAggregator {
    return this.observationAggregator;
  }

  /**
   * Get the postcondition evaluator for direct access
   */
  getPostconditionEvaluator(): PostconditionEvaluator {
    return this.postconditionEvaluator;
  }

  /**
   * Get the reproducibility prover for direct access
   */
  getReproducibilityProver(): ReproducibilityProver {
    return this.reproducibilityProver;
  }

  /**
   * Get the result assembler for direct access
   */
  getResultAssembler(): ResultAssembler {
    return this.resultAssembler;
  }

  // ===========================================================================
  // Individual Finalization Steps (for granular control)
  // ===========================================================================

  /**
   * Aggregate observations only
   */
  async aggregateObservations(
    type: 'metrics' | 'events' | 'traces'
  ): Promise<CapturedMetrics | CapturedEvents | CapturedTraces> {
    switch (type) {
      case 'metrics':
        return this.observationAggregator.aggregateMetrics();
      case 'events':
        return this.observationAggregator.compileEventLog();
      case 'traces':
        return this.observationAggregator.assembleTraces();
    }
  }

  /**
   * Evaluate postconditions only
   */
  async evaluatePostConditions(
    workflowResult: WorkflowResult
  ): Promise<PostConditionResults> {
    return this.postconditionEvaluator.evaluatePostConditions(workflowResult);
  }

  /**
   * Verify invariants only
   */
  async verifyInvariants(
    workflowResult: WorkflowResult
  ): Promise<InvariantResults> {
    return this.postconditionEvaluator.verifyInvariants(workflowResult);
  }

  /**
   * Generate reproducibility proof only
   */
  async generateReproducibilityProof(): Promise<ReproducibilityProof> {
    return this.reproducibilityProver.generateReproducibilityProof();
  }

  /**
   * Assemble result only (without persistence)
   */
  async assembleResult(
    workflowResult: WorkflowResult,
    telemetry: ExecutionTelemetry,
    validationOutcomes: ValidationOutcomes,
    preConditionResults: CommonConditionResult[] = [],
    options?: AssembleResultOptions
  ): Promise<SimulationResult> {
    const reproducibilityProof = await this.generateReproducibilityProof();
    const simResultProof = this.reproducibilityProver.buildSimResultReproducibilityProof(
      reproducibilityProof
    );

    return this.resultAssembler.assembleSimulationResult(
      workflowResult,
      telemetry,
      validationOutcomes,
      simResultProof,
      preConditionResults,
      options
    );
  }

  /**
   * Persist result only
   */
  async persistResult(
    result: SimulationResult
  ): Promise<PersistenceConfirmation> {
    return this.resultAssembler.persistSimulationResult(result);
  }

  // ===========================================================================
  // Runtime Tracking Methods
  // ===========================================================================

  /**
   * Record an event during execution
   * Called by execution orchestrator to capture events
   */
  recordEvent(
    eventType: string,
    data: Record<string, unknown>
  ): void {
    this.observationAggregator.recordEvent({
      eventId: uuidv4() as UUID,
      eventType,
      data,
      occurredAt: new Date().toISOString() as ISO8601Timestamp,
    });
  }

  /**
   * Check invariants at a step during execution
   * Called by step executor after each step
   */
  async checkInvariantsAtStep(
    stepId: string,
    stepOutputs: Record<string, unknown>
  ): Promise<string[]> {
    return this.postconditionEvaluator.checkInvariantsAtStep(stepId, stepOutputs);
  }

  /**
   * Log randomness during execution
   * Called by deterministic random wrapper
   */
  logRandomness(
    operation: string,
    value: Uint8Array,
    stepId?: string,
    context?: Metadata
  ): void {
    this.reproducibilityProver.logRandomness(operation, value, stepId, context);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a finalization orchestrator
 */
export function createFinalizationOrchestrator(
  ctx: ExecutionContext,
  plan: SimulationPlan
): FinalizationOrchestrator {
  return new FinalizationOrchestrator(ctx, plan);
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Finalize an execution in one call
 *
 * This is a convenience function that creates a finalization orchestrator
 * and runs the complete finalization process.
 *
 * @param ctx - Execution context
 * @param plan - Simulation plan
 * @param workflowResult - Result of workflow execution
 * @param preConditionResults - Results of precondition evaluation
 * @param options - Finalization options
 * @returns Finalization result
 */
export async function finalizeExecution(
  ctx: ExecutionContext,
  plan: SimulationPlan,
  workflowResult: WorkflowResult,
  preConditionResults: CommonConditionResult[] = [],
  options: FinalizationOptions = DEFAULT_FINALIZATION_OPTIONS
): Promise<FinalizationResult> {
  const orchestrator = createFinalizationOrchestrator(ctx, plan);
  return orchestrator.finalize(workflowResult, preConditionResults, options);
}
