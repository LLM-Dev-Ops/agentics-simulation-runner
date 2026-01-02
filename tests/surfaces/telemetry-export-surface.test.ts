/**
 * Tests for Telemetry Export Surface (MOD-013)
 *
 * Tests metric, trace, and log export functionality to various backends.
 *
 * @module tests/surfaces/telemetry-export-surface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UUID, ISO8601Timestamp, MetricEntry, TraceSpan, LogEntry } from '../../src/types/common.js';
import {
  TelemetryExportSurface,
  createTelemetryExportSurface,
  exportMetrics,
  exportTraces,
  exportLogs,
} from '../../src/surfaces/telemetry-export-surface.js';
import type {
  TelemetryBackend,
  CapturedMetrics,
  CapturedTraces,
  CapturedEvents,
  ExportResult,
  PrometheusConfig,
  JaegerConfig,
  ElasticsearchConfig,
  DatadogConfig,
  OTLPConfig,
} from '../../src/surfaces/telemetry-types.js';
import {
  isExportSuccessful,
  isExportPartial,
  isExportFailed,
  requiresAuthentication,
  isRetryableError,
} from '../../src/surfaces/telemetry-types.js';

// =============================================================================
// Mock Implementations
// =============================================================================

/**
 * Create mock captured metrics
 */
function createMockCapturedMetrics(count: number = 5): CapturedMetrics {
  const metrics: MetricEntry[] = [];
  for (let i = 0; i < count; i++) {
    metrics.push({
      name: `test_metric_${i}`,
      value: Math.random() * 100,
      unit: 'count',
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      labels: { service: 'test', instance: `instance-${i}` },
    });
  }

  return {
    batchId: `batch-metrics-${Date.now()}` as UUID,
    executionId: 'exec-123' as UUID,
    capturedAt: new Date().toISOString() as ISO8601Timestamp,
    metrics,
    count,
    resourceAttributes: {
      'service.name': 'agentics-simulation-runner',
      'service.version': '1.0.0',
    },
  };
}

/**
 * Create mock captured traces
 */
function createMockCapturedTraces(spanCount: number = 5): CapturedTraces {
  const spans: TraceSpan[] = [];
  const traceId = 'trace-' + Date.now();

  for (let i = 0; i < spanCount; i++) {
    spans.push({
      traceId,
      spanId: `span-${i}`,
      parentSpanId: i > 0 ? `span-${i - 1}` : undefined,
      name: `operation_${i}`,
      spanType: 'step_execution',
      startTime: new Date().toISOString() as ISO8601Timestamp,
      endTime: new Date().toISOString() as ISO8601Timestamp,
      durationMs: Math.floor(Math.random() * 100),
      status: 'ok',
      attributes: {
        'step.id': `step-${i}`,
        'step.name': `Step ${i}`,
      },
    });
  }

  return {
    batchId: `batch-traces-${Date.now()}` as UUID,
    executionId: 'exec-123' as UUID,
    capturedAt: new Date().toISOString() as ISO8601Timestamp,
    spans,
    count: spanCount,
    rootTraceId: traceId,
    serviceName: 'agentics-simulation-runner',
    resourceAttributes: {
      'service.name': 'agentics-simulation-runner',
    },
  };
}

/**
 * Create mock captured events/logs
 */
function createMockCapturedEvents(logCount: number = 5): CapturedEvents {
  const logs: LogEntry[] = [];

  for (let i = 0; i < logCount; i++) {
    logs.push({
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      level: i % 2 === 0 ? 'INFO' : 'DEBUG',
      executionId: 'exec-123' as UUID,
      component: 'test-component',
      message: `Test log message ${i}`,
      context: { index: i },
    });
  }

  return {
    batchId: `batch-events-${Date.now()}` as UUID,
    executionId: 'exec-123' as UUID,
    capturedAt: new Date().toISOString() as ISO8601Timestamp,
    logs,
    count: logCount,
    resourceAttributes: {
      'service.name': 'agentics-simulation-runner',
    },
  };
}

/**
 * Create mock backend configuration
 */
function createMockBackend(type: TelemetryBackend['type'], options?: Record<string, unknown>): TelemetryBackend {
  const baseBackend: TelemetryBackend = {
    type,
    endpoint: `http://localhost:${getDefaultPort(type)}`,
    name: `test-${type}-backend`,
    batchSize: 10,
    flushIntervalMs: 0, // Disable auto-flush for tests
    timeoutMs: 5000,
    options,
  };

  return baseBackend;
}

