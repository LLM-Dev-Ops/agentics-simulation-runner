/**
 * Conditional Evaluator for Workflow Branching
 *
 * Evaluates conditional expressions in workflow steps to determine
 * which branch to execute. Supports state-based conditions and
 * expression evaluation.
 *
 * @module core/conditional-evaluator
 * @see SPARC_PSEUDOCODE.md Section 5.2 - executeStep (CONDITIONAL case)
 * @see SPARC_ARCHITECTURE.md MOD-006 - Workflow Scheduler
 */

import type {
  ExecutionContext,
  StateNamespace,
} from '../types/execution-context.js';

import type {
  ConditionalStep,
  WorkflowStep,
} from '../types/workflow.js';

import type { ISO8601Timestamp, DurationMs } from '../types/common.js';

// =============================================================================
// Conditional Result Types
// =============================================================================

/**
 * Result of evaluating a conditional step
 */
export interface ConditionalResult {
  /**
   * Step ID of the conditional step
   */
  readonly stepId: string;

  /**
   * The condition expression that was evaluated
   */
  readonly condition: string;

  /**
   * Result of the condition evaluation (true/false)
   */
  readonly result: boolean;

  /**
   * Which branch should be executed ('then' or 'else')
   */
  readonly branch: 'then' | 'else';

  /**
   * The branch steps or step ID to execute
   */
  readonly branchTarget: string | readonly WorkflowStep[];

  /**
   * Timestamp when evaluation occurred
   */
  readonly evaluatedAt: ISO8601Timestamp;

  /**
   * Duration of evaluation in milliseconds
   */
  readonly evaluationDurationMs: DurationMs;

  /**
   * Context values used in evaluation
   */
  readonly evaluationContext: Record<string, unknown>;

  /**
   * Any errors during evaluation
   */
  readonly error?: string;
}

// =============================================================================
// Expression Token Types
// =============================================================================

/**
 * Token types for expression parsing
 */
type TokenType =
  | 'STATE_REF'      // state.key
  | 'LITERAL'        // true, false, numbers, strings
  | 'OPERATOR'       // ==, !=, >, <, >=, <=, &&, ||
  | 'FUNCTION'       // isEmpty(), contains(), etc.
  | 'PARENTHESIS'    // ( )
  | 'NOT';           // !

/**
 * Parsed token from expression
 */
interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// =============================================================================
// Conditional Evaluator Class
// =============================================================================

/**
 * Evaluates conditional expressions for workflow branching
 *
 * Supports:
 * - State references: state.key, state.nested.key
 * - Comparisons: ==, !=, >, <, >=, <=
 * - Logical operators: &&, ||, !
 * - Literals: true, false, numbers, quoted strings
 * - Functions: isEmpty(), contains(), exists()
 */
export class ConditionalEvaluator {
  constructor(private readonly ctx: ExecutionContext) {}

  /**
   * Evaluate a conditional step and determine which branch to execute
   *
   * @param step - The conditional step to evaluate
   * @returns ConditionalResult with branch determination
   */
  async evaluateConditional(step: ConditionalStep): Promise<ConditionalResult> {
    const startTime = Date.now();
    const evaluationContext: Record<string, unknown> = {};
    let error: string | undefined;
    let result = false;

    try {
      result = await this.evaluateExpression(step.condition, evaluationContext);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // Default to false on evaluation error
      result = false;
    }

    const branch = result ? 'then' : 'else';
    const branchTarget = result ? step.thenBranch : (step.elseBranch ?? []);

    return {
      stepId: step.id,
      condition: step.condition,
      result,
      branch,
      branchTarget: branchTarget ?? [],
      evaluatedAt: new Date().toISOString() as ISO8601Timestamp,
      evaluationDurationMs: Date.now() - startTime,
      evaluationContext,
      error,
    };
  }

  /**
   * Evaluate an expression string against the current state
   *
   * @param expression - The condition expression to evaluate
   * @param context - Object to store evaluated values for debugging
   * @returns Boolean result of the expression
   */
  async evaluateExpression(
    expression: string,
    context: Record<string, unknown> = {}
  ): Promise<boolean> {
    const trimmed = expression.trim();

    // Handle empty expression
    if (!trimmed) {
      return true;
    }

    // Boolean literals
    if (trimmed.toLowerCase() === 'true') {
      return true;
    }
    if (trimmed.toLowerCase() === 'false') {
      return false;
    }

    // Handle NOT operator
    if (trimmed.startsWith('!')) {
      const inner = trimmed.substring(1).trim();
      return !(await this.evaluateExpression(inner, context));
    }

    // Handle parenthesized expressions
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      return this.evaluateExpression(trimmed.slice(1, -1), context);
    }

    // Handle logical AND (&&)
    const andIndex = this.findOperatorIndex(trimmed, '&&');
    if (andIndex !== -1) {
      const left = trimmed.substring(0, andIndex).trim();
      const right = trimmed.substring(andIndex + 2).trim();
      const leftResult = await this.evaluateExpression(left, context);
      if (!leftResult) return false; // Short-circuit
      return this.evaluateExpression(right, context);
    }

    // Handle logical OR (||)
    const orIndex = this.findOperatorIndex(trimmed, '||');
    if (orIndex !== -1) {
      const left = trimmed.substring(0, orIndex).trim();
      const right = trimmed.substring(orIndex + 2).trim();
      const leftResult = await this.evaluateExpression(left, context);
      if (leftResult) return true; // Short-circuit
      return this.evaluateExpression(right, context);
    }

