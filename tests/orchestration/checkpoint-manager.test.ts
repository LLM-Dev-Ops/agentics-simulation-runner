/**
 * Tests for Checkpoint Manager
 *
 * Tests checkpoint creation, restoration, and storage functionality.
 *
 * @module tests/orchestration/checkpoint-manager
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
import type { UUID, SHA256Hash, ISO8601Timestamp, ResourceLimits } from '../../src/types/common.js';
import {
  ExecutionCheckpointManager,
  InMemoryCheckpointStorage,
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
      tokensConsumed: 100,
      activeAgents: 2,
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

function createMockAgentContext(agentId: string): AgentContext {
  return {
    agentId,
    executionContext: {} as ExecutionContext,
    status: 'ready',
    invocationCount: 5,
    totalTokensConsumed: 500,
    workingMemory: new Map([['key1', 'value1'], ['key2', 'value2']]),
    allowedStateKeys: [],
    invokeLLM: vi.fn(),
    recordAction: vi.fn(),
    getMetrics: () => ({
      invocationCount: 5,
      totalTokensConsumed: 500,
      averageLatencyMs: 100,
      errorCount: 0,
    }),
  };
}

function createMockExecutionContext(): ExecutionContext {
  const agentContexts = new Map<string, AgentContext>();
  agentContexts.set('agent-1', createMockAgentContext('agent-1'));
  agentContexts.set('agent-2', createMockAgentContext('agent-2'));

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
    cancel: vi.fn(),
    isCancelled: () => false,
    getCancellationReason: () => undefined,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('InMemoryCheckpointStorage', () => {
  let storage: InMemoryCheckpointStorage;
  const executionId = 'exec-123' as UUID;

  beforeEach(() => {
    storage = new InMemoryCheckpointStorage();
  });

  describe('store', () => {
    it('should store a checkpoint', async () => {
      const checkpoint = {
        checkpointId: 'cp-1' as UUID,
        label: 'test',
        executionId,
        sequenceNumber: 1,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
        randomGeneratorState: { state: 12345 },
        agentStates: {},
        stateData: { key: 'value' },
      };

      await storage.store(executionId, checkpoint);

      const retrieved = await storage.retrieve(executionId, checkpoint.checkpointId);
      expect(retrieved).toEqual(checkpoint);
    });
  });

  describe('list', () => {
    it('should list checkpoints in sequence order', async () => {
      const cp1 = {
        checkpointId: 'cp-1' as UUID,
        label: 'first',
        executionId,
        sequenceNumber: 1,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
        randomGeneratorState: {},
        agentStates: {},
        stateData: {},
      };

      const cp2 = {
        checkpointId: 'cp-2' as UUID,
        label: 'second',
        executionId,
        sequenceNumber: 2,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'def456abc123'.repeat(5).substring(0, 64) as SHA256Hash,
        randomGeneratorState: {},
        agentStates: {},
        stateData: {},
      };

      await storage.store(executionId, cp2);
      await storage.store(executionId, cp1);

      const list = await storage.list(executionId);

      expect(list.length).toBe(2);
      expect(list[0].sequenceNumber).toBe(1);
      expect(list[1].sequenceNumber).toBe(2);
    });

    it('should return empty array for unknown execution', async () => {
      const list = await storage.list('unknown' as UUID);
      expect(list).toEqual([]);
    });
  });

  describe('getLatest', () => {
    it('should return the checkpoint with highest sequence number', async () => {
      const cp1 = {
        checkpointId: 'cp-1' as UUID,
        label: 'first',
        executionId,
        sequenceNumber: 1,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
        randomGeneratorState: {},
        agentStates: {},
        stateData: {},
      };

      const cp3 = {
        checkpointId: 'cp-3' as UUID,
        label: 'third',
        executionId,
        sequenceNumber: 3,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'xyz789'.repeat(10).substring(0, 64) as SHA256Hash,
        randomGeneratorState: {},
        agentStates: {},
        stateData: {},
      };

      await storage.store(executionId, cp1);
      await storage.store(executionId, cp3);

      const latest = await storage.getLatest(executionId);

      expect(latest?.checkpointId).toBe('cp-3');
      expect(latest?.sequenceNumber).toBe(3);
    });

    it('should return undefined for unknown execution', async () => {
      const latest = await storage.getLatest('unknown' as UUID);
      expect(latest).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete a checkpoint', async () => {
      const checkpoint = {
        checkpointId: 'cp-1' as UUID,
        label: 'test',
        executionId,
        sequenceNumber: 1,
        createdAt: new Date().toISOString() as ISO8601Timestamp,
        stateHash: 'abc123def456'.repeat(5).substring(0, 64) as SHA256Hash,
        randomGeneratorState: {},
        agentStates: {},
        stateData: {},
      };

      await storage.store(executionId, checkpoint);
      const deleted = await storage.delete(executionId, checkpoint.checkpointId);

      expect(deleted).toBe(true);

      const retrieved = await storage.retrieve(executionId, checkpoint.checkpointId);
      expect(retrieved).toBeUndefined();
    });

    it('should return false for non-existent checkpoint', async () => {
      const deleted = await storage.delete(executionId, 'unknown' as UUID);
      expect(deleted).toBe(false);
    });
  });
});

describe('ExecutionCheckpointManager', () => {
  let ctx: ExecutionContext;
  let manager: ExecutionCheckpointManager;
  const executionId = 'exec-123' as UUID;

  beforeEach(() => {
    ctx = createMockExecutionContext();
    manager = createCheckpointManager(executionId);
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint with state data', async () => {
      // Add some state
      await ctx.stateNamespace.set('key1', 'value1');
      await ctx.stateNamespace.set('key2', { nested: 'data' });

      const checkpoint = await manager.createCheckpoint(ctx, {
        label: 'test-checkpoint',
        stepId: 'step-1',
        captureState: true,
        captureMetrics: true,
        captureVectorMemory: false,
      });

      expect(checkpoint.label).toBe('test-checkpoint');
      expect(checkpoint.stepId).toBe('step-1');
      expect(checkpoint.sequenceNumber).toBe(1);
      expect(checkpoint.stateHash).toBeDefined();
      expect(checkpoint.randomGeneratorState).toBeDefined();
    });

    it('should capture agent states', async () => {
      const checkpoint = await manager.createCheckpoint(ctx, {
        label: 'agent-checkpoint',
        captureState: true,
        captureMetrics: true,
        captureVectorMemory: false,
      });

      expect(checkpoint.agentStates).toBeDefined();
      expect(checkpoint.agentStates['agent-1']).toBeDefined();
      expect(checkpoint.agentStates['agent-2']).toBeDefined();
    });

    it('should capture metrics when requested', async () => {
      const checkpoint = await manager.createCheckpoint(ctx, {
        label: 'metrics-checkpoint',
        captureState: false,
        captureMetrics: true,
        captureVectorMemory: false,
      });

      expect(checkpoint.metrics).toBeDefined();
      expect(checkpoint.metrics?.tokensConsumed).toBe(100);
      expect(checkpoint.metrics?.agentsActive).toBe(2);
    });

    it('should increment sequence number', async () => {
      const cp1 = await manager.createCheckpoint(ctx, {
        label: 'first',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      const cp2 = await manager.createCheckpoint(ctx, {
        label: 'second',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      expect(cp1.sequenceNumber).toBe(1);
      expect(cp2.sequenceNumber).toBe(2);
    });
  });

  describe('getCreatedCheckpoints', () => {
    it('should track created checkpoints', async () => {
      await manager.createCheckpoint(ctx, {
        label: 'first',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      await manager.createCheckpoint(ctx, {
        label: 'second',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      const created = manager.getCreatedCheckpoints();

      expect(created.length).toBe(2);
      expect(created[0].label).toBe('first');
      expect(created[1].label).toBe('second');
    });
  });

  describe('listCheckpoints', () => {
    it('should list all checkpoints', async () => {
      await manager.createCheckpoint(ctx, {
        label: 'first',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      await manager.createCheckpoint(ctx, {
        label: 'second',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      const list = await manager.listCheckpoints();

      expect(list.length).toBe(2);
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return the most recent checkpoint', async () => {
      await manager.createCheckpoint(ctx, {
        label: 'first',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      await manager.createCheckpoint(ctx, {
        label: 'latest',
        captureState: false,
        captureMetrics: false,
        captureVectorMemory: false,
      });

      const latest = await manager.getLatestCheckpoint();

      expect(latest?.label).toBe('latest');
      expect(latest?.sequenceNumber).toBe(2);
    });
  });
});
