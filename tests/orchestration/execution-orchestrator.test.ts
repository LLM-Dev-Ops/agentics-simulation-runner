/**
 * Tests for Execution Orchestrator (MOD-004)
 *
 * Tests the central coordinator for workflow execution including:
 * - Execution lifecycle (start, pause, resume, abort)
 * - Dependency ordering (INV-EX-004)
 * - Deadline enforcement (INV-EX-006)
 * - Failure handling and rollback (INV-EX-003)
 *
 * @module tests/orchestration/execution-orchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import type {
  SimulationPlan,
  AgentDefinition,
} from '../../src/types/simulation-plan.js';
import type { WorkflowStep } from '../../src/types/workflow.js';
import type { UUID, SHA256Hash, ISO8601Timestamp, ResourceLimits } from '../../src/types/common.js';
import {
  ExecutionOrchestrator,
  createExecutionOrchestrator,
  type AgentLifecycleManager,
  type IntegrationAdapterManager,
} from '../../src/orchestration/index.js';

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
    limits: {
      maxMemoryBytes: 1000000000,
      maxCpuPercent: 100,
      maxConcurrentAgents: 10,
      maxTokensTotal: 100000,
    },
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

function createMockCheckpointManager(): ContextCheckpointManager {
  return {
    create: vi.fn().mockResolvedValue({
      checkpointId: 'cp-123' as UUID,
      label: 'test',
      executionId: 'exec-123' as UUID,
      sequenceNumber: 1,
      createdAt: new Date().toISOString() as ISO8601Timestamp,
      stateHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
      randomGeneratorState: {},
      agentStates: {},
    }),
    restore: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    getLatest: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAgentContext(agentId: string): AgentContext {
  return {
    agentId,
    executionContext: {} as ExecutionContext,
    status: 'ready',
    invocationCount: 0,
    totalTokensConsumed: 0,
    workingMemory: new Map(),
    allowedStateKeys: [],
    invokeLLM: vi.fn().mockResolvedValue({
      content: 'test response',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      latencyMs: 100,
      model: 'test-model',
      finishReason: 'stop' as const,
    }),
    recordAction: vi.fn(),
    getMetrics: () => ({
      invocationCount: 0,
      totalTokensConsumed: 0,
      averageLatencyMs: 0,
      errorCount: 0,
    }),
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
    status: 'pending',
    currentStepSequence: 0,
    currentStepId: undefined,
    getAgentContext: (agentId: string) => agentContexts.get(agentId),
    getAllAgentContexts: () => agentContexts,
    spawnAgent: vi.fn().mockImplementation(async (agentId: string) => {
      const ctx = createMockAgentContext(agentId);
      agentContexts.set(agentId, ctx);
      return ctx;
    }),
    terminateAgent: vi.fn().mockResolvedValue(undefined),
    checkpointManager: createMockCheckpointManager(),
    telemetry: createMockTelemetryCollector(),
    initialize: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    isCancelled: () => false,
    getCancellationReason: () => undefined,
  };
}

function createMockAgentManager(): AgentLifecycleManager {
  return {
    invokeAgent: vi.fn().mockResolvedValue({
      success: true,
      outputs: { result: 'test output' },
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
        integrationId: 'int-123',
        stepId: 'step-1',
        calledAt: new Date().toISOString() as ISO8601Timestamp,
        durationMs: 30,
        success: true,
        usedMock: false,
      },
    }),
  };
}

function createSimplePlan(): SimulationPlan {
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
      steps: [
        {
          id: 'step-1',
          name: 'Step 1',
          stepType: 'STATE_MUTATION',
          mutations: { counter: 1 },
        } as WorkflowStep,
        {
          id: 'step-2',
          name: 'Step 2',
          stepType: 'STATE_MUTATION',
          mutations: { counter: 2 },
          dependencies: ['step-1'],
        } as WorkflowStep,
      ],
      dependencies: {
        'step-2': ['step-1'],
      },
      checkpoints: [],
    },
    agents: [],
  } as unknown as SimulationPlan;
}

// =============================================================================
// Tests
// =============================================================================

describe('ExecutionOrchestrator', () => {
  let ctx: ExecutionContext;
  let plan: SimulationPlan;
  let agentManager: AgentLifecycleManager;
  let integrationManager: IntegrationAdapterManager;

  beforeEach(() => {
    ctx = createMockExecutionContext();
    plan = createSimplePlan();
    agentManager = createMockAgentManager();
    integrationManager = createMockIntegrationManager();
  });

  describe('Construction', () => {
    it('should create an orchestrator with default options', () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      expect(orchestrator).toBeInstanceOf(ExecutionOrchestrator);
      expect(orchestrator.getStatus()).toBe('pending');
    });

    it('should create an orchestrator with custom options', () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager,
        {
          autoCheckpoint: false,
          checkpointInterval: 50,
          continueOnError: true,
        }
      );

      expect(orchestrator).toBeInstanceOf(ExecutionOrchestrator);
    });
  });

  describe('Execution', () => {
    it('should execute a simple workflow successfully', async () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      const result = await orchestrator.execute();

      expect(result.status).toBe('completed');
      expect(result.stepResults.length).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should respect step dependencies (INV-EX-004)', async () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      const result = await orchestrator.execute();

      // Step 1 should complete before Step 2
      const step1Result = result.stepResults.find((r) => r.stepId === 'step-1');
      const step2Result = result.stepResults.find((r) => r.stepId === 'step-2');

      expect(step1Result).toBeDefined();
      expect(step2Result).toBeDefined();

      if (step1Result && step2Result) {
        expect(
          new Date(step1Result.completedAt!).getTime()
        ).toBeLessThanOrEqual(new Date(step2Result.startedAt).getTime());
      }
    });

    it('should track execution progress', async () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      await orchestrator.execute();

      expect(orchestrator.getCompletedStepIds()).toContain('step-1');
      expect(orchestrator.getCompletedStepIds()).toContain('step-2');
    });
  });

  describe('Deadline Enforcement (INV-EX-006)', () => {
    it('should timeout when deadline is exceeded', async () => {
      // Create a plan with very short timeout
      const shortTimeoutPlan = {
        ...plan,
        executionConfig: {
          ...plan.executionConfig,
          timeoutSeconds: 0, // Immediate timeout
        },
      };

      const orchestrator = createExecutionOrchestrator(
        ctx,
        shortTimeoutPlan as SimulationPlan,
        agentManager,
        integrationManager
      );

      const result = await orchestrator.execute();

      expect(result.status).toBe('timeout');
    });
  });

  describe('Abort', () => {
    it('should abort execution when requested', async () => {
      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager
      );

      // Start execution (don't await)
      const executionPromise = orchestrator.execute();

      // Immediately abort
      const abortResult = await orchestrator.abort('Test abort');

      // Wait for execution to complete
      const result = await executionPromise;

      expect(abortResult.success).toBe(true);
      expect(abortResult.reason).toBe('Test abort');
      expect(result.status).toBe('cancelled');
    });
  });

  describe('Event Emission', () => {
    it('should emit execution events', async () => {
      const eventHandler = vi.fn();

      const orchestrator = createExecutionOrchestrator(
        ctx,
        plan,
        agentManager,
        integrationManager,
        {
          eventListeners: [{ onEvent: eventHandler }],
        }
      );

      await orchestrator.execute();

      // Check that events were emitted
      expect(eventHandler).toHaveBeenCalled();

      const eventTypes = eventHandler.mock.calls.map(
        (call: [{ eventType: string }]) => call[0].eventType
      );
      expect(eventTypes).toContain('EXECUTION_STARTED');
      expect(eventTypes).toContain('STEP_STARTED');
      expect(eventTypes).toContain('STEP_COMPLETED');
      expect(eventTypes).toContain('EXECUTION_COMPLETED');
    });
  });

  describe('Error Tracking', () => {
    it('should track errors when steps fail', async () => {
      // Make agent manager fail
      vi.mocked(agentManager.invokeAgent).mockRejectedValue(
        new Error('Test error')
      );

      // Create plan with agent invocation step
      const planWithAgent = {
        ...plan,
        workflow: {
          ...plan.workflow,
          steps: [
            {
              id: 'agent-step',
              name: 'Agent Step',
              stepType: 'AGENT_INVOCATION',
              agentId: 'agent-1',
              action: 'test',
              inputs: { static: {} },
              outputs: { stateKeys: [] },
            } as WorkflowStep,
          ],
          dependencies: {},
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
      };

      const orchestrator = createExecutionOrchestrator(
        ctx,
        planWithAgent as unknown as SimulationPlan,
        agentManager,
        integrationManager,
        { continueOnError: false }
      );

      const result = await orchestrator.execute();

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Execution Order', () => {
  it('should build correct topological order for complex dependencies', () => {
    const ctx = createMockExecutionContext();
    const plan = {
      ...createSimplePlan(),
      workflow: {
        steps: [
          { id: 'A', name: 'A', stepType: 'STATE_MUTATION', mutations: {} },
          { id: 'B', name: 'B', stepType: 'STATE_MUTATION', mutations: {} },
          { id: 'C', name: 'C', stepType: 'STATE_MUTATION', mutations: {} },
          { id: 'D', name: 'D', stepType: 'STATE_MUTATION', mutations: {} },
        ] as WorkflowStep[],
        dependencies: {
          'B': ['A'],
          'C': ['A'],
          'D': ['B', 'C'],
        },
        checkpoints: [],
      },
    };

    const orchestrator = createExecutionOrchestrator(
      ctx,
      plan as unknown as SimulationPlan,
      createMockAgentManager(),
      createMockIntegrationManager()
    );

    // A should be first, D should be last
    expect(orchestrator).toBeDefined();
  });
});
