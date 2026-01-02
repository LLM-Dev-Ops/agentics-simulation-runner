/**
 * Tests for Conditional Evaluator
 *
 * @module tests/core/conditional-evaluator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  ConditionalEvaluator,
  createConditionalEvaluator,
  evaluateConditional,
} from '../../src/core/conditional-evaluator.js';

import type {
  ExecutionContext,
  StateNamespace,
  StateTransaction,
} from '../../src/types/execution-context.js';

import type { ConditionalStep } from '../../src/types/workflow.js';
import type { SHA256Hash, ISO8601Timestamp, UUID } from '../../src/types/common.js';

// =============================================================================
// Mock Factory
// =============================================================================

function createMockContext(stateData: Record<string, unknown> = {}): ExecutionContext {
  const store = new Map<string, unknown>(Object.entries(stateData));

  const stateNamespace: StateNamespace = {
    namespaceId: 'test',
    executionId: 'exec-1' as UUID,
    schemaName: 'test',
    initialized: true,
    isolationLevel: 'serializable',
    get: vi.fn(async <T>(key: string) => {
      const parts = key.split('.');
      let value: unknown = store.get(parts[0]);
      for (let i = 1; i < parts.length && value !== undefined; i++) {
        if (typeof value === 'object' && value !== null) {
          value = (value as Record<string, unknown>)[parts[i]];
        }
      }
      return value as T | undefined;
    }),
    set: vi.fn(async <T>(key: string, value: T) => {
      store.set(key, value);
    }),
    delete: vi.fn(),
    has: vi.fn(),
    keys: vi.fn(),
    getStateHash: vi.fn(async () => 'hash' as SHA256Hash),
    beginTransaction: vi.fn(),
    getVectorCollection: vi.fn(),
  };

  return {
    executionId: 'exec-1' as UUID,
    stateNamespace,
    telemetry: {
      startSpan: vi.fn(() => ({
        spanId: 'span-1',
        setAttribute: vi.fn(),
        recordError: vi.fn(),
        end: vi.fn(),
      })),
      recordMetric: vi.fn(),
      log: vi.fn(),
      emitEvent: vi.fn(),
      flush: vi.fn(),
    },
  } as unknown as ExecutionContext;
}

// =============================================================================
// Tests
// =============================================================================

describe('ConditionalEvaluator', () => {
  describe('evaluateExpression', () => {
    it('should evaluate boolean literals', async () => {
      const ctx = createMockContext();
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('true', {})).toBe(true);
      expect(await evaluator.evaluateExpression('false', {})).toBe(false);
      expect(await evaluator.evaluateExpression('TRUE', {})).toBe(true);
      expect(await evaluator.evaluateExpression('FALSE', {})).toBe(false);
    });

    it('should evaluate equality comparisons with numbers', async () => {
      const ctx = createMockContext({ count: 5 });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('state.count == 5', {})).toBe(true);
      expect(await evaluator.evaluateExpression('state.count == 10', {})).toBe(false);
      expect(await evaluator.evaluateExpression('state.count != 10', {})).toBe(true);
    });

    it('should evaluate equality comparisons with strings', async () => {
      const ctx = createMockContext({ status: 'active' });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('state.status == "active"', {})).toBe(true);
      expect(await evaluator.evaluateExpression('state.status == "inactive"', {})).toBe(false);
    });

    it('should evaluate numeric comparisons', async () => {
      const ctx = createMockContext({ value: 10 });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('state.value > 5', {})).toBe(true);
      expect(await evaluator.evaluateExpression('state.value < 5', {})).toBe(false);
      expect(await evaluator.evaluateExpression('state.value >= 10', {})).toBe(true);
      expect(await evaluator.evaluateExpression('state.value <= 10', {})).toBe(true);
      expect(await evaluator.evaluateExpression('state.value > 10', {})).toBe(false);
    });

    it('should evaluate NOT operator', async () => {
      const ctx = createMockContext({ flag: true });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('!false', {})).toBe(true);
      expect(await evaluator.evaluateExpression('!true', {})).toBe(false);
    });

    it('should evaluate AND operator', async () => {
      const ctx = createMockContext({ a: true, b: false });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('true && true', {})).toBe(true);
      expect(await evaluator.evaluateExpression('true && false', {})).toBe(false);
      expect(await evaluator.evaluateExpression('false && true', {})).toBe(false);
    });

    it('should evaluate OR operator', async () => {
      const ctx = createMockContext();
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('true || false', {})).toBe(true);
      expect(await evaluator.evaluateExpression('false || true', {})).toBe(true);
      expect(await evaluator.evaluateExpression('false || false', {})).toBe(false);
    });

    it('should evaluate isEmpty function', async () => {
      const ctx = createMockContext({
        emptyArray: [],
        nonEmptyArray: [1, 2, 3],
        emptyString: '',
        nonEmptyString: 'hello',
        nullValue: null,
      });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('isEmpty(state.emptyArray)', {})).toBe(true);
      expect(await evaluator.evaluateExpression('isEmpty(state.nonEmptyArray)', {})).toBe(false);
      expect(await evaluator.evaluateExpression('isEmpty(state.emptyString)', {})).toBe(true);
      expect(await evaluator.evaluateExpression('isEmpty(state.nonEmptyString)', {})).toBe(false);
      expect(await evaluator.evaluateExpression('isEmpty(state.nullValue)', {})).toBe(true);
    });

    it('should evaluate exists function', async () => {
      const ctx = createMockContext({
        existing: 'value',
      });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('exists(state.existing)', {})).toBe(true);
      expect(await evaluator.evaluateExpression('exists(state.nonExisting)', {})).toBe(false);
    });

    it('should evaluate contains function for arrays', async () => {
      const ctx = createMockContext({
        items: [1, 2, 3, 4, 5],
      });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('contains(state.items, 3)', {})).toBe(true);
      expect(await evaluator.evaluateExpression('contains(state.items, 10)', {})).toBe(false);
    });

    it('should evaluate contains function for strings', async () => {
      const ctx = createMockContext({
        message: 'Hello World',
      });
      const evaluator = createConditionalEvaluator(ctx);

      expect(await evaluator.evaluateExpression('contains(state.message, "World")', {})).toBe(true);
      expect(await evaluator.evaluateExpression('contains(state.message, "Foo")', {})).toBe(false);
    });

    it('should evaluate nested state access', async () => {
      const ctx = createMockContext({
        user: { profile: { age: 30 } },
      });
      const evaluator = createConditionalEvaluator(ctx);

      // For nested access, we need to ensure the mock supports it
      (ctx.stateNamespace.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: string) => {
          if (key === 'user') {
            return { profile: { age: 30 } };
          }
          return undefined;
        }
      );

      expect(await evaluator.evaluateExpression('state.user.profile.age == 30', {})).toBe(true);
    });

    it('should handle complex expressions', async () => {
      const ctx = createMockContext({
        count: 5,
        status: 'active',
      });
      const evaluator = createConditionalEvaluator(ctx);

      expect(
        await evaluator.evaluateExpression('state.count > 0 && state.status == "active"', {})
      ).toBe(true);
      expect(
        await evaluator.evaluateExpression('state.count > 10 || state.status == "active"', {})
      ).toBe(true);
    });
  });

  describe('evaluateConditional', () => {
    it('should return then branch when condition is true', async () => {
      const ctx = createMockContext({ flag: true });

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'state.flag == true',
        thenBranch: 'then-step',
        elseBranch: 'else-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.result).toBe(true);
      expect(result.branch).toBe('then');
      expect(result.branchTarget).toBe('then-step');
    });

    it('should return else branch when condition is false', async () => {
      const ctx = createMockContext({ flag: false });

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'state.flag == true',
        thenBranch: 'then-step',
        elseBranch: 'else-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.result).toBe(false);
      expect(result.branch).toBe('else');
      expect(result.branchTarget).toBe('else-step');
    });

    it('should return empty array when else branch is not defined', async () => {
      const ctx = createMockContext({ flag: false });

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'state.flag == true',
        thenBranch: 'then-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.branch).toBe('else');
      expect(result.branchTarget).toEqual([]);
    });

    it('should handle inline steps as branch target', async () => {
      const ctx = createMockContext({ flag: true });

      const inlineSteps = [
        { id: 'inline-1', stepType: 'DELAY', delayMs: 100 },
        { id: 'inline-2', stepType: 'DELAY', delayMs: 100 },
      ];

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'true',
        thenBranch: inlineSteps as any,
        elseBranch: 'else-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.branchTarget).toEqual(inlineSteps);
    });

    it('should record evaluation context', async () => {
      const ctx = createMockContext({ value: 42 });

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'state.value > 10',
        thenBranch: 'then-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.evaluationContext).toBeDefined();
      expect(result.evaluatedAt).toBeDefined();
      expect(result.evaluationDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle evaluation errors gracefully', async () => {
      const ctx = createMockContext();
      (ctx.stateNamespace.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );

      const step: ConditionalStep = {
        id: 'cond-1',
        stepType: 'CONDITIONAL',
        condition: 'state.value == 10',
        thenBranch: 'then-step',
        elseBranch: 'else-step',
      };

      const result = await evaluateConditional(ctx, step);

      expect(result.result).toBe(false); // Default to false on error
      expect(result.error).toBeDefined();
      expect(result.branch).toBe('else');
    });
  });
});
