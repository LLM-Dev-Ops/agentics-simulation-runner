/**
 * API Module Exports (MOD-001)
 *
 * This module exports the Execution Gateway and related types.
 * The Execution Gateway is the single entry point for all external
 * interactions with the agentics-simulation-runner.
 *
 * Primary exports:
 * - ExecutionGateway interface and implementation
 * - ExecutionHandle type and utilities
 * - Gateway configuration types
 * - Gateway error types
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-001
 */

// ============================================================================
// Execution Handle
// ============================================================================

export type { ExecutionHandle } from './execution-handle.js';

export {
  createExecutionHandle,
  isValidExecutionHandle,
  serializeHandle,
  deserializeHandle,
  handlesAreEqual,
  handleMatchesExecution,
} from './execution-handle.js';

// ============================================================================
// Execution Gateway
// ============================================================================

export type {
  ExecutionGateway,
  GatewayConfig,
  ExecutionStatusResult,
  ExecutionProgress,
  AbortResult,
  GetResultOptions,
  HealthStatus,
  ComponentHealth,
} from './execution-gateway.js';

export {
  ExecutionGatewayImpl,
  createExecutionGateway,
  DEFAULT_GATEWAY_CONFIG,
} from './execution-gateway.js';

// ============================================================================
// Gateway Errors
// ============================================================================

export {
  GatewayError,
  PlanValidationError,
  PlanIntegrityError,
  InvalidHandleError,
  ExecutionNotFoundError,
  ResultNotAvailableError,
  ExecutionFailedError,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  TimeoutError,
  ExecutionAlreadyCompletedError,
  ResourceExhaustedError,
} from './execution-gateway.js';

// ============================================================================
// Legacy Gateway (backward compatibility)
// ============================================================================

// Re-export legacy gateway for backward compatibility
// These are deprecated and will be removed in future versions
export {
  createExecutionGateway as createLegacyExecutionGateway,
  ExecutionGatewayImpl as LegacyExecutionGatewayImpl,
  PlanValidationError as LegacyPlanValidationError,
  ExecutionNotFoundError as LegacyExecutionNotFoundError,
  TimeoutError as LegacyTimeoutError,
} from './gateway.js';

export type {
  ExecutionGateway as LegacyExecutionGateway,
  GatewayConfig as LegacyGatewayConfig,
  ExecutionStatusResult as LegacyExecutionStatusResult,
  ExecutionProgress as LegacyExecutionProgress,
  AbortResult as LegacyAbortResult,
} from './gateway.js';
