/**
 * TelemetryCollector for MOD-009 Telemetry Collector
 *
 * Captures all telemetry data (metrics, events, traces) during execution
 * with support for aggregation, compilation, and export.
 *
 * PURPOSE: Central telemetry collection system for simulation execution
 * that provides:
 * - Metric recording with labels and aggregation
 * - Event recording with structured data
 * - Distributed tracing with span management
 * - Telemetry export to external systems
 *
 * References:
 * - SPARC_ARCHITECTURE.md Section 7: MOD-009 Telemetry Capture Module
 * - SPARC_PSEUDOCODE.md Section 6: Telemetry and Observability
 *
 * Dependencies:
 * - StateRepository (MOD-014) for persistence
 * - TelemetryExportSurface (MOD-013) for external export
 *
 * @module core/telemetry-collector
 */

import { randomUUID } from 'crypto';
import type { UUID, ISO8601Timestamp, DurationMs, LogLevel } from '../types/common.js';
import type { ExecutionContext } from '../types/execution-context.js';

// Import telemetry types
import type {
  CapturedMetric,
  CapturedMetrics,
  MetricRequirements,
  RawMetricSample,
  MetricAggregationType,
  MetricStorage,
  MetricAggregator,
  MetricValue,
  HistogramValue,
} from './metric-types.js';
import { createRawMetricSample, createCapturedMetric } from './metric-types.js';

import type {
  CapturedEvent,
  CapturedEvents,
  EventRequirements,
  EventStorage,
  EventCategory,
  EventSeverity,
} from './event-types.js';
import {
  createCapturedEvent,
  inferEventCategory,
  inferEventSeverity,
  meetsSeverityThreshold,
} from './event-types.js';

import type {
  TraceSpan,
  CapturedTrace,
  CapturedTraces,
  TracingConfig,
  SpanStorage,
  SpanStatus,
} from './trace-types.js';
import {
  createTraceSpan,
  endTraceSpan,
  assembleTraceTree,
  createCapturedTrace,
  DEFAULT_TRACING_CONFIG,
} from './trace-types.js';

import {
  SpanHandle,
  SpanRegistry,
  createSpanHandle,
} from './span-handle.js';

// =============================================================================
// Telemetry Collector Configuration
// =============================================================================

/**
 * Configuration for TelemetryCollector
 */
export interface TelemetryCollectorConfig {
  /**
   * Whether telemetry collection is enabled
   */
  readonly enabled: boolean;

  /**
   * Tracing configuration
   */
  readonly tracingConfig: TracingConfig;

  /**
   * Maximum metrics to buffer before flush
   */
  readonly maxMetricBufferSize: number;

  /**
   * Maximum events to buffer before flush
   */
  readonly maxEventBufferSize: number;

  /**
   * Auto-flush interval in milliseconds
   */
  readonly flushIntervalMs: DurationMs;

  /**
   * Whether to log telemetry to console
   */
  readonly consoleLogging: boolean;

  /**
   * Log level threshold for console logging
   */
  readonly consoleLogLevel: LogLevel;
}

/**
 * Default telemetry collector configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryCollectorConfig = {
  enabled: true,
  tracingConfig: DEFAULT_TRACING_CONFIG,
  maxMetricBufferSize: 10000,
  maxEventBufferSize: 10000,
  flushIntervalMs: 5000,
  consoleLogging: false,
  consoleLogLevel: 'INFO',
};

// =============================================================================
// In-Memory Storage Implementations
// =============================================================================

/**
 * In-memory metric storage implementation
 */
class InMemoryMetricStorage implements MetricStorage {
  private samples: Map<UUID, RawMetricSample[]> = new Map();

  async store(sample: RawMetricSample): Promise<void> {
    const samples = this.samples.get(sample.executionId) ?? [];
    samples.push(sample);
    this.samples.set(sample.executionId, samples);
  }

  async storeBatch(samples: readonly RawMetricSample[]): Promise<void> {
    for (const sample of samples) {
      await this.store(sample);
    }
  }

