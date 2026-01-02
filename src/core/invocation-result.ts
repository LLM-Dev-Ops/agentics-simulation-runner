/**
 * Invocation Result Types (MOD-007)
 *
 * Represents the result of an agent LLM invocation including output,
 * metrics, and reproducibility information.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-007 Agent Lifecycle Manager
 * - SPARC_SPECIFICATION.md Section 5.1 Agent Invocation Results
 *
 * Guarantees:
 * - GUA-REP-002: Random seed used is logged for reproducibility
 * - GUA-COR-003: invocationSpec compliance is enforced
 */

import type { UUID, DurationMs } from '../types/common.js';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Reason why the LLM invocation finished
 */
export type FinishReason =
  | 'stop'           // Normal completion
  | 'length'         // Max tokens reached
  | 'content_filter' // Content filtered by safety systems
  | 'tool_call'      // Tool/function call requested
  | 'error';         // Error during generation

/**
 * Metrics captured during an LLM invocation
 */
export interface InvocationMetrics {
  /**
   * Number of tokens in the input prompt
   */
  readonly inputTokens: number;

  /**
   * Number of tokens in the output completion
   */
  readonly outputTokens: number;

  /**
   * Total tokens consumed (input + output)
   */
  readonly totalTokens: number;

  /**
   * End-to-end latency of the invocation in milliseconds
   */
  readonly latencyMs: DurationMs;

  /**
   * Time to first token in milliseconds (streaming)
   */
  readonly timeToFirstTokenMs?: DurationMs;

  /**
   * Model ID that was actually used (may differ from requested)
   */
  readonly modelUsed: string;

  /**
   * Provider-specific metrics
   */
  readonly providerMetrics?: Record<string, number>;
}

/**
 * Tool call requested by the LLM
 */
export interface ToolCall {
  /**
   * Unique identifier for this tool call
   */
  readonly id: string;

  /**
   * Name of the tool to call
   */
  readonly name: string;

  /**
   * Arguments to pass to the tool (JSON string)
   */
  readonly arguments: string;
}

/**
 * Result of a single LLM invocation
 *
 * Contains all information needed to:
 * 1. Process the LLM output
 * 2. Track resource usage
 * 3. Reproduce the invocation deterministically
 */
export interface InvocationResult {
  /**
   * Unique invocation identifier (UUID v4)
   */
  readonly invocationId: UUID;

  /**
   * LLM response content (text output)
   */
  readonly output: string;

  /**
   * Metrics captured during invocation
   */
  readonly metrics: InvocationMetrics;

  /**
   * Reason the generation finished
   */
  readonly finishReason: FinishReason;

  /**
   * Random seed used for reproducibility (GUA-REP-002)
   * Logged for deterministic replay when temperature > 0
   */
  readonly randomSeedUsed: number;

  /**
   * When the invocation started
   */
  readonly startedAt: Date;

  /**
   * When the invocation completed
   */
  readonly completedAt: Date;

  /**
   * Tool calls requested by the LLM (if any)
   */
  readonly toolCalls?: readonly ToolCall[];

  /**
   * Raw provider response (for debugging)
   */
  readonly rawResponse?: unknown;

  /**
   * Error details if invocation failed
   */
  readonly error?: InvocationError;
}

/**
 * Error that occurred during invocation
 */
export interface InvocationError {
  /**
   * Error code
   */
  readonly code: string;

  /**
   * Human-readable error message
   */
  readonly message: string;

  /**
   * Whether the error is retryable
   */
  readonly retryable: boolean;

  /**
   * Suggested retry delay in milliseconds
   */
  readonly retryAfterMs?: DurationMs;

