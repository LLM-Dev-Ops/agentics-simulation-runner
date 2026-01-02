/**
 * Event Types for MOD-009 Telemetry Collector
 *
 * Defines event-related types for the telemetry system including
 * captured events, event requirements, and event compilation.
 *
 * References:
 * - SPARC_ARCHITECTURE.md Section 7: Telemetry Capture Module
 * - SPARC_PSEUDOCODE.md Section 6.2: Event Compilation
 *
 * @module core/event-types
 */

import type { UUID, ISO8601Timestamp } from '../types/common.js';

// =============================================================================
// Event Severity and Categories
// =============================================================================

/**
 * Event severity levels
 */
export type EventSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

/**
 * Standard event categories
 */
export type EventCategory =
  | 'LIFECYCLE'
  | 'EXECUTION'
  | 'STATE'
  | 'AGENT'
  | 'INTEGRATION'
  | 'LLM'
  | 'ERROR'
  | 'CHECKPOINT'
  | 'CUSTOM';

// =============================================================================
// Captured Event Types
// =============================================================================

/**
 * CapturedEvent type from Pseudocode 6.2
 *
 * Represents a structured event that occurred during execution,
 * with automatic timestamp and structured data.
 */
export interface CapturedEvent {
  /**
   * Unique event identifier
   */
  readonly eventId: UUID;

  /**
   * Type of event (e.g., "agent.invoked", "step.completed")
   */
  readonly eventType: string;

  /**
   * Structured event data payload
   */
  readonly data: Readonly<Record<string, unknown>>;

  /**
   * When the event occurred (ISO 8601 format)
   */
  readonly occurredAt: ISO8601Timestamp;

  /**
   * Execution ID this event belongs to
   */
  readonly executionId: UUID;

  /**
   * Optional step ID if event is step-scoped
   */
  readonly stepId?: string;

  /**
   * Optional agent ID if event is agent-scoped
   */
  readonly agentId?: string;

  /**
   * Event category for filtering
   */
  readonly category: EventCategory;

  /**
   * Event severity for prioritization
   */
  readonly severity: EventSeverity;

  /**
   * Sequence number within execution
   */
  readonly sequenceNumber: number;

  /**
   * Correlation ID for linking related events
   */
  readonly correlationId?: string;

  /**
   * Parent event ID if this is a sub-event
   */
  readonly parentEventId?: string;

  /**
   * Tags for additional categorization
   */
  readonly tags: readonly string[];
}

// =============================================================================
// Event Requirements Types
// =============================================================================

/**
 * Requirements for event compilation
 * Specifies which events to include and how to filter them
 */
export interface EventRequirements {
  /**
   * Event types to include (empty = all types)
   */
  readonly eventTypes?: readonly string[];

  /**
   * Categories to include (empty = all categories)
   */
  readonly categories?: readonly EventCategory[];

  /**
   * Minimum severity level to include
   */
  readonly minSeverity?: EventSeverity;

  /**
   * Time range filter
   */
  readonly timeRange?: {
    readonly start?: ISO8601Timestamp;
    readonly end?: ISO8601Timestamp;
  };

  /**
   * Step ID filter
   */
  readonly stepId?: string;

  /**
   * Agent ID filter
   */
  readonly agentId?: string;

  /**
   * Correlation ID filter
   */
  readonly correlationId?: string;

  /**
   * Maximum number of events to return
   */
  readonly limit?: number;

  /**
   * Offset for pagination
   */
  readonly offset?: number;

  /**
   * Sort order
   */
  readonly sortOrder?: 'ASC' | 'DESC';

  /**
   * Tags to filter by (events must have all specified tags)
   */
  readonly tags?: readonly string[];
}

/**
 * Collection of captured events
 */
export interface CapturedEvents {
  /**
   * Execution ID these events belong to
   */
  readonly executionId: UUID;

  /**
   * List of captured events
   */
  readonly events: readonly CapturedEvent[];

  /**
   * Total count of events matching criteria (before limit/offset)
   */
  readonly totalCount: number;

  /**
   * Whether there are more events available
   */
  readonly hasMore: boolean;

  /**
   * Time range covered by returned events
   */
  readonly timeRange?: {
    readonly start: ISO8601Timestamp;
    readonly end: ISO8601Timestamp;
  };

  /**
   * When the events were compiled
   */
  readonly compiledAt: ISO8601Timestamp;
}

// =============================================================================
// Event Storage Interface
// =============================================================================

/**
 * Event storage interface for persisting events
 */
export interface EventStorage {
  /**
   * Store an event
   */
  store(event: CapturedEvent): Promise<void>;

  /**
   * Store multiple events
   */
  storeBatch(events: readonly CapturedEvent[]): Promise<void>;

  /**
   * Query events for compilation
   */
  query(
    executionId: UUID,
    requirements: EventRequirements
  ): Promise<CapturedEvents>;

