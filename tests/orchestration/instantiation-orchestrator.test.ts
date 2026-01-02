/**
 * Comprehensive Test Suite for MOD-003 Instantiation Orchestrator
 *
 * Tests the complete instantiation flow including:
 * - Context Factory (4.1)
 * - State Initializer (4.2)
 * - Agent Resolver (4.3)
 * - Connection Establisher (4.4)
 * - Full Orchestrator Integration
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4
 * - SPARC_ARCHITECTURE.md MOD-003
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentId, IntegrationId, UUID } from '../../src/types/common.js';
import type { SimulationPlan, AgentType, LLMProvider } from '../../src/types/plan.js';
import type { ExecutionContext, StateHandle, AgentInstance } from '../../src/types/execution.js';

import {
  createExecutionContext,
  validateExecutionContext,
  type ExecutionContextConfig,
} from '../../src/orchestration/context-factory.js';

import {
  StateInitializer,
  createStateInitializer,
  countTotalSteps,
  flattenSteps,
  validateDependencyGraph,
} from '../../src/orchestration/state-initializer.js';

import {
  AgentResolver,
  createAgentResolver,
  validateAgentConfiguration,
  agentRequiresTools,
  getDefaultAgentConfig,
  AgentResolutionError,
} from '../../src/orchestration/agent-resolver.js';

import {
  ConnectionEstablisher,
  createConnectionEstablisher,
  validateIntegrationDefinition,
  getSupportedAdapterTypes,
  ConnectionEstablishmentError,
  createMockSecureVault,
} from '../../src/orchestration/connection-establisher.js';

import {
  InstantiationOrchestrator,
  createInstantiationOrchestrator,
} from '../../src/orchestration/instantiation-orchestrator.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a minimal valid simulation plan for testing
 */
function createTestPlan(overrides: Partial<SimulationPlan> = {}): SimulationPlan {
  const basePlan: SimulationPlan = {
    planId: 'test-plan-123',
    planVersion: '1.0.0',
    planHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    createdBy: {
      name: 'test-planner',
      version: '1.0.0',
      instanceId: 'planner-instance-1',
    },
    sourceIntent: {
      intentId: 'intent-123',
      intentHash: 'b'.repeat(64),
    },
    executionConfig: {
      maxDuration: 300000,
      resourceLimits: {
        maxMemoryBytes: 1024 * 1024 * 512,
        maxConcurrentAgents: 5,
      },
      concurrencyModel: 'PARALLEL',
      isolationLevel: 'READ_COMMITTED',
      deterministicSeed: BigInt(12345),
    },
    workflow: {
      steps: [
        {
          stepId: 'step-1',
          stepType: 'AGENT_INVOCATION',
          name: 'Test Step 1',
          agentRef: 'agent-1',
          inputs: {},
          critical: true,
        },
        {
          stepId: 'step-2',
          stepType: 'INTEGRATION_CALL',
          name: 'Test Step 2',
          integrationRef: 'integration-1',
          inputs: {},
          critical: false,
        },
      ],
      dependencies: {
        edges: [
          { from: 'step-1', to: 'step-2', type: 'REQUIRES' },
        ],
      },
      checkpoints: [
        {
          checkpointId: 'checkpoint-1',
          stepRef: 'step-1',
          name: 'After Step 1',
          captureState: true,
          captureMetrics: true,
        },
      ],
    },
    agents: [
      {
        agentId: 'agent-1',
        agentType: 'CONVERSATIONAL',
        name: 'Test Agent',
        configuration: {
          parameters: { maxTurns: 5 },
        },
        invocationSpec: {
          provider: 'ANTHROPIC',
          modelId: 'claude-3-sonnet-20240229',
          promptTemplate: 'Test prompt: {{input}}',
          maxTokens: 1024,
          temperature: 0.7,
        },
      },
    ],
    integrations: [
      {
        integrationId: 'integration-1',
        adapterType: 'HTTP_REST',
        name: 'Test Integration',
        connectionSpec: {
          baseUrl: 'https://api.example.com',
          credentialRef: 'test-api-key',
          timeout: 30000,
        },
        idempotent: true,
      },
    ],
    observability: {
      metricsToCapture: [],
      eventsToRecord: [],
      tracingConfig: {
        enabled: true,
        sampleRate: 1.0,
        propagateContext: true,
      },
    },
    validation: {
      preConditions: [],
      postConditions: [],
      invariants: [],
    },
  };

  return { ...basePlan, ...overrides };
}

