/**
 * SpanHandle for MOD-009 Telemetry Collector
 *
 * Provides a handle for managing active trace spans with methods
 * for adding tags, logs, and ending the span.
 *
 * References:
 * - SPARC_ARCHITECTURE.md Section 7: Telemetry Capture Module
 * - SPARC_PSEUDOCODE.md Section 6.3: Trace Assembly
 *
 * @module core/span-handle
 */

import type { UUID, ISO8601Timestamp, DurationMs } from '../types/common.js';
import type {
  TraceSpan,
  SpanStatus,
  SpanKind,
  SpanLog,
} from './trace-types.js';

// =============================================================================
// SpanHandle Interface
// =============================================================================

/**
 * Handle for managing an active trace span
 *
 * SpanHandle provides a fluent API for:
 * - Adding tags (key-value attributes)
 * - Adding logs (timestamped messages)
 * - Ending the span with a status
 *
 * The handle is immutable - all operations return a new state
 * that must be committed via endSpan.
 */
export interface ISpanHandle {
  /**
   * Unique span identifier
   */
  readonly spanId: UUID;

  /**
   * Trace identifier
   */
  readonly traceId: UUID;

  /**
   * Parent span identifier (optional)
   */
  readonly parentSpanId?: UUID;

  /**
   * Operation name
   */
  readonly operationName: string;

  /**
   * When the span started
   */
  readonly startTime: ISO8601Timestamp;

  /**
   * Accumulated tags
   */
  readonly tags: ReadonlyMap<string, string>;

  /**
   * Accumulated logs
   */
  readonly logs: readonly SpanLog[];

  /**
   * Whether the span has been ended
   */
  readonly isEnded: boolean;

  /**
   * Add a tag to the span
   */
  addTag(key: string, value: string): void;

  /**
   * Add multiple tags to the span
   */
  addTags(tags: Record<string, string>): void;

  /**
   * Add a log entry to the span
   */
  addLog(message: string, attributes?: Record<string, string | number | boolean>): void;

  /**
   * Get the current span data
   */
  getSpanData(): SpanHandleData;
}

/**
 * Data structure for span handle state
 */
export interface SpanHandleData {
  readonly spanId: UUID;
  readonly traceId: UUID;
  readonly parentSpanId?: UUID;
  readonly operationName: string;
  readonly kind: SpanKind;
  readonly startTime: ISO8601Timestamp;
  readonly tags: ReadonlyMap<string, string>;
  readonly logs: readonly SpanLog[];
  readonly executionId: UUID;
  readonly stepId?: string;
  readonly agentId?: string;
}

// =============================================================================
// SpanHandle Implementation
// =============================================================================

/**
 * SpanHandle class for managing active trace spans
 *
 * Implements the ISpanHandle interface with mutable internal state
 * that is committed when the span is ended.
 */
export class SpanHandle implements ISpanHandle {
  private readonly _spanId: UUID;
  private readonly _traceId: UUID;
  private readonly _parentSpanId?: UUID;
  private readonly _operationName: string;
  private readonly _kind: SpanKind;
  private readonly _startTime: ISO8601Timestamp;
  private readonly _executionId: UUID;
  private readonly _stepId?: string;
  private readonly _agentId?: string;
  private _tags: Map<string, string>;
  private _logs: SpanLog[];
  private _isEnded: boolean;

  constructor(params: {
    spanId: UUID;
    traceId: UUID;
    operationName: string;
    executionId: UUID;
    parentSpanId?: UUID;
    kind?: SpanKind;
    stepId?: string;
    agentId?: string;
    initialTags?: Map<string, string>;
  }) {
    this._spanId = params.spanId;
    this._traceId = params.traceId;
    this._parentSpanId = params.parentSpanId;
    this._operationName = params.operationName;
    this._kind = params.kind ?? 'INTERNAL';
    this._startTime = new Date().toISOString() as ISO8601Timestamp;
    this._executionId = params.executionId;
    this._stepId = params.stepId;
    this._agentId = params.agentId;
    this._tags = new Map(params.initialTags);
    this._logs = [];
    this._isEnded = false;
  }

  // ---------------------------------------------------------------------------
  // Readonly Properties
  // ---------------------------------------------------------------------------