  /**
   * Get event by ID
   */
  get(eventId: UUID): Promise<CapturedEvent | undefined>;

  /**
   * Delete events for an execution
   */
  delete(executionId: UUID): Promise<number>;

  /**
   * Count events for an execution
   */
  count(executionId: UUID, requirements?: EventRequirements): Promise<number>;
}

// =============================================================================
// Standard Event Types
// =============================================================================

/**
 * Standard event type constants for consistency
 */
export const StandardEventTypes = {
  // Lifecycle events
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_CANCELLED: 'execution.cancelled',
  EXECUTION_PAUSED: 'execution.paused',
  EXECUTION_RESUMED: 'execution.resumed',

  // Step events
  STEP_STARTED: 'step.started',
  STEP_COMPLETED: 'step.completed',
  STEP_FAILED: 'step.failed',
  STEP_SKIPPED: 'step.skipped',
  STEP_TIMEOUT: 'step.timeout',

  // Agent events
  AGENT_SPAWNED: 'agent.spawned',
  AGENT_INITIALIZED: 'agent.initialized',
  AGENT_INVOKED: 'agent.invoked',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',
  AGENT_TERMINATED: 'agent.terminated',

  // State events
  STATE_MUTATED: 'state.mutated',
  STATE_CHECKPOINT_CREATED: 'state.checkpoint.created',
  STATE_CHECKPOINT_RESTORED: 'state.checkpoint.restored',

  // Integration events
  INTEGRATION_CALL_STARTED: 'integration.call.started',
  INTEGRATION_CALL_COMPLETED: 'integration.call.completed',
  INTEGRATION_CALL_FAILED: 'integration.call.failed',

  // LLM events
  LLM_REQUEST_STARTED: 'llm.request.started',
  LLM_REQUEST_COMPLETED: 'llm.request.completed',
  LLM_REQUEST_FAILED: 'llm.request.failed',
  LLM_RATE_LIMITED: 'llm.rate.limited',
} as const;

/**
 * Severity order for comparison
 */
const SEVERITY_ORDER: Record<EventSeverity, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new CapturedEvent
 */
export function createCapturedEvent(params: {
  eventId: UUID;
  eventType: string;
  data: Record<string, unknown>;
  executionId: UUID;
  sequenceNumber: number;
  category?: EventCategory;
  severity?: EventSeverity;
  stepId?: string;
  agentId?: string;
  correlationId?: string;
  parentEventId?: string;
  tags?: readonly string[];
}): CapturedEvent {
  return {
    eventId: params.eventId,
    eventType: params.eventType,
    data: Object.freeze({ ...params.data }),
    occurredAt: new Date().toISOString() as ISO8601Timestamp,
    executionId: params.executionId,
    stepId: params.stepId,
    agentId: params.agentId,
    category: params.category ?? 'CUSTOM',
    severity: params.severity ?? 'INFO',
    sequenceNumber: params.sequenceNumber,
    correlationId: params.correlationId,
    parentEventId: params.parentEventId,
    tags: params.tags ?? [],
  };
}

/**
 * Create event requirements with defaults
 */
export function createEventRequirements(
  params: Partial<EventRequirements> = {}
): EventRequirements {
  return {
    eventTypes: params.eventTypes,
    categories: params.categories,
    minSeverity: params.minSeverity,
    timeRange: params.timeRange,
    stepId: params.stepId,
    agentId: params.agentId,
    correlationId: params.correlationId,
    limit: params.limit ?? 1000,
    offset: params.offset ?? 0,
    sortOrder: params.sortOrder ?? 'ASC',
    tags: params.tags,
  };
}

/**
 * Determine event category from event type
 */
export function inferEventCategory(eventType: string): EventCategory {
  const prefix = eventType.split('.')[0];
  switch (prefix) {
    case 'execution':
      return 'LIFECYCLE';
    case 'step':
      return 'EXECUTION';
    case 'state':
      return 'STATE';
    case 'agent':
      return 'AGENT';
    case 'integration':
      return 'INTEGRATION';
    case 'llm':
      return 'LLM';
    case 'error':
      return 'ERROR';
    case 'checkpoint':
      return 'CHECKPOINT';
    default:
      return 'CUSTOM';
  }
}

/**
 * Determine event severity from event type
 */
export function inferEventSeverity(eventType: string): EventSeverity {
  if (eventType.includes('failed') || eventType.includes('error')) {
    return 'ERROR';
  }
  if (eventType.includes('timeout') || eventType.includes('cancelled')) {
    return 'WARN';
  }
  if (eventType.includes('started') || eventType.includes('completed')) {
    return 'INFO';
  }
  return 'DEBUG';
}

/**
 * Compare severity levels
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareSeverity(a: EventSeverity, b: EventSeverity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Check if severity meets minimum threshold
 */
export function meetsSeverityThreshold(
  severity: EventSeverity,
  minSeverity: EventSeverity
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[minSeverity];
}