  async query(
    executionId: UUID,
    requirements: MetricRequirements
  ): Promise<readonly RawMetricSample[]> {
    const samples = this.samples.get(executionId) ?? [];

    return samples.filter((sample) => {
      // Filter by metric name
      if (
        requirements.metricNames.length > 0 &&
        !requirements.metricNames.includes(sample.name)
      ) {
        return false;
      }

      // Filter by time range
      if (requirements.timeRange) {
        const timestamp = new Date(sample.timestamp);
        const start = new Date(requirements.timeRange.start);
        const end = new Date(requirements.timeRange.end);
        if (timestamp < start || timestamp > end) {
          return false;
        }
      }

      // Filter by labels
      if (requirements.labelFilters) {
        for (const [key, value] of Array.from(requirements.labelFilters.entries())) {
          if (sample.labels.get(key) !== value) {
            return false;
          }
        }
      }

      return true;
    });
  }

  async delete(executionId: UUID): Promise<number> {
    const samples = this.samples.get(executionId);
    const count = samples?.length ?? 0;
    this.samples.delete(executionId);
    return count;
  }
}

/**
 * In-memory event storage implementation
 */
class InMemoryEventStorage implements EventStorage {
  private events: Map<UUID, CapturedEvent[]> = new Map();

  async store(event: CapturedEvent): Promise<void> {
    const events = this.events.get(event.executionId) ?? [];
    events.push(event);
    this.events.set(event.executionId, events);
  }

  async storeBatch(events: readonly CapturedEvent[]): Promise<void> {
    for (const event of events) {
      await this.store(event);
    }
  }

  async query(
    executionId: UUID,
    requirements: EventRequirements
  ): Promise<CapturedEvents> {
    const allEvents = this.events.get(executionId) ?? [];

    let filteredEvents = allEvents.filter((event) => {
      // Filter by event type
      if (
        requirements.eventTypes &&
        requirements.eventTypes.length > 0 &&
        !requirements.eventTypes.includes(event.eventType)
      ) {
        return false;
      }

      // Filter by category
      if (
        requirements.categories &&
        requirements.categories.length > 0 &&
        !requirements.categories.includes(event.category)
      ) {
        return false;
      }

      // Filter by severity
      if (
        requirements.minSeverity &&
        !meetsSeverityThreshold(event.severity, requirements.minSeverity)
      ) {
        return false;
      }

      // Filter by step ID
      if (requirements.stepId && event.stepId !== requirements.stepId) {
        return false;
      }

      // Filter by agent ID
      if (requirements.agentId && event.agentId !== requirements.agentId) {
        return false;
      }

      // Filter by time range
      if (requirements.timeRange) {
        const timestamp = new Date(event.occurredAt);
        if (requirements.timeRange.start) {
          const start = new Date(requirements.timeRange.start);
          if (timestamp < start) return false;
        }
        if (requirements.timeRange.end) {
          const end = new Date(requirements.timeRange.end);
          if (timestamp > end) return false;
        }
      }

      // Filter by tags
      if (requirements.tags && requirements.tags.length > 0) {
        for (const tag of requirements.tags) {
          if (!event.tags.includes(tag)) {
            return false;
          }
        }
      }

      return true;
    });

    // Sort
    filteredEvents.sort((a, b) => {
      const order = requirements.sortOrder === 'DESC' ? -1 : 1;
      return (
        order *
        (new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      );
    });

    const totalCount = filteredEvents.length;

    // Apply offset and limit
    const offset = requirements.offset ?? 0;
    const limit = requirements.limit ?? 1000;
    filteredEvents = filteredEvents.slice(offset, offset + limit);

    const timeRange =
      filteredEvents.length > 0
        ? {
            start: filteredEvents[0].occurredAt,
            end: filteredEvents[filteredEvents.length - 1].occurredAt,
          }
        : undefined;

    return {
      executionId,
      events: filteredEvents,
      totalCount,
      hasMore: offset + limit < totalCount,
      timeRange,
      compiledAt: new Date().toISOString() as ISO8601Timestamp,
    };
  }

  async get(eventId: UUID): Promise<CapturedEvent | undefined> {
    for (const events of Array.from(this.events.values())) {
      const event = events.find((e) => e.eventId === eventId);
      if (event) return event;
    }
    return undefined;
  }

  async delete(executionId: UUID): Promise<number> {
    const events = this.events.get(executionId);
    const count = events?.length ?? 0;
    this.events.delete(executionId);
    return count;
  }

  async count(
    executionId: UUID,
    requirements?: EventRequirements
  ): Promise<number> {
    if (!requirements) {
      return (this.events.get(executionId) ?? []).length;
    }
    const result = await this.query(executionId, requirements);
    return result.totalCount;
  }
}

/**
 * In-memory span storage implementation
 */
class InMemorySpanStorage implements SpanStorage {
  private spans: Map<UUID, TraceSpan[]> = new Map();

