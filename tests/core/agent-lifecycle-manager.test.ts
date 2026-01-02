/**
 * Agent Lifecycle Manager Tests (MOD-007)
 *
 * Tests for the complete agent lifecycle management including:
 * - Agent resolution from definitions
 * - Agent invocation with prompt rendering
 * - State machine transitions
 * - Metrics tracking
 * - Termination and cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { ExecutionContext, LLMClient, LLMRequest, LLMResponse } from '../../src/types/execution.js';
import type { LLMInvocationSpec, WorkflowStep, AgentDefinition as PlanAgentDefinition } from '../../src/types/plan.js';
import type { AgentId, DurationMs } from '../../src/types/common.js';
import {
  AgentLifecycleManager,
  createAgentLifecycleManager,
  AgentInstance,
  AgentState,
  AgentStateError,
  createInvocationSpec,
  InvocationResult,
  isSuccessfulInvocation,
  renderPromptTemplate,
  extractVariables,
  validateTemplateSyntax,
  createMetrics,
  createSuccessResult,
  createErrorResult,
  createRetryableError,
  createFatalError,
} from '../../src/core/agent-lifecycle-manager.js';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a mock LLM client for testing
 */
function createMockLLMClient(overrides: Partial<LLMClient> = {}): LLMClient {
  return {
    validateModel: vi.fn().mockResolvedValue(true),
    invoke: vi.fn().mockResolvedValue({
      content: 'Test response content',
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: 'stop',
      latencyMs: 250,
      modelId: 'test-model',
    }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Creates a mock LLM client factory
 */
function createMockLLMClientFactory() {
  const mockClient = createMockLLMClient();
  return {
    factory: {
      createClient: vi.fn().mockResolvedValue(mockClient),
    },
    mockClient,
  };
}

/**
 * Creates a mock execution context
 */
function createMockExecutionContext(): ExecutionContext {
  return {
    executionId: randomUUID() as any,
    planRef: {
      planId: randomUUID(),
      planHash: 'a'.repeat(64),
    },
    tenantId: 'test-tenant',
    stateNamespace: 'test-namespace',
    randomGenerator: {
      initialSeed: BigInt(12345),
      next: vi.fn().mockReturnValue(0.5),
      nextInt: vi.fn().mockReturnValue(42),
      nextBytes: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      getState: vi.fn().mockReturnValue({ seed: BigInt(12345), callCount: 0, state: {} }),
      currentSeed: vi.fn().mockReturnValue(BigInt(12345)),
    },
    startTime: new Date(),
    resourceLimits: {},
    maxDuration: 3600000,
    isolationLevel: 'read_committed',
  } as ExecutionContext;
}

/**
 * Creates a test agent definition
 */
function createTestAgentDefinition(overrides: Partial<PlanAgentDefinition> = {}): PlanAgentDefinition {
  return {
    agentId: 'test-agent-1' as AgentId,
    agentType: 'CONVERSATIONAL',
    name: 'Test Agent',
    description: 'A test agent for unit tests',
    configuration: {
      parameters: { maxTurns: 10 },
    },
    invocationSpec: {
      provider: 'ANTHROPIC',
      modelId: 'claude-3-opus',
      promptTemplate: 'You are a helpful assistant. {{task}}',
      maxTokens: 1000,
      temperature: 0.7,
      systemPrompt: 'You are a helpful AI assistant.',
    },
    ...overrides,
  } as PlanAgentDefinition;
}

/**
 * Creates a test workflow step
 */
function createTestWorkflowStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    stepId: 'step-1' as any,
    stepType: 'AGENT_INVOCATION',
    name: 'Test Step',
    agentRef: 'test-agent-1' as any,
    inputs: { task: 'Explain quantum computing' },
    critical: true,
    ...overrides,
  } as WorkflowStep;
}

// =============================================================================
// Agent Instance Tests
// =============================================================================

describe('AgentInstance', () => {
  let mockLLMClient: LLMClient;
  let agent: AgentInstance;

  beforeEach(() => {
    mockLLMClient = createMockLLMClient();
    agent = new AgentInstance({
      agentId: 'test-agent' as AgentId,
      agentType: 'CONVERSATIONAL',
      configuration: { maxTurns: 10 },
      invocationSpec: {
        modelId: 'claude-3-opus',
        provider: 'ANTHROPIC',
        promptTemplate: 'Hello {{name}}',
        maxTokens: 1000,
        temperature: 0.7,
      },
      llmClient: mockLLMClient,
      stateNamespace: 'test:namespace',
      initialState: 'CREATED',
    });
  });

  describe('State Machine', () => {
    it('should start in CREATED state', () => {
      expect(agent.state).toBe('CREATED');
      expect(agent.isReady()).toBe(false);
      expect(agent.isInvoking()).toBe(false);
      expect(agent.isTerminated()).toBe(false);
    });

    it('should transition from CREATED to READY on initialize', async () => {
      await agent.initialize();
      expect(agent.state).toBe('READY');
      expect(agent.isReady()).toBe(true);
    });

    it('should transition from READY to INVOKING on beginInvocation', async () => {
      await agent.initialize();
      agent.beginInvocation(randomUUID());
      expect(agent.state).toBe('INVOKING');
      expect(agent.isInvoking()).toBe(true);
    });

    it('should transition from INVOKING back to READY on completeInvocation', async () => {
      await agent.initialize();
      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        latencyMs: 100,
        modelId: 'test',
      });
      expect(agent.state).toBe('READY');
    });

    it('should transition to TERMINATED on terminate', async () => {
      await agent.initialize();
      await agent.terminate();
      expect(agent.state).toBe('TERMINATED');
      expect(agent.isTerminated()).toBe(true);
    });

    it('should throw on invalid state transition', async () => {
      await agent.initialize();
      expect(() => agent.transitionTo('CREATED')).toThrow(AgentStateError);
    });

    it('should not allow invocation when not ready', () => {
      expect(() => agent.beginInvocation(randomUUID())).toThrow(AgentStateError);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track invocation metrics', async () => {
      await agent.initialize();

      // First invocation
      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
        latencyMs: 250,
        modelId: 'test',
      });

      const metrics = agent.metrics;
      expect(metrics.invocationCount).toBe(1);
      expect(metrics.successCount).toBe(1);
      expect(metrics.totalInputTokens).toBe(100);
      expect(metrics.totalOutputTokens).toBe(50);
      expect(metrics.totalLatencyMs).toBe(250);
      expect(metrics.errorCount).toBe(0);
    });

    it('should track error metrics', async () => {
      await agent.initialize();

      agent.beginInvocation(randomUUID());
      agent.completeInvocation(false);

      const metrics = agent.metrics;
      expect(metrics.invocationCount).toBe(1);
      expect(metrics.successCount).toBe(0);
      expect(metrics.errorCount).toBe(1);
    });

    it('should calculate average latency correctly', async () => {
      await agent.initialize();

      // Two invocations with different latencies
      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
        latencyMs: 200,
        modelId: 'test',
      });

      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
        latencyMs: 400,
        modelId: 'test',
      });

      expect(agent.getAverageLatencyMs()).toBe(300);
    });

    it('should calculate success rate correctly', async () => {
      await agent.initialize();

      // 2 successes, 1 failure
      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
        latencyMs: 100,
        modelId: 'test',
      });

      agent.beginInvocation(randomUUID());
      agent.completeInvocation(false);

      agent.beginInvocation(randomUUID());
      agent.completeInvocation(true, {
        content: 'test',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
        latencyMs: 100,
        modelId: 'test',
      });

      expect(agent.getSuccessRate()).toBeCloseTo(0.667, 2);
    });
  });

  describe('LLM Request Creation', () => {
    it('should create correct LLM request', () => {
      const request = agent.createLLMRequest('Hello, world!');

      expect(request.model).toBe('claude-3-opus');
      expect(request.prompt).toBe('Hello, world!');
      expect(request.maxTokens).toBe(1000);
      expect(request.temperature).toBe(0.7);
    });

    it('should include seed override when provided', () => {
      const request = agent.createLLMRequest('Hello', BigInt(12345));
      expect(request.seed).toBe(BigInt(12345));
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON correctly', async () => {
      await agent.initialize();
      const json = agent.toJSON();

      expect(json.agentId).toBe('test-agent');
      expect(json.agentType).toBe('CONVERSATIONAL');
      expect(json.state).toBe('READY');
      expect(json.configuration).toEqual({ maxTurns: 10 });
    });
  });
});

