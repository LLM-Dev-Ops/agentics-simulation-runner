/**
 * Observation Aggregator (MOD-005 Component)
 *
 * Aggregates all observations collected during execution into structured formats
 * for the SimulationResult. Implements Pseudocode Section 6 - Observation Aggregation.
 *
 * Components:
 * - aggregateMetrics: Collects and summarizes execution metrics (6.1)
 * - compileEventLog: Assembles chronological event log (6.2)
 * - assembleTraces: Constructs distributed traces (6.3)
 * - validateObservabilityCompleteness: Verifies all required observations present
 *
 * @module orchestration/observation-aggregator
 * @see SPARC_PSEUDOCODE.md Section 6 - Observation Aggregation
 * @see SPARC_ARCHITECTURE.md MOD-005 - Finalization Orchestrator
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  Count,
  Percentage,
  Metadata,
  LogLevel,
  MetricEntry,
  TraceSpan,
  AgentLifecycleEvent,
  LogEntry,
} from '../types/common.js';

import type {
  ExecutionContext,
} from '../types/execution-context.js';

import type {
  SimulationPlan,
  ObservabilityConfig,
} from '../types/simulation-plan.js';

import type {
  CapturedMetric,
  CapturedEvent,
  CapturedTrace,
  Telemetry,
  TraceLog,
  TraceSpan as ResultTraceSpan,
} from '../types/result.js';

import type {
  ExecutionTelemetry,
  AgentSummary,
  IntegrationObservation,
} from '../types/simulation-result.js';

import type {
  WorkflowResult,
  ExecutionError,
} from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Captured metrics from execution
 */
export interface CapturedMetrics {
  /**
   * All metrics captured during execution
   */
  readonly metrics: CapturedMetric[];

  /**
   * Aggregated summary metrics
   */
  readonly summary: MetricsSummary;

  /**
   * Metrics grouped by category
   */
  readonly byCategory: Record<string, CapturedMetric[]>;

  /**
   * Metrics grouped by step
   */
  readonly byStep: Record<string, CapturedMetric[]>;

  /**
   * Metrics grouped by agent
   */
  readonly byAgent: Record<string, CapturedMetric[]>;
}

/**
 * Summary of captured metrics
 */
export interface MetricsSummary {
  readonly totalMetrics: Count;
  readonly totalStepMetrics: Count;
  readonly totalAgentMetrics: Count;
  readonly totalSystemMetrics: Count;
  readonly timeRangeStart: ISO8601Timestamp;
  readonly timeRangeEnd: ISO8601Timestamp;
}

/**
 * Captured events from execution
 */
export interface CapturedEvents {
  /**
   * All events captured during execution
   */
  readonly events: CapturedEvent[];

  /**
   * Events grouped by type
   */
  readonly byType: Record<string, CapturedEvent[]>;

  /**
   * Events grouped by step
   */
  readonly byStep: Record<string, CapturedEvent[]>;

  /**
   * Event counts by type
   */
  readonly countByType: Record<string, Count>;

  /**
   * Total event count
   */
  readonly totalCount: Count;
}

/**
 * Captured traces from execution
 */
export interface CapturedTraces {
  /**
   * All traces captured during execution
   */
  readonly traces: CapturedTrace[];

  /**
   * Root spans for each trace (using ResultTraceSpan from result.ts)
   */
  readonly rootSpans: ResultTraceSpan[];

  /**
   * Total span count across all traces
   */
  readonly totalSpans: Count;

  /**
   * Average trace duration
   */
  readonly averageDurationMs: DurationMs;
}

/**
 * Result of observability completeness validation
 */
export interface ObservabilityValidationResult {
  readonly valid: boolean;
  readonly missingMetrics: string[];
  readonly missingEvents: string[];
  readonly missingTraces: string[];
  readonly warnings: string[];
  readonly coverage: Percentage;
}

// =============================================================================
// Observation Aggregator Class
// =============================================================================

/**
 * Aggregates observations from execution into structured formats
 *
 * Implements Pseudocode Section 6 observation aggregation functions
 */