function getDefaultPort(type: TelemetryBackend['type']): number {
  switch (type) {
    case 'prometheus':
      return 9090;
    case 'jaeger':
      return 14268;
    case 'elasticsearch':
      return 9200;
    case 'datadog':
      return 8126;
    case 'otlp':
      return 4317;
    default:
      return 8080;
  }
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

describe('TelemetryExportSurface', () => {
  let surface: TelemetryExportSurface;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    surface = new TelemetryExportSurface();
  });

  afterEach(() => {
    surface.dispose();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor and Backend Registration Tests
  // ===========================================================================

  describe('constructor and backend management', () => {
    it('should create surface successfully', () => {
      expect(surface).toBeInstanceOf(TelemetryExportSurface);
    });

    it('should register backend', () => {
      const backend = createMockBackend('prometheus');
      surface.registerBackend('prom-1', backend);
      // No error means success
    });

    it('should unregister backend', () => {
      const backend = createMockBackend('prometheus');
      surface.registerBackend('prom-1', backend);

      const result = surface.unregisterBackend('prom-1');
      expect(result).toBe(true);
    });

    it('should return false when unregistering non-existent backend', () => {
      const result = surface.unregisterBackend('non-existent');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Metrics Export Tests
  // ===========================================================================

  describe('exportMetrics', () => {
    it('should export metrics to Prometheus backend', async () => {
      const backend = createMockBackend('prometheus', {
        jobName: 'test-job',
        instance: 'test-instance',
      } as PrometheusConfig);
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'success',
      });

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(true);
      expect(result.status).toBe('success');
      expect(result.itemsExported).toBe(5);
      expect(result.itemsFailed).toBe(0);
    });

    it('should export metrics to Datadog backend', async () => {
      const backend = createMockBackend('datadog', {
        site: 'datadoghq.com',
        service: 'test-service',
        env: 'test',
      } as DatadogConfig);
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{"status":"ok"}',
      });

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(true);
      expect(result.backend.type).toBe('datadog');
    });

    it('should export metrics to OTLP backend', async () => {
      const backend = createMockBackend('otlp', {
        protocol: 'http/json',
        exportMetrics: true,
      } as OTLPConfig);
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(true);
    });

    it('should handle empty metrics array', async () => {
      const backend = createMockBackend('prometheus');
      const metrics: CapturedMetrics[] = [];

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(true);
      expect(result.itemsExported).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle export failure', async () => {
      const backend = createMockBackend('prometheus');
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should handle partial failure', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('prometheus'),
        batchSize: 2, // Small batch to trigger multiple batches
        retryConfig: {
          maxRetries: 0, // No retries so failures stick
          initialDelayMs: 1,
          maxDelayMs: 1,
          backoffMultiplier: 1,
          useJitter: false,
        },
      };
      const metrics = [createMockCapturedMetrics(10)];

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Batch failed');
        }
        return { ok: true, text: async () => 'success' };
      });

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.status).toBe('partial');
      expect(result.itemsFailed).toBeGreaterThan(0);
      expect(result.itemsExported).toBeGreaterThan(0);
    });

    it('should reject unsupported backend for metrics', async () => {
      const backend = createMockBackend('elasticsearch');
      const metrics = [createMockCapturedMetrics()];

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('does not support metrics');
    });

    it('should batch metrics correctly', async () => {
      const backend = createMockBackend('prometheus');
      backend.batchSize = 3;
      const metrics = [createMockCapturedMetrics(10)];

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => 'success',
      });

      await surface.exportMetrics(metrics, backend);

      // 10 metrics / 3 batch size = 4 batches
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // ===========================================================================
  // Traces Export Tests
  // ===========================================================================

  describe('exportTraces', () => {
    it('should export traces to Jaeger backend', async () => {
      const backend = createMockBackend('jaeger', {
        serviceName: 'test-service',
      } as JaegerConfig);
      const traces = [createMockCapturedTraces()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportTraces(traces, backend);

      expect(result.success).toBe(true);
      expect(result.itemsExported).toBe(5);
    });

    it('should export traces to Datadog backend', async () => {
      const backend = createMockBackend('datadog', {
        site: 'datadoghq.com',
        service: 'test-service',
      } as DatadogConfig);
      const traces = [createMockCapturedTraces()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportTraces(traces, backend);

      expect(result.success).toBe(true);
    });

    it('should export traces to OTLP backend', async () => {
      const backend = createMockBackend('otlp', {
        protocol: 'http/json',
        exportTraces: true,
      } as OTLPConfig);
      const traces = [createMockCapturedTraces()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportTraces(traces, backend);

      expect(result.success).toBe(true);
    });

    it('should handle empty traces array', async () => {
      const backend = createMockBackend('jaeger');
      const traces: CapturedTraces[] = [];

      const result = await surface.exportTraces(traces, backend);

      expect(result.success).toBe(true);
      expect(result.itemsExported).toBe(0);
    });

    it('should reject unsupported backend for traces', async () => {
      const backend = createMockBackend('elasticsearch');
      const traces = [createMockCapturedTraces()];

      const result = await surface.exportTraces(traces, backend);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('does not support traces');
    });
  });

  // ===========================================================================
  // Logs Export Tests
  // ===========================================================================

  describe('exportLogs', () => {
    it('should export logs to Elasticsearch backend', async () => {
      const backend = createMockBackend('elasticsearch', {
        indexPattern: 'logs-test',
      } as ElasticsearchConfig);
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{"items":[]}',
      });

      const result = await surface.exportLogs(events, backend);

      expect(result.success).toBe(true);
      expect(result.itemsExported).toBe(5);
    });

    it('should export logs to Datadog backend', async () => {
      const backend = createMockBackend('datadog', {
        site: 'datadoghq.com',
        service: 'test-service',
      } as DatadogConfig);
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportLogs(events, backend);

      expect(result.success).toBe(true);
    });

    it('should export logs to OTLP backend', async () => {
      const backend = createMockBackend('otlp', {
        protocol: 'http/json',
        exportLogs: true,
      } as OTLPConfig);
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await surface.exportLogs(events, backend);

      expect(result.success).toBe(true);
    });

    it('should handle empty events array', async () => {
      const backend = createMockBackend('elasticsearch');
      const events: CapturedEvents[] = [];

      const result = await surface.exportLogs(events, backend);

      expect(result.success).toBe(true);
      expect(result.itemsExported).toBe(0);
    });

    it('should reject unsupported backend for logs', async () => {
      const backend = createMockBackend('prometheus');
      const events = [createMockCapturedEvents()];

      const result = await surface.exportLogs(events, backend);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('does not support logs');
    });
  });

  // ===========================================================================
  // Authentication Tests
  // ===========================================================================

  describe('authentication', () => {
    it('should include API key header when configured', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('otlp'),
        credentials: {
          method: 'api_key',
          apiKey: 'test-api-key',
        },
      };
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      await surface.exportMetrics(metrics, backend);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        })
      );
    });

    it('should include Bearer token when configured', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('otlp'),
        credentials: {
          method: 'bearer_token',
          bearerToken: 'test-bearer-token',
        },
      };
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      await surface.exportMetrics(metrics, backend);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-bearer-token',
          }),
        })
      );
    });

    it('should include Basic auth when configured', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('elasticsearch'),
        credentials: {
          method: 'basic',
          username: 'elastic',
          password: 'password123',
        },
      };
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      await surface.exportLogs(events, backend);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic '),
          }),
        })
      );
    });
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe('retry logic', () => {
    it('should retry on transient failure', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('prometheus'),
        retryConfig: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          useJitter: false,
        },
      };
      const metrics = [createMockCapturedMetrics(2)];

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient error');
        }
        return { ok: true, text: async () => 'success' };
      });

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const backend: TelemetryBackend = {
        ...createMockBackend('prometheus'),
        retryConfig: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          useJitter: false,
        },
      };
      const metrics = [createMockCapturedMetrics(2)];

      mockFetch.mockRejectedValue(new Error('Persistent error'));

      const result = await surface.exportMetrics(metrics, backend);

      expect(result.success).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  // ===========================================================================
  // Export All Tests
  // ===========================================================================

  describe('exportAll', () => {
    it('should export all telemetry types', async () => {
      const backend = createMockBackend('otlp');
      const metrics = [createMockCapturedMetrics()];
      const traces = [createMockCapturedTraces()];
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '{}',
      });

      const results = await surface.exportAll(
        { backend },
        metrics,
        traces,
        events
      );

      expect(results.metrics?.success).toBe(true);
      expect(results.traces?.success).toBe(true);
      expect(results.logs?.success).toBe(true);
    });

    it('should handle partial data', async () => {
      const backend = createMockBackend('otlp');
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '{}',
      });

      const results = await surface.exportAll(
        { backend },
        metrics,
        undefined, // No traces
        undefined  // No events
      );

      expect(results.metrics?.success).toBe(true);
      expect(results.traces).toBeUndefined();
      expect(results.logs).toBeUndefined();
    });
  });

  // ===========================================================================
  // Flush Tests
  // ===========================================================================

  describe('flushAll', () => {
    it('should flush buffered data', async () => {
      const backend = createMockBackend('prometheus');
      surface.registerBackend('test-backend', backend);

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '{}',
      });

      const results = await surface.flushAll('test-backend');

      // Should return empty results since nothing was buffered
      expect(results).toEqual([]);
    });

    it('should throw error for non-existent backend', async () => {
      await expect(surface.flushAll('non-existent')).rejects.toThrow('Backend non-existent not found');
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('factory functions', () => {
    it('createTelemetryExportSurface should create new surface', () => {
      const surface = createTelemetryExportSurface();
      expect(surface).toBeInstanceOf(TelemetryExportSurface);
      surface.dispose();
    });

    it('exportMetrics helper should work', async () => {
      const backend = createMockBackend('prometheus');
      const metrics = [createMockCapturedMetrics()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'success',
      });

      const result = await exportMetrics(metrics, backend);
      expect(result.success).toBe(true);
    });

    it('exportTraces helper should work', async () => {
      const backend = createMockBackend('jaeger');
      const traces = [createMockCapturedTraces()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await exportTraces(traces, backend);
      expect(result.success).toBe(true);
    });

    it('exportLogs helper should work', async () => {
      const backend = createMockBackend('elasticsearch');
      const events = [createMockCapturedEvents()];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
      });

      const result = await exportLogs(events, backend);
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('Type Guards', () => {
  const now = new Date().toISOString() as ISO8601Timestamp;

  describe('isExportSuccessful', () => {
    it('should return true for successful export', () => {
      const result: ExportResult = {
        success: true,
        status: 'success',
        itemsExported: 10,
        itemsAttempted: 10,
        itemsFailed: 0,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportSuccessful(result)).toBe(true);
    });

    it('should return false for partial export', () => {
      const result: ExportResult = {
        success: true,
        status: 'partial',
        itemsExported: 5,
        itemsAttempted: 10,
        itemsFailed: 5,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportSuccessful(result)).toBe(false);
    });

    it('should return false for failed export', () => {
      const result: ExportResult = {
        success: false,
        status: 'failed',
        itemsExported: 0,
        itemsAttempted: 10,
        itemsFailed: 10,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportSuccessful(result)).toBe(false);
    });
  });

  describe('isExportPartial', () => {
    it('should return true for partial export', () => {
      const result: ExportResult = {
        success: true,
        status: 'partial',
        itemsExported: 5,
        itemsAttempted: 10,
        itemsFailed: 5,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportPartial(result)).toBe(true);
    });

    it('should return false for successful export', () => {
      const result: ExportResult = {
        success: true,
        status: 'success',
        itemsExported: 10,
        itemsAttempted: 10,
        itemsFailed: 0,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportPartial(result)).toBe(false);
    });
  });

  describe('isExportFailed', () => {
    it('should return true for failed export', () => {
      const result: ExportResult = {
        success: false,
        status: 'failed',
        itemsExported: 0,
        itemsAttempted: 10,
        itemsFailed: 10,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportFailed(result)).toBe(true);
    });

    it('should return false for successful export', () => {
      const result: ExportResult = {
        success: true,
        status: 'success',
        itemsExported: 10,
        itemsAttempted: 10,
        itemsFailed: 0,
        durationMs: 100,
        startedAt: now,
        completedAt: now,
        backend: { type: 'prometheus', endpoint: 'http://localhost:9090' },
      };
      expect(isExportFailed(result)).toBe(false);
    });
  });

  describe('requiresAuthentication', () => {
    it('should return true when credentials are provided', () => {
      const backend: TelemetryBackend = {
        type: 'prometheus',
        endpoint: 'http://localhost:9090',
        credentials: {
          method: 'api_key',
          apiKey: 'test-key',
        },
      };
      expect(requiresAuthentication(backend)).toBe(true);
    });

    it('should return false when no credentials', () => {
      const backend: TelemetryBackend = {
        type: 'prometheus',
        endpoint: 'http://localhost:9090',
      };
      expect(requiresAuthentication(backend)).toBe(false);
    });

    it('should return false when method is none', () => {
      const backend: TelemetryBackend = {
        type: 'prometheus',
        endpoint: 'http://localhost:9090',
        credentials: {
          method: 'none',
        },
      };
      expect(requiresAuthentication(backend)).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable error', () => {
      expect(
        isRetryableError({
          code: 'NETWORK_ERROR',
          message: 'Connection timeout',
          retryable: true,
          timestamp: now,
        })
      ).toBe(true);
    });

    it('should return false for non-retryable error', () => {
      expect(
        isRetryableError({
          code: 'INVALID_DATA',
          message: 'Invalid payload format',
          retryable: false,
          timestamp: now,
        })
      ).toBe(false);
    });
  });
});
