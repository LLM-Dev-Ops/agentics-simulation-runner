/**
 * Telemetry Export Surface
 *
 * MOD-013: Abstracts telemetry backend interactions
 *
 * This surface provides a unified interface for:
 * - Exporting metrics to Prometheus, Datadog, or OTLP endpoints
 * - Exporting traces to Jaeger, Datadog, or OTLP endpoints
 * - Exporting logs/events to Elasticsearch, Datadog, or OTLP endpoints
 *
 * Supported backends:
 * - OpenTelemetry Collector (OTLP)
 * - Prometheus (metrics)
 * - Jaeger (traces)
 * - Elasticsearch (logs)
 * - Datadog
 * - Custom OTLP endpoint
 *
 * @module surfaces/telemetry-export-surface
 */

import { v4 as uuidv4 } from 'uuid';
import type { UUID, ISO8601Timestamp, DurationMs } from '../types/common.js';
import type {
  TelemetryBackend,
  TelemetryBackendType,
  ExportResult,
  ExportError,
  ExportStatus,
  CapturedMetrics,
  CapturedTraces,
  CapturedEvents,
  ExportConfig,
  ExportFilter,
  ExportTransform,
  TelemetryRetryConfig,
  PrometheusConfig,
  JaegerConfig,
  ElasticsearchConfig,
  DatadogConfig,
  OTLPConfig,
} from './telemetry-types.js';

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: TelemetryRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  useJitter: true,
};

/**
 * Default batch configuration
 */
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 30000;

// =============================================================================
// Telemetry Export Surface Class
// =============================================================================

/**
 * Telemetry Export Surface
 *
 * Provides a unified interface for exporting telemetry data to various backends.
 */
export class TelemetryExportSurface {
  private readonly backends: Map<string, TelemetryBackend>;
  private readonly metricBuffers: Map<string, CapturedMetrics[]>;
  private readonly traceBuffers: Map<string, CapturedTraces[]>;
  private readonly eventBuffers: Map<string, CapturedEvents[]>;
  private readonly flushTimers: Map<string, ReturnType<typeof setInterval>>;

  constructor() {
    this.backends = new Map();
    this.metricBuffers = new Map();
    this.traceBuffers = new Map();
    this.eventBuffers = new Map();
    this.flushTimers = new Map();
  }

  /**
   * Register a telemetry backend
   */
  public registerBackend(name: string, backend: TelemetryBackend): void {
    this.backends.set(name, backend);
    this.metricBuffers.set(name, []);
    this.traceBuffers.set(name, []);
    this.eventBuffers.set(name, []);

    // Start flush timer if auto-flush is enabled
    const flushInterval = backend.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    if (flushInterval > 0) {
      const timer = setInterval(() => {
        void this.flushAll(name);
      }, flushInterval);
      this.flushTimers.set(name, timer);
    }
  }

