/**
 * Tests for Step Executor
 *
 * Tests step dispatch, input resolution, and output handling.
 *
 * @module tests/orchestration/step-executor
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
import type { SimulationPlan, AgentDefinition, IntegrationEndpoint } from '../../src/types/simulation-plan.js';
import type {
  WorkflowStep,
  StateMutationStep,
  DelayStep,
  EventEmitStep,
  ConditionalStep,
  LoopStep,
} from '../../src/types/workflow.js';
import type { UUID, SHA256Hash, ISO8601Timestamp, ResourceLimits } from '../../src/types/common.js';
import {
  StepExecutor,
  createStepExecutor,
  resolveStepInputs,
  storeStepOutputs,
  evaluateCondition,
  type AgentLifecycleManager,
  type IntegrationAdapterManager,
} from '../../src/orchestration/step-executor.js';

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
    currentStepSequence: 1,
    currentStepId: 'step-1',
    getAgentContext: (agentId: string) => agentContexts.get(agentId),
    getAllAgentContexts: () => agentContexts,
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn(),
    checkpointManager: createMockContextCheckpointManager(),
    telemetry: createMockTelemetryCollector(),
    initialize: vi.fn(),
    finalize: vi.fn(),
    cancel: vi.fn(),
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
    agents: [
      {
        id: 'agent-1',
        type: 'autonomous',
        role: 'test',
        capabilities: [],
        llmBinding: {
          provider: 'anthropic',
          modelId: 'claude-3',
          apiKeyReference: 'test-key',
          configuration: { modelId: 'claude-3', maxTokens: 1000, temperature: 0 },
          systemPrompt: 'test',
        },
        memoryBinding: {
          workingMemory: { type: 'in_memory', maxItems: 100, ttlSeconds: 3600 },
        },
      } as AgentDefinition,
    ],
    integrations: [
      {
        id: 'int-1',
        type: 'http',
        config: {
          url: 'https://api.example.com',
          method: 'GET',
          timeoutMs: 5000,
        },
      } as unknown as IntegrationEndpoint,
    ],
  } as unknown as SimulationPlan;
}

function createMockAgentManager(): AgentLifecycleManager {
  return {
    invokeAgent: vi.fn().mockResolvedValue({
      success: true,
      outputs: { result: 'agent output' },
      tokensConsumed: 100,
      latencyMs: 50,
      llmDetails: {
        provider: 'anthropic',
        model: 'claude-3',
        promptTokens: 50,
        completionTokens: 50,
      },
    }),
  };
}

function createMockIntegrationManager(): IntegrationAdapterManager {
  return {
    executeIntegration: vi.fn().mockResolvedValue({
      success: true,
      outputs: { data: 'integration result' },
      latencyMs: 30,
      observation: {
        integrationId: 'int-1',
        stepId: 'step-1',
        calledAt: new Date().toISOString() as ISO8601Timestamp,
        durationMs: 30,
        success: true,
        usedMock: false,
      },
    }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('resolveStepInputs', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockExecutionContext();
  });

  it('should resolve static inputs', async () => {
    const step = {
      id: 'step-1',
      stepType: 'STATE_MUTATION',
      inputs: {
        static: {
          key1: 'value1',
          key2: 42,
        },
      },
    } as unknown as WorkflowStep;

    const inputs = await resolveStepInputs(step, ctx);

    expect(inputs.key1).toBe('value1');
    expect(inputs.key2).toBe(42);
  });

  it('should resolve dynamic inputs from state', async () => {
    await ctx.stateNamespace.set('stateKey', 'stateValue');

    const step = {
      id: 'step-1',
      stepType: 'STATE_MUTATION',
      inputs: {
        dynamic: ['stateKey'],
      },
    } as unknown as WorkflowStep;

    const inputs = await resolveStepInputs(step, ctx);

    expect(inputs.stateKey).toBe('stateValue');
  });

  it('should return empty object for step without inputs', async () => {
    const step = {
      id: 'step-1',
      stepType: 'STATE_MUTATION',
    } as unknown as WorkflowStep;

    const inputs = await resolveStepInputs(step, ctx);

    expect(inputs).toEqual({});
  });
});

describe('storeStepOutputs', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockExecutionContext();
  });

  it('should store outputs to specified state keys', async () => {
    const step = {
      id: 'step-1',
      stepType: 'STATE_MUTATION',
      outputs: {
        stateKeys: ['result', 'count'],
      },
    } as unknown as WorkflowStep;

    const outputs = {
      result: 'success',
      count: 42,
      ignored: 'not stored',
    };

    await storeStepOutputs(step, outputs, ctx);

    const storedResult = await ctx.stateNamespace.get('result');
    const storedCount = await ctx.stateNamespace.get('count');
    const storedIgnored = await ctx.stateNamespace.get('ignored');

    expect(storedResult).toBe('success');
    expect(storedCount).toBe(42);
    expect(storedIgnored).toBeUndefined();
  });

  it('should emit events when specified', async () => {
    const step = {
      id: 'step-1',
      stepType: 'STATE_MUTATION',
      outputs: {
        stateKeys: [],
        emitEvents: ['STEP_COMPLETE', 'DATA_READY'],
      },
    } as unknown as WorkflowStep;

    await storeStepOutputs(step, { result: 'test' }, ctx);

    expect(ctx.telemetry.emitEvent).toHaveBeenCalledWith(
      'STEP_COMPLETE',
      expect.any(Object)
    );
    expect(ctx.telemetry.emitEvent).toHaveBeenCalledWith(
      'DATA_READY',
      expect.any(Object)
    );
  });
});

describe('evaluateCondition', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockExecutionContext();
  });

  it('should evaluate state equality condition', async () => {
    await ctx.stateNamespace.set('status', 'active');

    const result = await evaluateCondition('state.status == "active"', ctx);

    expect(result).toBe(true);
  });

  it('should evaluate state inequality condition', async () => {
    await ctx.stateNamespace.set('count', 5);

    const result = await evaluateCondition('state.count != 0', ctx);

    expect(result).toBe(true);
  });

  it('should evaluate numeric comparisons', async () => {
    await ctx.stateNamespace.set('value', 10);

    expect(await evaluateCondition('state.value > 5', ctx)).toBe(true);
    expect(await evaluateCondition('state.value < 15', ctx)).toBe(true);
    expect(await evaluateCondition('state.value >= 10', ctx)).toBe(true);
    expect(await evaluateCondition('state.value <= 10', ctx)).toBe(true);
  });

  it('should handle boolean literals', async () => {
    expect(await evaluateCondition('true', ctx)).toBe(true);
    expect(await evaluateCondition('false', ctx)).toBe(false);
    expect(await evaluateCondition('TRUE', ctx)).toBe(true);
    expect(await evaluateCondition('FALSE', ctx)).toBe(false);
  });

  it('should default to true for unrecognized expressions', async () => {
    const result = await evaluateCondition('unknown expression', ctx);

    expect(result).toBe(true);
  });
});

describe('StepExecutor', () => {
  let ctx: ExecutionContext;
  let plan: SimulationPlan;
  let agentManager: AgentLifecycleManager;
  let integrationManager: IntegrationAdapterManager;
  let executor: StepExecutor;

  beforeEach(() => {
    ctx = createMockExecutionContext();
    plan = createMockPlan();
    agentManager = createMockAgentManager();
    integrationManager = createMockIntegrationManager();
    executor = createStepExecutor(ctx, plan, agentManager, integrationManager);
  });

  describe('executeStep - STATE_MUTATION', () => {
    it('should execute state mutation step', async () => {
      const step: StateMutationStep = {
        id: 'step-1',
        name: 'Mutate State',
        stepType: 'STATE_MUTATION',
        mutations: {
          counter: 42,
          status: 'updated',
        },
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.mutatedKeys).toContain('counter');
      expect(result.outputs.mutatedKeys).toContain('status');
    });
  });

  describe('executeStep - DELAY', () => {
    it('should execute delay step', async () => {
      const step: DelayStep = {
        id: 'step-1',
        name: 'Wait',
        stepType: 'DELAY',
        delayMs: 10, // Short delay for test
      };

      const startTime = Date.now();
      const result = await executor.executeStep(step);
      const elapsed = Date.now() - startTime;

      expect(result.status).toBe('success');
      expect(result.outputs.delayedMs).toBe(10);
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });
  });

  describe('executeStep - EVENT_EMIT', () => {
    it('should execute event emit step', async () => {
      const step: EventEmitStep = {
        id: 'step-1',
        name: 'Emit Event',
        stepType: 'EVENT_EMIT',
        eventType: 'TEST_EVENT',
        payload: { data: 'test' },
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.eventEmitted).toBe('TEST_EVENT');
      expect(ctx.telemetry.emitEvent).toHaveBeenCalledWith(
        'TEST_EVENT',
        expect.objectContaining({
          stepId: 'step-1',
        })
      );
    });
  });

  describe('executeStep - CONDITIONAL', () => {
    it('should execute then branch when condition is true', async () => {
      await ctx.stateNamespace.set('flag', true);

      const step: ConditionalStep = {
        id: 'step-1',
        name: 'Conditional',
        stepType: 'CONDITIONAL',
        condition: 'state.flag == true',
        thenBranch: [
          {
            id: 'then-step',
            name: 'Then',
            stepType: 'STATE_MUTATION',
            mutations: { result: 'then' },
          } as StateMutationStep,
        ],
        elseBranch: [
          {
            id: 'else-step',
            name: 'Else',
            stepType: 'STATE_MUTATION',
            mutations: { result: 'else' },
          } as StateMutationStep,
        ],
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.conditionResult).toBe(true);
      expect(result.outputs.executedBranch).toBe('then');
    });

    it('should execute else branch when condition is false', async () => {
      await ctx.stateNamespace.set('flag', false);

      const step: ConditionalStep = {
        id: 'step-1',
        name: 'Conditional',
        stepType: 'CONDITIONAL',
        condition: 'state.flag == true',
        thenBranch: [
          {
            id: 'then-step',
            name: 'Then',
            stepType: 'STATE_MUTATION',
            mutations: { result: 'then' },
          } as StateMutationStep,
        ],
        elseBranch: [
          {
            id: 'else-step',
            name: 'Else',
            stepType: 'STATE_MUTATION',
            mutations: { result: 'else' },
          } as StateMutationStep,
        ],
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.conditionResult).toBe(false);
      expect(result.outputs.executedBranch).toBe('else');
    });
  });

  describe('executeStep - LOOP', () => {
    it('should execute count loop', async () => {
      const step: LoopStep = {
        id: 'step-1',
        name: 'Count Loop',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 3,
        body: [
          {
            id: 'body-step',
            name: 'Body',
            stepType: 'STATE_MUTATION',
            mutations: {},
          } as StateMutationStep,
        ],
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.iterations).toBe(3);
    });

    it('should respect maxIterations limit', async () => {
      const step: LoopStep = {
        id: 'step-1',
        name: 'Limited Loop',
        stepType: 'LOOP',
        loopType: 'count',
        iteratorSource: 1000,
        maxIterations: 5,
        body: [
          {
            id: 'body-step',
            name: 'Body',
            stepType: 'STATE_MUTATION',
            mutations: {},
          } as StateMutationStep,
        ],
      };

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(result.outputs.iterations).toBe(5);
    });
  });

  describe('executeStep - AGENT_INVOCATION', () => {
    it('should invoke agent and return result', async () => {
      const step = {
        id: 'step-1',
        name: 'Agent Step',
        stepType: 'AGENT_INVOCATION',
        agentId: 'agent-1',
        action: 'analyze',
        inputs: {
          static: { data: 'test' },
        },
        outputs: {
          stateKeys: ['agentResult'],
        },
      } as unknown as WorkflowStep;

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(agentManager.invokeAgent).toHaveBeenCalled();
      expect(result.llmInteraction).toBeDefined();
    });
  });

  describe('executeStep - INTEGRATION_CALL', () => {
    it('should execute integration call', async () => {
      const step = {
        id: 'step-1',
        name: 'Integration Step',
        stepType: 'INTEGRATION_CALL',
        integrationId: 'int-1',
        inputs: {
          static: { query: 'test' },
        },
        outputs: {
          stateKeys: ['apiResult'],
        },
      } as unknown as WorkflowStep;

      const result = await executor.executeStep(step);

      expect(result.status).toBe('success');
      expect(integrationManager.executeIntegration).toHaveBeenCalled();
    });

    it('should collect integration observations', async () => {
      const step = {
        id: 'step-1',
        name: 'Integration Step',
        stepType: 'INTEGRATION_CALL',
        integrationId: 'int-1',
        inputs: { static: {} },
        outputs: { stateKeys: [] },
      } as unknown as WorkflowStep;

      await executor.executeStep(step);

      const observations = executor.getIntegrationObservations();
      expect(observations.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should return failure result on error', async () => {
      vi.mocked(agentManager.invokeAgent).mockRejectedValue(
        new Error('Agent failed')
      );

      const step = {
        id: 'step-1',
        name: 'Failing Step',
        stepType: 'AGENT_INVOCATION',
        agentId: 'agent-1',
        action: 'fail',
        inputs: { static: {} },
        outputs: { stateKeys: [] },
      } as unknown as WorkflowStep;

      const result = await executor.executeStep(step);

      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Agent failed');
    });
  });
});
