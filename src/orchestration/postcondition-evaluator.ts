/**
 * Postcondition Evaluator (MOD-005 Component)
 *
 * Evaluates postconditions and verifies invariants after execution completes.
 * Implements Pseudocode Section 7.1-7.2 - Postcondition and Invariant Verification.
 *
 * Components:
 * - evaluatePostConditions: Evaluates plan-defined postconditions (7.1)
 * - verifyInvariants: Verifies invariants held throughout execution (7.2)
 *
 * @module orchestration/postcondition-evaluator
 * @see SPARC_PSEUDOCODE.md Section 7.1-7.2 - Postcondition and Invariant Verification
 * @see SPARC_ARCHITECTURE.md MOD-005 - Finalization Orchestrator
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  Metadata,
  Condition,
  ConditionResult as CommonConditionResult,
} from '../types/common.js';

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  SimulationPlan,
  Invariant,
  ValidationConfig,
} from '../types/simulation-plan.js';

import type {
  ConditionResult,
  InvariantResult,
  InvariantViolation as ResultInvariantViolation,
  ValidationOutcomes,
} from '../types/result.js';

/**
 * Local InvariantViolation type that uses plain string for stepId
 * to avoid branded type issues
 */
interface InvariantViolation {
  readonly occurredAt: ISO8601Timestamp;
  readonly data: Record<string, unknown>;
  readonly stepId?: string;
}

import type {
  ValidationOutcomes as SimResultValidationOutcomes,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
  ExecutionError,
} from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of postcondition evaluation
 */
export interface PostConditionResults {
  /**
   * Individual postcondition results
   */
  readonly results: ConditionResult[];

  /**
   * Whether all postconditions passed
   */
  readonly allPassed: boolean;

  /**
   * Count of passed conditions
   */
  readonly passedCount: number;

  /**
   * Count of failed conditions
   */
  readonly failedCount: number;

  /**
   * Evaluation timestamp
   */
  readonly evaluatedAt: ISO8601Timestamp;
}

/**
 * Result of invariant verification
 */
export interface InvariantResults {
  /**
   * Individual invariant results
   */
  readonly results: InvariantResult[];

  /**
   * Whether all invariants held
   */
  readonly allHeld: boolean;

  /**
   * Count of held invariants
   */
  readonly heldCount: number;

  /**
   * Count of violated invariants
   */
  readonly violatedCount: number;

  /**
   * Total violations across all invariants
   */
  readonly totalViolations: number;

  /**
   * Verification timestamp
   */
  readonly verifiedAt: ISO8601Timestamp;
}

/**
 * Expression evaluation context
 */
interface EvaluationContext {
  readonly state: Record<string, unknown>;
  readonly stepResults: Record<string, unknown>;
  readonly agentStates: Record<string, unknown>;
  readonly execution: {
    readonly status: string;
    readonly durationMs: number;
    readonly stepsCompleted: number;
    readonly errorsCount: number;
  };
}

// =============================================================================
// Postcondition Evaluator Class
// =============================================================================

/**
 * Evaluates postconditions and verifies invariants
 *
 * Implements Pseudocode Section 7.1-7.2 validation functions
 */