  /**
   * Additional error context
   */
  readonly context?: Record<string, unknown>;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a successful invocation result
 */
export function createSuccessResult(params: {
  invocationId: UUID;
  output: string;
  metrics: InvocationMetrics;
  finishReason: FinishReason;
  randomSeedUsed: number;
  startedAt: Date;
  completedAt: Date;
  toolCalls?: readonly ToolCall[];
  rawResponse?: unknown;
}): InvocationResult {
  return {
    invocationId: params.invocationId,
    output: params.output,
    metrics: params.metrics,
    finishReason: params.finishReason,
    randomSeedUsed: params.randomSeedUsed,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    toolCalls: params.toolCalls,
    rawResponse: params.rawResponse,
  };
}

/**
 * Creates a failed invocation result
 */
export function createErrorResult(params: {
  invocationId: UUID;
  error: InvocationError;
  randomSeedUsed: number;
  startedAt: Date;
  completedAt: Date;
  partialOutput?: string;
  partialMetrics?: Partial<InvocationMetrics>;
}): InvocationResult {
  const defaultMetrics: InvocationMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs: params.completedAt.getTime() - params.startedAt.getTime(),
    modelUsed: 'unknown',
    ...params.partialMetrics,
  };

  return {
    invocationId: params.invocationId,
    output: params.partialOutput ?? '',
    metrics: defaultMetrics,
    finishReason: 'error',
    randomSeedUsed: params.randomSeedUsed,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    error: params.error,
  };
}

/**
 * Creates invocation metrics from LLM response data
 */
export function createMetrics(params: {
  inputTokens: number;
  outputTokens: number;
  latencyMs: DurationMs;
  modelUsed: string;
  timeToFirstTokenMs?: DurationMs;
  providerMetrics?: Record<string, number>;
}): InvocationMetrics {
  return {
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.inputTokens + params.outputTokens,
    latencyMs: params.latencyMs,
    modelUsed: params.modelUsed,
    timeToFirstTokenMs: params.timeToFirstTokenMs,
    providerMetrics: params.providerMetrics,
  };
}

/**
 * Creates a retryable error
 */
export function createRetryableError(
  code: string,
  message: string,
  retryAfterMs?: DurationMs,
  context?: Record<string, unknown>
): InvocationError {
  return {
    code,
    message,
    retryable: true,
    retryAfterMs,
    context,
  };
}

/**
 * Creates a non-retryable error
 */
export function createFatalError(
  code: string,
  message: string,
  context?: Record<string, unknown>
): InvocationError {
  return {
    code,
    message,
    retryable: false,
    context,
  };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if the invocation result represents a successful invocation
 */
export function isSuccessfulInvocation(result: InvocationResult): boolean {
  return result.finishReason !== 'error' && !result.error;
}

/**
 * Check if the invocation result has tool calls
 */
export function hasToolCalls(result: InvocationResult): boolean {
  return !!result.toolCalls && result.toolCalls.length > 0;
}

/**
 * Check if the error is retryable
 */
export function isRetryableError(result: InvocationResult): boolean {
  return !!result.error && result.error.retryable;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate the total cost of an invocation (placeholder for provider pricing)
 */
export function calculateCost(
  metrics: InvocationMetrics,
  pricing: { inputPerMillion: number; outputPerMillion: number }
): number {
  const inputCost = (metrics.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (metrics.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Merge multiple invocation results (for multi-turn conversations)
 */
export function mergeResults(results: readonly InvocationResult[]): {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  outputs: readonly string[];
} {
  return {
    totalInputTokens: results.reduce((sum, r) => sum + r.metrics.inputTokens, 0),
    totalOutputTokens: results.reduce((sum, r) => sum + r.metrics.outputTokens, 0),
    totalLatencyMs: results.reduce((sum, r) => sum + r.metrics.latencyMs, 0),
    outputs: results.map(r => r.output),
  };
}

/**
 * Serialize invocation result for logging/storage
 */
export function serializeResult(result: InvocationResult): string {
  return JSON.stringify({
    invocationId: result.invocationId,
    output: result.output,
    metrics: result.metrics,
    finishReason: result.finishReason,
    randomSeedUsed: result.randomSeedUsed,
    startedAt: result.startedAt.toISOString(),
    completedAt: result.completedAt.toISOString(),
    toolCalls: result.toolCalls,
    error: result.error,
  });
}