export class ObservationAggregator {
  private readonly metricsBuffer: CapturedMetric[] = [];
  private readonly eventsBuffer: CapturedEvent[] = [];
  private readonly tracesBuffer: CapturedTrace[] = [];

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plan: SimulationPlan
  ) {}

  // ===========================================================================
  // Pseudocode 6.1 - aggregateMetrics
  // ===========================================================================

  /**
   * Aggregate all metrics from the execution
   *
   * Algorithm (from Pseudocode 6.1):
   * 1. Query metrics from state namespace (metrics table)
   * 2. Group metrics by category (step, agent, system)
   * 3. Compute aggregations (sum, avg, min, max, percentiles)
   * 4. Return CapturedMetrics structure
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan with observability config
   * @returns Aggregated metrics
   */
  async aggregateMetrics(): Promise<CapturedMetrics> {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const startTime = this.ctx.startTime;

    // Query metrics from telemetry collector
    // In production, this would query from the state namespace metrics table
    const rawMetrics = await this.queryMetricsFromState();

    // Group metrics by category
    const byCategory: Record<string, CapturedMetric[]> = {
      step: [],
      agent: [],
      system: [],
      custom: [],
    };

    const byStep: Record<string, CapturedMetric[]> = {};
    const byAgent: Record<string, CapturedMetric[]> = {};

    for (const metric of rawMetrics) {
      // Categorize metric
      const category = this.categorizeMetric(metric);
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(metric);

      // Group by step if applicable
      if (metric.labels?.stepId) {
        const stepId = metric.labels.stepId;
        if (!byStep[stepId]) {
          byStep[stepId] = [];
        }
        byStep[stepId].push(metric);
      }

      // Group by agent if applicable
      if (metric.labels?.agentId) {
        const agentId = metric.labels.agentId;
        if (!byAgent[agentId]) {
          byAgent[agentId] = [];
        }
        byAgent[agentId].push(metric);
      }
    }

    // Compute summary
    const summary: MetricsSummary = {
      totalMetrics: rawMetrics.length,
      totalStepMetrics: byCategory.step?.length ?? 0,
      totalAgentMetrics: byCategory.agent?.length ?? 0,
      totalSystemMetrics: byCategory.system?.length ?? 0,
      timeRangeStart: startTime,
      timeRangeEnd: now,
    };

    return {
      metrics: rawMetrics,
      summary,
      byCategory,
      byStep,
      byAgent,
    };
  }

  // ===========================================================================
  // Pseudocode 6.2 - compileEventLog
  // ===========================================================================

  /**
   * Compile all events into a chronological event log
   *
   * Algorithm (from Pseudocode 6.2):
   * 1. Query events from state namespace (events table)
   * 2. Sort events chronologically
   * 3. Group events by type and step
   * 4. Compute event statistics
   * 5. Return CapturedEvents structure
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan
   * @returns Compiled event log
   */
  async compileEventLog(): Promise<CapturedEvents> {
    // Query events from state
    const rawEvents = await this.queryEventsFromState();

    // Sort events chronologically
    const sortedEvents = [...rawEvents].sort((a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );

    // Group by type
    const byType: Record<string, CapturedEvent[]> = {};
    const countByType: Record<string, Count> = {};

    for (const event of sortedEvents) {
      if (!byType[event.eventType]) {
        byType[event.eventType] = [];
        countByType[event.eventType] = 0;
      }
      byType[event.eventType].push(event);
      countByType[event.eventType]++;
    }

    // Group by step
    const byStep: Record<string, CapturedEvent[]> = {};
    for (const event of sortedEvents) {
      const stepId = event.data.stepId as string | undefined;
      if (stepId) {
        if (!byStep[stepId]) {
          byStep[stepId] = [];
        }
        byStep[stepId].push(event);
      }
    }

    return {
      events: sortedEvents,
      byType,
      byStep,
      countByType,
      totalCount: sortedEvents.length,
    };
  }

  // ===========================================================================
  // Pseudocode 6.3 - assembleTraces
  // ===========================================================================

  /**
   * Assemble distributed traces from execution
   *
   * Algorithm (from Pseudocode 6.3):
   * 1. Query trace spans from telemetry
   * 2. Build trace tree from parent-child relationships
   * 3. Compute trace durations and statistics
   * 4. Return CapturedTraces structure
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan
   * @returns Assembled traces
   */
  async assembleTraces(): Promise<CapturedTraces> {
    // Query trace spans from telemetry
    const rawSpans = await this.queryTracesFromState();

    // Build trace trees - use ResultTraceSpan from result.ts
    const traceMap = new Map<UUID, ResultTraceSpan[]>();

    for (const span of rawSpans) {
      const traceId = span.traceId as UUID;
      if (!traceMap.has(traceId)) {
        traceMap.set(traceId, []);
      }
      traceMap.get(traceId)!.push(span);
    }

    // Build captured traces
    const traces: CapturedTrace[] = [];
    const rootSpans: ResultTraceSpan[] = [];
    let totalDurationMs = 0;

    for (const [traceId, spans] of traceMap) {
      // Find root span (no parent)
      const rootSpan = spans.find((s) => !s.parentSpanId);
      if (rootSpan) {
        rootSpans.push(rootSpan);

        // Build span tree
        const rootWithChildren = this.buildSpanTree(rootSpan, spans);

        // Calculate duration
        const duration = this.getSpanDuration(rootSpan);
        totalDurationMs += duration;

        traces.push({
          traceId,
          rootSpan: rootWithChildren,
          spanCount: spans.length,
          duration,
        });
      }
    }

    const averageDurationMs = traces.length > 0
      ? totalDurationMs / traces.length
      : 0;

    return {
      traces,
      rootSpans,
      totalSpans: rawSpans.length,
      averageDurationMs,
    };
  }

  /**
   * Get duration from a result trace span
   */
  private getSpanDuration(span: ResultTraceSpan): DurationMs {
    if (span.startTime && span.endTime) {
      return new Date(span.endTime).getTime() - new Date(span.startTime).getTime();
    }
    return 0;
  }

  // ===========================================================================
  // Observability Completeness Validation
  // ===========================================================================

  /**
   * Validate that all required observations were captured
   *
   * @param ctx - Execution context
   * @param plan - Simulation plan
   * @param metrics - Captured metrics
   * @param events - Captured events
   * @param traces - Captured traces
   * @returns Validation result
   */
  validateObservabilityCompleteness(
    metrics: CapturedMetrics,
    events: CapturedEvents,
    traces: CapturedTraces
  ): ObservabilityValidationResult {
    const missingMetrics: string[] = [];
    const missingEvents: string[] = [];
    const missingTraces: string[] = [];
    const warnings: string[] = [];

    const observabilityConfig = this.plan.observability;

    // Check required metrics
    const requiredMetrics = [
      'execution.duration_ms',
      'execution.step_count',
      'agent.invocation_count',
      'agent.token_total',
    ];

    for (const required of requiredMetrics) {
      const found = metrics.metrics.some((m) =>
        m.metricName === required || m.metricId === required
      );
      if (!found) {
        missingMetrics.push(required);
      }
    }

    // Check for step-level metrics if steps were executed
    const stepCount = this.plan.workflow.steps.length;
    if (stepCount > 0 && Object.keys(metrics.byStep).length === 0) {
      warnings.push('No step-level metrics captured despite steps being executed');
    }

    // Check for agent metrics if agents are defined
    const agentCount = this.plan.agents.length;
    if (agentCount > 0 && Object.keys(metrics.byAgent).length === 0) {
      warnings.push('No agent-level metrics captured despite agents being defined');
    }

    // Check for trace data if tracing is enabled
    if (observabilityConfig?.tracing?.enabled && traces.traces.length === 0) {
      missingTraces.push('execution_trace');
      warnings.push('Tracing enabled but no traces captured');
    }

    // Calculate coverage
    const totalRequired = requiredMetrics.length;
    const totalMissing = missingMetrics.length + missingEvents.length + missingTraces.length;
    const coverage = totalRequired > 0
      ? ((totalRequired - totalMissing) / totalRequired) as Percentage
      : 1.0 as Percentage;

    return {
      valid: missingMetrics.length === 0 && missingEvents.length === 0 && missingTraces.length === 0,
      missingMetrics,
      missingEvents,
      missingTraces,
      warnings,
      coverage,
    };
  }

  // ===========================================================================
  // Build Execution Telemetry
  // ===========================================================================

  /**
   * Build complete ExecutionTelemetry from aggregated observations
   */
  buildExecutionTelemetry(
    metrics: CapturedMetrics,
    events: CapturedEvents,
    traces: CapturedTraces,
    workflowResult: WorkflowResult
  ): ExecutionTelemetry {
    // Convert CapturedMetrics to MetricEntry[]
    const metricEntries: MetricEntry[] = metrics.metrics.map((m) => ({
      name: m.metricName,
      value: typeof m.value === 'number' ? m.value : 0,
      unit: m.aggregationType || 'count',
      timestamp: m.timeRange.end,
      labels: m.labels,
    }));

    // Convert events to AgentLifecycleEvent[]
    const agentEvents: AgentLifecycleEvent[] = events.events
      .filter((e) => e.eventType.startsWith('AGENT_'))
      .map((e) => ({
        eventId: e.eventId,
        eventType: e.eventType as AgentLifecycleEvent['eventType'],
        timestamp: e.occurredAt,
        executionId: this.ctx.executionId,
        agentId: (e.data.agentId as string) ?? 'unknown',
        payload: e.data,
      }));

    // Convert traces to TraceSpan[] (using common.ts TraceSpan)
    const traceSpans: TraceSpan[] = traces.rootSpans.map((span) => ({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.operationName ?? 'execution',
      spanType: 'simulation_execution' as const,
      startTime: span.startTime,
      endTime: span.endTime,
      durationMs: this.getSpanDuration(span),
      status: 'ok' as const,
      attributes: (span.tags ?? {}) as Record<string, string | number | boolean>,
    }));

    // Calculate performance summary
    const stepDurations = workflowResult.stepResults
      .filter((r) => r.durationMs !== undefined)
      .map((r) => r.durationMs!);

    const sortedDurations = [...stepDurations].sort((a, b) => a - b);
    const avgStepLatencyMs = stepDurations.length > 0
      ? stepDurations.reduce((sum, d) => sum + d, 0) / stepDurations.length
      : 0;

    const p50Index = Math.floor(sortedDurations.length * 0.5);
    const p95Index = Math.floor(sortedDurations.length * 0.95);
    const p99Index = Math.floor(sortedDurations.length * 0.99);

    // Build error log entries
    const errorEntries: LogEntry[] = workflowResult.errors.map((error) => ({
      timestamp: error.timestamp,
      level: 'ERROR' as LogLevel,
      executionId: this.ctx.executionId,
      component: error.stepId ?? 'orchestrator',
      message: error.message,
      context: {
        errorCode: error.errorCode,
        severity: error.severity,
        recoverable: error.recoverable,
      },
    }));

    return {
      metrics: metricEntries,
      events: agentEvents,
      traces: traceSpans,
      logsSummary: {
        totalEntries: events.events.length + errorEntries.length,
        byLevel: {
          ERROR: errorEntries.length,
          INFO: events.events.length,
        },
        errors: errorEntries,
      },
      performanceSummary: stepDurations.length > 0 ? {
        avgStepLatencyMs,
        p50StepLatencyMs: sortedDurations[p50Index] ?? 0,
        p95StepLatencyMs: sortedDurations[p95Index] ?? 0,
        p99StepLatencyMs: sortedDurations[p99Index] ?? 0,
        peakMemoryBytes: this.ctx.resourceManager.usage.memoryBytes,
        avgCpuPercent: this.ctx.resourceManager.usage.cpuPercent,
      } : undefined,
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Query metrics from state namespace
   */
  private async queryMetricsFromState(): Promise<CapturedMetric[]> {
    // In production, this would query the {namespace}_metrics table
    // For now, return metrics from the buffer
    const metrics: CapturedMetric[] = [];
    const now = new Date().toISOString() as ISO8601Timestamp;

    // Create basic execution metrics
    metrics.push(
      this.createMetric('execution.duration_ms', this.ctx.getElapsedMs(), 'gauge', now),
      this.createMetric('execution.step_count', this.ctx.currentStepSequence, 'counter', now),
      this.createMetric('execution.tokens_consumed', this.ctx.resourceManager.usage.tokensConsumed, 'counter', now),
      this.createMetric('execution.memory_bytes', this.ctx.resourceManager.usage.memoryBytes, 'gauge', now),
      this.createMetric('execution.active_agents', this.ctx.resourceManager.usage.activeAgents, 'gauge', now)
    );

    // Add agent metrics
    for (const [agentId, agentContext] of this.ctx.getAllAgentContexts()) {
      const agentMetrics = agentContext.getMetrics();
      metrics.push(
        this.createMetric('agent.invocation_count', agentMetrics.invocationCount, 'counter', now, { agentId }),
        this.createMetric('agent.token_total', agentMetrics.totalTokensConsumed, 'counter', now, { agentId }),
        this.createMetric('agent.avg_latency_ms', agentMetrics.averageLatencyMs, 'gauge', now, { agentId }),
        this.createMetric('agent.error_count', agentMetrics.errorCount, 'counter', now, { agentId })
      );
    }

    return metrics;
  }

  /**
   * Query events from state namespace
   */
  private async queryEventsFromState(): Promise<CapturedEvent[]> {
    // In production, this would query the {namespace}_events table
    // For now, return events from the buffer
    return this.eventsBuffer;
  }

  /**
   * Query trace spans from telemetry
   */
  private async queryTracesFromState(): Promise<ResultTraceSpan[]> {
    // In production, this would query trace data from telemetry backend
    // For now, return traces from the buffer
    const spans: ResultTraceSpan[] = [];

    for (const trace of this.tracesBuffer) {
      const flattenedSpans = this.flattenSpanTree(trace.rootSpan);
      spans.push(...flattenedSpans);
    }

    return spans;
  }

  /**
   * Create a CapturedMetric
   */
  private createMetric(
    name: string,
    value: number,
    aggregationType: string,
    timestamp: ISO8601Timestamp,
    labels?: Record<string, string>
  ): CapturedMetric {
    return {
      metricId: `${name}-${timestamp}`,
      metricName: name,
      aggregationType,
      value,
      sampleCount: 1,
      timeRange: {
        start: this.ctx.startTime,
        end: timestamp,
      },
      labels,
    };
  }

  /**
   * Categorize a metric into step, agent, or system
   */
  private categorizeMetric(metric: CapturedMetric): string {
    const name = metric.metricName.toLowerCase();

    if (metric.labels?.stepId || name.includes('step')) {
      return 'step';
    }
    if (metric.labels?.agentId || name.includes('agent')) {
      return 'agent';
    }
    if (name.includes('execution') || name.includes('system') || name.includes('memory')) {
      return 'system';
    }
    return 'custom';
  }

  /**
   * Build span tree from flat list of spans
   */
  private buildSpanTree(rootSpan: ResultTraceSpan, allSpans: ResultTraceSpan[]): ResultTraceSpan {
    const children = allSpans.filter((s) => s.parentSpanId === rootSpan.spanId);

    if (children.length === 0) {
      return rootSpan;
    }

    return {
      ...rootSpan,
      children: children.map((child) => this.buildSpanTree(child, allSpans)),
    } as ResultTraceSpan;
  }

  /**
   * Flatten span tree to flat list
   */
  private flattenSpanTree(span: ResultTraceSpan): ResultTraceSpan[] {
    const result: ResultTraceSpan[] = [span];

    if ('children' in span && Array.isArray((span as { children?: ResultTraceSpan[] }).children)) {
      for (const child of (span as { children: ResultTraceSpan[] }).children) {
        result.push(...this.flattenSpanTree(child));
      }
    }

    return result;
  }

  // ===========================================================================
  // Event Recording (called during execution)
  // ===========================================================================

  /**
   * Record a captured event
   */
  recordEvent(event: CapturedEvent): void {
    this.eventsBuffer.push(event);
  }

  /**
   * Record a captured metric
   */
  recordMetric(metric: CapturedMetric): void {
    this.metricsBuffer.push(metric);
  }

  /**
   * Record a captured trace
   */
  recordTrace(trace: CapturedTrace): void {
    this.tracesBuffer.push(trace);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an observation aggregator
 */
export function createObservationAggregator(
  ctx: ExecutionContext,
  plan: SimulationPlan
): ObservationAggregator {
  return new ObservationAggregator(ctx, plan);
}