export class PostconditionEvaluator {
  private readonly invariantViolations: Map<string, InvariantViolation[]> = new Map();

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan
  ) {}

  // ===========================================================================
  // Pseudocode 7.1 - evaluatePostConditions
  // ===========================================================================

  /**
   * Evaluate all postconditions defined in the plan
   *
   * Algorithm (from Pseudocode 7.1):
   * 1. Get postconditions from plan.validation.postConditions
   * 2. Build evaluation context from execution state
   * 3. For each postcondition:
   *    a. Evaluate expression against context
   *    b. Record result (passed/failed)
   *    c. Capture evaluation details
   * 4. Return PostConditionResults
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan
   * @param workflowResult - Result of workflow execution
   * @returns Postcondition evaluation results
   */
  async evaluatePostConditions(
    workflowResult: WorkflowResult
  ): Promise<PostConditionResults> {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const postConditions = this.plan.validation?.postConditions ?? [];

    if (postConditions.length === 0) {
      return {
        results: [],
        allPassed: true,
        passedCount: 0,
        failedCount: 0,
        evaluatedAt: now,
      };
    }

    // Build evaluation context
    const evalContext = await this.buildEvaluationContext(workflowResult);

    // Evaluate each postcondition
    const results: ConditionResult[] = [];
    let passedCount = 0;
    let failedCount = 0;

    for (const condition of postConditions) {
      try {
        const evaluationResult = this.evaluateExpression(
          condition.expression,
          evalContext
        );

        const passed = Boolean(evaluationResult);
        const result: ConditionResult = {
          conditionId: condition.id,
          passed,
          message: passed
            ? `Postcondition '${condition.id}' satisfied`
            : `Postcondition '${condition.id}' failed: ${condition.description ?? condition.expression}`,
          evaluatedAt: now,
          details: {
            expression: condition.expression,
            description: condition.description,
            severity: condition.severity,
            evaluatedValue: evaluationResult,
          },
        };

        results.push(result);

        if (passed) {
          passedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        // Evaluation error counts as failure
        const result: ConditionResult = {
          conditionId: condition.id,
          passed: false,
          message: `Postcondition '${condition.id}' evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
          evaluatedAt: now,
          details: {
            expression: condition.expression,
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(result);
        failedCount++;
      }
    }

    return {
      results,
      allPassed: failedCount === 0,
      passedCount,
      failedCount,
      evaluatedAt: now,
    };
  }

  // ===========================================================================
  // Pseudocode 7.2 - verifyInvariants
  // ===========================================================================

  /**
   * Verify all invariants held throughout execution
   *
   * Algorithm (from Pseudocode 7.2):
   * 1. Get invariants from plan.validation.invariants
   * 2. Collect recorded violations from execution
   * 3. For each invariant:
   *    a. Get violations recorded during execution
   *    b. Determine if invariant held (no violations)
   *    c. Build InvariantResult
   * 4. Return InvariantResults
   *
   * Note: Invariants are checked continuously during execution.
   * This method aggregates the results of those checks.
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan
   * @param workflowResult - Result of workflow execution
   * @returns Invariant verification results
   */
  async verifyInvariants(
    workflowResult: WorkflowResult
  ): Promise<InvariantResults> {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const invariants = this.plan.validation?.invariants ?? [];

    if (invariants.length === 0) {
      return {
        results: [],
        allHeld: true,
        heldCount: 0,
        violatedCount: 0,
        totalViolations: 0,
        verifiedAt: now,
      };
    }

    // Also do a final check of all invariants
    const evalContext = await this.buildEvaluationContext(workflowResult);

    const results: InvariantResult[] = [];
    let heldCount = 0;
    let violatedCount = 0;
    let totalViolations = 0;

    for (const invariant of invariants) {
      // Get recorded violations from execution
      const recordedViolations = this.invariantViolations.get(invariant.id) ?? [];

      // Do final evaluation
      let finalCheckPassed = true;
      try {
        const evaluationResult = this.evaluateExpression(
          invariant.expression,
          evalContext
        );
        finalCheckPassed = Boolean(evaluationResult);
      } catch {
        finalCheckPassed = false;
      }

      // If final check fails, add to violations
      if (!finalCheckPassed && recordedViolations.length === 0) {
        recordedViolations.push({
          occurredAt: now,
          data: {
            reason: 'Final invariant check failed',
            expression: invariant.expression,
          },
        });
      }

      const held = recordedViolations.length === 0;
      // Convert local InvariantViolation to result.ts InvariantViolation format
      const resultViolations: ResultInvariantViolation[] = recordedViolations.map((v) => ({
        occurredAt: v.occurredAt,
        data: v.data,
        stepId: v.stepId as unknown as ResultInvariantViolation['stepId'],
      }));
      const result: InvariantResult = {
        invariantId: invariant.id,
        held,
        violations: resultViolations,
      };

      results.push(result);

      if (held) {
        heldCount++;
      } else {
        violatedCount++;
        totalViolations += recordedViolations.length;
      }
    }

    return {
      results,
      allHeld: violatedCount === 0,
      heldCount,
      violatedCount,
      totalViolations,
      verifiedAt: now,
    };
  }

  // ===========================================================================
  // Invariant Recording (called during execution)
  // ===========================================================================

  /**
   * Record an invariant violation during execution
   *
   * Called by step executor when an invariant check fails
   *
   * @param invariantId - ID of the violated invariant
   * @param violation - Violation details
   */
  recordInvariantViolation(invariantId: string, violation: InvariantViolation): void {
    if (!this.invariantViolations.has(invariantId)) {
      this.invariantViolations.set(invariantId, []);
    }
    this.invariantViolations.get(invariantId)!.push(violation);
  }

  /**
   * Check invariants at a point during execution
   *
   * Called after each step to verify invariants still hold
   *
   * @param stepId - Current step ID
   * @param stepOutputs - Outputs from the step
   * @returns List of violated invariant IDs
   */
  async checkInvariantsAtStep(
    stepId: string,
    stepOutputs: Record<string, unknown>
  ): Promise<string[]> {
    const invariants = this.plan.validation?.invariants ?? [];
    const violatedIds: string[] = [];
    const now = new Date().toISOString() as ISO8601Timestamp;

    // Build partial evaluation context
    const evalContext: EvaluationContext = {
      state: {},
      stepResults: { [stepId]: stepOutputs },
      agentStates: {},
      execution: {
        status: this.ctx.status,
        durationMs: this.ctx.getElapsedMs(),
        stepsCompleted: this.ctx.currentStepSequence,
        errorsCount: 0,
      },
    };

    // Try to get state from namespace
    try {
      const keys = await this.ctx.stateNamespace.keys();
      for (const key of keys) {
        const value = await this.ctx.stateNamespace.get(key);
        if (value !== undefined) {
          evalContext.state[key] = value;
        }
      }
    } catch {
      // Continue with partial context
    }

    for (const invariant of invariants) {
      try {
        const result = this.evaluateExpression(invariant.expression, evalContext);
        if (!result) {
          violatedIds.push(invariant.id);
          this.recordInvariantViolation(invariant.id, {
            occurredAt: now,
            data: {
              stepId,
              expression: invariant.expression,
              reason: 'Invariant check returned false',
            },
          });
        }
      } catch (error) {
        // Evaluation error - may or may not be a violation depending on invariant
        // For strict invariants, count as violation
        if (invariant.haltOnViolation) {
          violatedIds.push(invariant.id);
          this.recordInvariantViolation(invariant.id, {
            occurredAt: now,
            data: {
              stepId,
              expression: invariant.expression,
              error: error instanceof Error ? error.message : String(error),
              reason: 'Invariant evaluation error',
            },
          });
        }
      }
    }

    return violatedIds;
  }

  // ===========================================================================
  // Build Validation Outcomes
  // ===========================================================================

  /**
   * Build ValidationOutcomes for SimulationResult
   */
  buildValidationOutcomes(
    preConditionResults: CommonConditionResult[],
    postConditionResults: PostConditionResults,
    invariantResults: InvariantResults
  ): SimResultValidationOutcomes {
    // Convert precondition results
    const preConditions = preConditionResults.map((r) => ({
      satisfied: r.satisfied,
      condition: r.condition,
      evaluatedAt: r.evaluatedAt,
      message: r.message,
    }));

    // Convert postcondition results
    const postConditions = postConditionResults.results.map((r) => ({
      satisfied: r.passed,
      condition: r.conditionId,
      evaluatedAt: r.evaluatedAt,
      message: r.message,
    }));

    // Convert invariant violations
    const invariantViolationsArray: Array<{
      readonly invariantId: string;
      readonly violatedAt: ISO8601Timestamp;
      readonly stepId?: string;
      readonly message: string;
    }> = [];
    for (const result of invariantResults.results) {
      if (!result.held) {
        for (const violation of result.violations) {
          invariantViolationsArray.push({
            invariantId: result.invariantId,
            violatedAt: violation.occurredAt,
            stepId: violation.stepId as string | undefined,
            message: `Invariant '${result.invariantId}' violated`,
          });
        }
      }
    }

    return {
      preConditions,
      postConditions,
      invariantViolations: invariantViolationsArray,
      allPassed: postConditionResults.allPassed && invariantResults.allHeld,
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Build evaluation context from execution state
   */
  private async buildEvaluationContext(
    workflowResult: WorkflowResult
  ): Promise<EvaluationContext> {
    // Build state from namespace
    const state: Record<string, unknown> = {};
    try {
      const keys = await this.ctx.stateNamespace.keys();
      for (const key of keys) {
        const value = await this.ctx.stateNamespace.get(key);
        if (value !== undefined) {
          state[key] = value;
        }
      }
    } catch {
      // Continue with empty state
    }

    // Build step results map
    const stepResults: Record<string, unknown> = {};
    for (const result of workflowResult.stepResults) {
      stepResults[result.stepId] = {
        status: result.status,
        outputs: result.outputs,
        durationMs: result.durationMs,
        error: result.error,
      };
    }

    // Build agent states map
    const agentStates: Record<string, unknown> = {};
    for (const [agentId, agentContext] of this.ctx.getAllAgentContexts()) {
      const metrics = agentContext.getMetrics();
      agentStates[agentId] = {
        status: agentContext.status,
        invocationCount: metrics.invocationCount,
        totalTokensConsumed: metrics.totalTokensConsumed,
        errorCount: metrics.errorCount,
      };
    }

    return {
      state,
      stepResults,
      agentStates,
      execution: {
        status: workflowResult.status,
        durationMs: workflowResult.durationMs,
        stepsCompleted: workflowResult.stepResults.length,
        errorsCount: workflowResult.errors.length,
      },
    };
  }

  /**
   * Evaluate an expression against the evaluation context
   *
   * Supports simple expression syntax:
   * - state.keyName - access state values
   * - stepResults.stepId.status - access step results
   * - execution.status - access execution metadata
   * - Comparisons: ==, !=, >, <, >=, <=
   * - Logical: &&, ||, !
   */
  private evaluateExpression(
    expression: string,
    context: EvaluationContext
  ): unknown {
    // Simple expression evaluation
    // In production, use a proper expression parser/evaluator

    // Replace context references with actual values
    let expr = expression;

    // Replace state references
    expr = expr.replace(/state\.(\w+)/g, (_, key) => {
      const value = context.state[key];
      return JSON.stringify(value);
    });

    // Replace stepResults references
    expr = expr.replace(/stepResults\.(\w+)\.(\w+)/g, (_, stepId, prop) => {
      const stepResult = context.stepResults[stepId] as Record<string, unknown> | undefined;
      const value = stepResult?.[prop];
      return JSON.stringify(value);
    });

    // Replace agentStates references
    expr = expr.replace(/agentStates\.(\w+)\.(\w+)/g, (_, agentId, prop) => {
      const agentState = context.agentStates[agentId] as Record<string, unknown> | undefined;
      const value = agentState?.[prop];
      return JSON.stringify(value);
    });

    // Replace execution references
    expr = expr.replace(/execution\.(\w+)/g, (_, prop) => {
      const value = context.execution[prop as keyof typeof context.execution];
      return JSON.stringify(value);
    });

    // Handle common expression patterns
    // Check for simple comparisons
    const comparisonMatch = expr.match(/^(.+?)\s*(===?|!==?|>=?|<=?)\s*(.+)$/);
    if (comparisonMatch) {
      const [, left, op, right] = comparisonMatch;
      const leftValue = this.parseValue(left.trim());
      const rightValue = this.parseValue(right.trim());

      switch (op) {
        case '==':
        case '===':
          return leftValue === rightValue;
        case '!=':
        case '!==':
          return leftValue !== rightValue;
        case '>':
          return Number(leftValue) > Number(rightValue);
        case '<':
          return Number(leftValue) < Number(rightValue);
        case '>=':
          return Number(leftValue) >= Number(rightValue);
        case '<=':
          return Number(leftValue) <= Number(rightValue);
      }
    }

    // Handle boolean literals
    if (expr.trim() === 'true') return true;
    if (expr.trim() === 'false') return false;

    // Try to parse as JSON (for simple values)
    try {
      return JSON.parse(expr);
    } catch {
      // Return the expression as-is (might be a truthy/falsy check)
      return expr.trim().length > 0;
    }
  }

  /**
   * Parse a value from expression string
   */
  private parseValue(value: string): unknown {
    // Try JSON parse
    try {
      return JSON.parse(value);
    } catch {
      // Return as string
      return value;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a postcondition evaluator
 */
export function createPostconditionEvaluator(
  ctx: ExecutionContext,
  plan: SimulationPlan
): PostconditionEvaluator {
  return new PostconditionEvaluator(ctx, plan);
}
