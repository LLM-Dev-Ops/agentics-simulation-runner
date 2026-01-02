/**
 * Trace Types for MOD-009 Telemetry Collector
 *
 * Defines trace-related types for the telemetry system including
 * trace spans, captured traces, and trace assembly.
 *
 * References:
 * - SPARC_ARCHITECTURE.md Section 7: Telemetry Capture Module
 * - SPARC_PSEUDOCODE.md Section 6.3: Trace Assembly
 *
 * @module core/trace-types
 */

import type { UUID, ISO8601Timestamp, DurationMs } from '../types/common.js';

// =============================================================================
// Span Status Types
// =============================================================================

/**
 * Status of a trace span
 */
export type SpanStatus = 'OK' | 'ERROR' | 'UNSET';

/**
 * Kind of span indicating its role in the trace
 */
export type SpanKind =
  | 'INTERNAL'    // Internal operation
  | 'CLIENT'      // Outgoing request
  | 'SERVER'      // Incoming request
  | 'PRODUCER'    // Message producer
  | 'CONSUMER';   // Message consumer

// =============================================================================
// Trace Span Types
// =============================================================================

/**
 * Log entry within a span
 */
export interface SpanLog {
  /**
   * When the log was recorded
   */
  readonly timestamp: ISO8601Timestamp;

  /**
   * Log message
   */
  readonly message: string;

  /**
   * Additional attributes
   */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * TraceSpan type from Pseudocode 6.3
 *
 * Represents a single span in a distributed trace with support for
 * parent-child relationships and hierarchical assembly.
 */
export interface TraceSpan {
  /**
   * Unique span identifier
   */
  readonly spanId: UUID;

  /**
   * Trace identifier (shared by all spans in the trace)
   */
  readonly traceId: UUID;

  /**
   * Parent span identifier (optional for root spans)
   */
  readonly parentSpanId?: UUID;

  /**
   * Name of the operation this span represents
   */
  readonly operationName: string;

  /**
   * Kind of span
   */
  readonly kind: SpanKind;

  /**
   * When the span started
   */
  readonly startTime: ISO8601Timestamp;

  /**
   * When the span ended (undefined if still active)
   */
  readonly endTime?: ISO8601Timestamp;

  /**
   * Duration in milliseconds (computed from start/end)
   */
  readonly durationMs?: DurationMs;

  /**
   * Status of the span
   */
  readonly status: SpanStatus;

  /**
   * Status message (for ERROR status)
   */
  readonly statusMessage?: string;

  /**
   * Span tags/attributes
   */
  readonly tags: ReadonlyMap<string, string>;

  /**
   * Span logs
   */
  readonly logs: readonly SpanLog[];

  /**
   * Child spans (populated during trace assembly)
   */
  readonly children: readonly TraceSpan[];

  /**
   * Execution ID this span belongs to
   */
  readonly executionId: UUID;

  /**
   * Step ID if this span is step-scoped
   */
  readonly stepId?: string;

  /**
   * Agent ID if this span is agent-scoped
   */
  readonly agentId?: string;
}

// =============================================================================
// Captured Trace Types
// =============================================================================

/**
 * CapturedTrace type from Pseudocode 6.3
 *
 * Represents a complete trace tree assembled from individual spans.
 */
export interface CapturedTrace {
  /**
   * Unique trace identifier
   */
  readonly traceId: UUID;

  /**
   * Root span of the trace tree
   */
  readonly rootSpan: TraceSpan;

  /**
   * Total number of spans in the trace
   */
  readonly spanCount: number;

  /**
   * Total duration of the trace (root span duration)
   */
  readonly totalDurationMs: DurationMs;

  /**
   * Execution ID this trace belongs to
   */
  readonly executionId: UUID;

  /**
   * When the trace started (root span start)
   */
  readonly startTime: ISO8601Timestamp;

  /**
   * When the trace ended (root span end)
   */
  readonly endTime: ISO8601Timestamp;

