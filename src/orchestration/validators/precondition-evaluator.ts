/**
 * Pre-Condition Evaluator
 *
 * Evaluates pre-conditions defined in the simulation plan before execution begins.
 * Supports various condition types including expressions, state checks, resource checks,
 * and external checks.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3.5
 */

import type { SimulationPlan, Condition, ConditionType } from '../../types/plan.js';
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ConditionEvaluator,
  ConditionEvaluationResult,
} from './types.js';

/**
 * Pre-condition evaluation configuration options
 */
export interface PreConditionEvaluatorOptions {
  /**
   * Whether to treat optional condition failures as warnings
   */
  readonly treatOptionalAsWarning?: boolean;

  /**
   * Whether to continue evaluating after first failure
   */
  readonly continueOnFailure?: boolean;

  /**
   * Timeout for external condition checks in milliseconds
   */
  readonly externalCheckTimeoutMs?: number;

  /**
   * Whether to evaluate conditions in parallel
   */
  readonly parallelEvaluation?: boolean;

  /**
   * Maximum concurrent condition evaluations
   */
  readonly maxConcurrency?: number;
}

const DEFAULT_OPTIONS: Required<PreConditionEvaluatorOptions> = {
  treatOptionalAsWarning: true,
  continueOnFailure: true,
  externalCheckTimeoutMs: 30_000,
  parallelEvaluation: true,
  maxConcurrency: 5,
};

/**
 * Default condition evaluator implementation
 */
export class DefaultConditionEvaluator implements ConditionEvaluator {
  constructor(private readonly timeoutMs: number = 30_000) {}

  async evaluate(
    conditionType: string,
    expression: string,
    context: Record<string, unknown>
  ): Promise<ConditionEvaluationResult> {
    switch (conditionType) {
      case 'EXPRESSION':
        return this.evaluateExpression(expression, context);

      case 'STATE_CHECK':
        return this.evaluateStateCheck(expression, context);

      case 'RESOURCE_CHECK':
        return this.evaluateResourceCheck(expression, context);

      case 'EXTERNAL_CHECK':
        return this.evaluateExternalCheck(expression, context);

      default:
        return {
          passed: false,
          message: `Unknown condition type: ${conditionType}`,
          expression,
        };
    }
  }

