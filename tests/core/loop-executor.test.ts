/**
 * Tests for Loop Executor
 *
 * @module tests/core/loop-executor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  LoopExecutor,
  createLoopExecutor,
  executeLoop,
} from '../../src/core/loop-executor.js';

import type {
  ExecutionContext,
  StateNamespace,
} from '../../src/types/execution-context.js';

import type {
  LoopStep,
  DelayStep,
  WorkflowStep,
  StateMutationStep,
} from '../../src/types/workflow.js';

import type { OrchestrationStepResult } from '../../src/orchestration/types.js';
import type { SHA256Hash, UUID, ISO8601Timestamp, StepStatus } from '../../src/types/common.js';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockContext(initialState: Record<string, unknown> = {}): ExecutionContext {
  const store = new Map<string, unknown>(Object.entries(initialState));

  const stateNamespace: StateNamespace = {
    namespaceId: 'test',
    executionId: 'exec-1' as UUID,
    schemaName: 'test',
    initialized: true,
    isolationLevel: 'serializable',
    get: vi.fn(async <T>(key: string) => store.get(key) as T | undefined),
    set: vi.fn(async <T>(key: string, value: T) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    has: vi.fn(),
    keys: vi.fn(),
    getStateHash: vi.fn(async () => 'hash' as SHA256Hash),
    beginTransaction: vi.fn(),
    getVectorCollection: vi.fn(),
  };

  return {
    executionId: 'exec-1' as UUID,
    stateNamespace,
    randomGenerator: {
      seed: 12345,
      next: vi.fn(() => 0.5),
      nextInt: vi.fn(),
      nextBoolean: vi.fn(),
      pick: vi.fn(),
      shuffle: vi.fn(),
      nextUUID: vi.fn(),
      clone: vi.fn(),
      getState: vi.fn(),
      setState: vi.fn(),
    },
    currentStepSequence: 0,
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

function createMockStepExecutor() {
  return {
    executeStep: vi.fn(async (step: WorkflowStep): Promise<OrchestrationStepResult> => {
      return {
        stepId: step.id,
        workflowId: 'wf-1',
        status: 'success' as StepStatus,
        startedAt: new Date().toISOString() as ISO8601Timestamp,
        completedAt: new Date().toISOString() as ISO8601Timestamp,
        durationMs: 10,
        inputsSnapshot: {},
        outputs: {},
        sequenceNumber: 0,
        waitedForDependencies: [],
        dependencyWaitTimeMs: 0,
        skipped: false,
      };
    }),
  };
}

function createFailingStepExecutor(failOnIteration: number) {
  let callCount = 0;
  return {
    executeStep: vi.fn(async (step: WorkflowStep): Promise<OrchestrationStepResult> => {
      callCount++;
      const status: StepStatus = callCount === failOnIteration ? 'failure' : 'success';
      return {
        stepId: step.id,
        workflowId: 'wf-1',
        status,
        startedAt: new Date().toISOString() as ISO8601Timestamp,
        completedAt: new Date().toISOString() as ISO8601Timestamp,
        durationMs: 10,
        inputsSnapshot: {},
        outputs: {},
        error: status === 'failure' ? { code: 'ERR', message: 'Failed' } : undefined,
        sequenceNumber: 0,
        waitedForDependencies: [],
        dependencyWaitTimeMs: 0,
        skipped: false,
      };
    }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('LoopExecutor', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('count loop', () => {
    it('should execute exactly N iterations', async () => {
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 5,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.iterationCount).toBe(5);
      expect(result.terminationReason).toBe('COUNT_COMPLETED');
      expect(stepExecutor.executeStep).toHaveBeenCalledTimes(5);
    });

    it('should respect maxIterations limit', async () => {
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 100,
        maxIterations: 10,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.iterationCount).toBe(10);
      expect(result.terminationReason).toBe('MAX_ITERATIONS');
    });

    it('should set iterator variable correctly', async () => {
      const setValues: number[] = [];

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          // Capture the iterator value
          const idx = await ctx.stateNamespace.get<number>('idx');
          if (idx !== undefined) {
            setValues.push(idx);
          }
          return {
            stepId: step.id,
            workflowId: 'wf-1',
            status: 'success' as StepStatus,
            startedAt: new Date().toISOString() as ISO8601Timestamp,
            completedAt: new Date().toISOString() as ISO8601Timestamp,
            durationMs: 10,
            inputsSnapshot: {},
            outputs: {},
            sequenceNumber: 0,
            waitedForDependencies: [],
            dependencyWaitTimeMs: 0,
            skipped: false,
          };
        }),
      };

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 3,
        iteratorVariable: 'idx',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(setValues).toEqual([0, 1, 2]);
    });
  });

  describe('for_each loop', () => {
    it('should iterate over collection', async () => {
      ctx = createMockContext({ items: ['a', 'b', 'c'] });
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'for_each',
        iteratorSource: 'items',
        iteratorVariable: 'item',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.iterationCount).toBe(3);
      expect(result.terminationReason).toBe('COLLECTION_EXHAUSTED');
    });

    it('should pass current item to iterator variable', async () => {
      ctx = createMockContext({ items: [10, 20, 30] });
      const itemValues: unknown[] = [];

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          const item = await ctx.stateNamespace.get('currentItem');
          itemValues.push(item);
          return {
            stepId: step.id,
            workflowId: 'wf-1',
            status: 'success' as StepStatus,
            startedAt: new Date().toISOString() as ISO8601Timestamp,
            completedAt: new Date().toISOString() as ISO8601Timestamp,
            durationMs: 10,
            inputsSnapshot: {},
            outputs: {},
            sequenceNumber: 0,
            waitedForDependencies: [],
            dependencyWaitTimeMs: 0,
            skipped: false,
          };
        }),
      };

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'for_each',
        iteratorSource: 'items',
        iteratorVariable: 'currentItem',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(itemValues).toEqual([10, 20, 30]);
    });

    it('should handle missing collection gracefully', async () => {
      ctx = createMockContext({});
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'for_each',
        iteratorSource: 'nonExistentCollection',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('failure');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty collection', async () => {
      ctx = createMockContext({ items: [] });
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'for_each',
        iteratorSource: 'items',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.iterationCount).toBe(0);
      expect(result.terminationReason).toBe('COLLECTION_EXHAUSTED');
    });
  });

  describe('while loop', () => {
    it('should loop while condition is true', async () => {
      let counter = 0;
      const store = new Map<string, unknown>([['counter', 0]]);

      const stateNamespace: StateNamespace = {
        ...ctx.stateNamespace,
        get: vi.fn(async <T>(key: string) => store.get(key) as T | undefined),
        set: vi.fn(async <T>(key: string, value: T) => {
          store.set(key, value);
        }),
      };

      ctx = {
        ...ctx,
        stateNamespace,
      } as ExecutionContext;

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          counter++;
          store.set('counter', counter);
          return {
            stepId: step.id,
            workflowId: 'wf-1',
            status: 'success' as StepStatus,
            startedAt: new Date().toISOString() as ISO8601Timestamp,
            completedAt: new Date().toISOString() as ISO8601Timestamp,
            durationMs: 10,
            inputsSnapshot: {},
            outputs: {},
            sequenceNumber: 0,
            waitedForDependencies: [],
            dependencyWaitTimeMs: 0,
            skipped: false,
          };
        }),
      };

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'while',
        condition: 'state.counter < 5',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
        maxIterations: 10,
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.terminationReason).toBe('CONDITION_FALSE');
      expect(result.iterationCount).toBe(5);
    });
  });

  describe('until loop', () => {
    it('should loop until condition becomes true', async () => {
      let counter = 0;
      const store = new Map<string, unknown>([['counter', 0]]);

      const stateNamespace: StateNamespace = {
        ...ctx.stateNamespace,
        get: vi.fn(async <T>(key: string) => store.get(key) as T | undefined),
        set: vi.fn(async <T>(key: string, value: T) => {
          store.set(key, value);
        }),
      };

      ctx = {
        ...ctx,
        stateNamespace,
      } as ExecutionContext;

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          counter++;
          store.set('counter', counter);
          return {
            stepId: step.id,
            workflowId: 'wf-1',
            status: 'success' as StepStatus,
            startedAt: new Date().toISOString() as ISO8601Timestamp,
            completedAt: new Date().toISOString() as ISO8601Timestamp,
            durationMs: 10,
            inputsSnapshot: {},
            outputs: {},
            sequenceNumber: 0,
            waitedForDependencies: [],
            dependencyWaitTimeMs: 0,
            skipped: false,
          };
        }),
      };

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'until',
        condition: 'state.counter >= 3',
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
        maxIterations: 10,
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.terminationReason).toBe('CONDITION_MET');
      expect(result.iterationCount).toBe(3);
    });
  });

  describe('error handling', () => {
    it('should stop on body step failure', async () => {
      const stepExecutor = createFailingStepExecutor(2);

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 5,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('failure');
      expect(result.iterationCount).toBe(2);
      expect(result.terminationReason).toBe('ERROR');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should record iteration results even on failure', async () => {
      const stepExecutor = createFailingStepExecutor(3);

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 5,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.iterationResults.length).toBe(3);
      expect(result.iterationResults[0].success).toBe(true);
      expect(result.iterationResults[1].success).toBe(true);
      expect(result.iterationResults[2].success).toBe(false);
    });
  });

  describe('metrics', () => {
    it('should calculate average iteration duration', async () => {
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 3,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.avgIterationDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should record final loop index', async () => {
      const stepExecutor = createMockStepExecutor();

      const loopStep: LoopStep = {
        id: 'loop-1',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 5,
        body: [{ id: 'body-step', stepType: 'DELAY', delayMs: 10 } as DelayStep],
      };

      const result = await executeLoop(
        ctx,
        loopStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.finalLoopIndex).toBe(4); // 0-indexed, last iteration
    });
  });

  describe('createLoopExecutor', () => {
    it('should create a loop executor instance', () => {
      const stepExecutor = createMockStepExecutor();
      const executor = createLoopExecutor(ctx, stepExecutor);

      expect(executor).toBeInstanceOf(LoopExecutor);
    });
  });
});
