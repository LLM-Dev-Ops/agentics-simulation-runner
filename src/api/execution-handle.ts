/**
 * Execution Handle Type Definitions (MOD-001)
 *
 * ExecutionHandle is the opaque reference returned by submitPlan() that
 * allows clients to track execution progress and retrieve results.
 *
 * The handle contains all information necessary to:
 * - Uniquely identify an execution
 * - Verify plan integrity (via planHash)
 * - Track when submission occurred
 * - Associate with tenant for multi-tenant isolation
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-001
 * - SPARC_SPECIFICATION.md Section 3, 4
 */

import type { UUID, SHA256Hash, ISO8601Timestamp, DurationMs, ExecutionId } from '../types/common.js';

// ============================================================================
// Execution Handle
// ============================================================================

/**
 * ExecutionHandle - Opaque reference for tracking an execution.
 *
 * Returned by ExecutionGateway.submitPlan() and used for:
 * - getExecutionStatus() - Check progress
 * - getResult() - Retrieve completed result
 * - abortExecution() - Request cancellation
 *
 * Properties:
 * - executionId: UUID - Unique identifier for this execution
 * - planId: UUID - Reference to the submitted SimulationPlan
 * - planHash: SHA256Hash - Hash of the plan for integrity verification
 * - submittedAt: ISO8601Timestamp - When the plan was submitted
 * - tenantId: string - Tenant identifier for isolation
 */
export interface ExecutionHandle {
  /**
   * Unique execution identifier (UUID v4)
   * Used for all subsequent operations on this execution
   */
  readonly executionId: ExecutionId;

  /**
   * Reference to the submitted SimulationPlan's ID
   */
  readonly planId: UUID;

  /**
   * SHA-256 hash of the submitted plan
   * Used for integrity verification and reproducibility
   */
  readonly planHash: SHA256Hash;

  /**
   * ISO 8601 timestamp when the plan was submitted
   */
  readonly submittedAt: ISO8601Timestamp;

  /**
   * Tenant identifier for multi-tenant isolation
   * Ensures execution state is properly namespaced
   */
  readonly tenantId: string;

  /**
   * Optional estimated duration based on plan analysis
   */
  readonly estimatedDuration?: DurationMs;
}

// ============================================================================
// Handle Creation
// ============================================================================

/**
 * Create a new ExecutionHandle
 *
 * @param params - Parameters for creating the handle
 * @returns A new ExecutionHandle instance
 */
export function createExecutionHandle(params: {
  executionId: ExecutionId;
  planId: UUID;
  planHash: SHA256Hash;
  tenantId: string;
  submittedAt?: ISO8601Timestamp;
  estimatedDuration?: DurationMs;
}): ExecutionHandle {
  return {
    executionId: params.executionId,
    planId: params.planId,
    planHash: params.planHash,
    tenantId: params.tenantId,
    submittedAt: params.submittedAt ?? new Date().toISOString(),
    estimatedDuration: params.estimatedDuration,
  };
}

// ============================================================================
// Handle Validation
// ============================================================================

/**
 * Validate that an object conforms to ExecutionHandle interface
 *
 * @param obj - Object to validate
 * @returns True if valid ExecutionHandle
 */
export function isValidExecutionHandle(obj: unknown): obj is ExecutionHandle {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const handle = obj as Record<string, unknown>;

  // Required fields
  if (typeof handle.executionId !== 'string' || handle.executionId.length === 0) {
    return false;
  }

  if (typeof handle.planId !== 'string' || handle.planId.length === 0) {
    return false;
  }

  if (typeof handle.planHash !== 'string' || !/^[a-f0-9]{64}$/i.test(handle.planHash)) {
    return false;
  }

  if (typeof handle.submittedAt !== 'string') {
    return false;
  }

  if (typeof handle.tenantId !== 'string' || handle.tenantId.length === 0) {
    return false;
  }

  // Optional fields
  if (handle.estimatedDuration !== undefined && typeof handle.estimatedDuration !== 'number') {
    return false;
  }

  return true;
}

// ============================================================================
// Handle Serialization
// ============================================================================

/**
 * Serialize an ExecutionHandle to a compact string representation
 * Useful for transmission or storage
 *
 * @param handle - The handle to serialize
 * @returns Base64-encoded JSON string
 */
export function serializeHandle(handle: ExecutionHandle): string {
  const json = JSON.stringify({
    e: handle.executionId,
    p: handle.planId,
    h: handle.planHash,
    t: handle.tenantId,
    s: handle.submittedAt,
    d: handle.estimatedDuration,
  });
  return Buffer.from(json).toString('base64url');
}

/**
 * Deserialize an ExecutionHandle from a compact string representation
 *
 * @param serialized - Base64-encoded JSON string
 * @returns ExecutionHandle or null if invalid
 */
export function deserializeHandle(serialized: string): ExecutionHandle | null {
  try {
    const json = Buffer.from(serialized, 'base64url').toString('utf-8');
    const data = JSON.parse(json) as Record<string, unknown>;

    const handle: ExecutionHandle = {
      executionId: data.e as ExecutionId,
      planId: data.p as UUID,
      planHash: data.h as SHA256Hash,
      tenantId: data.t as string,
      submittedAt: data.s as ISO8601Timestamp,
      estimatedDuration: data.d as DurationMs | undefined,
    };

    if (isValidExecutionHandle(handle)) {
      return handle;
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Handle Comparison
// ============================================================================

/**
 * Compare two ExecutionHandles for equality
 *
 * @param a - First handle
 * @param b - Second handle
 * @returns True if handles reference the same execution
 */
export function handlesAreEqual(a: ExecutionHandle, b: ExecutionHandle): boolean {
  return (
    a.executionId === b.executionId &&
    a.planId === b.planId &&
    a.planHash === b.planHash &&
    a.tenantId === b.tenantId
  );
}

/**
 * Check if a handle references a specific execution
 *
 * @param handle - The handle to check
 * @param executionId - The execution ID to compare
 * @returns True if handle references the execution
 */
export function handleMatchesExecution(handle: ExecutionHandle, executionId: ExecutionId): boolean {
  return handle.executionId === executionId;
}