  get spanId(): UUID {
    return this._spanId;
  }

  get traceId(): UUID {
    return this._traceId;
  }

  get parentSpanId(): UUID | undefined {
    return this._parentSpanId;
  }

  get operationName(): string {
    return this._operationName;
  }

  get startTime(): ISO8601Timestamp {
    return this._startTime;
  }

  get tags(): ReadonlyMap<string, string> {
    return this._tags;
  }

  get logs(): readonly SpanLog[] {
    return this._logs;
  }

  get isEnded(): boolean {
    return this._isEnded;
  }

  // ---------------------------------------------------------------------------
  // Tag Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a single tag to the span
   *
   * @param key - Tag key
   * @param value - Tag value
   * @throws Error if span has been ended
   */
  addTag(key: string, value: string): void {
    if (this._isEnded) {
      throw new SpanHandleError(
        'Cannot add tag to ended span',
        this._spanId,
        'ADD_TAG_TO_ENDED_SPAN'
      );
    }

    if (!key || typeof key !== 'string') {
      throw new SpanHandleError(
        'Tag key must be a non-empty string',
        this._spanId,
        'INVALID_TAG_KEY'
      );
    }

    this._tags.set(key, String(value));
  }

  /**
   * Add multiple tags to the span
   *
   * @param tags - Object containing key-value pairs
   * @throws Error if span has been ended
   */
  addTags(tags: Record<string, string>): void {
    if (this._isEnded) {
      throw new SpanHandleError(
        'Cannot add tags to ended span',
        this._spanId,
        'ADD_TAGS_TO_ENDED_SPAN'
      );
    }

    for (const [key, value] of Object.entries(tags)) {
      this._tags.set(key, String(value));
    }
  }

  // ---------------------------------------------------------------------------
  // Log Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a log entry to the span
   *
   * @param message - Log message
   * @param attributes - Optional attributes for the log
   * @throws Error if span has been ended
   */
  addLog(
    message: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    if (this._isEnded) {
      throw new SpanHandleError(
        'Cannot add log to ended span',
        this._spanId,
        'ADD_LOG_TO_ENDED_SPAN'
      );
    }

    const log: SpanLog = {
      timestamp: new Date().toISOString() as ISO8601Timestamp,
      message,
      attributes: attributes ? Object.freeze({ ...attributes }) : undefined,
    };

    this._logs.push(log);
  }

  // ---------------------------------------------------------------------------
  // Span Completion
  // ---------------------------------------------------------------------------

  /**
   * Mark the span as ended (internal use)
   */
  markEnded(): void {
    this._isEnded = true;
  }

  /**
   * Get the current span data for persistence
   */
  getSpanData(): SpanHandleData {
    return {
      spanId: this._spanId,
      traceId: this._traceId,
      parentSpanId: this._parentSpanId,
      operationName: this._operationName,
      kind: this._kind,
      startTime: this._startTime,
      tags: new Map(this._tags),
      logs: [...this._logs],
      executionId: this._executionId,
      stepId: this._stepId,
      agentId: this._agentId,
    };
  }

  /**
   * Convert to a TraceSpan (for persistence)
   */
  toTraceSpan(status: SpanStatus, statusMessage?: string): TraceSpan {
    const endTime = new Date();
    const startTimeDate = new Date(this._startTime);
    const durationMs = endTime.getTime() - startTimeDate.getTime();

    return {
      spanId: this._spanId,
      traceId: this._traceId,
      parentSpanId: this._parentSpanId,
      operationName: this._operationName,
      kind: this._kind,
      startTime: this._startTime,
      endTime: endTime.toISOString() as ISO8601Timestamp,
      durationMs: durationMs as DurationMs,
      status,
      statusMessage,
      tags: new Map(this._tags),
      logs: [...this._logs],
      children: [],
      executionId: this._executionId,
      stepId: this._stepId,
      agentId: this._agentId,
    };
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    const startTimeDate = new Date(this._startTime);
    return Date.now() - startTimeDate.getTime();
  }
}

// =============================================================================
// Span Handle Error
// =============================================================================

/**
 * Error thrown by SpanHandle operations
 */