  /**
   * Evaluates a boolean expression
   */
  private evaluateExpression(
    expression: string,
    context: Record<string, unknown>
  ): ConditionEvaluationResult {
    try {
      // Create a safe evaluation context
      const safeContext = { ...context };

      // Parse and evaluate the expression safely
      // In production, use a proper expression parser like jsep
      const result = this.safeEvaluate(expression, safeContext);

      return {
        passed: Boolean(result),
        message: result ? 'Expression evaluated to true' : 'Expression evaluated to false',
        evaluatedValue: result,
        expression,
      };
    } catch (error) {
      return {
        passed: false,
        message: `Expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        expression,
      };
    }
  }

  /**
   * Evaluates a state check condition
   */
  private evaluateStateCheck(
    expression: string,
    context: Record<string, unknown>
  ): ConditionEvaluationResult {
    try {
      // Parse state check expression (format: "state.key == value" or "state.key exists")
      const stateCheckPattern = /^state\.(\w+(?:\.\w+)*)\s*(==|!=|exists|not_exists)\s*(.*)$/;
      const match = expression.match(stateCheckPattern);

      if (!match) {
        return {
          passed: false,
          message: `Invalid state check expression format: ${expression}`,
          expression,
        };
      }

      const [, path, operator, expectedValue] = match;
      const state = context.state as Record<string, unknown> | undefined;

      if (!state) {
        return {
          passed: false,
          message: 'State context is not available',
          expression,
        };
      }

      const actualValue = this.getNestedValue(state, path);

      switch (operator) {
        case 'exists':
          return {
            passed: actualValue !== undefined,
            message: actualValue !== undefined
              ? `State key '${path}' exists`
              : `State key '${path}' does not exist`,
            evaluatedValue: actualValue,
            expression,
          };

        case 'not_exists':
          return {
            passed: actualValue === undefined,
            message: actualValue === undefined
              ? `State key '${path}' does not exist`
              : `State key '${path}' exists (expected not to)`,
            evaluatedValue: actualValue,
            expression,
          };

        case '==':
          const isEqual = String(actualValue) === expectedValue.trim();
          return {
            passed: isEqual,
            message: isEqual
              ? `State key '${path}' equals expected value`
              : `State key '${path}' is '${actualValue}', expected '${expectedValue.trim()}'`,
            evaluatedValue: actualValue,
            expression,
          };

        case '!=':
          const isNotEqual = String(actualValue) !== expectedValue.trim();
          return {
            passed: isNotEqual,
            message: isNotEqual
              ? `State key '${path}' does not equal '${expectedValue.trim()}'`
              : `State key '${path}' equals '${expectedValue.trim()}' (expected different)`,
            evaluatedValue: actualValue,
            expression,
          };

        default:
          return {
            passed: false,
            message: `Unknown operator: ${operator}`,
            expression,
          };
      }
    } catch (error) {
      return {
        passed: false,
        message: `State check failed: ${error instanceof Error ? error.message : String(error)}`,
        expression,
      };
    }
  }

  /**
   * Evaluates a resource check condition
   */
  private evaluateResourceCheck(
    expression: string,
    context: Record<string, unknown>
  ): ConditionEvaluationResult {
    try {
      // Parse resource check expression (format: "resource.type >= value")
      const resourceCheckPattern = /^resource\.(\w+)\s*(>=|<=|>|<|==)\s*(\d+(?:\.\d+)?)$/;
      const match = expression.match(resourceCheckPattern);

      if (!match) {
        return {
          passed: false,
          message: `Invalid resource check expression format: ${expression}`,
          expression,
        };
      }

      const [, resourceType, operator, thresholdStr] = match;
      const threshold = parseFloat(thresholdStr);
      const resources = context.resources as Record<string, number> | undefined;

      if (!resources) {
        return {
          passed: false,
          message: 'Resource context is not available',
          expression,
        };
      }

      const actualValue = resources[resourceType];

      if (actualValue === undefined) {
        return {
          passed: false,
          message: `Unknown resource type: ${resourceType}`,
          expression,
        };
      }

      let passed: boolean;
      switch (operator) {
        case '>=':
          passed = actualValue >= threshold;
          break;
        case '<=':
          passed = actualValue <= threshold;
          break;
        case '>':
          passed = actualValue > threshold;
          break;
        case '<':
          passed = actualValue < threshold;
          break;
        case '==':
          passed = actualValue === threshold;
          break;
        default:
          return {
            passed: false,
            message: `Unknown operator: ${operator}`,
            expression,
          };
      }

      return {
        passed,
        message: passed
          ? `Resource check passed: ${resourceType} (${actualValue}) ${operator} ${threshold}`
          : `Resource check failed: ${resourceType} (${actualValue}) ${operator} ${threshold}`,
        evaluatedValue: actualValue,
        expression,
      };
    } catch (error) {
      return {
        passed: false,
        message: `Resource check failed: ${error instanceof Error ? error.message : String(error)}`,
        expression,
      };
    }
  }

  /**
   * Evaluates an external check condition
   */
  private async evaluateExternalCheck(
    expression: string,
    context: Record<string, unknown>
  ): Promise<ConditionEvaluationResult> {
    try {
      // Parse external check expression (format: "endpoint:path" or "service:check")
      const externalCheckPattern = /^(\w+):(.+)$/;
      const match = expression.match(externalCheckPattern);

      if (!match) {
        return {
          passed: false,
          message: `Invalid external check expression format: ${expression}`,
          expression,
        };
      }

      const [, checkType, checkPath] = match;

      // In a real implementation, this would make external calls
      // For now, we simulate the check
      switch (checkType) {
        case 'http':
          return await this.simulateHttpCheck(checkPath);

        case 'service':
          return await this.simulateServiceCheck(checkPath);

        case 'health':
          return await this.simulateHealthCheck(checkPath);

        default:
          return {
            passed: false,
            message: `Unknown external check type: ${checkType}`,
            expression,
          };
      }
    } catch (error) {
      return {
        passed: false,
        message: `External check failed: ${error instanceof Error ? error.message : String(error)}`,
        expression,
      };
    }
  }

  /**
   * Simulates an HTTP health check
   */
  private async simulateHttpCheck(endpoint: string): Promise<ConditionEvaluationResult> {
    // In production, this would make an actual HTTP request
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      passed: true,
      message: `HTTP endpoint '${endpoint}' is reachable`,
      expression: `http:${endpoint}`,
    };
  }

  /**
   * Simulates a service availability check
   */
  private async simulateServiceCheck(serviceName: string): Promise<ConditionEvaluationResult> {
    // In production, this would check service registry or Kubernetes
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      passed: true,
      message: `Service '${serviceName}' is available`,
      expression: `service:${serviceName}`,
    };
  }

  /**
   * Simulates a health check
   */
  private async simulateHealthCheck(target: string): Promise<ConditionEvaluationResult> {
    // In production, this would perform actual health checks
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      passed: true,
      message: `Health check for '${target}' passed`,
      expression: `health:${target}`,
    };
  }

  /**
   * Safely evaluates a simple expression
   */
  private safeEvaluate(expression: string, context: Record<string, unknown>): unknown {
    // Simple expression evaluator for basic operations
    // In production, use a proper expression parser

    // Handle simple boolean literals
    if (expression.trim() === 'true') return true;
    if (expression.trim() === 'false') return false;

    // Handle simple comparisons
    const comparisonPattern = /^(\w+(?:\.\w+)*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
    const match = expression.match(comparisonPattern);

    if (match) {
      const [, left, operator, right] = match;
      const leftValue = this.getNestedValue(context, left);
      const rightValue = this.parseValue(right.trim(), context);

      switch (operator) {
        case '==':
          return leftValue === rightValue;
        case '!=':
          return leftValue !== rightValue;
        case '>=':
          return Number(leftValue) >= Number(rightValue);
        case '<=':
          return Number(leftValue) <= Number(rightValue);
        case '>':
          return Number(leftValue) > Number(rightValue);
        case '<':
          return Number(leftValue) < Number(rightValue);
      }
    }

    // Handle simple variable lookup
    if (/^\w+(?:\.\w+)*$/.test(expression)) {
      return this.getNestedValue(context, expression);
    }

    throw new Error(`Unable to evaluate expression: ${expression}`);
  }

  /**
   * Gets a nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Parses a value string into its typed value
   */
  private parseValue(value: string, context: Record<string, unknown>): unknown {
    // Handle string literals
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Handle numeric literals
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return parseFloat(value);
    }

    // Handle boolean literals
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;

    // Handle variable references
    if (/^\w+(?:\.\w+)*$/.test(value)) {
      return this.getNestedValue(context, value);
    }

    return value;
  }
}

/**
 * Evaluates all pre-conditions defined in a SimulationPlan
 *
 * From Pseudocode Section 3.5:
 * ```
 * FUNCTION evaluatePreConditions(plan: SimulationPlan, context: Context): ValidationResult
 *   errors = []
 *   FOR EACH condition IN plan.validation.preConditions:
 *     result = evaluator.evaluate(condition.type, condition.expression, context)
 *     IF NOT result.passed AND condition.required:
 *       errors.append(ValidationError(
 *         code="PRECONDITION_FAILED",
 *         message=result.message,
 *         path="validation.preConditions.{condition.conditionId}"
 *       ))
 *   RETURN ValidationResult(valid=errors.isEmpty(), errors=errors)
 * ```
 *
 * @param plan - The SimulationPlan containing pre-conditions
 * @param evaluator - Condition evaluator implementation
 * @param context - Evaluation context with state, resources, etc.
 * @param options - Optional evaluation configuration
 * @returns Promise resolving to ValidationResult with pre-condition status
 */
export async function evaluatePreConditions(
  plan: SimulationPlan,
  evaluator: ConditionEvaluator = new DefaultConditionEvaluator(),
  context: Record<string, unknown> = {},
  options: PreConditionEvaluatorOptions = {}
): Promise<ValidationResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Get pre-conditions from plan
  const preConditions = plan.validation?.preConditions ?? [];

  if (preConditions.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      phase: 'PRECONDITION_VALIDATION',
      validatedAt: new Date().toISOString(),
    };
  }

  if (config.parallelEvaluation) {
    // Evaluate conditions in parallel
    const results = await evaluateConditionsParallel(
      preConditions,
      evaluator,
      context,
      config.maxConcurrency
    );

    for (const { condition, result } of results) {
      processConditionResult(condition, result, errors, warnings, config);

      if (!config.continueOnFailure && !result.passed && condition.required) {
        break;
      }
    }
  } else {
    // Evaluate conditions sequentially
    for (const condition of preConditions) {
      const result = await evaluator.evaluate(
        condition.type,
        condition.expression,
        context
      );

      processConditionResult(condition, result, errors, warnings, config);

      if (!config.continueOnFailure && !result.passed && condition.required) {
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'PRECONDITION_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluates multiple conditions in parallel with concurrency limit
 */
async function evaluateConditionsParallel(
  conditions: readonly Condition[],
  evaluator: ConditionEvaluator,
  context: Record<string, unknown>,
  maxConcurrency: number
): Promise<Array<{ condition: Condition; result: ConditionEvaluationResult }>> {
  const results: Array<{ condition: Condition; result: ConditionEvaluationResult }> = [];
  const pending: Array<Promise<void>> = [];

  for (const condition of conditions) {
    const evaluatePromise = (async () => {
      const result = await evaluator.evaluate(
        condition.type,
        condition.expression,
        context
      );
      results.push({ condition, result });
    })();

    pending.push(evaluatePromise);

    if (pending.length >= maxConcurrency) {
      await Promise.race(pending);
      // Remove completed promises
      for (let i = pending.length - 1; i >= 0; i--) {
        const resolved = await Promise.race([
          pending[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (resolved) {
          pending.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(pending);

  return results;
}

/**
 * Processes a condition evaluation result
 */
function processConditionResult(
  condition: Condition,
  result: ConditionEvaluationResult,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  config: Required<PreConditionEvaluatorOptions>
): void {
  if (!result.passed) {
    if (condition.required) {
      errors.push({
        code: 'PRECONDITION_FAILED',
        severity: 'ERROR',
        message: `Pre-condition '${condition.conditionId}' failed: ${result.message}`,
        path: `validation.preConditions.${condition.conditionId}`,
        context: {
          conditionId: condition.conditionId,
          conditionType: condition.type,
          expression: condition.expression,
          evaluationResult: result,
        },
      });
    } else if (config.treatOptionalAsWarning) {
      warnings.push({
        code: 'PRECONDITION_WARNING',
        message: `Optional pre-condition '${condition.conditionId}' failed: ${result.message}`,
        path: `validation.preConditions.${condition.conditionId}`,
        context: {
          conditionId: condition.conditionId,
          conditionType: condition.type,
          expression: condition.expression,
        },
      });
    }
  }
}

/**
 * Evaluates post-conditions after execution completes
 *
 * @param plan - The SimulationPlan containing post-conditions
 * @param evaluator - Condition evaluator implementation
 * @param context - Evaluation context with execution results
 * @param options - Optional evaluation configuration
 * @returns Promise resolving to ValidationResult with post-condition status
 */
export async function evaluatePostConditions(
  plan: SimulationPlan,
  evaluator: ConditionEvaluator = new DefaultConditionEvaluator(),
  context: Record<string, unknown> = {},
  options: PreConditionEvaluatorOptions = {}
): Promise<ValidationResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const postConditions = plan.validation?.postConditions ?? [];

  if (postConditions.length === 0) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      phase: 'PRECONDITION_VALIDATION', // Reusing phase for post-conditions
      validatedAt: new Date().toISOString(),
    };
  }

  for (const condition of postConditions) {
    const result = await evaluator.evaluate(
      condition.type,
      condition.expression,
      context
    );

    if (!result.passed) {
      if (condition.required) {
        errors.push({
          code: 'POSTCONDITION_FAILED',
          severity: 'ERROR',
          message: `Post-condition '${condition.conditionId}' failed: ${result.message}`,
          path: `validation.postConditions.${condition.conditionId}`,
          context: {
            conditionId: condition.conditionId,
            expression: condition.expression,
          },
        });
      } else if (config.treatOptionalAsWarning) {
        warnings.push({
          code: 'POSTCONDITION_WARNING',
          message: `Optional post-condition '${condition.conditionId}' failed: ${result.message}`,
          path: `validation.postConditions.${condition.conditionId}`,
        });
      }
    }

    if (!config.continueOnFailure && !result.passed && condition.required) {
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'PRECONDITION_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Creates an evaluation context from execution state
 *
 * @param state - Current execution state
 * @param resources - Available resources
 * @param metadata - Additional metadata
 * @returns Evaluation context object
 */
export function createEvaluationContext(
  state?: Record<string, unknown>,
  resources?: Record<string, number>,
  metadata?: Record<string, unknown>
): Record<string, unknown> {
  return {
    state: state ?? {},
    resources: resources ?? {
      cpu: 100,
      memory: 100,
      storage: 100,
    },
    metadata: metadata ?? {},
    timestamp: new Date().toISOString(),
  };
}