  /**
   * Unregister a telemetry backend
   */
  public unregisterBackend(name: string): boolean {
    const timer = this.flushTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.flushTimers.delete(name);
    }
    this.metricBuffers.delete(name);
    this.traceBuffers.delete(name);
    this.eventBuffers.delete(name);
    return this.backends.delete(name);
  }

  /**
   * Export metrics to a telemetry backend
   *
   * @param metrics - Array of captured metrics to export
   * @param backend - Target telemetry backend configuration
   * @returns Promise<ExportResult> - Result of the export operation
   */
  public async exportMetrics(
    metrics: CapturedMetrics[],
    backend: TelemetryBackend
  ): Promise<ExportResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // Validate backend supports metrics
      this.validateMetricsBackend(backend);

      // Flatten all metrics into a single array
      const allMetrics = metrics.flatMap(m => m.metrics);
      const totalItems = allMetrics.length;

      if (totalItems === 0) {
        return this.createSuccessResult(0, 0, startedAt, backend);
      }

      // Batch and export
      const batchSize = backend.batchSize ?? DEFAULT_BATCH_SIZE;
      const batches = this.createBatches(allMetrics, batchSize);
      const errors: ExportError[] = [];
      let itemsExported = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          await this.exportMetricsBatch(batch, backend, metrics[0]?.resourceAttributes);
          itemsExported += batch.length;
        } catch (error) {
          const exportError = this.createExportError(
            'BATCH_EXPORT_FAILED',
            error instanceof Error ? error.message : 'Unknown error',
            i * batchSize,
            true
          );
          errors.push(exportError);
        }
      }

      return this.createResult(
        itemsExported,
        totalItems,
        errors,
        startedAt,
        backend
      );
    } catch (error) {
      return this.createFailureResult(
        error instanceof Error ? error.message : 'Unknown error',
        metrics.reduce((acc, m) => acc + m.count, 0),
        startedAt,
        backend
      );
    }
  }

  /**
   * Export traces to a telemetry backend
   *
   * @param traces - Array of captured traces to export
   * @param backend - Target telemetry backend configuration
   * @returns Promise<ExportResult> - Result of the export operation
   */
  public async exportTraces(
    traces: CapturedTraces[],
    backend: TelemetryBackend
  ): Promise<ExportResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // Validate backend supports traces
      this.validateTracesBackend(backend);

      // Flatten all spans into a single array
      const allSpans = traces.flatMap(t => t.spans);
      const totalItems = allSpans.length;

      if (totalItems === 0) {
        return this.createSuccessResult(0, 0, startedAt, backend);
      }

      // Batch and export
      const batchSize = backend.batchSize ?? DEFAULT_BATCH_SIZE;
      const batches = this.createBatches(allSpans, batchSize);
      const errors: ExportError[] = [];
      let itemsExported = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          await this.exportTracesBatch(batch, backend, traces[0]?.resourceAttributes);
          itemsExported += batch.length;
        } catch (error) {
          const exportError = this.createExportError(
            'BATCH_EXPORT_FAILED',
            error instanceof Error ? error.message : 'Unknown error',
            i * batchSize,
            true
          );
          errors.push(exportError);
        }
      }

      return this.createResult(
        itemsExported,
        totalItems,
        errors,
        startedAt,
        backend
      );
    } catch (error) {
      return this.createFailureResult(
        error instanceof Error ? error.message : 'Unknown error',
        traces.reduce((acc, t) => acc + t.count, 0),
        startedAt,
        backend
      );
    }
  }

  /**
   * Export logs/events to a telemetry backend
   *
   * @param events - Array of captured events to export
   * @param backend - Target telemetry backend configuration
   * @returns Promise<ExportResult> - Result of the export operation
   */
  public async exportLogs(
    events: CapturedEvents[],
    backend: TelemetryBackend
  ): Promise<ExportResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // Validate backend supports logs
      this.validateLogsBackend(backend);

      // Flatten all logs and events
      const allItems: unknown[] = [];
      for (const event of events) {
        if (event.logs) {
          allItems.push(...event.logs);
        }
        if (event.lifecycleEvents) {
          allItems.push(...event.lifecycleEvents);
        }
      }

      const totalItems = allItems.length;

      if (totalItems === 0) {
        return this.createSuccessResult(0, 0, startedAt, backend);
      }

      // Batch and export
      const batchSize = backend.batchSize ?? DEFAULT_BATCH_SIZE;
      const batches = this.createBatches(allItems, batchSize);
      const errors: ExportError[] = [];
      let itemsExported = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          await this.exportLogsBatch(batch, backend, events[0]?.resourceAttributes);
          itemsExported += batch.length;
        } catch (error) {
          const exportError = this.createExportError(
            'BATCH_EXPORT_FAILED',
            error instanceof Error ? error.message : 'Unknown error',
            i * batchSize,
            true
          );
          errors.push(exportError);
        }
      }

      return this.createResult(
        itemsExported,
        totalItems,
        errors,
        startedAt,
        backend
      );
    } catch (error) {
      return this.createFailureResult(
        error instanceof Error ? error.message : 'Unknown error',
        events.reduce((acc, e) => acc + e.count, 0),
        startedAt,
        backend
      );
    }
  }

  /**
   * Export all telemetry types in a single operation
   */
  public async exportAll(
    config: ExportConfig,
    metrics?: CapturedMetrics[],
    traces?: CapturedTraces[],
    events?: CapturedEvents[]
  ): Promise<{
    metrics?: ExportResult;
    traces?: ExportResult;
    logs?: ExportResult;
  }> {
    const results: {
      metrics?: ExportResult;
      traces?: ExportResult;
      logs?: ExportResult;
    } = {};

    // Apply filters and transforms
    const filteredMetrics = metrics ? this.applyFilter(metrics, config.filter) : undefined;
    const filteredTraces = traces ? this.applyFilter(traces, config.filter) : undefined;
    const filteredEvents = events ? this.applyFilter(events, config.filter) : undefined;

    // Export in parallel
    const promises: Promise<void>[] = [];

    if (filteredMetrics && filteredMetrics.length > 0) {
      promises.push(
        this.exportMetrics(filteredMetrics as CapturedMetrics[], config.backend).then(r => {
          results.metrics = r;
        })
      );
    }

    if (filteredTraces && filteredTraces.length > 0) {
      promises.push(
        this.exportTraces(filteredTraces as CapturedTraces[], config.backend).then(r => {
          results.traces = r;
        })
      );
    }

    if (filteredEvents && filteredEvents.length > 0) {
      promises.push(
        this.exportLogs(filteredEvents as CapturedEvents[], config.backend).then(r => {
          results.logs = r;
        })
      );
    }

    await Promise.allSettled(promises);

    return results;
  }

  /**
   * Flush all buffered telemetry for a backend
   */
  public async flushAll(backendName: string): Promise<ExportResult[]> {
    const backend = this.backends.get(backendName);
    if (!backend) {
      throw new Error(`Backend ${backendName} not found`);
    }

    const results: ExportResult[] = [];

    // Flush metrics
    const metricBuffer = this.metricBuffers.get(backendName) ?? [];
    if (metricBuffer.length > 0) {
      const result = await this.exportMetrics(metricBuffer, backend);
      results.push(result);
      this.metricBuffers.set(backendName, []);
    }

    // Flush traces
    const traceBuffer = this.traceBuffers.get(backendName) ?? [];
    if (traceBuffer.length > 0) {
      const result = await this.exportTraces(traceBuffer, backend);
      results.push(result);
      this.traceBuffers.set(backendName, []);
    }

    // Flush events
    const eventBuffer = this.eventBuffers.get(backendName) ?? [];
    if (eventBuffer.length > 0) {
      const result = await this.exportLogs(eventBuffer, backend);
      results.push(result);
      this.eventBuffers.set(backendName, []);
    }

    return results;
  }

  // ===========================================================================
  // Backend-Specific Export Methods
  // ===========================================================================

  /**
   * Export a batch of metrics to the backend
   */
  private async exportMetricsBatch(
    metrics: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): Promise<void> {
    const payload = this.formatMetricsPayload(metrics, backend, resourceAttributes);
    await this.sendWithRetry(backend, payload, 'metrics');
  }

  /**
   * Export a batch of traces to the backend
   */
  private async exportTracesBatch(
    spans: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): Promise<void> {
    const payload = this.formatTracesPayload(spans, backend, resourceAttributes);
    await this.sendWithRetry(backend, payload, 'traces');
  }

  /**
   * Export a batch of logs to the backend
   */
  private async exportLogsBatch(
    logs: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): Promise<void> {
    const payload = this.formatLogsPayload(logs, backend, resourceAttributes);
    await this.sendWithRetry(backend, payload, 'logs');
  }

  /**
   * Send payload with retry logic
   */
  private async sendWithRetry(
    backend: TelemetryBackend,
    payload: unknown,
    signalType: 'metrics' | 'traces' | 'logs'
  ): Promise<void> {
    const retryConfig = backend.retryConfig ?? DEFAULT_RETRY_CONFIG;
    let lastError: Error | undefined;
    let delay = retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        await this.send(backend, payload, signalType);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryConfig.maxRetries) {
          // Apply jitter if enabled
          const jitter = retryConfig.useJitter ? Math.random() * delay * 0.1 : 0;
          await this.sleep(delay + jitter);

          // Exponential backoff
          delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Send payload to backend
   */
  private async send(
    backend: TelemetryBackend,
    payload: unknown,
    signalType: 'metrics' | 'traces' | 'logs'
  ): Promise<void> {
    const endpoint = this.getEndpointForSignal(backend, signalType);
    const timeout = backend.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...backend.headers,
      };

      // Add authentication headers
      if (backend.credentials) {
        const authHeaders = this.getAuthHeaders(backend);
        Object.assign(headers, authHeaders);
      }

      const body = this.compressPayload(payload, backend.compression);

      if (backend.compression && backend.compression !== 'none') {
        headers['Content-Encoding'] = backend.compression;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Get the endpoint URL for a specific signal type
   */
  private getEndpointForSignal(
    backend: TelemetryBackend,
    signalType: 'metrics' | 'traces' | 'logs'
  ): string {
    const options = backend.options as Partial<OTLPConfig> | undefined;

    switch (signalType) {
      case 'metrics':
        if (options?.metricsEndpoint) return options.metricsEndpoint;
        if (backend.type === 'prometheus') return `${backend.endpoint}/api/v1/write`;
        if (backend.type === 'otlp') return `${backend.endpoint}/v1/metrics`;
        break;
      case 'traces':
        if (options?.tracesEndpoint) return options.tracesEndpoint;
        if (backend.type === 'jaeger') return `${backend.endpoint}/api/traces`;
        if (backend.type === 'otlp') return `${backend.endpoint}/v1/traces`;
        break;
      case 'logs':
        if (options?.logsEndpoint) return options.logsEndpoint;
        if (backend.type === 'elasticsearch') {
          const esConfig = backend.options as Partial<ElasticsearchConfig> | undefined;
          const index = esConfig?.indexPattern ?? 'logs';
          return `${backend.endpoint}/${index}/_bulk`;
        }
        if (backend.type === 'otlp') return `${backend.endpoint}/v1/logs`;
        break;
    }

    return backend.endpoint;
  }

  /**
   * Get authentication headers based on credentials
   */
  private getAuthHeaders(backend: TelemetryBackend): Record<string, string> {
    const creds = backend.credentials;
    if (!creds) return {};

    switch (creds.method) {
      case 'api_key':
        return { 'X-API-Key': creds.apiKey ?? '' };
      case 'bearer_token':
        return { 'Authorization': `Bearer ${creds.bearerToken ?? ''}` };
      case 'basic':
        const encoded = Buffer.from(`${creds.username ?? ''}:${creds.password ?? ''}`).toString('base64');
        return { 'Authorization': `Basic ${encoded}` };
      default:
        return {};
    }
  }

  // ===========================================================================
  // Payload Formatting
  // ===========================================================================

  /**
   * Format metrics payload based on backend type
   */
  private formatMetricsPayload(
    metrics: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): unknown {
    switch (backend.type) {
      case 'prometheus':
        return this.formatPrometheusMetrics(metrics, backend.options as Partial<PrometheusConfig> | undefined);
      case 'datadog':
        return this.formatDatadogMetrics(metrics, backend.options as Partial<DatadogConfig> | undefined);
      case 'otlp':
        return this.formatOTLPMetrics(metrics, resourceAttributes);
      default:
        return { metrics, resourceAttributes };
    }
  }

  /**
   * Format traces payload based on backend type
   */
  private formatTracesPayload(
    spans: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): unknown {
    switch (backend.type) {
      case 'jaeger':
        return this.formatJaegerTraces(spans, backend.options as Partial<JaegerConfig> | undefined);
      case 'datadog':
        return this.formatDatadogTraces(spans, backend.options as Partial<DatadogConfig> | undefined);
      case 'otlp':
        return this.formatOTLPTraces(spans, resourceAttributes);
      default:
        return { spans, resourceAttributes };
    }
  }

  /**
   * Format logs payload based on backend type
   */
  private formatLogsPayload(
    logs: readonly unknown[],
    backend: TelemetryBackend,
    resourceAttributes?: Record<string, string>
  ): unknown {
    switch (backend.type) {
      case 'elasticsearch':
        return this.formatElasticsearchLogs(logs, backend.options as Partial<ElasticsearchConfig> | undefined);
      case 'datadog':
        return this.formatDatadogLogs(logs, backend.options as Partial<DatadogConfig> | undefined);
      case 'otlp':
        return this.formatOTLPLogs(logs, resourceAttributes);
      default:
        return { logs, resourceAttributes };
    }
  }

  /**
   * Format metrics for Prometheus
   */
  private formatPrometheusMetrics(
    metrics: readonly unknown[],
    config?: Partial<PrometheusConfig>
  ): unknown {
    // Prometheus remote write format
    const timeseries: unknown[] = [];
    const prefix = config?.metricPrefix ?? '';

    for (const metric of metrics as Array<{ name: string; value: number; timestamp: string; labels?: Record<string, string> }>) {
      timeseries.push({
        labels: [
          { name: '__name__', value: `${prefix}${metric.name}` },
          { name: 'job', value: config?.jobName ?? 'agentics' },
          { name: 'instance', value: config?.instance ?? 'unknown' },
          ...Object.entries(metric.labels ?? {}).map(([name, value]) => ({ name, value })),
        ],
        samples: [
          {
            value: metric.value,
            timestamp: new Date(metric.timestamp).getTime(),
          },
        ],
      });
    }

    return { timeseries };
  }

  /**
   * Format traces for Jaeger
   */
  private formatJaegerTraces(
    spans: readonly unknown[],
    config?: Partial<JaegerConfig>
  ): unknown {
    return {
      data: [
        {
          traceID: (spans[0] as { traceId?: string })?.traceId ?? uuidv4(),
          spans: spans.map((span: any) => ({
            traceID: span.traceId,
            spanID: span.spanId,
            operationName: span.name,
            references: span.parentSpanId
              ? [{ refType: 'CHILD_OF', traceID: span.traceId, spanID: span.parentSpanId }]
              : [],
            startTime: new Date(span.startTime).getTime() * 1000,
            duration: (span.durationMs ?? 0) * 1000,
            tags: Object.entries(span.attributes ?? {}).map(([key, value]) => ({
              key,
              type: typeof value === 'string' ? 'string' : 'int64',
              value,
            })),
            logs: [],
            processID: 'p1',
          })),
          processes: {
            p1: {
              serviceName: config?.serviceName ?? 'agentics-simulation-runner',
              tags: [],
            },
          },
        },
      ],
    };
  }

  /**
   * Format logs for Elasticsearch
   */
  private formatElasticsearchLogs(
    logs: readonly unknown[],
    config?: Partial<ElasticsearchConfig>
  ): string {
    // Elasticsearch bulk format
    const lines: string[] = [];
    const index = config?.indexPattern ?? 'logs';

    for (const log of logs) {
      lines.push(JSON.stringify({ index: { _index: index } }));
      lines.push(JSON.stringify(log));
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format metrics for Datadog
   */
  private formatDatadogMetrics(
    metrics: readonly unknown[],
    config?: Partial<DatadogConfig>
  ): unknown {
    const series: unknown[] = [];

    for (const metric of metrics as Array<{ name: string; value: number; timestamp: string; labels?: Record<string, string> }>) {
      const tags = [
        `service:${config?.service ?? 'agentics'}`,
        ...(config?.env ? [`env:${config.env}`] : []),
        ...(config?.version ? [`version:${config.version}`] : []),
        ...Object.entries(metric.labels ?? {}).map(([k, v]) => `${k}:${v}`),
        ...Object.entries(config?.tags ?? {}).map(([k, v]) => `${k}:${v}`),
      ];

      series.push({
        metric: metric.name,
        points: [[Math.floor(new Date(metric.timestamp).getTime() / 1000), metric.value]],
        tags,
        type: 'gauge',
      });
    }

    return { series };
  }

  /**
   * Format traces for Datadog
   */
  private formatDatadogTraces(
    spans: readonly unknown[],
    config?: Partial<DatadogConfig>
  ): unknown {
    return {
      traces: [
        spans.map((span: any) => ({
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_id: span.parentSpanId,
          name: span.name,
          service: config?.service ?? 'agentics',
          resource: span.name,
          start: new Date(span.startTime).getTime() * 1000000,
          duration: (span.durationMs ?? 0) * 1000000,
          error: span.status === 'error' ? 1 : 0,
          meta: {
            ...span.attributes,
            env: config?.env,
            version: config?.version,
          },
        })),
      ],
    };
  }

  /**
   * Format logs for Datadog
   */
  private formatDatadogLogs(
    logs: readonly unknown[],
    config?: Partial<DatadogConfig>
  ): unknown {
    return logs.map((log: any) => ({
      message: log.message,
      status: log.level?.toLowerCase() ?? 'info',
      timestamp: log.timestamp,
      service: config?.service ?? 'agentics',
      ddsource: 'agentics-simulation-runner',
      ddtags: [
        ...(config?.env ? [`env:${config.env}`] : []),
        ...(config?.version ? [`version:${config.version}`] : []),
        ...Object.entries(config?.tags ?? {}).map(([k, v]) => `${k}:${v}`),
      ].join(','),
      ...log.context,
    }));
  }

  /**
   * Format metrics for OTLP
   */
  private formatOTLPMetrics(
    metrics: readonly unknown[],
    resourceAttributes?: Record<string, string>
  ): unknown {
    return {
      resourceMetrics: [
        {
          resource: {
            attributes: Object.entries(resourceAttributes ?? {}).map(([key, value]) => ({
              key,
              value: { stringValue: value },
            })),
          },
          scopeMetrics: [
            {
              scope: {
                name: 'agentics-simulation-runner',
                version: '1.0.0',
              },
              metrics: metrics.map((m: any) => ({
                name: m.name,
                unit: m.unit ?? '',
                gauge: {
                  dataPoints: [
                    {
                      asDouble: m.value,
                      timeUnixNano: new Date(m.timestamp).getTime() * 1000000,
                      attributes: Object.entries(m.labels ?? {}).map(([key, value]) => ({
                        key,
                        value: { stringValue: value },
                      })),
                    },
                  ],
                },
              })),
            },
          ],
        },
      ],
    };
  }

  /**
   * Format traces for OTLP
   */
  private formatOTLPTraces(
    spans: readonly unknown[],
    resourceAttributes?: Record<string, string>
  ): unknown {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: Object.entries(resourceAttributes ?? {}).map(([key, value]) => ({
              key,
              value: { stringValue: value },
            })),
          },
          scopeSpans: [
            {
              scope: {
                name: 'agentics-simulation-runner',
                version: '1.0.0',
              },
              spans: spans.map((s: any) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                name: s.name,
                kind: 1, // INTERNAL
                startTimeUnixNano: new Date(s.startTime).getTime() * 1000000,
                endTimeUnixNano: s.endTime
                  ? new Date(s.endTime).getTime() * 1000000
                  : (new Date(s.startTime).getTime() + (s.durationMs ?? 0)) * 1000000,
                status: {
                  code: s.status === 'ok' ? 1 : 2,
                },
                attributes: Object.entries(s.attributes ?? {}).map(([key, value]) => ({
                  key,
                  value:
                    typeof value === 'string'
                      ? { stringValue: value }
                      : typeof value === 'number'
                        ? { intValue: value }
                        : { boolValue: value },
                })),
              })),
            },
          ],
        },
      ],
    };
  }

  /**
   * Format logs for OTLP
   */
  private formatOTLPLogs(
    logs: readonly unknown[],
    resourceAttributes?: Record<string, string>
  ): unknown {
    const severityMap: Record<string, number> = {
      DEBUG: 5,
      INFO: 9,
      WARN: 13,
      ERROR: 17,
      FATAL: 21,
    };

    return {
      resourceLogs: [
        {
          resource: {
            attributes: Object.entries(resourceAttributes ?? {}).map(([key, value]) => ({
              key,
              value: { stringValue: value },
            })),
          },
          scopeLogs: [
            {
              scope: {
                name: 'agentics-simulation-runner',
                version: '1.0.0',
              },
              logRecords: logs.map((l: any) => ({
                timeUnixNano: new Date(l.timestamp).getTime() * 1000000,
                severityNumber: severityMap[l.level] ?? 9,
                severityText: l.level ?? 'INFO',
                body: { stringValue: l.message },
                attributes: Object.entries(l.context ?? {}).map(([key, value]) => ({
                  key,
                  value: { stringValue: String(value) },
                })),
              })),
            },
          ],
        },
      ],
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Validate backend supports metrics export
   */
  private validateMetricsBackend(backend: TelemetryBackend): void {
    const metricsBackends: TelemetryBackendType[] = ['prometheus', 'datadog', 'otlp', 'newrelic', 'grafana', 'custom'];
    if (!metricsBackends.includes(backend.type)) {
      throw new Error(`Backend type ${backend.type} does not support metrics export`);
    }
  }

  /**
   * Validate backend supports traces export
   */
  private validateTracesBackend(backend: TelemetryBackend): void {
    const tracesBackends: TelemetryBackendType[] = ['jaeger', 'datadog', 'otlp', 'newrelic', 'grafana', 'custom'];
    if (!tracesBackends.includes(backend.type)) {
      throw new Error(`Backend type ${backend.type} does not support traces export`);
    }
  }

  /**
   * Validate backend supports logs export
   */
  private validateLogsBackend(backend: TelemetryBackend): void {
    const logsBackends: TelemetryBackendType[] = ['elasticsearch', 'datadog', 'otlp', 'newrelic', 'grafana', 'custom'];
    if (!logsBackends.includes(backend.type)) {
      throw new Error(`Backend type ${backend.type} does not support logs export`);
    }
  }

  /**
   * Create batches from an array
   */
  private createBatches<T>(items: readonly T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize) as T[]);
    }
    return batches;
  }

  /**
   * Apply filter to telemetry data
   */
  private applyFilter<T>(data: T[], filter?: ExportFilter): T[] {
    if (!filter) return data;

    // Filter implementation would go here
    // For now, return data unchanged
    return data;
  }

  /**
   * Compress payload if needed
   */
  private compressPayload(
    payload: unknown,
    compression?: 'none' | 'gzip' | 'snappy' | 'zstd'
  ): unknown {
    // Compression implementation would go here
    // For now, return payload unchanged
    if (!compression || compression === 'none') {
      return payload;
    }

    // In a real implementation, we would compress based on the method
    // For gzip: require('zlib').gzipSync(JSON.stringify(payload))
    return payload;
  }

  /**
   * Create an export error
   */
  private createExportError(
    code: string,
    message: string,
    itemIndex?: number,
    retryable: boolean = true
  ): ExportError {
    return {
      code,
      message,
      itemIndex,
      retryable,
      timestamp: new Date().toISOString() as ISO8601Timestamp,
    };
  }

  /**
   * Create a success result
   */
  private createSuccessResult(
    itemsExported: number,
    itemsAttempted: number,
    startedAt: ISO8601Timestamp,
    backend: TelemetryBackend
  ): ExportResult {
    const now = new Date().toISOString() as ISO8601Timestamp;
    return {
      success: true,
      status: 'success',
      itemsExported,
      itemsAttempted,
      itemsFailed: 0,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      startedAt,
      completedAt: now,
      backend: {
        type: backend.type,
        endpoint: backend.endpoint,
        name: backend.name,
      },
    };
  }

  /**
   * Create a result from export outcome
   */
  private createResult(
    itemsExported: number,
    itemsAttempted: number,
    errors: ExportError[],
    startedAt: ISO8601Timestamp,
    backend: TelemetryBackend
  ): ExportResult {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const itemsFailed = itemsAttempted - itemsExported;

    let status: ExportStatus;
    if (itemsFailed === 0) {
      status = 'success';
    } else if (itemsExported === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    return {
      success: status !== 'failed',
      status,
      itemsExported,
      itemsAttempted,
      itemsFailed,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      startedAt,
      completedAt: now,
      backend: {
        type: backend.type,
        endpoint: backend.endpoint,
        name: backend.name,
      },
    };
  }

  /**
   * Create a failure result
   */
  private createFailureResult(
    message: string,
    itemsAttempted: number,
    startedAt: ISO8601Timestamp,
    backend: TelemetryBackend
  ): ExportResult {
    const now = new Date().toISOString() as ISO8601Timestamp;
    return {
      success: false,
      status: 'failed',
      itemsExported: 0,
      itemsAttempted,
      itemsFailed: itemsAttempted,
      errors: [this.createExportError('EXPORT_FAILED', message)],
      durationMs: Date.now() - new Date(startedAt).getTime(),
      startedAt,
      completedAt: now,
      backend: {
        type: backend.type,
        endpoint: backend.endpoint,
        name: backend.name,
      },
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Dispose and clean up resources
   */
  public dispose(): void {
    const timers = Array.from(this.flushTimers.values());
    for (const timer of timers) {
      clearInterval(timer);
    }
    this.flushTimers.clear();
    this.backends.clear();
    this.metricBuffers.clear();
    this.traceBuffers.clear();
    this.eventBuffers.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a telemetry export surface
 */
export function createTelemetryExportSurface(): TelemetryExportSurface {
  return new TelemetryExportSurface();
}

/**
 * Export metrics to a backend using a one-off operation
 */
export async function exportMetrics(
  metrics: CapturedMetrics[],
  backend: TelemetryBackend
): Promise<ExportResult> {
  const surface = new TelemetryExportSurface();
  try {
    return await surface.exportMetrics(metrics, backend);
  } finally {
    surface.dispose();
  }
}

/**
 * Export traces to a backend using a one-off operation
 */
export async function exportTraces(
  traces: CapturedTraces[],
  backend: TelemetryBackend
): Promise<ExportResult> {
  const surface = new TelemetryExportSurface();
  try {
    return await surface.exportTraces(traces, backend);
  } finally {
    surface.dispose();
  }
}

/**
 * Export logs to a backend using a one-off operation
 */
export async function exportLogs(
  events: CapturedEvents[],
  backend: TelemetryBackend
): Promise<ExportResult> {
  const surface = new TelemetryExportSurface();
  try {
    return await surface.exportLogs(events, backend);
  } finally {
    surface.dispose();
  }
}

// =============================================================================
// Re-export Types
// =============================================================================

export type {
  TelemetryBackend,
  TelemetryBackendType,
  ExportResult,
  ExportError,
  ExportStatus,
  CapturedMetrics,
  CapturedTraces,
  CapturedEvents,
  ExportConfig,
  ExportFilter,
  ExportTransform,
  TelemetryRetryConfig,
  TelemetryCredentials,
  PrometheusConfig,
  JaegerConfig,
  ElasticsearchConfig,
  DatadogConfig,
  OTLPConfig,
} from './telemetry-types.js';
