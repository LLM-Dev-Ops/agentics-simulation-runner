/**
 * Tests for Failure Handler
 *
 * Tests error classification, recovery actions, and rollback functionality.
 *
 * @module tests/orchestration/failure-handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ExecutionContext,
  SeededRandomGenerator,
  StateNamespace,
  StateTransaction,
  ResourceManager,
  TelemetryCollector,
  CheckpointManager as ContextCheckpointManager,
  AgentContext,
  SpanHandle,
} from '../../src/types/execution-context.js';
import type { SimulationPlan } from '../../src/types/simulation-plan.js';
import type { WorkflowStep } from '../../src/types/workflow.js';
import type { UUID, SHA256Hash, ISO8601Timestamp, ResourceLimits } from '../../src/types/common.js';
import {
  FailureHandler,
  createFailureHandler,
  classifyErrorSeverity,
  isRetryableError,
} from '../../src/orchestration/failure-handler.js';
import {
  ExecutionCheckpointManager,
  createCheckpointManager,
} from '../../src/orchestration/checkpoint-manager.js';

// =============================================================================
// Mock Implementations
// =============================================================================

function createMockSpanHandle(): SpanHandle {
  return {
    spanId: 'span-123',
    setAttribute: vi.fn(),
    recordError: vi.fn(),
    end: vi.fn(),
  };
}

function createMockRandomGenerator(): SeededRandomGenerator {
  let state = 12345;
  return {
    seed: 12345,
    next: () => 0.5,
    nextInt: (min, max) => Math.floor((min + max) / 2),
    nextBoolean: () => true,
    pick: <T>(arr: readonly T[]) => arr[0],
    shuffle: <T>(arr: readonly T[]) => [...arr],
    nextUUID: () => '00000000-0000-4000-8000-000000000000' as UUID,
    clone: function () { return this; },
    getState: () => state,
    setState: (s: unknown) => { state = s as number; },
  };
}

function createMockStateTransaction(): StateTransaction {
  const data = new Map<string, unknown>();
  return {
    transactionId: 'tx-123',
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => data.delete(key),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    isActive: true,
  };
}

function createMockStateNamespace(): StateNamespace {
  const data = new Map<string, unknown>();
  return {
    namespaceId: 'ns-123',
    executionId: 'exec-123' as UUID,
    schemaName: 'test_schema',
    initialized: true,
    isolationLevel: 'serializable',
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => data.delete(key),
    has: async (key: string) => data.has(key),
    keys: async () => Array.from(data.keys()),
    getStateHash: async () => 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
    beginTransaction: async () => createMockStateTransaction(),
    getVectorCollection: vi.fn(),
  };
}

function createMockResourceManager(): ResourceManager {
  return {
    limits: {} as ResourceLimits,
    usage: {
      memoryBytes: 0,
      cpuPercent: 0,
      tokensConsumed: 0,
      activeAgents: 0,
      stateSizeBytes: 0,
      apiCallsCount: 0,
    },
    canAllocate: () => true,
    allocate: vi.fn(),
    release: vi.fn(),
    getUsagePercent: () => 0.1,
    isAnyLimitExceeded: () => false,
    snapshot: () => ({
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      usage: {
        memoryBytes: 0,
        cpuPercent: 0,
        tokensConsumed: 0,
        activeAgents: 0,
        stateSizeBytes: 0,
        apiCallsCount: 0,
      },
      limits: {} as ResourceLimits,
    }),
  };
}

function createMockTelemetryCollector(): TelemetryCollector {
  return {
    startSpan: vi.fn().mockReturnValue(createMockSpanHandle()),
    recordMetric: vi.fn(),
    log: vi.fn(),
    emitEvent: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockContextCheckpointManager(): ContextCheckpointManager {
  return {
    create: vi.fn().mockResolvedValue({}),
    restore: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    getLatest: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockExecutionContext(): ExecutionContext {
  const agentContexts = new Map<string, AgentContext>();

  return {
    executionId: 'exec-123' as UUID,
    planRef: {
      planId: 'plan-123' as UUID,
      planVersion: '1.0.0',
      planHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
    },
    stateNamespace: createMockStateNamespace(),
    randomGenerator: createMockRandomGenerator(),
    startTime: new Date().toISOString() as ISO8601Timestamp,
    maxDuration: 3600,
    getElapsedMs: () => 1000,
    getRemainingMs: () => 3599000,
    isTimedOut: () => false,
    resourceLimits: {} as ResourceLimits,
    resourceManager: createMockResourceManager(),
    status: 'running',
    currentStepSequence: 5,
    currentStepId: 'step-5',
    getAgentContext: (agentId: string) => agentContexts.get(agentId),
    getAllAgentContexts: () => agentContexts,
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn(),
    checkpointManager: createMockContextCheckpointManager(),
    telemetry: createMockTelemetryCollector(),
    initialize: vi.fn(),
    finalize: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    isCancelled: () => false,
    getCancellationReason: () => undefined,
  };
}

function createMockPlan(): SimulationPlan {
  return {
    version: '1.0.0',
    planId: 'plan-123' as UUID,
    planVersion: '1.0.0',
    planHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
    createdAt: new Date().toISOString() as ISO8601Timestamp,
    createdBy: 'test',
    metadata: {
      id: 'plan-123' as UUID,
      name: 'Test Plan',
      createdAt: new Date().toISOString() as ISO8601Timestamp,
      createdBy: 'test',
    },
    executionConfig: {
      timeoutSeconds: 3600,
      maxSteps: 100,
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000,
      },
    },
    stateConfig: {
      databaseConnectionId: 'db-123',
      schemaNamespace: 'test',
      isolationLevel: 'serializable',
    },
    workflow: {
      steps: [],
      dependencies: {},
      checkpoints: [],
    },
    agents: [],
  } as unknown as SimulationPlan;
}

function createStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    stepType: 'STATE_MUTATION',
    mutations: {},
    ...overrides,
  } as WorkflowStep;
}

// =============================================================================
// Tests
// =============================================================================

describe('classifyErrorSeverity', () => {
  it('should classify timeout as RECOVERABLE', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('TIMEOUT', step);
    expect(severity).toBe('RECOVERABLE');
  });

  it('should classify rate limit as RECOVERABLE', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('RATE_LIMIT', step);
    expect(severity).toBe('RECOVERABLE');
  });

  it('should classify network error as RECOVERABLE', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('NETWORK_ERROR', step);
    expect(severity).toBe('RECOVERABLE');
  });

  it('should classify step failure as CRITICAL', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('STEP_FAILED', step);
    expect(severity).toBe('CRITICAL');
  });

  it('should classify agent error as CRITICAL', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('AGENT_ERROR', step);
    expect(severity).toBe('CRITICAL');
  });

  it('should classify invariant violation as FATAL', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('INVARIANT_VIOLATED', step);
    expect(severity).toBe('FATAL');
  });

  it('should classify resource exhausted as FATAL', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('RESOURCE_EXHAUSTED', step);
    expect(severity).toBe('FATAL');
  });

  it('should escalate unknown errors on steps with abort control flow', () => {
    const step = createStep({
      controlFlow: {
        onSuccess: 'next',
        onFailure: 'abort',
        onTimeout: 'abort',
      },
    });
    const severity = classifyErrorSeverity('UNKNOWN_ERROR', step);
    expect(severity).toBe('FATAL');
  });

  it('should default to CRITICAL for unknown errors', () => {
    const step = createStep();
    const severity = classifyErrorSeverity('SOME_RANDOM_ERROR', step);
    expect(severity).toBe('CRITICAL');
  });
});

describe('isRetryableError', () => {
  it('should return true for recoverable errors', () => {
    expect(isRetryableError('TIMEOUT')).toBe(true);
    expect(isRetryableError('RATE_LIMIT')).toBe(true);
    expect(isRetryableError('NETWORK_ERROR')).toBe(true);
    expect(isRetryableError('TRANSIENT_ERROR')).toBe(true);
  });

  it('should return false for non-recoverable errors', () => {
    expect(isRetryableError('STEP_FAILED')).toBe(false);
    expect(isRetryableError('INVARIANT_VIOLATED')).toBe(false);
    expect(isRetryableError('RESOURCE_EXHAUSTED')).toBe(false);
  });
});

describe('FailureHandler', () => {
  let ctx: ExecutionContext;
  let plan: SimulationPlan;
  let checkpointManager: ExecutionCheckpointManager;
  let handler: FailureHandler;

  beforeEach(() => {
    ctx = createMockExecutionContext();
    plan = createMockPlan();
    checkpointManager = createCheckpointManager(ctx.executionId);
    handler = createFailureHandler(ctx, plan, checkpointManager);
  });

  describe('handleStepFailure', () => {
    it('should record error in failure history', async () => {
      const step = createStep();
      const error = new Error('Test error');

      await handler.handleStepFailure(step, error, 0);

      const history = handler.getFailureHistory();
      expect(history.length).toBe(1);
      expect(history[0].message).toBe('Test error');
    });

    it('should return RETRY for recoverable errors with retries available', async () => {
      const step = createStep({
        controlFlow: {
          onSuccess: 'next',
          onFailure: 'retry',
          onTimeout: 'abort',
        },
      });

      // Create an error that will be classified as recoverable
      const error = new Error('timeout occurred');
      (error as Error & { code?: string }).code = 'TIMEOUT';

      const result = await handler.handleStepFailure(step, error, 0);

      expect(result.action).toBe('RETRY');
      expect(result.continueExecution).toBe(true);
      expect(result.nextStepId).toBe(step.id);
    });

    it('should return SKIP for non-critical failures', async () => {
      const step = createStep({
        controlFlow: {
          onSuccess: 'next',
          onFailure: 'complete',
          onTimeout: 'abort',
        },
      });

      const error = new Error('Step failed');

      const result = await handler.handleStepFailure(step, error, 0);

      expect(result.action).toBe('SKIP');
      expect(result.continueExecution).toBe(true);
    });

    it('should return ABORT for steps with abort control flow', async () => {
      const step = createStep({
        controlFlow: {
          onSuccess: 'next',
          onFailure: 'abort',
          onTimeout: 'abort',
        },
      });

      const error = new Error('Critical error');

      const result = await handler.handleStepFailure(step, error, 0);

      expect(result.action).toBe('ABORT');
      expect(result.continueExecution).toBe(false);
    });

    it('should track error severity counts', async () => {
      const step = createStep();

      // Create errors with different codes
      const recoverableError = new Error('timeout');
      (recoverableError as Error & { code?: string }).code = 'TIMEOUT';

      const criticalError = new Error('step failed');
      (criticalError as Error & { code?: string }).code = 'STEP_FAILED';

      await handler.handleStepFailure(step, recoverableError, 0);
      await handler.handleStepFailure(step, criticalError, 0);

      const counts = handler.getErrorCountBySeverity();

      expect(counts.RECOVERABLE).toBe(1);
      expect(counts.CRITICAL).toBe(1);
    });
  });

  describe('rollbackExecution', () => {
    it('should fail when no checkpoint available', async () => {
      const result = await handler.rollbackExecution('Test rollback');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No checkpoint available');
    });

    it('should rollback to latest checkpoint when available', async () => {
      // Create a checkpoint first
      await checkpointManager.createCheckpoint(ctx, {
        label: 'before-failure',
        captureState: true,
        captureMetrics: true,
        captureVectorMemory: false,
      });

      const result = await handler.rollbackExecution('Test rollback');

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBeDefined();
      expect(result.rolledBackAt).toBeDefined();
    });
  });

  describe('abortExecution', () => {
    it('should cancel the execution context', async () => {
      await handler.abortExecution('Test abort');

      expect(ctx.cancel).toHaveBeenCalledWith('Test abort');
    });

    it('should emit abort event', async () => {
      await handler.abortExecution('Test abort');

      expect(ctx.telemetry.emitEvent).toHaveBeenCalledWith(
        'EXECUTION_ABORTED',
        expect.objectContaining({
          reason: 'Test abort',
        })
      );
    });
  });
});