  async store(span: TraceSpan): Promise<void> {
    const spans = this.spans.get(span.executionId) ?? [];
    spans.push(span);
    this.spans.set(span.executionId, spans);
  }

  async storeBatch(spans: readonly TraceSpan[]): Promise<void> {
    for (const span of spans) {
      await this.store(span);
    }
  }

  async getByTraceId(traceId: UUID): Promise<readonly TraceSpan[]> {
    const allSpans: TraceSpan[] = [];
    for (const spans of Array.from(this.spans.values())) {
      for (const span of spans) {
        if (span.traceId === traceId) {
          allSpans.push(span);
        }
      }
    }
    return allSpans;
  }

  async get(spanId: UUID): Promise<TraceSpan | undefined> {
    for (const spans of Array.from(this.spans.values())) {
      const span = spans.find((s) => s.spanId === spanId);
      if (span) return span;
    }
    return undefined;
  }

  async getRootSpans(executionId: UUID): Promise<readonly TraceSpan[]> {
    const spans = this.spans.get(executionId) ?? [];
    return spans.filter((span) => !span.parentSpanId);
  }

  async getChildren(parentSpanId: UUID): Promise<readonly TraceSpan[]> {
    const children: TraceSpan[] = [];
    for (const spans of Array.from(this.spans.values())) {
      for (const span of spans) {
        if (span.parentSpanId === parentSpanId) {
          children.push(span);
        }
      }
    }
    return children;
  }

  async delete(executionId: UUID): Promise<number> {
    const spans = this.spans.get(executionId);
    const count = spans?.length ?? 0;
    this.spans.delete(executionId);
    return count;
  }

  async update(spanId: UUID, updates: Partial<TraceSpan>): Promise<void> {
    for (const spans of Array.from(this.spans.values())) {
      const index = spans.findIndex((s) => s.spanId === spanId);
      if (index !== -1) {
        spans[index] = { ...spans[index], ...updates };
        return;
      }
    }
  }
}

// =============================================================================
// Default Metric Aggregator Implementation
// =============================================================================

/**
 * Default metric aggregator implementation
 */
class DefaultMetricAggregator implements MetricAggregator {
  sum(values: readonly number[]): number {
    return values.reduce((acc, val) => acc + val, 0);
  }

  avg(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return this.sum(values) / values.length;
  }

  max(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return Math.max(...values);
  }

  min(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return Math.min(...values);
  }

  count(values: readonly number[]): number {
    return values.length;
  }

  percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  histogram(
    values: readonly number[],
    buckets: readonly number[]
  ): HistogramValue {
    const bucketCounts = buckets.map((upperBound) => ({
      upperBound,
      count: values.filter((v) => v <= upperBound).length,
    }));

    return {
      buckets: bucketCounts,
      sum: this.sum(values),
      count: values.length,
      min: values.length > 0 ? this.min(values) : 0,
      max: values.length > 0 ? this.max(values) : 0,
    };
  }
}

// =============================================================================
// TelemetryCollector Class
// =============================================================================

/**
 * TelemetryCollector - Main telemetry collection class
 *
 * Captures all telemetry data (metrics, events, traces) during execution
 * and provides aggregation and export capabilities.
 */
export class TelemetryCollector {
  private readonly config: TelemetryCollectorConfig;
  private readonly metricStorage: MetricStorage;
  private readonly eventStorage: EventStorage;
  private readonly spanStorage: SpanStorage;
  private readonly aggregator: MetricAggregator;
  private readonly spanRegistry: SpanRegistry;

  private eventSequence: Map<UUID, number> = new Map();
  private flushTimer?: ReturnType<typeof setInterval>;
  private metricBuffer: RawMetricSample[] = [];
  private eventBuffer: CapturedEvent[] = [];

  constructor(
    config: Partial<TelemetryCollectorConfig> = {},
    dependencies?: {
      metricStorage?: MetricStorage;
      eventStorage?: EventStorage;
      spanStorage?: SpanStorage;
      aggregator?: MetricAggregator;
    }
  ) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.metricStorage = dependencies?.metricStorage ?? new InMemoryMetricStorage();
    this.eventStorage = dependencies?.eventStorage ?? new InMemoryEventStorage();
    this.spanStorage = dependencies?.spanStorage ?? new InMemorySpanStorage();
    this.aggregator = dependencies?.aggregator ?? new DefaultMetricAggregator();
    this.spanRegistry = new SpanRegistry();

    if (this.config.enabled && this.config.flushIntervalMs > 0) {
      this.startAutoFlush();
    }
  }

  // ===========================================================================
  // Metric Operations
  // ===========================================================================

  /**
   * Record a metric with labels
   *
   * Records a metric sample with the given name, value, and labels.
   * The sample is persisted to the state substrate for later aggregation.
   *
   * @param ctx - Execution context
   * @param name - Metric name (e.g., "simulation.step.duration")
   * @param value - Metric value
   * @param labels - Labels for the metric
   */
  recordMetric(
    ctx: ExecutionContext,
    name: string,
    value: number,
    labels: Map<string, string> = new Map()
  ): void {
    if (!this.config.enabled) return;

    const sample = createRawMetricSample({
      name,
      value,
      executionId: ctx.executionId,
      labels,
      stepId: ctx.currentStepId,
    });

    this.metricBuffer.push(sample);

    if (this.metricBuffer.length >= this.config.maxMetricBufferSize) {
      void this.flushMetrics();
    }

    if (this.config.consoleLogging) {
      console.log(`[METRIC] ${name}=${value}`, Object.fromEntries(labels));
    }
  }

