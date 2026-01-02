/**
 * Tests for Agentics Ecosystem Surface (MOD-012)
 *
 * Tests ecosystem component availability validation, result emission,
 * and handoff protocol handling.
 *
 * @module tests/surfaces/agentics-ecosystem-surface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SimulationResult } from '../../src/types/simulation-result.js';
import type { UUID, SHA256Hash, ISO8601Timestamp } from '../../src/types/common.js';
import {
  AgenticsEcosystemSurface,
  createEcosystemSurface,
  validateEcosystemAvailability,
  emitResult,
} from '../../src/surfaces/agentics-ecosystem-surface.js';
import type {
  EcosystemComponent,
  EcosystemStatus,
  EmitConfirmation,
  EmitTarget,
  EcosystemSurfaceConfig,
} from '../../src/surfaces/ecosystem-types.js';
import {
  isComponentAvailable,
  isEcosystemHealthy,
  isEmitAcknowledged,
  isHandoffAccepted,
} from '../../src/surfaces/ecosystem-types.js';

// =============================================================================
// Mock Implementations
// =============================================================================

/**
 * Create a mock SimulationResult for testing
 */
function createMockSimulationResult(): SimulationResult {
  const now = new Date().toISOString() as ISO8601Timestamp;
  const resultId = 'result-123' as UUID;
  const resultHash = 'a'.repeat(64) as SHA256Hash;

  return {
    version: '1.0.0',
    resultId,
    resultVersion: '1.0.0',
    resultHash,
    executedAt: now,
    executedBy: 'test-runner',
    sourcePlan: {
      planId: 'plan-123' as UUID,
      planVersion: '1.0.0',
      planHash: 'b'.repeat(64) as SHA256Hash,
    },
    execution: {
      resultId,
      planId: 'plan-123' as UUID,
      planVersion: '1.0.0',
      startedAt: now,
      completedAt: now,
      durationMs: 1000,
      status: 'completed',
    },
    summary: {
      totalStepsExecuted: 5,
      successfulSteps: 5,
      failedSteps: 0,
      skippedSteps: 0,
      totalAgentInvocations: 10,
      totalStateMutations: 3,
      totalEventsEmitted: 2,
    },
    finalState: {
      snapshotId: 'snapshot-123' as UUID,
      stateHash: 'c'.repeat(64) as SHA256Hash,
      stateLocation: 'ruvvector-postgres://state/final',
    },
    stepResults: [],
    agentObservations: [],
    integrationObservations: [],
    telemetry: {
      metrics: [],
      events: [],
    },
    validationOutcomes: {
      preConditions: [],
      postConditions: [],
      invariantViolations: [],
      allPassed: true,
    },
    errors: [],
    artifacts: [],
    auditTrail: {
      trailId: 'trail-123' as UUID,
      entryCount: 5,
      merkleRoot: 'd'.repeat(64) as SHA256Hash,
      firstEntryAt: now,
      lastEntryAt: now,
    },
    checksum: 'e'.repeat(64) as SHA256Hash,
  };
}

/**
 * Mock fetch implementation
 */
function createMockFetch() {
  return vi.fn();
}

// =============================================================================
// Test Suite
// =============================================================================