export class SpanHandleError extends Error {
  constructor(
    message: string,
    public readonly spanId: UUID,
    public readonly code: string
  ) {
    super(message);
    this.name = 'SpanHandleError';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new SpanHandle
 */
export function createSpanHandle(params: {
  spanId: UUID;
  traceId: UUID;
  operationName: string;
  executionId: UUID;
  parentSpanId?: UUID;
  kind?: SpanKind;
  stepId?: string;
  agentId?: string;
  initialTags?: Record<string, string>;
}): SpanHandle {
  const initialTagsMap = params.initialTags
    ? new Map(Object.entries(params.initialTags))
    : undefined;

  return new SpanHandle({
    spanId: params.spanId,
    traceId: params.traceId,
    operationName: params.operationName,
    executionId: params.executionId,
    parentSpanId: params.parentSpanId,
    kind: params.kind,
    stepId: params.stepId,
    agentId: params.agentId,
    initialTags: initialTagsMap,
  });
}

/**
 * Create a child span handle from a parent
 */
export function createChildSpanHandle(
  parent: SpanHandle,
  params: {
    spanId: UUID;
    operationName: string;
    kind?: SpanKind;
    stepId?: string;
    agentId?: string;
    initialTags?: Record<string, string>;
  }
): SpanHandle {
  const data = parent.getSpanData();

  return createSpanHandle({
    spanId: params.spanId,
    traceId: data.traceId,
    parentSpanId: data.spanId,
    operationName: params.operationName,
    executionId: data.executionId,
    kind: params.kind,
    stepId: params.stepId ?? data.stepId,
    agentId: params.agentId ?? data.agentId,
    initialTags: params.initialTags,
  });
}

// =============================================================================
// Span Context Propagation
// =============================================================================

/**
 * Trace context for propagation
 */
export interface TraceContext {
  readonly traceId: UUID;
  readonly spanId: UUID;
  readonly sampled: boolean;
}

/**
 * Extract trace context from a span handle
 */
export function extractTraceContext(handle: SpanHandle): TraceContext {
  return {
    traceId: handle.traceId,
    spanId: handle.spanId,
    sampled: true,
  };
}

/**
 * Create span handle from trace context
 */
export function spanHandleFromContext(
  context: TraceContext,
  params: {
    spanId: UUID;
    operationName: string;
    executionId: UUID;
    kind?: SpanKind;
    stepId?: string;
    agentId?: string;
  }
): SpanHandle {
  return createSpanHandle({
    spanId: params.spanId,
    traceId: context.traceId,
    parentSpanId: context.spanId,
    operationName: params.operationName,
    executionId: params.executionId,
    kind: params.kind,
    stepId: params.stepId,
    agentId: params.agentId,
  });
}

/**
 * Serialize trace context to a string for propagation
 */
export function serializeTraceContext(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

/**
 * Parse trace context from a serialized string
 */
export function parseTraceContext(header: string): TraceContext | undefined {
  const parts = header.split('-');
  if (parts.length !== 4 || parts[0] !== '00') {
    return undefined;
  }

  return {
    traceId: parts[1] as UUID,
    spanId: parts[2] as UUID,
    sampled: parts[3] === '01',
  };
}

// =============================================================================
// Span Registry
// =============================================================================

/**
 * Registry for tracking active spans
 */
export class SpanRegistry {
  private readonly spans = new Map<UUID, SpanHandle>();

  /**
   * Register a span
   */
  register(handle: SpanHandle): void {
    this.spans.set(handle.spanId, handle);
  }

  /**
   * Get a span by ID
   */
  get(spanId: UUID): SpanHandle | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Unregister a span
   */
  unregister(spanId: UUID): void {
    this.spans.delete(spanId);
  }

  /**
   * Get all active spans
   */
  getAll(): readonly SpanHandle[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get active span count
   */
  get size(): number {
    return this.spans.size;
  }

  /**
   * Get spans for a specific trace
   */
  getByTraceId(traceId: UUID): readonly SpanHandle[] {
    return Array.from(this.spans.values()).filter(
      (handle) => handle.traceId === traceId
    );
  }

  /**
   * Clear all spans
   */
  clear(): void {
    this.spans.clear();
  }
}