  /**
   * Aggregate metrics per observability spec
   *
   * Aggregates raw metric samples according to the provided requirements,
   * supporting SUM, AVG, MAX, MIN, COUNT, P50, P95, P99, and HISTOGRAM.
   *
   * @param ctx - Execution context
   * @param requirements - Aggregation requirements
   * @returns Aggregated metrics
   */
  async aggregateMetrics(
    ctx: ExecutionContext,
    requirements: MetricRequirements
  ): Promise<CapturedMetrics> {
    // Flush buffer first to ensure all metrics are available
    await this.flushMetrics();

    const samples = await this.metricStorage.query(
      ctx.executionId,
      requirements
    );

    // Group samples by metric name
    const groupedSamples = new Map<string, RawMetricSample[]>();
    for (const sample of samples) {
      const existing = groupedSamples.get(sample.name) ?? [];
      existing.push(sample);
      groupedSamples.set(sample.name, existing);
    }

    const capturedMetrics: CapturedMetric[] = [];
    let totalSamples = 0;

    for (const [metricName, metricSamples] of Array.from(groupedSamples.entries())) {
      const values = metricSamples.map((s) => s.value);
      totalSamples += values.length;

      // Get time range for this metric
      const timestamps = metricSamples.map((s) => new Date(s.timestamp));
      const timeRange = {
        start: new Date(Math.min(...timestamps.map((t) => t.getTime()))).toISOString() as ISO8601Timestamp,
        end: new Date(Math.max(...timestamps.map((t) => t.getTime()))).toISOString() as ISO8601Timestamp,
      };

      // Compute each requested aggregation type
      for (const aggregationType of requirements.aggregationTypes) {
        const aggregatedValue = this.computeAggregation(
          aggregationType,
          values,
          requirements.histogramBuckets
        );

        const capturedMetric = createCapturedMetric({
          metricId: randomUUID() as UUID,
          metricName,
          aggregationType,
          value: aggregatedValue,
          sampleCount: values.length,
          timeRange,
          labels: metricSamples[0]?.labels ?? new Map(),
        });

        capturedMetrics.push(capturedMetric);
      }
    }

    // Compute overall time range
    const allTimestamps = samples.map((s) => new Date(s.timestamp));
    const overallTimeRange =
      allTimestamps.length > 0
        ? {
            start: new Date(Math.min(...allTimestamps.map((t) => t.getTime()))).toISOString() as ISO8601Timestamp,
            end: new Date(Math.max(...allTimestamps.map((t) => t.getTime()))).toISOString() as ISO8601Timestamp,
          }
        : {
            start: new Date().toISOString() as ISO8601Timestamp,
            end: new Date().toISOString() as ISO8601Timestamp,
          };

    return {
      executionId: ctx.executionId,
      metrics: capturedMetrics,
      totalSamples,
      timeRange: overallTimeRange,
      aggregatedAt: new Date().toISOString() as ISO8601Timestamp,
    };
  }

  private computeAggregation(
    type: MetricAggregationType,
    values: number[],
    histogramBuckets?: readonly number[]
  ): MetricValue {
    switch (type) {
      case 'SUM':
        return this.aggregator.sum(values);
      case 'AVG':
        return this.aggregator.avg(values);
      case 'MAX':
        return this.aggregator.max(values);
      case 'MIN':
        return this.aggregator.min(values);
      case 'COUNT':
        return this.aggregator.count(values);
      case 'P50':
        return this.aggregator.percentile(values, 50);
      case 'P95':
        return this.aggregator.percentile(values, 95);
      case 'P99':
        return this.aggregator.percentile(values, 99);
      case 'HISTOGRAM':
        return this.aggregator.histogram(
          values,
          histogramBuckets ?? [1, 5, 10, 25, 50, 100, 250, 500, 1000]
        );
    }
  }

  // ===========================================================================
  // Event Operations
  // ===========================================================================

  /**
   * Record an event with structured data
   *
   * Records an event with the given type and data. Events are
   * automatically timestamped and assigned sequence numbers.
   *
   * @param ctx - Execution context
   * @param eventType - Type of event (e.g., "agent.invoked")
   * @param eventData - Structured event data
   * @param options - Optional event metadata
   */
  recordEvent(
    ctx: ExecutionContext,
    eventType: string,
    eventData: Record<string, unknown>,
    options?: {
      severity?: EventSeverity;
      category?: EventCategory;
      correlationId?: string;
      parentEventId?: string;
      tags?: string[];
      stepId?: string;
      agentId?: string;
    }
  ): void {
    if (!this.config.enabled) return;

    const sequence = this.getNextEventSequence(ctx.executionId);

    const event = createCapturedEvent({
      eventId: randomUUID() as UUID,
      eventType,
      data: eventData,
      executionId: ctx.executionId,
      sequenceNumber: sequence,
      category: options?.category ?? inferEventCategory(eventType),
      severity: options?.severity ?? inferEventSeverity(eventType),
      stepId: options?.stepId ?? ctx.currentStepId,
      correlationId: options?.correlationId,
      parentEventId: options?.parentEventId,
      tags: options?.tags,
    });

    this.eventBuffer.push(event);

    if (this.eventBuffer.length >= this.config.maxEventBufferSize) {
      void this.flushEvents();
    }

    if (this.config.consoleLogging) {
      console.log(`[EVENT] ${eventType}`, eventData);
    }
  }

