/**
 * Agentics Ecosystem Types
 *
 * Type definitions for MOD-012: Agentics Ecosystem Surface
 * Defines types for ecosystem component status, connectivity, and result emission.
 *
 * @module surfaces/ecosystem-types
 */

import type { UUID, ISO8601Timestamp, SHA256Hash, SemanticVersion } from '../types/common.js';

// =============================================================================
// Ecosystem Component Types
// =============================================================================

/**
 * Status of an ecosystem component
 */
export type EcosystemComponentStatus = 'available' | 'unavailable' | 'degraded';

/**
 * Known ecosystem repository identifiers
 */
export type EcosystemRepository =
  | 'agentics-simulation-planner'
  | 'agentics-deployment-intent'
  | 'agentics-skill-registry'
  | 'agentics-credential-vault'
  | 'ruvvector-postgres';

/**
 * Component type classification
 */
export type EcosystemComponentType =
  | 'planner'        // Source of SimulationPlan
  | 'intent'         // Target for deployment intent
  | 'registry'       // Skill/capability registry
  | 'vault'          // Credential/secret management
  | 'state'          // State substrate (database)
  | 'custom';        // Custom ecosystem component

/**
 * Represents an ecosystem component with its connection details and status
 */
export interface EcosystemComponent {
  /**
   * Component name/identifier
   */
  readonly name: string;

  /**
   * Repository name this component belongs to
   */
  readonly repository?: EcosystemRepository;

  /**
   * Component type classification
   */
  readonly type: EcosystemComponentType;

  /**
   * Connection endpoint URL or URI
   */
  readonly endpoint: string;

  /**
   * Current availability status
   */
  readonly status: EcosystemComponentStatus;

  /**
   * Component version (if available)
   */
  readonly version?: SemanticVersion;

  /**
   * When the status was last checked
   */
  readonly lastCheckedAt?: ISO8601Timestamp;

  /**
   * Response latency in milliseconds (if available)
   */
  readonly latencyMs?: number;

  /**
   * Additional component metadata
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Error message if status is unavailable or degraded
   */
  readonly errorMessage?: string;
}

// =============================================================================
// Ecosystem Status Types
// =============================================================================

/**
 * Overall health status of the ecosystem
 */
export type EcosystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Aggregated status of the entire ecosystem
 */
export interface EcosystemStatus {
  /**
   * Individual component statuses
   */
  readonly components: readonly EcosystemComponent[];

  /**
   * Overall ecosystem health status
   */
  readonly overallStatus: EcosystemHealthStatus;

  /**
   * When this status was computed
   */
  readonly evaluatedAt: ISO8601Timestamp;

  /**
   * Number of available components
   */
  readonly availableCount: number;

  /**
   * Number of degraded components
   */
  readonly degradedCount: number;

  /**
   * Number of unavailable components
   */
  readonly unavailableCount: number;

  /**
   * List of critical components that are unavailable
   */
  readonly criticalIssues?: readonly string[];

  /**
   * Recommendations for addressing issues
   */
  readonly recommendations?: readonly string[];
}

// =============================================================================
// Emit Result Types
// =============================================================================

/**
 * Target types for result emission
 */
export type EmitTargetType =
  | 'deployment-intent'   // Emit to agentics-deployment-intent
  | 'storage'             // Emit to storage backend
  | 'webhook'             // Emit to external webhook
  | 'message-queue'       // Emit to message queue
  | 'custom';             // Custom target

/**
 * Configuration for the emit target
 */
export interface EmitTarget {
  /**
   * Target type
   */
  readonly type: EmitTargetType;

  /**
   * Target endpoint or identifier
   */
  readonly endpoint: string;

  /**
   * Target component name (for agentics ecosystem components)
   */
  readonly componentName?: string;

  /**
   * Authentication configuration reference
   */
  readonly authRef?: string;

  /**
   * Custom headers or metadata for the emission
   */
  readonly headers?: Record<string, string>;

  /**
   * Timeout in milliseconds
   */
  readonly timeoutMs?: number;

  /**
   * Whether to retry on failure
   */
  readonly retryOnFailure?: boolean;

  /**
   * Maximum retry attempts
   */
  readonly maxRetries?: number;
}

/**
 * Confirmation of a successful result emission
 */
export interface EmitConfirmation {
  /**
   * Target component that received the result
   */
  readonly targetComponent: string;

  /**
   * Target type
   */
  readonly targetType: EmitTargetType;

  /**
   * When the result was emitted
   */
  readonly emittedAt: ISO8601Timestamp;

  /**
   * Unique identifier of the emitted result
   */
  readonly resultId: UUID;

  /**
   * Hash of the emitted result for verification
   */
  readonly resultHash?: SHA256Hash;

  /**
   * Whether the target acknowledged receipt
   */
  readonly acknowledgment: boolean;

  /**
   * Acknowledgment ID from the target (if provided)
   */
  readonly acknowledgmentId?: string;