// ============================================================================
// Context Factory Tests
// ============================================================================

describe('Context Factory', () => {
  describe('createExecutionContext', () => {
    it('should create a valid execution context', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.context.executionId).toBeTruthy();
      expect(result.context.planRef.planId).toBe(plan.planId);
      expect(result.context.planRef.planHash).toBe(plan.planHash);
      expect(result.context.tenantId).toBe('tenant-123');
      expect(result.stateNamespace).toContain('execution:');
    });

    it('should initialize deterministic random generator from seed', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      expect(result.context.randomGenerator).toBeDefined();
      expect(result.context.randomGenerator.initialSeed).toBe(plan.executionConfig.deterministicSeed);
    });

    it('should generate unique execution IDs', () => {
      const plan = createTestPlan();
      const result1 = createExecutionContext({ tenantId: 'tenant-123', plan });
      const result2 = createExecutionContext({ tenantId: 'tenant-123', plan });

      expect(result1.context.executionId).not.toBe(result2.context.executionId);
    });

    it('should apply resource limit overrides', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
        overrideResourceLimits: {
          maxConcurrentAgents: 10,
        },
      });

      expect(result.context.resourceLimits.maxConcurrentAgents).toBe(10);
    });

    it('should apply max duration override', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
        overrideMaxDuration: 600000,
      });

      expect(result.context.maxDuration).toBe(600000);
    });
  });

  describe('validateExecutionContext', () => {
    it('should validate a properly created context', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      expect(() => validateExecutionContext(result.context)).not.toThrow();
    });

    it('should throw on missing executionId', () => {
      const invalidContext = {
        planRef: { planId: 'test', planHash: 'hash' },
        stateNamespace: 'execution:test',
      } as ExecutionContext;

      expect(() => validateExecutionContext(invalidContext)).toThrow('missing executionId');
    });

    it('should throw on invalid namespace format', () => {
      const plan = createTestPlan();
      const result = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const invalidContext = {
        ...result.context,
        stateNamespace: 'invalid-namespace',
      };

      expect(() => validateExecutionContext(invalidContext)).toThrow('must start with "execution:"');
    });
  });
});

// ============================================================================
// State Initializer Tests
// ============================================================================

describe('State Initializer', () => {
  describe('countTotalSteps', () => {
    it('should count flat steps correctly', () => {
      const steps = [
        { stepId: '1', stepType: 'AGENT_INVOCATION', name: 'Step 1', inputs: {}, critical: true },
        { stepId: '2', stepType: 'AGENT_INVOCATION', name: 'Step 2', inputs: {}, critical: true },
      ];

      expect(countTotalSteps(steps as any)).toBe(2);
    });

    it('should count nested steps correctly', () => {
      const steps = [
        { stepId: '1', stepType: 'AGENT_INVOCATION', name: 'Step 1', inputs: {}, critical: true },
        {
          stepId: '2',
          stepType: 'PARALLEL_GROUP',
          name: 'Parallel',
          inputs: {},
          critical: true,
          subSteps: [
            { stepId: '2a', stepType: 'AGENT_INVOCATION', name: 'Step 2a', inputs: {}, critical: true },
            { stepId: '2b', stepType: 'AGENT_INVOCATION', name: 'Step 2b', inputs: {}, critical: true },
          ],
        },
      ];

      expect(countTotalSteps(steps as any)).toBe(4);
    });
  });

  describe('flattenSteps', () => {
    it('should flatten nested steps', () => {
      const steps = [
        { stepId: '1', stepType: 'AGENT_INVOCATION', name: 'Step 1', inputs: {}, critical: true },
        {
          stepId: '2',
          stepType: 'PARALLEL_GROUP',
          name: 'Parallel',
          inputs: {},
          critical: true,
          subSteps: [
            { stepId: '2a', stepType: 'AGENT_INVOCATION', name: 'Step 2a', inputs: {}, critical: true },
          ],
        },
      ];

      const flattened = flattenSteps(steps as any);
      expect(flattened).toHaveLength(3);
      expect(flattened.map((s) => s.stepId)).toEqual(['1', '2', '2a']);
    });
  });

  describe('validateDependencyGraph', () => {
    it('should validate a valid dependency graph', () => {
      const plan = createTestPlan();
      expect(() => validateDependencyGraph(plan)).not.toThrow();
    });

    it('should throw on invalid step reference in dependency', () => {
      const plan = createTestPlan({
        workflow: {
          ...createTestPlan().workflow,
          dependencies: {
            edges: [{ from: 'non-existent', to: 'step-1', type: 'REQUIRES' }],
          },
        },
      });

      expect(() => validateDependencyGraph(plan)).toThrow('non-existent step');
    });

    it('should detect dependency cycles', () => {
      const cyclicPlan = createTestPlan({
        workflow: {
          steps: [
            { stepId: 'a', stepType: 'AGENT_INVOCATION', name: 'A', inputs: {}, critical: true },
            { stepId: 'b', stepType: 'AGENT_INVOCATION', name: 'B', inputs: {}, critical: true },
            { stepId: 'c', stepType: 'AGENT_INVOCATION', name: 'C', inputs: {}, critical: true },
          ],
          dependencies: {
            edges: [
              { from: 'a', to: 'b', type: 'REQUIRES' },
              { from: 'b', to: 'c', type: 'REQUIRES' },
              { from: 'c', to: 'a', type: 'REQUIRES' }, // Creates cycle
            ],
          },
          checkpoints: [],
        },
      });

      expect(() => validateDependencyGraph(cyclicPlan)).toThrow('cycle detected');
    });
  });
});