  /**
   * Compile events per observability spec
   *
   * Compiles events according to the provided requirements with
   * filtering, pagination, and sorting.
   *
   * @param ctx - Execution context
   * @param requirements - Event compilation requirements
   * @returns Compiled events
   */
  async compileEvents(
    ctx: ExecutionContext,
    requirements: EventRequirements
  ): Promise<CapturedEvents> {
    // Flush buffer first to ensure all events are available
    await this.flushEvents();

    return this.eventStorage.query(ctx.executionId, requirements);
  }

  private getNextEventSequence(executionId: UUID): number {
    const current = this.eventSequence.get(executionId) ?? 0;
    const next = current + 1;
    this.eventSequence.set(executionId, next);
    return next;
  }

  // ===========================================================================
  // Trace Operations
  // ===========================================================================

  /**
   * Start a trace span
   *
   * Creates and starts a new trace span for the given operation.
   * If a parent span ID is provided, the new span is linked as a child.
   *
   * @param ctx - Execution context
   * @param operationName - Name of the operation
   * @param parentSpanId - Optional parent span ID
   * @returns SpanHandle for managing the span
   */
  startSpan(
    ctx: ExecutionContext,
    operationName: string,
    parentSpanId?: string
  ): SpanHandle {
    const spanId = randomUUID() as UUID;

    // Generate or reuse trace ID
    let traceId: UUID;
    if (parentSpanId) {
      const parentHandle = this.spanRegistry.get(parentSpanId as UUID);
      traceId = parentHandle?.traceId ?? (randomUUID() as UUID);
    } else {
      traceId = randomUUID() as UUID;
    }

    const handle = createSpanHandle({
      spanId,
      traceId,
      operationName,
      executionId: ctx.executionId,
      parentSpanId: parentSpanId as UUID | undefined,
      stepId: ctx.currentStepId,
    });

    this.spanRegistry.register(handle);

    if (this.config.consoleLogging) {
      console.log(`[SPAN START] ${operationName} (${spanId})`);
    }

    return handle;
  }

  /**
   * End a trace span
   *
   * Ends the span with the given status and persists it to storage.
   *
   * @param handle - SpanHandle to end
   * @param status - Final status of the span
   */
  endSpan(handle: SpanHandle, status: SpanStatus): void {
    if (handle.isEnded) {
      return; // Already ended
    }

    const traceSpan = handle.toTraceSpan(status);
    handle.markEnded();

    this.spanRegistry.unregister(handle.spanId);

    // Store the span
    void this.spanStorage.store(traceSpan);

    if (this.config.consoleLogging) {
      console.log(
        `[SPAN END] ${handle.operationName} (${handle.spanId}) - ${status} - ${handle.getElapsedMs()}ms`
      );
    }
  }

  /**
   * Assemble complete trace trees
   *
   * Assembles trace spans into hierarchical trace trees.
   *
   * @param ctx - Execution context
   * @param config - Tracing configuration
   * @returns Assembled traces
   */
  async assembleTraces(
    ctx: ExecutionContext,
    config: TracingConfig = this.config.tracingConfig
  ): Promise<CapturedTraces> {
    const rootSpans = await this.spanStorage.getRootSpans(ctx.executionId);
    const traces: CapturedTrace[] = [];
    let totalSpanCount = 0;

    for (const rootSpan of rootSpans) {
      // Get all spans for this trace
      const traceSpans = await this.spanStorage.getByTraceId(rootSpan.traceId);
      totalSpanCount += traceSpans.length;

      // Assemble the tree
      const assembledRoot = assembleTraceTree(traceSpans);
      if (assembledRoot) {
        const capturedTrace = createCapturedTrace(
          rootSpan.traceId,
          assembledRoot,
          ctx.executionId
        );
        traces.push(capturedTrace);
      }
    }

    return {
      executionId: ctx.executionId,
      traces,
      totalCount: traces.length,
      totalSpanCount,
      assembledAt: new Date().toISOString() as ISO8601Timestamp,
    };
  }