    // Handle comparison operators
    return this.evaluateComparison(trimmed, context);
  }

  /**
   * Evaluate a comparison expression
   */
  private async evaluateComparison(
    expression: string,
    context: Record<string, unknown>
  ): Promise<boolean> {
    // Order matters: check >= and <= before > and <
    const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];

    for (const op of operators) {
      const index = expression.indexOf(op);
      if (index !== -1) {
        const left = expression.substring(0, index).trim();
        const right = expression.substring(index + op.length).trim();

        const leftValue = await this.resolveValue(left, context);
        const rightValue = await this.resolveValue(right, context);

        context[`${left}_value`] = leftValue;
        context[`${right}_value`] = rightValue;

        return this.compare(leftValue, rightValue, op);
      }
    }

    // Handle function calls like isEmpty(state.key)
    if (expression.includes('(') && expression.includes(')')) {
      return this.evaluateFunction(expression, context);
    }

    // If no operator, treat as truthy check
    const value = await this.resolveValue(expression, context);
    return this.isTruthy(value);
  }

  /**
   * Resolve a value from an expression (state reference or literal)
   */
  private async resolveValue(
    expr: string,
    context: Record<string, unknown>
  ): Promise<unknown> {
    const trimmed = expr.trim();

    // State reference: state.key or state.nested.key
    if (trimmed.startsWith('state.')) {
      const key = trimmed.substring(6); // Remove 'state.'
      const value = await this.getStateValue(key);
      context[trimmed] = value;
      return value;
    }

    // Context reference: context.key
    if (trimmed.startsWith('context.')) {
      const key = trimmed.substring(8);
      const value = await this.ctx.stateNamespace.get(`context.${key}`);
      context[trimmed] = value;
      return value;
    }

    // Quoted string
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // Null/undefined
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;

    // Boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Number
    const num = Number(trimmed);
    if (!isNaN(num)) {
      return num;
    }

    // JSON object or array
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, return as string
        return trimmed;
      }
    }

    // Default: treat as string literal
    return trimmed;
  }

  /**
   * Get a value from state, supporting nested keys
   */
  private async getStateValue(key: string): Promise<unknown> {
    // Handle nested keys like 'user.profile.name'
    const parts = key.split('.');
    let value: unknown = await this.ctx.stateNamespace.get(parts[0]);

    for (let i = 1; i < parts.length && value !== undefined && value !== null; i++) {
      if (typeof value === 'object') {
        value = (value as Record<string, unknown>)[parts[i]];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Compare two values with an operator
   */
  private compare(left: unknown, right: unknown, operator: string): boolean {
    switch (operator) {
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      case '==':
        // eslint-disable-next-line eqeqeq
        return left == right;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return left != right;
      case '>':
        return Number(left) > Number(right);
      case '<':
        return Number(left) < Number(right);
      case '>=':
        return Number(left) >= Number(right);
      case '<=':
        return Number(left) <= Number(right);
      default:
        return false;
    }
  }

  /**
   * Evaluate a function call expression
   */
  private async evaluateFunction(
    expression: string,
    context: Record<string, unknown>
  ): Promise<boolean> {
    const match = expression.match(/^(\w+)\((.*)\)$/);
    if (!match) {
      return false;
    }

    const [, funcName, argsStr] = match;
    const args = argsStr.split(',').map((a) => a.trim());

    switch (funcName.toLowerCase()) {
      case 'isempty': {
        const value = await this.resolveValue(args[0], context);
        return this.isEmpty(value);
      }

      case 'exists': {
        const value = await this.resolveValue(args[0], context);
        return value !== undefined && value !== null;
      }

      case 'contains': {
        const collection = await this.resolveValue(args[0], context);
        const item = await this.resolveValue(args[1], context);
        if (Array.isArray(collection)) {
          return collection.includes(item);
        }
        if (typeof collection === 'string' && typeof item === 'string') {
          return collection.includes(item);
        }
        return false;
      }

      case 'length': {
        const value = await this.resolveValue(args[0], context);
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        if (typeof value === 'string') {
          return value.length > 0;
        }
        return false;
      }

      case 'matches': {
        const value = await this.resolveValue(args[0], context);
        const pattern = await this.resolveValue(args[1], context);
        if (typeof value === 'string' && typeof pattern === 'string') {
          const regex = new RegExp(pattern);
          return regex.test(value);
        }
        return false;
      }

      case 'typeof': {
        const value = await this.resolveValue(args[0], context);
        const expectedType = await this.resolveValue(args[1], context);
        return typeof value === expectedType;
      }

      default:
        // Unknown function, return false
        return false;
    }
  }

  /**
   * Check if a value is empty
   */
  private isEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  /**
   * Check if a value is truthy
   */
  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  /**
   * Find operator index, respecting parentheses
   */
  private findOperatorIndex(expression: string, operator: string): number {
    let depth = 0;
    for (let i = 0; i <= expression.length - operator.length; i++) {
      const char = expression[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (depth === 0 && expression.substring(i, i + operator.length) === operator) {
        return i;
      }
    }
    return -1;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a conditional evaluator for the given execution context
 */
export function createConditionalEvaluator(ctx: ExecutionContext): ConditionalEvaluator {
  return new ConditionalEvaluator(ctx);
}

// =============================================================================
// Standalone Evaluation Function
// =============================================================================

/**
 * Evaluate a conditional step in the given execution context
 *
 * @param ctx - Execution context for state access
 * @param step - Conditional step to evaluate
 * @returns ConditionalResult with branch determination
 */
export async function evaluateConditional(
  ctx: ExecutionContext,
  step: ConditionalStep
): Promise<ConditionalResult> {
  const evaluator = createConditionalEvaluator(ctx);
  return evaluator.evaluateConditional(step);
}