describe('AgenticsEcosystemSurface', () => {
  let surface: AgenticsEcosystemSurface;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    surface = new AgenticsEcosystemSurface();
  });

  afterEach(() => {
    surface.dispose();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor and Configuration Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create surface with default configuration', () => {
      const surface = new AgenticsEcosystemSurface();
      expect(surface).toBeInstanceOf(AgenticsEcosystemSurface);
      surface.dispose();
    });

    it('should create surface with custom configuration', () => {
      const config: Partial<EcosystemSurfaceConfig> = {
        discovery: {
          autoDiscover: true,
          discoveryMethod: 'dns',
          healthCheckIntervalMs: 60000,
          healthCheckTimeoutMs: 10000,
          failureThreshold: 5,
        },
        defaultEmitConfig: {
          timeoutMs: 60000,
          retryOnFailure: false,
          maxRetries: 1,
          retryDelayMs: 500,
        },
        handoffProtocolVersion: '2.0',
        criticalComponents: ['custom-component'],
      };

      const surface = new AgenticsEcosystemSurface(config);
      expect(surface).toBeInstanceOf(AgenticsEcosystemSurface);
      surface.dispose();
    });
  });

  // ===========================================================================
  // Component Registration Tests
  // ===========================================================================

  describe('component registration', () => {
    it('should have default known components registered', () => {
      const components = surface.getRegisteredComponents();
      expect(components).toContain('agentics-simulation-planner');
      expect(components).toContain('agentics-deployment-intent');
      expect(components).toContain('agentics-skill-registry');
      expect(components).toContain('agentics-credential-vault');
      expect(components).toContain('ruvvector-postgres');
    });

    it('should register custom component', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy', version: '1.0.0' }),
      });

      surface.registerComponent('custom-service', 'http://localhost:8080', 'custom');

      const components = surface.getRegisteredComponents();
      expect(components).toContain('custom-service');
    });

    it('should unregister component', () => {
      surface.registerComponent('temp-service', 'http://localhost:9000', 'custom');
      expect(surface.getRegisteredComponents()).toContain('temp-service');

      const result = surface.unregisterComponent('temp-service');
      expect(result).toBe(true);
      expect(surface.getRegisteredComponents()).not.toContain('temp-service');
    });

    it('should return false when unregistering non-existent component', () => {
      const result = surface.unregisterComponent('non-existent');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Ecosystem Availability Tests
  // ===========================================================================

  describe('validateEcosystemAvailability', () => {
    it('should return healthy status when all components are available', async () => {
      // Mock all health checks to succeed
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy', version: '1.0.0' }),
      });

      const status = await surface.validateEcosystemAvailability();

      expect(status.overallStatus).toBe('healthy');
      expect(status.availableCount).toBeGreaterThan(0);
      expect(status.unavailableCount).toBe(0);
      expect(status.degradedCount).toBe(0);
    });

    it('should return degraded status when some components are degraded', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ status: 'degraded', version: '1.0.0' }),
          };
        }
        return {
          ok: true,
          json: async () => ({ status: 'healthy', version: '1.0.0' }),
        };
      });

      const status = await surface.validateEcosystemAvailability();

      expect(status.overallStatus).not.toBe('healthy');
    });

    it('should return unhealthy status when critical components are unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const status = await surface.validateEcosystemAvailability();

      expect(status.overallStatus).toBe('unhealthy');
      expect(status.unavailableCount).toBeGreaterThan(0);
    });

    it('should handle timeout on health checks', async () => {
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('abort')), 50);
        });
      });

      // Use a surface with short timeout
      const fastSurface = new AgenticsEcosystemSurface({
        discovery: {
          autoDiscover: false,
          discoveryMethod: 'static',
          healthCheckIntervalMs: 30000,
          healthCheckTimeoutMs: 100, // Very short timeout
          failureThreshold: 3,
        },
      });

      const status = await fastSurface.validateEcosystemAvailability();

      expect(status.unavailableCount).toBeGreaterThan(0);
      fastSurface.dispose();
    }, 10000);

    it('should include evaluatedAt timestamp', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const before = new Date().toISOString();
      const status = await surface.validateEcosystemAvailability();
      const after = new Date().toISOString();

      expect(status.evaluatedAt).toBeDefined();
      expect(status.evaluatedAt >= before).toBe(true);
      expect(status.evaluatedAt <= after).toBe(true);
    });

    it('should include recommendations when issues are found', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const status = await surface.validateEcosystemAvailability();

      expect(status.recommendations).toBeDefined();
      expect(status.recommendations!.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Result Emission Tests
  // ===========================================================================

  describe('emitResult', () => {
    it('should emit result to known component by name', async () => {
      const result = createMockSimulationResult();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          handoffId: 'handoff-123',
          respondedAt: new Date().toISOString(),
          status: 'received',
        }),
      });

      const confirmation = await surface.emitResult(result, 'agentics-deployment-intent');

      expect(confirmation.acknowledgment).toBe(true);
      expect(confirmation.resultId).toBe(result.resultId);
      expect(confirmation.targetComponent).toBe('agentics-deployment-intent');
    });

    it('should emit result to custom endpoint', async () => {
      const result = createMockSimulationResult();
      const target: EmitTarget = {
        type: 'webhook',
        endpoint: 'https://custom-webhook.example.com/results',
        timeoutMs: 5000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          handoffId: 'handoff-456',
          respondedAt: new Date().toISOString(),
          status: 'received',
        }),
      });

      const confirmation = await surface.emitResult(result, target);

      expect(confirmation.acknowledgment).toBe(true);
      expect(confirmation.targetType).toBe('webhook');
    });

    it('should retry on transient failure', async () => {
      const result = createMockSimulationResult();

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accepted: true,
            handoffId: 'handoff-789',
            respondedAt: new Date().toISOString(),
            status: 'received',
          }),
        });

      const confirmation = await surface.emitResult(result, 'agentics-deployment-intent');

      expect(confirmation.acknowledgment).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries exceeded', async () => {
      const result = createMockSimulationResult();

      // Use a surface with minimal retry delays
      const fastSurface = new AgenticsEcosystemSurface({
        defaultEmitConfig: {
          timeoutMs: 100,
          retryOnFailure: true,
          maxRetries: 2,
          retryDelayMs: 10,
        },
      });

      mockFetch.mockRejectedValue(new Error('Persistent failure'));

      await expect(fastSurface.emitResult(result, 'agentics-deployment-intent')).rejects.toMatchObject({
        code: 'EMIT_FAILED',
      });

      fastSurface.dispose();
    }, 10000);

    it('should include handoff protocol version in request', async () => {
      const result = createMockSimulationResult();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          handoffId: 'handoff-test',
          respondedAt: new Date().toISOString(),
          status: 'received',
        }),
      });

      await surface.emitResult(result, 'agentics-deployment-intent');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Handoff-Protocol-Version': '1.0',
          }),
        })
      );
    });

    it('should include correlation ID in request', async () => {
      const result = createMockSimulationResult();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          handoffId: 'handoff-test',
          respondedAt: new Date().toISOString(),
          status: 'received',
        }),
      });

      await surface.emitResult(result, 'agentics-deployment-intent');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': expect.any(String),
          }),
        })
      );
    });

    it('should handle rejection from target', async () => {
      const result = createMockSimulationResult();

      // Use a surface with minimal retry delays
      const fastSurface = new AgenticsEcosystemSurface({
        defaultEmitConfig: {
          timeoutMs: 100,
          retryOnFailure: true,
          maxRetries: 1,
          retryDelayMs: 10,
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          accepted: false,
          respondedAt: new Date().toISOString(),
          status: 'rejected',
          rejectionReason: 'Invalid result format',
        }),
      });

      await expect(fastSurface.emitResult(result, 'agentics-deployment-intent')).rejects.toMatchObject({
        code: 'EMIT_FAILED',
      });

      fastSurface.dispose();
    }, 10000);
  });

  // ===========================================================================
  // Health Check Lifecycle Tests
  // ===========================================================================

  describe('health check lifecycle', () => {
    it('should start and stop periodic health checks', () => {
      surface.startHealthChecks();
      // Starting again should be idempotent
      surface.startHealthChecks();

      surface.stopHealthChecks();
      surface.stopHealthChecks(); // Should not error
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('factory functions', () => {
    it('createEcosystemSurface should create new surface', () => {
      const surface = createEcosystemSurface();
      expect(surface).toBeInstanceOf(AgenticsEcosystemSurface);
      surface.dispose();
    });

    it('createEcosystemSurface should accept configuration', () => {
      const surface = createEcosystemSurface({
        handoffProtocolVersion: '2.0',
      });
      expect(surface).toBeInstanceOf(AgenticsEcosystemSurface);
      surface.dispose();
    });

    it('validateEcosystemAvailability helper should work', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const status = await validateEcosystemAvailability();
      expect(status).toBeDefined();
      expect(status.components).toBeDefined();
    });

    it('emitResult helper should work', async () => {
      const result = createMockSimulationResult();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accepted: true,
          handoffId: 'handoff-helper',
          respondedAt: new Date().toISOString(),
          status: 'received',
        }),
      });

      const confirmation = await emitResult(result, 'agentics-deployment-intent');
      expect(confirmation.acknowledgment).toBe(true);
    });
  });
});

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('Type Guards', () => {
  describe('isComponentAvailable', () => {
    it('should return true for available component', () => {
      const component: EcosystemComponent = {
        name: 'test',
        type: 'custom',
        endpoint: 'http://localhost',
        status: 'available',
      };
      expect(isComponentAvailable(component)).toBe(true);
    });

    it('should return false for unavailable component', () => {
      const component: EcosystemComponent = {
        name: 'test',
        type: 'custom',
        endpoint: 'http://localhost',
        status: 'unavailable',
      };
      expect(isComponentAvailable(component)).toBe(false);
    });

    it('should return false for degraded component', () => {
      const component: EcosystemComponent = {
        name: 'test',
        type: 'custom',
        endpoint: 'http://localhost',
        status: 'degraded',
      };
      expect(isComponentAvailable(component)).toBe(false);
    });
  });

  describe('isEcosystemHealthy', () => {
    it('should return true for healthy ecosystem', () => {
      const status: EcosystemStatus = {
        components: [],
        overallStatus: 'healthy',
        evaluatedAt: new Date().toISOString() as ISO8601Timestamp,
        availableCount: 5,
        degradedCount: 0,
        unavailableCount: 0,
      };
      expect(isEcosystemHealthy(status)).toBe(true);
    });

    it('should return false for degraded ecosystem', () => {
      const status: EcosystemStatus = {
        components: [],
        overallStatus: 'degraded',
        evaluatedAt: new Date().toISOString() as ISO8601Timestamp,
        availableCount: 3,
        degradedCount: 2,
        unavailableCount: 0,
      };
      expect(isEcosystemHealthy(status)).toBe(false);
    });

    it('should return false for unhealthy ecosystem', () => {
      const status: EcosystemStatus = {
        components: [],
        overallStatus: 'unhealthy',
        evaluatedAt: new Date().toISOString() as ISO8601Timestamp,
        availableCount: 1,
        degradedCount: 0,
        unavailableCount: 4,
      };
      expect(isEcosystemHealthy(status)).toBe(false);
    });
  });

  describe('isEmitAcknowledged', () => {
    it('should return true when acknowledgment is true', () => {
      const confirmation: EmitConfirmation = {
        targetComponent: 'test',
        targetType: 'deployment-intent',
        emittedAt: new Date().toISOString() as ISO8601Timestamp,
        resultId: 'result-123' as UUID,
        acknowledgment: true,
      };
      expect(isEmitAcknowledged(confirmation)).toBe(true);
    });

    it('should return false when acknowledgment is false', () => {
      const confirmation: EmitConfirmation = {
        targetComponent: 'test',
        targetType: 'deployment-intent',
        emittedAt: new Date().toISOString() as ISO8601Timestamp,
        resultId: 'result-123' as UUID,
        acknowledgment: false,
      };
      expect(isEmitAcknowledged(confirmation)).toBe(false);
    });
  });

  describe('isHandoffAccepted', () => {
    it('should return true for accepted handoff', () => {
      expect(
        isHandoffAccepted({
          accepted: true,
          respondedAt: new Date().toISOString() as ISO8601Timestamp,
          status: 'received',
        })
      ).toBe(true);
    });

    it('should return false for rejected handoff', () => {
      expect(
        isHandoffAccepted({
          accepted: false,
          respondedAt: new Date().toISOString() as ISO8601Timestamp,
          status: 'rejected',
          rejectionReason: 'Test rejection',
        })
      ).toBe(false);
    });

    it('should return false when accepted but status is rejected', () => {
      expect(
        isHandoffAccepted({
          accepted: true,
          respondedAt: new Date().toISOString() as ISO8601Timestamp,
          status: 'rejected',
        })
      ).toBe(false);
    });
  });
});
