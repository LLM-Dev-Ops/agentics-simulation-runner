/**
 * Tests for Workflow Scheduler (MOD-006)
 *
 * @module tests/core/workflow-scheduler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  WorkflowScheduler,
  createWorkflowScheduler,
  ExecutionOrder,
  ExecutionOrderBuilder,
  areDependenciesSatisfied,
  getReadySteps,
} from '../../src/core/workflow-scheduler.js';

import type {
  ExecutionContext,
  StateNamespace,
  StateTransaction,
  SeededRandomGenerator,
  CheckpointManager,
  TelemetryCollector,
  ResourceManager,
  Checkpoint,
} from '../../src/types/execution-context.js';

import type {
  WorkflowStep,
  AgentInvocationStep,
  ConditionalStep,
  ParallelGroupStep,
  LoopStep,
  DelayStep,
  StateMutationStep,
} from '../../src/types/workflow.js';

import type {
  SimulationPlan,
  AgentDefinition,
} from '../../src/types/simulation-plan.js';

import type { SHA256Hash, ISO8601Timestamp, UUID } from '../../src/types/common.js';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockStateNamespace(): StateNamespace {
  const store = new Map<string, unknown>();

  return {
    namespaceId: 'test-namespace',
    executionId: 'test-execution' as UUID,
    schemaName: 'test_schema',
    initialized: true,
    isolationLevel: 'serializable',
    get: vi.fn(async <T>(key: string) => store.get(key) as T | undefined),
    set: vi.fn(async <T>(key: string, value: T) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    has: vi.fn(async (key: string) => store.has(key)),
    keys: vi.fn(async () => Array.from(store.keys())),
    getStateHash: vi.fn(async () => 'abc123' as SHA256Hash),
    beginTransaction: vi.fn(async () => ({
      transactionId: 'tx-1',
      get: vi.fn(async <T>(key: string) => store.get(key) as T | undefined),
      set: vi.fn(async <T>(key: string, value: T) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => store.delete(key)),
      commit: vi.fn(),
      rollback: vi.fn(),
      isActive: true,
    } as StateTransaction)),
    getVectorCollection: vi.fn(() => ({
      name: 'test',
      dimensions: 384,
      insert: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      count: vi.fn(),
    })),
  };
}

function createMockTelemetry(): TelemetryCollector {
  return {
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
  };
}

function createMockCheckpointManager(): CheckpointManager {
  return {
    create: vi.fn(async (label: string, stepId?: string) => ({
      checkpointId: 'cp-1' as UUID,
      label,
      executionId: 'exec-1' as UUID,
      stepId,
      sequenceNumber: 1,
      createdAt: new Date().toISOString() as ISO8601Timestamp,
      stateHash: 'hash123' as SHA256Hash,
      randomGeneratorState: {},
      agentStates: {},
    } as Checkpoint)),
    restore: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getLatest: vi.fn(),
  };
}

function createMockRandomGenerator(): SeededRandomGenerator {
  return {
    seed: 12345,
    next: vi.fn(() => 0.5),
    nextInt: vi.fn((min, max) => Math.floor((min + max) / 2)),
    nextBoolean: vi.fn(() => true),
    pick: vi.fn((arr) => arr[0]),
    shuffle: vi.fn((arr) => [...arr]),
    nextUUID: vi.fn(() => 'uuid-1' as UUID),
    clone: vi.fn(),
    getState: vi.fn(() => ({})),
    setState: vi.fn(),
  };
}

function createMockResourceManager(): ResourceManager {
  return {
    limits: {},
    usage: {
      memoryBytes: 0,
      cpuPercent: 0,
      tokensConsumed: 0,
      activeAgents: 0,
      stateSizeBytes: 0,
      apiCallsCount: 0,
    },
    canAllocate: vi.fn(() => true),
    allocate: vi.fn(),
    release: vi.fn(),
    getUsagePercent: vi.fn(() => 0),
    isAnyLimitExceeded: vi.fn(() => false),
    snapshot: vi.fn(),
  };
}

function createMockExecutionContext(): ExecutionContext {
  const stateNamespace = createMockStateNamespace();

  return {
    executionId: 'exec-1' as UUID,
    planRef: {
      planId: 'plan-1' as UUID,
      planVersion: '1.0.0',
      planHash: 'hash123' as SHA256Hash,
    },
    stateNamespace,
    randomGenerator: createMockRandomGenerator(),
    startTime: new Date().toISOString() as ISO8601Timestamp,
    maxDuration: 3600,
    resourceLimits: {},
    resourceManager: createMockResourceManager(),
    status: 'running',
    currentStepSequence: 0,
    getAgentContext: vi.fn(),
    getAllAgentContexts: vi.fn(() => new Map()),
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn(),
    checkpointManager: createMockCheckpointManager(),
    telemetry: createMockTelemetry(),
    initialize: vi.fn(),
    finalize: vi.fn(),
    cancel: vi.fn(),
    isCancelled: vi.fn(() => false),
    getCancellationReason: vi.fn(() => undefined),
    getElapsedMs: vi.fn(() => 1000),
    getRemainingMs: vi.fn(() => 59000),
    isTimedOut: vi.fn(() => false),
  } as unknown as ExecutionContext;
}

function createMockAgentManager() {
  return {
    invokeAgent: vi.fn(async () => ({
      success: true,
      outputs: { result: 'test' },
      tokensConsumed: 100,
      latencyMs: 50,
      llmDetails: {
        provider: 'anthropic',
        model: 'claude-3',
        promptTokens: 50,
        completionTokens: 50,
      },
    })),
  };
}

function createMockIntegrationManager() {
  return {
    executeIntegration: vi.fn(async () => ({
      success: true,
      outputs: { data: 'response' },
      latencyMs: 30,
    })),
  };
}

function createMockPlan(steps: WorkflowStep[]): SimulationPlan {
  return {
    version: '1.0.0',
    planId: 'plan-1' as UUID,
    planVersion: '1.0.0',
    planHash: 'hash123' as SHA256Hash,
    createdAt: new Date().toISOString() as ISO8601Timestamp,
    createdBy: 'test',
    metadata: {
      id: 'plan-1' as UUID,
      name: 'Test Plan',
      createdAt: new Date().toISOString() as ISO8601Timestamp,
      createdBy: 'test',
    },
    executionConfig: {
      timeoutSeconds: 3600,
      maxSteps: 1000,
    },
    stateConfig: {
      databaseConnectionId: 'db-1',
      schemaNamespace: 'test',
      isolationLevel: 'serializable',
    },
    workflow: {
      steps,
      dependencies: {},
    },
    agents: [
      {
        id: 'agent-1',
        type: 'autonomous',
        role: 'test-agent',
        capabilities: [],
        llmBinding: {
          provider: 'anthropic',
          modelId: 'claude-3',
          apiKeyReference: 'secret/api-key',
          configuration: {
            modelId: 'claude-3',
            maxTokens: 1000,
            temperature: 0.7,
          },
          systemPrompt: 'You are a test agent.',
        },
        memoryBinding: {
          workingMemory: {
            type: 'in_memory',
            maxItems: 100,
            ttlSeconds: 3600,
          },
        },
      },
    ],
    integrations: [
      {
        id: 'integration-1',
        type: 'http',
        config: {
          url: 'https://api.example.com',
          method: 'GET',
          timeoutMs: 5000,
        },
      },
    ],
  } as unknown as SimulationPlan;
}

// =============================================================================
// Tests
// =============================================================================

describe('WorkflowScheduler', () => {
  let ctx: ExecutionContext;
  let agentManager: ReturnType<typeof createMockAgentManager>;
  let integrationManager: ReturnType<typeof createMockIntegrationManager>;

  beforeEach(() => {
    ctx = createMockExecutionContext();
    agentManager = createMockAgentManager();
    integrationManager = createMockIntegrationManager();
  });

  describe('buildExecutionOrder', () => {
    it('should sort steps topologically based on dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-c',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-b'],
        } as DelayStep,
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-a'],
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      const order = scheduler.buildExecutionOrder();

      expect(order.steps.map((s) => s.id)).toEqual(['step-a', 'step-b', 'step-c']);
    });

    it('should identify parallel groups correctly', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-c',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-a', 'step-b'],
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      const order = scheduler.buildExecutionOrder();

      // step-a and step-b should be in the same level (can run in parallel)
      expect(order.parallelGroups.get(0)?.has('step-a')).toBe(true);
      expect(order.parallelGroups.get(0)?.has('step-b')).toBe(true);
      // step-c should be in a later level
      expect(order.stepLevels.get('step-c')).toBeGreaterThan(0);
    });

    it('should compute critical path', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-a'],
        } as DelayStep,
        {
          id: 'step-c',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-b'],
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      const order = scheduler.buildExecutionOrder();

      expect(order.criticalPath).toEqual(['step-a', 'step-b', 'step-c']);
    });
  });

  describe('getNextSteps', () => {
    it('should return steps with no dependencies initially', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 100,
        } as DelayStep,
        {
          id: 'step-c',
          stepType: 'DELAY',
          delayMs: 100,
          dependencies: ['step-a'],
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      const nextSteps = scheduler.getNextSteps();

      const nextIds = nextSteps.map((s) => s.id);
      expect(nextIds).toContain('step-a');
      expect(nextIds).toContain('step-b');
      expect(nextIds).not.toContain('step-c');
    });

    it('should return dependent steps after dependencies complete', async () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 10,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 10,
          dependencies: ['step-a'],
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();

      // Initially only step-a is available
      let nextSteps = scheduler.getNextSteps();
      expect(nextSteps.map((s) => s.id)).toEqual(['step-a']);

      // Execute step-a
      await scheduler.executeStep(steps[0]);

      // Now step-b should be available
      nextSteps = scheduler.getNextSteps();
      expect(nextSteps.map((s) => s.id)).toEqual(['step-b']);
    });
  });

  describe('executeStep', () => {
    it('should execute delay step', async () => {
      const step: DelayStep = {
        id: 'delay-step',
        stepType: 'DELAY',
        delayMs: 50,
      };

      const plan = createMockPlan([step]);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      const result = await scheduler.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.stepId).toBe('delay-step');
      expect(result.outputs).toEqual({ delayedMs: 50 });
    });

    it('should execute agent invocation step', async () => {
      const step: AgentInvocationStep = {
        id: 'agent-step',
        stepType: 'AGENT_INVOCATION',
        agentId: 'agent-1',
        action: 'process',
        inputs: { static: { query: 'test' } },
        outputs: { stateKeys: ['result'] },
      };

      const plan = createMockPlan([step]);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      const result = await scheduler.executeStep(step);

      expect(result.status).toBe('success');
      expect(agentManager.invokeAgent).toHaveBeenCalled();
      expect(result.llmInteraction).toBeDefined();
    });

    it('should execute state mutation step', async () => {
      const step: StateMutationStep = {
        id: 'mutation-step',
        stepType: 'STATE_MUTATION',
        mutations: {
          counter: 42,
          name: 'test',
        },
      };

      const plan = createMockPlan([step]);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      const result = await scheduler.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs).toEqual({ mutatedKeys: ['counter', 'name'] });
    });

    it('should handle step timeout', async () => {
      const step: DelayStep = {
        id: 'slow-step',
        stepType: 'DELAY',
        delayMs: 5000,
        timeoutMs: 50,
      };

      const plan = createMockPlan([step]);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager,
        { defaultStepTimeoutMs: 50 }
      );

      scheduler.buildExecutionOrder();
      const result = await scheduler.executeStep(step);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timed out');
    });
  });

  describe('isComplete', () => {
    it('should return true when all steps are completed', async () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 10,
        } as DelayStep,
        {
          id: 'step-b',
          stepType: 'DELAY',
          delayMs: 10,
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      expect(scheduler.isComplete()).toBe(false);

      await scheduler.executeStep(steps[0]);
      expect(scheduler.isComplete()).toBe(false);

      await scheduler.executeStep(steps[1]);
      expect(scheduler.isComplete()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset scheduler state', async () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step-a',
          stepType: 'DELAY',
          delayMs: 10,
        } as DelayStep,
      ];

      const plan = createMockPlan(steps);
      const scheduler = createWorkflowScheduler(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      scheduler.buildExecutionOrder();
      await scheduler.executeStep(steps[0]);
      expect(scheduler.getCompletedSteps().size).toBe(1);

      scheduler.reset();
      expect(scheduler.getCompletedSteps().size).toBe(0);
      expect(scheduler.getExecutionOrder()).toBeNull();
    });
  });
});

describe('ExecutionOrderBuilder', () => {
  it('should build execution order correctly', () => {
    const builder = new ExecutionOrderBuilder();

    const steps: WorkflowStep[] = [
      { id: 'step-1', stepType: 'DELAY', delayMs: 100 } as DelayStep,
      { id: 'step-2', stepType: 'DELAY', delayMs: 100 } as DelayStep,
    ];

    builder
      .setWorkflowId('wf-1')
      .setSteps(steps)
      .addToParallelGroup(0, 'step-1')
      .addToParallelGroup(0, 'step-2')
      .setDependencies('step-1', [])
      .setDependencies('step-2', [])
      .setDependents('step-1', [])
      .setDependents('step-2', [])
      .setCriticalPath(['step-1']);

    const order = builder.build('hash123' as SHA256Hash);

    expect(order.workflowId).toBe('wf-1');
    expect(order.steps.length).toBe(2);
    expect(order.parallelGroups.get(0)?.size).toBe(2);
    expect(order.maxLevel).toBe(0);
  });
});

describe('areDependenciesSatisfied', () => {
  it('should return true when all dependencies are completed', () => {
    const builder = new ExecutionOrderBuilder();
    builder
      .setWorkflowId('wf-1')
      .setSteps([])
      .setDependencies('step-c', ['step-a', 'step-b']);

    const order = builder.build('hash' as SHA256Hash);
    const completed = new Set(['step-a', 'step-b']);

    expect(areDependenciesSatisfied('step-c', order, completed)).toBe(true);
  });

  it('should return false when some dependencies are not completed', () => {
    const builder = new ExecutionOrderBuilder();
    builder
      .setWorkflowId('wf-1')
      .setSteps([])
      .setDependencies('step-c', ['step-a', 'step-b']);

    const order = builder.build('hash' as SHA256Hash);
    const completed = new Set(['step-a']);

    expect(areDependenciesSatisfied('step-c', order, completed)).toBe(false);
  });
});

describe('getReadySteps', () => {
  it('should return steps that are ready for execution', () => {
    const steps: WorkflowStep[] = [
      { id: 'step-a', stepType: 'DELAY', delayMs: 100 } as DelayStep,
      { id: 'step-b', stepType: 'DELAY', delayMs: 100 } as DelayStep,
      { id: 'step-c', stepType: 'DELAY', delayMs: 100 } as DelayStep,
    ];

    const builder = new ExecutionOrderBuilder();
    builder
      .setWorkflowId('wf-1')
      .setSteps(steps)
      .setDependencies('step-a', [])
      .setDependencies('step-b', [])
      .setDependencies('step-c', ['step-a', 'step-b']);

    const order = builder.build('hash' as SHA256Hash);
    const completed = new Set<string>();
    const inProgress = new Set<string>();

    const ready = getReadySteps(order, completed, inProgress);

    expect(ready.map((s) => s.id)).toEqual(['step-a', 'step-b']);
  });
});
