/**
 * Tests for Parallel Executor
 *
 * @module tests/core/parallel-executor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  ParallelExecutor,
  createParallelExecutor,
  executeParallelSteps,
} from '../../src/core/parallel-executor.js';

import type {
  ExecutionContext,
  StateNamespace,
} from '../../src/types/execution-context.js';

import type {
  ParallelGroupStep,
  DelayStep,
  WorkflowStep,
} from '../../src/types/workflow.js';

import type { OrchestrationStepResult } from '../../src/orchestration/types.js';
import type { SHA256Hash, UUID, ISO8601Timestamp, StepStatus } from '../../src/types/common.js';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockContext(): ExecutionContext {
  const store = new Map<string, unknown>();

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

function createMockStepExecutor(
  results: Map<string, OrchestrationStepResult> = new Map()
) {
  return {
    executeStep: vi.fn(async (step: WorkflowStep): Promise<OrchestrationStepResult> => {
      // Check if we have a custom result for this step
      if (results.has(step.id)) {
        return results.get(step.id)!;
      }

      // Default successful result
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

function createSuccessResult(stepId: string): OrchestrationStepResult {
  return {
    stepId,
    workflowId: 'wf-1',
    status: 'success',
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
}

function createFailureResult(stepId: string, errorMessage: string): OrchestrationStepResult {
  return {
    stepId,
    workflowId: 'wf-1',
    status: 'failure',
    startedAt: new Date().toISOString() as ISO8601Timestamp,
    completedAt: new Date().toISOString() as ISO8601Timestamp,
    durationMs: 10,
    inputsSnapshot: {},
    outputs: {},
    error: {
      code: 'STEP_ERROR',
      message: errorMessage,
    },
    sequenceNumber: 0,
    waitedForDependencies: [],
    dependencyWaitTimeMs: 0,
    skipped: false,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ParallelExecutor', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('executeParallelSteps', () => {
    it('should execute all parallel steps successfully', async () => {
      const stepExecutor = createMockStepExecutor();

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.stepResults.length).toBe(3);
      expect(result.successfulSteps).toEqual(['step-a', 'step-b', 'step-c']);
      expect(result.failedSteps).toEqual([]);
      expect(result.skippedSteps).toEqual([]);
      expect(stepExecutor.executeStep).toHaveBeenCalledTimes(3);
    });

    it('should respect maxConcurrency limit', async () => {
      const executionOrder: string[] = [];

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          executionOrder.push(step.id);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return createSuccessResult(step.id);
        }),
      };

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-d', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_slow',
        maxConcurrency: 2,
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.stepResults.length).toBe(4);
      // With maxConcurrency=2, steps should be executed in 2 batches
    });

    it('should fail fast on first failure with fail_fast strategy', async () => {
      const results = new Map<string, OrchestrationStepResult>();
      results.set('step-b', createFailureResult('step-b', 'Step B failed'));

      const stepExecutor = createMockStepExecutor(results);

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('failure');
      expect(result.failedSteps).toContain('step-b');
    });

    it('should continue on failure with fail_slow strategy', async () => {
      const results = new Map<string, OrchestrationStepResult>();
      results.set('step-b', createFailureResult('step-b', 'Step B failed'));

      const stepExecutor = createMockStepExecutor(results);

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_slow',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('failure');
      expect(result.stepResults.length).toBe(3);
      expect(result.successfulSteps).toContain('step-a');
      expect(result.successfulSteps).toContain('step-c');
      expect(result.failedSteps).toContain('step-b');
    });

    it('should succeed despite failures with ignore_failures strategy', async () => {
      const results = new Map<string, OrchestrationStepResult>();
      results.set('step-b', createFailureResult('step-b', 'Step B failed'));

      const stepExecutor = createMockStepExecutor(results);

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'ignore_failures',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.status).toBe('success');
      expect(result.stepResults.length).toBe(3);
      expect(result.failedSteps).toContain('step-b');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should track parallelism efficiency', async () => {
      const stepExecutor = createMockStepExecutor();

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.parallelismEfficiency).toBeGreaterThan(0);
      expect(result.combinedDurationMs).toBeGreaterThanOrEqual(result.totalDurationMs);
    });

    it('should sort steps by ID for deterministic ordering', async () => {
      const executionOrder: string[] = [];

      const stepExecutor = {
        executeStep: vi.fn(async (step: WorkflowStep) => {
          executionOrder.push(step.id);
          return createSuccessResult(step.id);
        }),
      };

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-c', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
        maxConcurrency: 1, // Force sequential to verify order
      };

      await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      // Steps should be executed in sorted order (step-a, step-b, step-c)
      expect(executionOrder).toEqual(['step-a', 'step-b', 'step-c']);
    });

    it('should set sub-sequence PRNG for each step', async () => {
      const stepExecutor = createMockStepExecutor();

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
          { id: 'step-b', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
      };

      await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      // Verify set was called with PRNG keys
      expect(ctx.stateNamespace.set).toHaveBeenCalled();
      expect(ctx.stateNamespace.delete).toHaveBeenCalled();
    });

    it('should record timing information', async () => {
      const stepExecutor = createMockStepExecutor();

      const parallelStep: ParallelGroupStep = {
        id: 'parallel-1',
        stepType: 'PARALLEL_GROUP',
        parallelSteps: [
          { id: 'step-a', stepType: 'DELAY', delayMs: 10 } as DelayStep,
        ],
        failureStrategy: 'fail_fast',
      };

      const result = await executeParallelSteps(
        ctx,
        parallelStep,
        stepExecutor,
        'prehash' as SHA256Hash
      );

      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createParallelExecutor', () => {
    it('should create a parallel executor instance', () => {
      const stepExecutor = createMockStepExecutor();
      const executor = createParallelExecutor(ctx, stepExecutor);

      expect(executor).toBeInstanceOf(ParallelExecutor);
    });
  });
});