  // ===========================================================================
  // Flush Operations
  // ===========================================================================

  /**
   * Flush all buffered telemetry data
   */
  async flush(): Promise<void> {
    await Promise.all([this.flushMetrics(), this.flushEvents()]);
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) return;

    const samples = [...this.metricBuffer];
    this.metricBuffer = [];

    await this.metricStorage.storeBatch(samples);
  }

  private async flushEvents(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    await this.eventStorage.storeBatch(events);
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  // ===========================================================================
  // Cleanup Operations
  // ===========================================================================

  /**
   * Stop the telemetry collector
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining data
    await this.flush();
  }

  /**
   * Clear telemetry data for an execution
   */
  async clear(executionId: UUID): Promise<void> {
    await Promise.all([
      this.metricStorage.delete(executionId),
      this.eventStorage.delete(executionId),
      this.spanStorage.delete(executionId),
    ]);

    this.eventSequence.delete(executionId);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get the span registry for managing active spans
   */
  getSpanRegistry(): SpanRegistry {
    return this.spanRegistry;
  }

  /**
   * Get the current configuration
   */
  getConfig(): TelemetryCollectorConfig {
    return { ...this.config };
  }

  /**
   * Check if telemetry collection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get buffer sizes for monitoring
   */
  getBufferSizes(): { metrics: number; events: number } {
    return {
      metrics: this.metricBuffer.length,
      events: this.eventBuffer.length,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new TelemetryCollector with the given configuration
 */
export function createTelemetryCollector(
  config: Partial<TelemetryCollectorConfig> = {},
  dependencies?: {
    metricStorage?: MetricStorage;
    eventStorage?: EventStorage;
    spanStorage?: SpanStorage;
    aggregator?: MetricAggregator;
  }
): TelemetryCollector {
  return new TelemetryCollector(config, dependencies);
}

// =============================================================================
// Telemetry Collector Adapter
// =============================================================================

/**
 * Adapter implementing the TelemetryCollector interface from execution-context.ts
 *
 * This adapter wraps the full TelemetryCollector to provide the simpler
 * interface expected by ExecutionContext.
 */
export class TelemetryCollectorAdapter {
  private readonly collector: TelemetryCollector;
  private readonly executionId: UUID;

  constructor(collector: TelemetryCollector, executionId: UUID) {
    this.collector = collector;
    this.executionId = executionId;
  }

  /**
   * Start a trace span
   */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): SpanHandle {
    // Create a minimal execution context for the call
    const ctx = { executionId: this.executionId } as ExecutionContext;
    const handle = this.collector.startSpan(ctx, name);

    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        handle.addTag(key, String(value));
      }
    }

    return handle;
  }

  /**
   * Record a metric
   */
  recordMetric(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    const ctx = { executionId: this.executionId } as ExecutionContext;
    const labelsMap = labels ? new Map(Object.entries(labels)) : new Map();
    this.collector.recordMetric(ctx, name, value, labelsMap);
  }

  /**
   * Emit a log entry
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const ctx = { executionId: this.executionId } as ExecutionContext;
    this.collector.recordEvent(ctx, `log.${level.toLowerCase()}`, {
      level,
      message,
      ...context,
    });
  }

  /**
   * Emit an event
   */
  emitEvent(eventType: string, payload: Record<string, unknown>): void {
    const ctx = { executionId: this.executionId } as ExecutionContext;
    this.collector.recordEvent(ctx, eventType, payload);
  }

  /**
   * Flush all pending telemetry
   */
  async flush(): Promise<void> {
    await this.collector.flush();
  }
}

/**
 * Create a telemetry collector adapter for an execution
 */
export function createTelemetryAdapter(
  collector: TelemetryCollector,
  executionId: UUID
): TelemetryCollectorAdapter {
  return new TelemetryCollectorAdapter(collector, executionId);
}