// ============================================================================
// Agent Resolver Tests
// ============================================================================

describe('Agent Resolver', () => {
  let resolver: AgentResolver;

  beforeEach(() => {
    resolver = createAgentResolver();
  });

  describe('resolveAgentInstances', () => {
    it('should resolve valid agent definitions', async () => {
      const plan = createTestPlan();
      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await resolver.resolveAgentInstances(contextResult.context, plan);

      expect(result.agents.size).toBe(1);
      expect(result.validationErrors).toHaveLength(0);
      expect(result.agents.has('agent-1' as AgentId)).toBe(true);
    });

    it('should create agents with READY status', async () => {
      const plan = createTestPlan();
      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await resolver.resolveAgentInstances(contextResult.context, plan);
      const agent = result.agents.get('agent-1' as AgentId);

      expect(agent?.status).toBe('READY');
    });

    it('should report validation errors for unsupported agent types', async () => {
      const plan = createTestPlan({
        agents: [
          {
            agentId: 'agent-1',
            agentType: 'UNSUPPORTED' as AgentType,
            name: 'Invalid Agent',
            configuration: { parameters: {} },
            invocationSpec: {
              provider: 'ANTHROPIC',
              modelId: 'claude-3-sonnet-20240229',
              promptTemplate: 'Test',
              maxTokens: 1024,
              temperature: 0.7,
            },
          },
        ],
      });

      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await resolver.resolveAgentInstances(contextResult.context, plan);

      expect(result.agents.size).toBe(0);
      expect(result.validationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('validateAgentConfiguration', () => {
    it('should validate a valid agent configuration', () => {
      const agent = createTestPlan().agents[0];
      expect(() => validateAgentConfiguration(agent)).not.toThrow();
    });

    it('should throw on missing agentId', () => {
      const agent = { ...createTestPlan().agents[0], agentId: '' };
      expect(() => validateAgentConfiguration(agent)).toThrow('missing agentId');
    });

    it('should throw on invalid temperature', () => {
      const agent = {
        ...createTestPlan().agents[0],
        invocationSpec: {
          ...createTestPlan().agents[0].invocationSpec,
          temperature: 3.0,
        },
      };
      expect(() => validateAgentConfiguration(agent)).toThrow('temperature must be between');
    });
  });

  describe('agentRequiresTools', () => {
    it('should return true for TOOL_USE agents', () => {
      expect(agentRequiresTools('TOOL_USE')).toBe(true);
    });

    it('should return true for CODING agents', () => {
      expect(agentRequiresTools('CODING')).toBe(true);
    });

    it('should return false for CONVERSATIONAL agents', () => {
      expect(agentRequiresTools('CONVERSATIONAL')).toBe(false);
    });
  });

  describe('getDefaultAgentConfig', () => {
    it('should return config for CONVERSATIONAL agents', () => {
      const config = getDefaultAgentConfig('CONVERSATIONAL');
      expect(config).toHaveProperty('maxTurns');
      expect(config).toHaveProperty('contextWindowSize');
    });

    it('should return config for TOOL_USE agents', () => {
      const config = getDefaultAgentConfig('TOOL_USE');
      expect(config).toHaveProperty('maxToolCalls');
      expect(config).toHaveProperty('toolTimeout');
    });
  });
});

// ============================================================================
// Connection Establisher Tests
// ============================================================================

describe('Connection Establisher', () => {
  let establisher: ConnectionEstablisher;

  beforeEach(() => {
    establisher = createConnectionEstablisher();
  });

  describe('establishIntegrationConnections', () => {
    it('should establish connections for valid integrations', async () => {
      const plan = createTestPlan();
      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await establisher.establishIntegrationConnections(
        contextResult.context,
        plan
      );

      expect(result.connections.size).toBe(1);
      expect(result.connectionErrors).toHaveLength(0);
    });

    it('should create connections with CONNECTED status', async () => {
      const plan = createTestPlan();
      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await establisher.establishIntegrationConnections(
        contextResult.context,
        plan
      );

      const connection = result.connections.get('integration-1' as IntegrationId);
      expect(connection?.status).toBe('CONNECTED');
    });
  });

  describe('validateIntegrationDefinition', () => {
    it('should validate a valid integration definition', () => {
      const integration = createTestPlan().integrations[0];
      expect(() => validateIntegrationDefinition(integration)).not.toThrow();
    });

    it('should throw on missing integrationId', () => {
      const integration = { ...createTestPlan().integrations[0], integrationId: '' };
      expect(() => validateIntegrationDefinition(integration)).toThrow('missing integrationId');
    });

    it('should throw on missing credentialRef', () => {
      const integration = {
        ...createTestPlan().integrations[0],
        connectionSpec: {
          baseUrl: 'https://api.example.com',
          credentialRef: '',
        },
      };
      expect(() => validateIntegrationDefinition(integration)).toThrow('missing credentialRef');
    });
  });

  describe('getSupportedAdapterTypes', () => {
    it('should return all supported adapter types', () => {
      const types = getSupportedAdapterTypes();
      expect(types).toContain('HTTP_REST');
      expect(types).toContain('GRAPHQL');
      expect(types).toContain('GRPC');
      expect(types).toContain('DATABASE');
    });
  });

  describe('closeConnections', () => {
    it('should close all connections without error', async () => {
      const plan = createTestPlan();
      const contextResult = createExecutionContext({
        tenantId: 'tenant-123',
        plan,
      });

      const result = await establisher.establishIntegrationConnections(
        contextResult.context,
        plan
      );

      await expect(establisher.closeConnections(result.connections)).resolves.not.toThrow();
    });
  });
});

// ============================================================================
// Instantiation Orchestrator Integration Tests
// ============================================================================

// Skip integration tests that require a real database connection
// These tests can be run with a PostgreSQL instance available
describe.skip('Instantiation Orchestrator', () => {
  let orchestrator: InstantiationOrchestrator;

  beforeEach(() => {
    orchestrator = createInstantiationOrchestrator({
      enableStrictValidation: true,
      instantiationTimeout: 30000,
    });
  });

  afterEach(async () => {
    await orchestrator.close();
  });

  describe('instantiate', () => {
    it('should successfully instantiate a valid plan', async () => {
      const plan = createTestPlan();

      const result = await orchestrator.instantiate('tenant-123', plan);

      expect(result.success).toBe(true);
      expect(result.executionContext).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('should create complete execution context with all components', async () => {
      const plan = createTestPlan();

      const result = await orchestrator.instantiate('tenant-123', plan);

      expect(result.executionContext?.context).toBeDefined();
      expect(result.executionContext?.stateHandle).toBeDefined();
      expect(result.executionContext?.agents).toBeDefined();
      expect(result.executionContext?.connections).toBeDefined();
    });

    it('should track metrics for all instantiation phases', async () => {
      const plan = createTestPlan();

      const result = await orchestrator.instantiate('tenant-123', plan);

      expect(result.metrics.contextCreationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.stateInitializationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.agentResolutionMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.connectionEstablishmentMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should count total steps, agents, and connections', async () => {
      const plan = createTestPlan();

      const result = await orchestrator.instantiate('tenant-123', plan);

      expect(result.metrics.totalSteps).toBe(2);
      expect(result.metrics.totalAgents).toBe(1);
      expect(result.metrics.totalConnections).toBe(1);
    });

    it('should report agent resolution issues as warnings', async () => {
      const plan = createTestPlan({
        agents: [
          ...createTestPlan().agents,
          {
            agentId: 'bad-agent',
            agentType: 'UNSUPPORTED_TYPE' as AgentType,
            name: 'Bad Agent',
            configuration: { parameters: {} },
            invocationSpec: {
              provider: 'ANTHROPIC',
              modelId: 'claude-3-sonnet-20240229',
              promptTemplate: 'Test',
              maxTokens: 1024,
              temperature: 0.7,
            },
          },
        ],
      });

      const result = await orchestrator.instantiate('tenant-123', plan);

      // Should still succeed because at least one agent works
      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.metrics.failedAgents).toBe(1);
    });

    it('should fail if all agents fail to resolve', async () => {
      const plan = createTestPlan({
        agents: [
          {
            agentId: 'bad-agent',
            agentType: 'UNSUPPORTED_TYPE' as AgentType,
            name: 'Bad Agent',
            configuration: { parameters: {} },
            invocationSpec: {
              provider: 'ANTHROPIC',
              modelId: 'claude-3-sonnet-20240229',
              promptTemplate: 'Test',
              maxTokens: 1024,
              temperature: 0.7,
            },
          },
        ],
      });

      const result = await orchestrator.instantiate('tenant-123', plan);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.code === 'NO_AGENTS_AVAILABLE')).toBe(true);
    });
  });

  describe('teardown', () => {
    it('should successfully teardown an execution context', async () => {
      const plan = createTestPlan();
      const instantiateResult = await orchestrator.instantiate('tenant-123', plan);

      expect(instantiateResult.success).toBe(true);
      expect(instantiateResult.executionContext).toBeDefined();

      const teardownResult = await orchestrator.teardown(instantiateResult.executionContext!);

      expect(teardownResult.success).toBe(true);
      expect(teardownResult.cleanedUpResources).toContain('integration-connections');
      expect(teardownResult.cleanedUpResources).toContain('agent-instances');
    });

    it('should track teardown duration', async () => {
      const plan = createTestPlan();
      const instantiateResult = await orchestrator.instantiate('tenant-123', plan);

      const teardownResult = await orchestrator.teardown(instantiateResult.executionContext!);

      expect(teardownResult.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// Determinism Tests
// ============================================================================

describe('Determinism', () => {
  it('should produce same random sequence with same seed', () => {
    const plan = createTestPlan();

    const result1 = createExecutionContext({ tenantId: 'tenant-123', plan });
    const result2 = createExecutionContext({ tenantId: 'tenant-123', plan });

    // Generate 10 random values from each
    const values1: number[] = [];
    const values2: number[] = [];

    for (let i = 0; i < 10; i++) {
      values1.push(result1.context.randomGenerator.next());
      values2.push(result2.context.randomGenerator.next());
    }

    expect(values1).toEqual(values2);
  });

  it('should produce different sequences with different seeds', () => {
    const plan1 = createTestPlan({
      executionConfig: {
        ...createTestPlan().executionConfig,
        deterministicSeed: BigInt(12345),
      },
    });
    const plan2 = createTestPlan({
      executionConfig: {
        ...createTestPlan().executionConfig,
        deterministicSeed: BigInt(67890),
      },
    });

    const result1 = createExecutionContext({ tenantId: 'tenant-123', plan: plan1 });
    const result2 = createExecutionContext({ tenantId: 'tenant-123', plan: plan2 });

    const value1 = result1.context.randomGenerator.next();
    const value2 = result2.context.randomGenerator.next();

    expect(value1).not.toBe(value2);
  });
});

// ============================================================================
// Isolation Tests
// ============================================================================

describe('Execution Isolation (INV-EX-002)', () => {
  it('should create unique namespaces for each execution', () => {
    const plan = createTestPlan();

    const result1 = createExecutionContext({ tenantId: 'tenant-123', plan });
    const result2 = createExecutionContext({ tenantId: 'tenant-123', plan });

    expect(result1.stateNamespace).not.toBe(result2.stateNamespace);
  });

  it('should include execution ID in namespace', () => {
    const plan = createTestPlan();
    const result = createExecutionContext({ tenantId: 'tenant-123', plan });

    expect(result.stateNamespace).toContain(result.context.executionId);
  });

  it('should prefix namespaces with "execution:"', () => {
    const plan = createTestPlan();
    const result = createExecutionContext({ tenantId: 'tenant-123', plan });

    expect(result.stateNamespace).toMatch(/^execution:/);
  });
});