  /**
   * Overall status (ERROR if any span has error)
   */
  readonly status: SpanStatus;

  /**
   * List of all span IDs in the trace (flattened)
   */
  readonly spanIds: readonly UUID[];

  /**
   * When the trace was assembled
   */
  readonly assembledAt: ISO8601Timestamp;
}

/**
 * Collection of captured traces
 */
export interface CapturedTraces {
  /**
   * Execution ID these traces belong to
   */
  readonly executionId: UUID;

  /**
   * List of captured traces
   */
  readonly traces: readonly CapturedTrace[];

  /**
   * Total number of traces
   */
  readonly totalCount: number;

  /**
   * Total number of spans across all traces
   */
  readonly totalSpanCount: number;

  /**
   * When the traces were assembled
   */
  readonly assembledAt: ISO8601Timestamp;
}

// =============================================================================
// Tracing Configuration Types
// =============================================================================

/**
 * Configuration for trace assembly
 */
export interface TracingConfig {
  /**
   * Whether tracing is enabled
   */
  readonly enabled: boolean;

  /**
   * Sampling rate (0.0 to 1.0)
   */
  readonly samplingRate: number;

  /**
   * Maximum spans per trace
   */
  readonly maxSpansPerTrace: number;

  /**
   * Maximum trace duration before auto-close (ms)
   */
  readonly maxTraceDurationMs: DurationMs;

  /**
   * Whether to include span logs
   */
  readonly includeSpanLogs: boolean;

  /**
   * Maximum logs per span
   */
  readonly maxLogsPerSpan: number;

  /**
   * Operation name patterns to exclude from tracing
   */
  readonly excludePatterns?: readonly string[];

  /**
   * Whether to propagate trace context
   */
  readonly propagateContext: boolean;
}

/**
 * Default tracing configuration
 */
export const DEFAULT_TRACING_CONFIG: TracingConfig = {
  enabled: true,
  samplingRate: 1.0,
  maxSpansPerTrace: 1000,
  maxTraceDurationMs: 3600000, // 1 hour
  includeSpanLogs: true,
  maxLogsPerSpan: 100,
  excludePatterns: [],
  propagateContext: true,
};

// =============================================================================
// Span Storage Interface
// =============================================================================

/**
 * Span storage interface for persisting spans
 */
export interface SpanStorage {
  /**
   * Store a span
   */
  store(span: TraceSpan): Promise<void>;

  /**
   * Store multiple spans
   */
  storeBatch(spans: readonly TraceSpan[]): Promise<void>;

  /**
   * Get all spans for a trace
   */
  getByTraceId(traceId: UUID): Promise<readonly TraceSpan[]>;

  /**
   * Get span by ID
   */
  get(spanId: UUID): Promise<TraceSpan | undefined>;

  /**
   * Get all root spans for an execution
   */
  getRootSpans(executionId: UUID): Promise<readonly TraceSpan[]>;

  /**
   * Get child spans of a parent
   */
  getChildren(parentSpanId: UUID): Promise<readonly TraceSpan[]>;

  /**
   * Delete spans for an execution
   */
  delete(executionId: UUID): Promise<number>;