// =============================================================================
// Prompt Renderer Tests
// =============================================================================

describe('PromptRenderer', () => {
  describe('Variable Extraction', () => {
    it('should extract simple variables', () => {
      const template = 'Hello {{name}}, you are {{age}} years old.';
      const variables = extractVariables(template);
      expect(variables).toEqual(['name', 'age']);
    });

    it('should extract step output variables', () => {
      const template = 'Previous result: {{step.output[step-1]}}';
      const variables = extractVariables(template);
      expect(variables).toEqual(['step.output[step-1]']);
    });

    it('should extract context variables', () => {
      const template = 'Execution: {{context.executionId}}';
      const variables = extractVariables(template);
      expect(variables).toEqual(['context.executionId']);
    });

    it('should extract agent variables', () => {
      const template = 'Agent: {{agent.name}} ({{agent.id}})';
      const variables = extractVariables(template);
      expect(variables).toEqual(['agent.name', 'agent.id']);
    });
  });

  describe('Template Validation', () => {
    it('should validate correct templates', () => {
      const result = validateTemplateSyntax('Hello {{name}}');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect unbalanced braces', () => {
      const result = validateTemplateSyntax('Hello {{name} world');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect empty variable names', () => {
      const result = validateTemplateSyntax('Hello {{}}');
      expect(result.valid).toBe(false);
    });
  });

  describe('Template Rendering', () => {
    const defaultContext = {
      executionId: 'exec-123',
      planId: 'plan-456',
      stepId: 'step-1',
      stepSequence: 1,
      startTime: new Date(),
      currentTime: new Date(),
      elapsedMs: 1000,
    };

    const defaultAgent = {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      agentType: 'CONVERSATIONAL',
      invocationCount: 5,
      config: { setting: 'value' },
    };

    it('should render simple input variables', () => {
      const result = renderPromptTemplate(
        'Hello {{name}}, your task is: {{task}}',
        { name: 'Alice', task: 'write code' },
        {},
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Hello Alice, your task is: write code');
      expect(result.resolvedVariables).toContain('name');
      expect(result.resolvedVariables).toContain('task');
    });

    it('should render step output variables', () => {
      const result = renderPromptTemplate(
        'Previous result: {{step.output[step-1]}}',
        {},
        { 'step-1': 'Success!' },
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Previous result: Success!');
    });

    it('should render nested step output fields', () => {
      const result = renderPromptTemplate(
        'Score: {{step.output[step-1].score}}',
        {},
        { 'step-1': { score: 95, grade: 'A' } },
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Score: 95');
    });

    it('should render context variables', () => {
      const result = renderPromptTemplate(
        'Execution ID: {{context.executionId}}',
        {},
        {},
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Execution ID: exec-123');
    });

    it('should render agent variables', () => {
      const result = renderPromptTemplate(
        'Agent {{agent.name}} (invocations: {{agent.invocationCount}})',
        {},
        {},
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Agent Test Agent (invocations: 5)');
    });

    it('should throw on missing variables by default', () => {
      expect(() => {
        renderPromptTemplate(
          'Hello {{missingVariable}}',
          {},
          {},
          defaultContext,
          defaultAgent
        );
      }).toThrow();
    });

    it('should use default value when configured', () => {
      const result = renderPromptTemplate(
        'Hello {{missingVariable}}',
        {},
        {},
        defaultContext,
        defaultAgent,
        { throwOnMissing: false, defaultValue: '[UNKNOWN]' }
      );

      expect(result.prompt).toBe('Hello [UNKNOWN]');
      expect(result.missingVariables).toContain('missingVariable');
    });

    it('should handle JSON objects in templates', () => {
      const result = renderPromptTemplate(
        'Data: {{data}}',
        { data: { key: 'value', num: 42 } },
        {},
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Data: {"key":"value","num":42}');
    });

    it('should handle arrays in templates', () => {
      const result = renderPromptTemplate(
        'Items: {{items}}',
        { items: ['a', 'b', 'c'] },
        {},
        defaultContext,
        defaultAgent
      );

      expect(result.prompt).toBe('Items: ["a","b","c"]');
    });
  });
});

// =============================================================================
// Invocation Result Tests
// =============================================================================

describe('InvocationResult', () => {
  describe('Factory Functions', () => {
    it('should create success result', () => {
      const result = createSuccessResult({
        invocationId: randomUUID(),
        output: 'Test output',
        metrics: createMetrics({
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 250,
          modelUsed: 'test-model',
        }),
        finishReason: 'stop',
        randomSeedUsed: 12345,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      expect(isSuccessfulInvocation(result)).toBe(true);
      expect(result.output).toBe('Test output');
      expect(result.metrics.totalTokens).toBe(150);
    });

    it('should create error result', () => {
      const result = createErrorResult({
        invocationId: randomUUID(),
        error: createFatalError('TEST_ERROR', 'Test error message'),
        randomSeedUsed: 12345,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      expect(isSuccessfulInvocation(result)).toBe(false);
      expect(result.error?.code).toBe('TEST_ERROR');
      expect(result.error?.retryable).toBe(false);
    });

    it('should create retryable error', () => {
      const error = createRetryableError('RATE_LIMIT', 'Rate limited', 1000);
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(1000);
    });
  });

  describe('Metrics', () => {
    it('should calculate total tokens correctly', () => {
      const metrics = createMetrics({
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 250,
        modelUsed: 'test-model',
      });

      expect(metrics.totalTokens).toBe(150);
    });
  });
});

// =============================================================================
// Agent Lifecycle Manager Tests
// =============================================================================

describe('AgentLifecycleManager', () => {
  let manager: AgentLifecycleManager;
  let mockClientFactory: ReturnType<typeof createMockLLMClientFactory>;

  beforeEach(() => {
    mockClientFactory = createMockLLMClientFactory();
    manager = createAgentLifecycleManager({
      llmClientFactory: mockClientFactory.factory,
    });
  });

  describe('Agent Resolution', () => {
    it('should resolve agent from definition', async () => {
      const agentDef = createTestAgentDefinition();
      const result = await manager.resolveAgent(agentDef, randomUUID());

      expect(result.agent).toBeDefined();
      expect(result.agent.agentId).toBe('test-agent-1');
      expect(result.agent.isReady()).toBe(true);
      expect(result.validationErrors).toHaveLength(0);
    });

    it('should create LLM client via factory', async () => {
      const agentDef = createTestAgentDefinition();
      await manager.resolveAgent(agentDef, randomUUID());

      expect(mockClientFactory.factory.createClient).toHaveBeenCalled();
    });

    it('should store resolved agent', async () => {
      const agentDef = createTestAgentDefinition();
      await manager.resolveAgent(agentDef, randomUUID());

      const agent = manager.getAgent('test-agent-1');
      expect(agent).toBeDefined();
    });

    it('should handle model validation failure', async () => {
      mockClientFactory.mockClient.validateModel = vi.fn().mockResolvedValue(false);

      const agentDef = createTestAgentDefinition();
      const result = await manager.resolveAgent(agentDef, randomUUID());

      expect(result.validationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Agent Invocation', () => {
    let ctx: ExecutionContext;
    let agent: AgentInstance;

    beforeEach(async () => {
      ctx = createMockExecutionContext();
      const agentDef = createTestAgentDefinition();
      const resolution = await manager.resolveAgent(agentDef, ctx.executionId as string);
      agent = resolution.agent;
    });

    it('should invoke agent and return result', async () => {
      const step = createTestWorkflowStep();
      const stepOutputs = {
        getOutput: () => undefined,
        getAllOutputs: () => ({}),
      };

      const result = await manager.invoke(ctx, agent, step, stepOutputs);

      expect(isSuccessfulInvocation(result)).toBe(true);
      expect(result.output).toBe('Test response content');
      expect(result.metrics.inputTokens).toBe(100);
      expect(result.metrics.outputTokens).toBe(50);
    });

    it('should use deterministic seed for reproducibility', async () => {
      const step = createTestWorkflowStep();
      const stepOutputs = {
        getOutput: () => undefined,
        getAllOutputs: () => ({}),
      };

      const result = await manager.invoke(ctx, agent, step, stepOutputs);

      expect(result.randomSeedUsed).toBeDefined();
      expect(typeof result.randomSeedUsed).toBe('number');
    });

    it('should track invocation in history', async () => {
      const step = createTestWorkflowStep();
      const stepOutputs = {
        getOutput: () => undefined,
        getAllOutputs: () => ({}),
      };

      await manager.invoke(ctx, agent, step, stepOutputs);
      const history = manager.getInvocationHistory('test-agent-1');

      expect(history).toHaveLength(1);
    });

    it('should handle invocation errors gracefully', async () => {
      mockClientFactory.mockClient.invoke = vi.fn().mockRejectedValue(
        new Error('LLM service unavailable')
      );

      const step = createTestWorkflowStep();
      const stepOutputs = {
        getOutput: () => undefined,
        getAllOutputs: () => ({}),
      };

      const result = await manager.invoke(ctx, agent, step, stepOutputs);

      expect(isSuccessfulInvocation(result)).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Agent Termination', () => {
    it('should terminate agent and close LLM client', async () => {
      const agentDef = createTestAgentDefinition();
      const resolution = await manager.resolveAgent(agentDef, randomUUID());

      await manager.terminateAgent(resolution.agent);

      expect(resolution.agent.isTerminated()).toBe(true);
      expect(mockClientFactory.mockClient.close).toHaveBeenCalled();
    });

    it('should remove agent from manager after termination', async () => {
      const agentDef = createTestAgentDefinition();
      const resolution = await manager.resolveAgent(agentDef, randomUUID());

      await manager.terminateAgent(resolution.agent);

      expect(manager.getAgent('test-agent-1')).toBeUndefined();
    });

    it('should terminate all agents', async () => {
      const agentDef1 = createTestAgentDefinition({ agentId: 'agent-1' as AgentId });
      const agentDef2 = createTestAgentDefinition({ agentId: 'agent-2' as AgentId });

      await manager.resolveAgent(agentDef1, randomUUID());
      await manager.resolveAgent(agentDef2, randomUUID());

      await manager.terminateAllAgents();

      expect(manager.getAllAgents().size).toBe(0);
    });
  });

  describe('Aggregate Metrics', () => {
    it('should calculate aggregate metrics across agents', async () => {
      const ctx = createMockExecutionContext();
      const agentDef = createTestAgentDefinition();
      const resolution = await manager.resolveAgent(agentDef, ctx.executionId as string);

      const step = createTestWorkflowStep();
      const stepOutputs = {
        getOutput: () => undefined,
        getAllOutputs: () => ({}),
      };

      // Multiple invocations
      await manager.invoke(ctx, resolution.agent, step, stepOutputs);
      await manager.invoke(ctx, resolution.agent, step, stepOutputs);

      const aggregateMetrics = manager.getAggregateMetrics();

      expect(aggregateMetrics.totalInvocations).toBe(2);
      expect(aggregateMetrics.totalTokens).toBe(300); // (100 + 50) * 2
      expect(aggregateMetrics.successRate).toBe(1.0);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Agent Lifecycle Integration', () => {
  it('should handle complete agent lifecycle', async () => {
    const mockClientFactory = createMockLLMClientFactory();
    const manager = createAgentLifecycleManager({
      llmClientFactory: mockClientFactory.factory,
    });

    const ctx = createMockExecutionContext();
    const agentDef = createTestAgentDefinition();

    // 1. Resolve agent
    const resolution = await manager.resolveAgent(agentDef, ctx.executionId as string);
    expect(resolution.agent.state).toBe('READY');

    // 2. Invoke agent multiple times
    const step = createTestWorkflowStep();
    const stepOutputs = {
      getOutput: () => undefined,
      getAllOutputs: () => ({}),
    };

    for (let i = 0; i < 3; i++) {
      const result = await manager.invoke(ctx, resolution.agent, step, stepOutputs);
      expect(isSuccessfulInvocation(result)).toBe(true);
    }

    // 3. Check metrics
    const metrics = resolution.agent.metrics;
    expect(metrics.invocationCount).toBe(3);
    expect(metrics.successCount).toBe(3);

    // 4. Terminate
    await manager.terminateAgent(resolution.agent);
    expect(resolution.agent.state).toBe('TERMINATED');

    // 5. Verify cleanup
    expect(manager.getAgent(agentDef.agentId as string)).toBeUndefined();
  });

  it('should maintain determinism across invocations', async () => {
    const mockClientFactory = createMockLLMClientFactory();
    const manager = createAgentLifecycleManager({
      llmClientFactory: mockClientFactory.factory,
    });

    const ctx = createMockExecutionContext();
    const agentDef = createTestAgentDefinition();
    const resolution = await manager.resolveAgent(agentDef, ctx.executionId as string);

    const step = createTestWorkflowStep();
    const stepOutputs = {
      getOutput: () => undefined,
      getAllOutputs: () => ({}),
    };

    // Collect seeds from multiple invocations
    const seeds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await manager.invoke(ctx, resolution.agent, step, stepOutputs);
      seeds.push(result.randomSeedUsed);
    }

    // Seeds should be deterministic (based on context random generator)
    expect(seeds[0]).toBeDefined();
    expect(seeds[1]).toBeDefined();
    expect(seeds[2]).toBeDefined();
  });
});