  /**
   * Response time in milliseconds
   */
  readonly responseTimeMs?: number;

  /**
   * Additional response metadata from the target
   */
  readonly responseMetadata?: Record<string, unknown>;
}

/**
 * Error during result emission
 */
export interface EmitError {
  /**
   * Error code
   */
  readonly code: string;

  /**
   * Human-readable error message
   */
  readonly message: string;

  /**
   * Target component that failed
   */
  readonly targetComponent: string;

  /**
   * When the error occurred
   */
  readonly occurredAt: ISO8601Timestamp;

  /**
   * Whether the error is retryable
   */
  readonly retryable: boolean;

  /**
   * Number of retries attempted
   */
  readonly retriesAttempted?: number;

  /**
   * Underlying error details
   */
  readonly details?: Record<string, unknown>;
}

// =============================================================================
// Handoff Protocol Types
// =============================================================================

/**
 * Protocol version for ecosystem handoff
 */
export type HandoffProtocolVersion = '1.0' | '1.1' | '2.0';

/**
 * Handoff request to transfer result to another component
 */
export interface HandoffRequest {
  /**
   * Protocol version
   */
  readonly protocolVersion: HandoffProtocolVersion;

  /**
   * Source component (this runner)
   */
  readonly source: {
    readonly name: string;
    readonly version: SemanticVersion;
    readonly instanceId: UUID;
  };

  /**
   * Target component
   */
  readonly target: EmitTarget;

  /**
   * Result being handed off
   */
  readonly payload: {
    readonly resultId: UUID;
    readonly resultHash: SHA256Hash;
    readonly resultType: 'simulation_result';
    readonly sizeBytes: number;
  };

  /**
   * Handoff metadata
   */
  readonly metadata: {
    readonly initiatedAt: ISO8601Timestamp;
    readonly correlationId: UUID;
    readonly priority?: 'low' | 'normal' | 'high';
  };
}

/**
 * Response to a handoff request
 */
export interface HandoffResponse {
  /**
   * Whether the handoff was accepted
   */
  readonly accepted: boolean;

  /**
   * Handoff ID assigned by the target
   */
  readonly handoffId?: UUID;

  /**
   * When the response was generated
   */
  readonly respondedAt: ISO8601Timestamp;

  /**
   * Status of the handoff
   */
  readonly status: 'received' | 'processing' | 'completed' | 'rejected';

  /**
   * Rejection reason (if rejected)
   */
  readonly rejectionReason?: string;

  /**
   * Processing estimate in milliseconds (if processing)
   */
  readonly estimatedCompletionMs?: number;
}

// =============================================================================
// Ecosystem Configuration Types
// =============================================================================

/**
 * Configuration for ecosystem component discovery
 */
export interface EcosystemDiscoveryConfig {
  /**
   * Whether to auto-discover components
   */
  readonly autoDiscover: boolean;

  /**
   * Discovery method
   */
  readonly discoveryMethod: 'static' | 'dns' | 'consul' | 'kubernetes';

  /**
   * Static component endpoints (for static discovery)
   */
  readonly staticEndpoints?: Record<string, string>;

  /**
   * Discovery service endpoint (for dynamic discovery)
   */
  readonly discoveryEndpoint?: string;

  /**
   * Health check interval in milliseconds
   */
  readonly healthCheckIntervalMs: number;

  /**
   * Timeout for health checks in milliseconds
   */
  readonly healthCheckTimeoutMs: number;

  /**
   * Number of consecutive failures before marking unavailable
   */
  readonly failureThreshold: number;
}

/**
 * Configuration for the ecosystem surface
 */
export interface EcosystemSurfaceConfig {
  /**
   * Discovery configuration
   */
  readonly discovery: EcosystemDiscoveryConfig;

  /**
   * Default emit configuration
   */
  readonly defaultEmitConfig: {
    readonly timeoutMs: number;
    readonly retryOnFailure: boolean;
    readonly maxRetries: number;
    readonly retryDelayMs: number;
  };

  /**
   * Handoff protocol version to use
   */
  readonly handoffProtocolVersion: HandoffProtocolVersion;

  /**
   * List of critical components (emission fails if these are unavailable)
   */
  readonly criticalComponents: readonly string[];
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a component is available
 */
export function isComponentAvailable(component: EcosystemComponent): boolean {
  return component.status === 'available';
}

/**
 * Type guard to check if ecosystem is healthy
 */
export function isEcosystemHealthy(status: EcosystemStatus): boolean {
  return status.overallStatus === 'healthy';
}

/**
 * Type guard to check if emission was acknowledged
 */
export function isEmitAcknowledged(confirmation: EmitConfirmation): boolean {
  return confirmation.acknowledgment === true;
}

/**
 * Type guard to check if handoff was accepted
 */
export function isHandoffAccepted(response: HandoffResponse): boolean {
  return response.accepted === true && response.status !== 'rejected';
}
