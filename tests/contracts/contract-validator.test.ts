/**
 * Contract Validator Tests
 *
 * Tests for the Ajv-based contract validation at the HTTP boundary.
 * Ensures that simulation/v1/request.schema.json is properly enforced.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ContractValidator,
  getContractValidator,
  validateSimulationRequest,
  validateSimulationRequestOrThrow,
  ContractValidationException,
  createExecutionProof,
  type LayerExecuted,
  type ExecutionGraphNode,
} from '../../src/contracts/index.js';

describe('ContractValidator', () => {
  let validator: ContractValidator;

  beforeAll(() => {
    validator = getContractValidator();
  });

  describe('Schema loading and initialization', () => {
    it('should load the request schema successfully', () => {
      const info = validator.getSchemaInfo();
      expect(info.id).toContain('simulation');
      expect(info.version).toBe('v1');
    });

    it('should return the same instance from getContractValidator', () => {
      const instance1 = getContractValidator();
      const instance2 = getContractValidator();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Valid request validation', () => {
    it('should validate a minimal valid simulation plan', () => {
      const validPlan = createMinimalValidPlan();
      const result = validator.validate(validPlan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.schemaId).toContain('simulation');
      expect(result.validatedAt).toBeDefined();
    });

    it('should validate a full simulation plan with all fields', () => {
      const fullPlan = createFullValidPlan();
      const result = validator.validate(fullPlan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Invalid request validation', () => {
    it('should reject null input', () => {
      const result = validator.validate(null);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject undefined input', () => {
      const result = validator.validate(undefined);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject non-object input', () => {
      const result = validator.validate('not an object');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject array input', () => {
      const result = validator.validate([]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject plan missing required fields', () => {
      const result = validator.validate({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should have errors for missing required fields
      const missingFieldErrors = result.errors.filter(
        (e) => e.keyword === 'required'
      );
      expect(missingFieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject plan with invalid planId format', () => {
      const plan = createMinimalValidPlan();
      (plan as Record<string, unknown>).planId = 'not-a-uuid';

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('planId'))).toBe(true);
    });

    it('should reject plan with invalid planHash format', () => {
      const plan = createMinimalValidPlan();
      (plan as Record<string, unknown>).planHash = 'not-a-sha256-hash';

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('planHash'))).toBe(true);
    });

    it('should reject plan with invalid version format', () => {
      const plan = createMinimalValidPlan();
      (plan as Record<string, unknown>).version = 'invalid';

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('version'))).toBe(true);
    });

    it('should reject plan with invalid executionConfig', () => {
      const plan = createMinimalValidPlan();
      (plan as Record<string, unknown>).executionConfig = {
        timeoutSeconds: -1, // Invalid: must be >= 1
        maxSteps: 0, // Invalid: must be >= 1
      };

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
    });

    it('should reject plan with timeoutSeconds exceeding maximum', () => {
      const plan = createMinimalValidPlan();
      (plan.executionConfig as Record<string, unknown>).timeoutSeconds = 100000; // Max is 86400

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
    });

    it('should reject plan with invalid agent type', () => {
      const plan = createMinimalValidPlan();
      plan.agents = [
        {
          id: 'agent-1',
          type: 'invalid-type' as 'autonomous', // Invalid enum value
          role: 'test',
          capabilities: [],
          llmBinding: createValidLLMBinding(),
          memoryBinding: createValidMemoryBinding(),
        },
      ];

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
    });

    it('should reject plan with invalid stateConfig.isolationLevel', () => {
      const plan = createMinimalValidPlan();
      (plan.stateConfig as Record<string, unknown>).isolationLevel = 'INVALID_LEVEL';

      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
    });
  });

  describe('validateOrThrow', () => {
    it('should not throw for valid plan', () => {
      const plan = createMinimalValidPlan();

      expect(() => validator.validateOrThrow(plan)).not.toThrow();
    });

    it('should throw ContractValidationException for invalid plan', () => {
      expect(() => validator.validateOrThrow(null)).toThrow(
        ContractValidationException
      );
    });

    it('should include validation errors in exception', () => {
      try {
        validator.validateOrThrow({});
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ContractValidationException);
        const exception = error as ContractValidationException;
        expect(exception.result.errors.length).toBeGreaterThan(0);
        expect(exception.code).toBe('CONTRACT_VALIDATION_FAILED');
      }
    });
  });

  describe('Convenience functions', () => {
    it('validateSimulationRequest should use shared validator', () => {
      const plan = createMinimalValidPlan();
      const result = validateSimulationRequest(plan);

      expect(result.valid).toBe(true);
    });

    it('validateSimulationRequestOrThrow should work', () => {
      const plan = createMinimalValidPlan();

      expect(() => validateSimulationRequestOrThrow(plan)).not.toThrow();
    });
  });
});

describe('Execution Proof', () => {
  it('should create valid execution proof', () => {
    const layers: LayerExecuted[] = [
      {
        layerId: 'validation',
        layerType: 'validation',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 10,
        status: 'success',
      },
      {
        layerId: 'execution',
        layerType: 'execution',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 100,
        status: 'success',
      },
    ];

    const nodes: ExecutionGraphNode[] = [
      {
        nodeId: 'validation',
        nodeType: 'checkpoint',
        status: 'completed',
        parentNodes: [],
        childNodes: ['execution'],
      },
      {
        nodeId: 'execution',
        nodeType: 'step',
        status: 'completed',
        parentNodes: ['validation'],
        childNodes: [],
      },
    ];

    const edges = [
      { from: 'validation', to: 'execution', type: 'sequence' as const },
    ];

    const proof = createExecutionProof('proof-1', layers, nodes, edges);

    expect(proof.proofId).toBe('proof-1');
    expect(proof.layers_executed).toHaveLength(2);
    expect(proof.execution_graph.nodes).toHaveLength(2);
    expect(proof.execution_graph.edges).toHaveLength(1);
    expect(proof.layerCount).toBe(2);
    expect(proof.complete).toBe(true); // Has successful execution layer
    expect(proof.generatedAt).toBeDefined();
  });

  it('should mark proof as incomplete without successful execution layer', () => {
    const layers: LayerExecuted[] = [
      {
        layerId: 'validation',
        layerType: 'validation',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 10,
        status: 'success',
      },
    ];

    const proof = createExecutionProof('proof-2', layers, [], []);

    expect(proof.complete).toBe(false); // No execution layer
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMinimalValidPlan(): Record<string, unknown> {
  return {
    version: '1.0.0',
    planId: '550e8400-e29b-41d4-a716-446655440000',
    planVersion: '1.0.0',
    planHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    createdBy: 'test-user',
    metadata: {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Plan',
      createdAt: new Date().toISOString(),
      createdBy: 'test-user',
    },
    executionConfig: {
      timeoutSeconds: 300,
      maxSteps: 100,
    },
    stateConfig: {
      databaseConnectionId: 'test-db',
      schemaNamespace: 'test_namespace',
      isolationLevel: 'SERIALIZABLE',
    },
    workflow: {
      steps: [],
    },
    agents: [],
  };
}

function createFullValidPlan(): Record<string, unknown> {
  const minimalPlan = createMinimalValidPlan();

  return {
    ...minimalPlan,
    sourceIntent: 'Test simulation',
    executionConfig: {
      ...minimalPlan.executionConfig,
      checkpointInterval: 10,
      concurrencyModel: 'parallel',
      maxConcurrentAgents: 5,
      deterministicSeed: 12345,
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      resourceLimits: {
        maxCpu: 4,
        maxMemory: 4294967296, // 4GB
      },
    },
    workflow: {
      steps: [
        {
          id: 'step-1',
          type: 'AGENT_INVOCATION',
          name: 'Test Step',
          agentRef: 'agent-1',
        },
      ],
      dependencies: {
        'step-1': [],
      },
      checkpoints: ['step-1'],
    },
    agents: [
      {
        id: 'agent-1',
        type: 'autonomous',
        role: 'Test Agent',
        description: 'A test agent',
        capabilities: [{ capabilityId: 'test-capability' }],
        llmBinding: createValidLLMBinding(),
        memoryBinding: createValidMemoryBinding(),
        constraints: {
          maxConcurrentActions: 1,
          rateLimitPerMinute: 60,
        },
      },
    ],
    integrations: [
      {
        id: 'integration-1',
        type: 'HTTP',
        config: {
          url: 'https://example.com/api',
          method: 'POST',
        },
        authentication: {
          type: 'bearer',
          credentialReference: 'secret-ref',
        },
      },
    ],
    observability: {
      tracing: {
        enabled: true,
        samplingRate: 1.0,
      },
      metrics: {
        enabled: true,
      },
      logging: {
        level: 'INFO',
      },
    },
    validation: {
      preConditions: [],
      postConditions: [],
      invariants: [],
      validateStateSchema: false,
    },
  };
}

function createValidLLMBinding(): Record<string, unknown> {
  return {
    provider: 'openai',
    modelId: 'gpt-4',
    apiKeyReference: 'openai-api-key',
    configuration: {
      temperature: 0.7,
      maxTokens: 4096,
    },
    systemPrompt: 'You are a helpful assistant.',
  };
}

function createValidMemoryBinding(): Record<string, unknown> {
  return {
    workingMemory: {
      maxSize: 1000,
      evictionPolicy: 'LRU',
    },
  };
}