  /**
   * Update span (for ending spans)
   */
  update(spanId: UUID, updates: Partial<TraceSpan>): Promise<void>;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new TraceSpan
 */
export function createTraceSpan(params: {
  spanId: UUID;
  traceId: UUID;
  operationName: string;
  executionId: UUID;
  parentSpanId?: UUID;
  kind?: SpanKind;
  stepId?: string;
  agentId?: string;
  tags?: ReadonlyMap<string, string>;
}): TraceSpan {
  return {
    spanId: params.spanId,
    traceId: params.traceId,
    parentSpanId: params.parentSpanId,
    operationName: params.operationName,
    kind: params.kind ?? 'INTERNAL',
    startTime: new Date().toISOString() as ISO8601Timestamp,
    endTime: undefined,
    durationMs: undefined,
    status: 'UNSET',
    statusMessage: undefined,
    tags: params.tags ?? new Map(),
    logs: [],
    children: [],
    executionId: params.executionId,
    stepId: params.stepId,
    agentId: params.agentId,
  };
}

/**
 * End a trace span
 */
export function endTraceSpan(
  span: TraceSpan,
  status: SpanStatus,
  statusMessage?: string
): TraceSpan {
  const endTime = new Date();
  const startTime = new Date(span.startTime);
  const durationMs = endTime.getTime() - startTime.getTime();

  return {
    ...span,
    endTime: endTime.toISOString() as ISO8601Timestamp,
    durationMs: durationMs as DurationMs,
    status,
    statusMessage,
  };
}

/**
 * Add a log to a span
 */
export function addSpanLog(
  span: TraceSpan,
  message: string,
  attributes?: Record<string, string | number | boolean>
): TraceSpan {
  const newLog: SpanLog = {
    timestamp: new Date().toISOString() as ISO8601Timestamp,
    message,
    attributes,
  };

  return {
    ...span,
    logs: [...span.logs, newLog],
  };
}

/**
 * Add a tag to a span
 */
export function addSpanTag(
  span: TraceSpan,
  key: string,
  value: string
): TraceSpan {
  const newTags = new Map(span.tags);
  newTags.set(key, value);

  return {
    ...span,
    tags: newTags,
  };
}

/**
 * Create a CapturedTrace from a root span
 */
export function createCapturedTrace(
  traceId: UUID,
  rootSpan: TraceSpan,
  executionId: UUID
): CapturedTrace {
  const spanIds = collectSpanIds(rootSpan);
  const status = computeTraceStatus(rootSpan);

  return {
    traceId,
    rootSpan,
    spanCount: spanIds.length,
    totalDurationMs: rootSpan.durationMs ?? 0,
    executionId,
    startTime: rootSpan.startTime,
    endTime: rootSpan.endTime ?? rootSpan.startTime,
    status,
    spanIds,
    assembledAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Collect all span IDs from a span tree
 */
function collectSpanIds(span: TraceSpan): UUID[] {
  const ids: UUID[] = [span.spanId];
  for (const child of span.children) {
    ids.push(...collectSpanIds(child));
  }
  return ids;
}

/**
 * Compute overall trace status from span tree
 */
function computeTraceStatus(span: TraceSpan): SpanStatus {
  if (span.status === 'ERROR') {
    return 'ERROR';
  }
  for (const child of span.children) {
    if (computeTraceStatus(child) === 'ERROR') {
      return 'ERROR';
    }
  }
  return span.status;
}

/**
 * Assemble spans into a trace tree
 */
export function assembleTraceTree(
  spans: readonly TraceSpan[]
): TraceSpan | undefined {
  if (spans.length === 0) {
    return undefined;
  }

  // Create a map of spanId -> span with mutable children
  const spanMap = new Map<UUID, TraceSpan & { children: TraceSpan[] }>();

  for (const span of spans) {
    spanMap.set(span.spanId, { ...span, children: [] });
  }

  // Find root span and build tree
  let rootSpan: TraceSpan | undefined;

  for (const span of Array.from(spanMap.values())) {
    if (span.parentSpanId) {
      const parent = spanMap.get(span.parentSpanId);
      if (parent) {
        parent.children.push(span);
      }
    } else {
      rootSpan = span;
    }
  }

  return rootSpan;
}

/**
 * Flatten a trace tree into a list of spans
 */
export function flattenTraceTree(span: TraceSpan): TraceSpan[] {
  const spans: TraceSpan[] = [span];
  for (const child of span.children) {
    spans.push(...flattenTraceTree(child));
  }
  return spans;
}

/**
 * Create default tracing config
 */
export function createTracingConfig(
  overrides: Partial<TracingConfig> = {}
): TracingConfig {
  return {
    ...DEFAULT_TRACING_CONFIG,
    ...overrides,
  };
}
