/**
 * MOD-014 State Repository - Table Definitions
 *
 * SQL table definitions for the state substrate layer.
 * All execution state is persisted using ruvvector-postgres with namespaced tables.
 *
 * Tables are organized as:
 * - Namespaced tables: {namespace}_tablename (per execution isolation)
 * - Global tables: shared across executions
 *
 * References:
 * - Section 9.1 of Specification (mandatory state substrate)
 * - Section 4.2 of Refinement (database concurrency, partitioning)
 * - Pseudocode Section 4.2 (state storage patterns)
 */

/**
 * Namespace pattern for execution isolation (Section 7.2 of Refinement):
 * Pattern: "exec_{tenant_id}_{execution_id}"
 */
export interface NamespaceConfig {
  tenantId: string;
  executionId: string;
}

/**
 * Generates the table namespace prefix for execution isolation.
 * Ensures INV-EX-002: Each execution runs in isolated state namespace.
 */
export function getNamespacePrefix(config: NamespaceConfig): string {
  // Sanitize IDs to prevent SQL injection and ensure valid table names
  const sanitizedTenantId = config.tenantId.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);
  const sanitizedExecutionId = config.executionId.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
  return `exec_${sanitizedTenantId}_${sanitizedExecutionId}`;
}

/**
 * Global tables shared across all executions.
 * These tables are created once at system initialization.
 */
export const GLOBAL_TABLES = {
  /**
   * Execution contexts table - tracks all active and completed executions.
   * Partitioned by tenant_id for efficient multi-tenant queries.
   */
  EXECUTION_CONTEXTS: `
    CREATE TABLE IF NOT EXISTS execution_contexts (
      execution_id UUID PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      plan_id VARCHAR(128) NOT NULL,
      plan_hash VARCHAR(64) NOT NULL,
      deterministic_seed BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'INITIALIZING',
      namespace_prefix VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      CONSTRAINT valid_status CHECK (status IN (
        'INITIALIZING', 'RUNNING', 'PAUSED', 'COMPLETED',
        'FAILED', 'ROLLED_BACK', 'TIMED_OUT', 'ABORTED'
      ))
    ) PARTITION BY LIST (tenant_id);

    CREATE INDEX IF NOT EXISTS idx_execution_contexts_tenant
      ON execution_contexts (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_execution_contexts_status
      ON execution_contexts (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_execution_contexts_plan
      ON execution_contexts (plan_id, created_at DESC);
  `,

  /**
   * Simulation results table - immutable storage for completed execution results.
   * Implements INV-OUT-002: Results are immutable once persisted.
   */
  SIMULATION_RESULTS: `
    CREATE TABLE IF NOT EXISTS simulation_results (
      result_id UUID PRIMARY KEY,
      execution_id UUID NOT NULL UNIQUE,
      tenant_id VARCHAR(64) NOT NULL,
      plan_id VARCHAR(128) NOT NULL,
      plan_hash VARCHAR(64) NOT NULL,
      result_hash VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      schema_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
      result_data JSONB NOT NULL,
      telemetry_summary JSONB,
      execution_fingerprint VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      immutable_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT valid_result_status CHECK (status IN (
        'COMPLETED', 'PARTIAL', 'FAILED'
      ))
    ) PARTITION BY LIST (tenant_id);

    CREATE INDEX IF NOT EXISTS idx_simulation_results_execution
      ON simulation_results (execution_id);
    CREATE INDEX IF NOT EXISTS idx_simulation_results_plan
      ON simulation_results (plan_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_simulation_results_tenant_created
      ON simulation_results (tenant_id, created_at DESC);
  `,

  /**
   * Result immutability locks - prevents modification of finalized results.
   * Implements INV-OUT-002 enforcement mechanism.
   */
  RESULT_IMMUTABILITY_LOCKS: `
    CREATE TABLE IF NOT EXISTS result_immutability_locks (
      result_id UUID PRIMARY KEY REFERENCES simulation_results(result_id),
      lock_hash VARCHAR(64) NOT NULL,
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_by VARCHAR(128) NOT NULL,
      lock_reason VARCHAR(256) DEFAULT 'EXECUTION_COMPLETED'
    );

    CREATE INDEX IF NOT EXISTS idx_result_locks_locked_at
      ON result_immutability_locks (locked_at DESC);
  `,

  /**
   * Default tenant partition for execution_contexts.
   * Additional partitions should be created per tenant.
   */
  EXECUTION_CONTEXTS_DEFAULT_PARTITION: `
    CREATE TABLE IF NOT EXISTS execution_contexts_default
      PARTITION OF execution_contexts DEFAULT;
  `,

  /**
   * Default tenant partition for simulation_results.
   * Additional partitions should be created per tenant.
   */
  SIMULATION_RESULTS_DEFAULT_PARTITION: `
    CREATE TABLE IF NOT EXISTS simulation_results_default
      PARTITION OF simulation_results DEFAULT;
  `,
};

/**
 * Namespaced table definitions - created per execution.
 * Namespace pattern: {namespace}_tablename
 *
 * These tables implement the state substrate required by Section 9.1 of Specification.
 */
export const NAMESPACED_TABLE_TEMPLATES = {
  /**
   * Step states table - tracks state for each execution step.
   * From Pseudocode Section 4.2.
   */
  STEP_STATES: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_step_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      step_id VARCHAR(128) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      step_order INTEGER NOT NULL,
      inputs JSONB,
      outputs JSONB,
      error_info JSONB,
      retry_count INTEGER DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ${namespace}_step_states_unique_step UNIQUE (step_id),
      CONSTRAINT ${namespace}_valid_step_status CHECK (status IN (
        'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'RETRYING'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_step_states_status
      ON ${namespace}_step_states (status);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_step_states_order
      ON ${namespace}_step_states (step_order);
  `,

  /**
   * Agent invocations table - records all agent invocations.
   * Required for reproducibility (GUA-REP-001) and audit trail.
   */
  AGENT_INVOCATIONS: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_agent_invocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invocation_id VARCHAR(128) NOT NULL UNIQUE,
      agent_id VARCHAR(128) NOT NULL,
      step_id VARCHAR(128) NOT NULL,
      agent_type VARCHAR(64) NOT NULL,
      invocation_spec JSONB NOT NULL,
      request_data JSONB,
      response_data JSONB,
      token_usage JSONB,
      cost_breakdown JSONB,
      latency_ms INTEGER,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      error_info JSONB,
      determinism_level VARCHAR(16) DEFAULT 'STRICT',
      llm_seed BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT ${namespace}_valid_invocation_status CHECK (status IN (
        'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING'
      )),
      CONSTRAINT ${namespace}_valid_determinism_level CHECK (determinism_level IN (
        'STRICT', 'REPRODUCIBLE', 'AUDITED'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_agent_invocations_agent
      ON ${namespace}_agent_invocations (agent_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_agent_invocations_step
      ON ${namespace}_agent_invocations (step_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_agent_invocations_status
      ON ${namespace}_agent_invocations (status);
  `,

  /**
   * Integration calls table - records all external integration calls.
   * Required for reproducibility and external side effect tracking.
   */
  INTEGRATION_CALLS: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_integration_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id VARCHAR(128) NOT NULL UNIQUE,
      integration_id VARCHAR(128) NOT NULL,
      step_id VARCHAR(128) NOT NULL,
      endpoint_url TEXT NOT NULL,
      method VARCHAR(16) NOT NULL,
      request_headers JSONB,
      request_body JSONB,
      response_status INTEGER,
      response_headers JSONB,
      response_body JSONB,
      latency_ms INTEGER,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      error_info JSONB,
      is_idempotent BOOLEAN DEFAULT TRUE,
      compensation_action JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT ${namespace}_valid_call_status CHECK (status IN (
        'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_integration_calls_integration
      ON ${namespace}_integration_calls (integration_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_integration_calls_step
      ON ${namespace}_integration_calls (step_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_integration_calls_status
      ON ${namespace}_integration_calls (status);
  `,

  /**
   * Metrics table - stores execution metrics for telemetry.
   * From Pseudocode Section 4.2.
   */
  METRICS: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      metric_name VARCHAR(256) NOT NULL,
      metric_type VARCHAR(32) NOT NULL,
      metric_value DOUBLE PRECISION NOT NULL,
      labels JSONB DEFAULT '{}'::jsonb,
      step_id VARCHAR(128),
      agent_id VARCHAR(128),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ${namespace}_valid_metric_type CHECK (metric_type IN (
        'COUNTER', 'GAUGE', 'HISTOGRAM', 'SUMMARY'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_metrics_name
      ON ${namespace}_metrics (metric_name);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_metrics_timestamp
      ON ${namespace}_metrics (timestamp);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_metrics_step
      ON ${namespace}_metrics (step_id) WHERE step_id IS NOT NULL;
  `,

  /**
   * Events table - stores execution events for audit and observability.
   * From Pseudocode Section 4.2.
   */
  EVENTS: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type VARCHAR(128) NOT NULL,
      event_category VARCHAR(64) NOT NULL,
      severity VARCHAR(16) NOT NULL DEFAULT 'INFO',
      event_data JSONB NOT NULL,
      step_id VARCHAR(128),
      agent_id VARCHAR(128),
      correlation_id VARCHAR(128),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ${namespace}_valid_severity CHECK (severity IN (
        'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_events_type
      ON ${namespace}_events (event_type);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_events_category
      ON ${namespace}_events (event_category);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_events_timestamp
      ON ${namespace}_events (timestamp);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_events_correlation
      ON ${namespace}_events (correlation_id) WHERE correlation_id IS NOT NULL;
  `,

  /**
   * Randomness log table - records all random value generation.
   * Required for reproducibility (GUA-REP-002) and deterministic replay.
   * From Refinement Section 2.3.
   */
  RANDOMNESS_LOG: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_randomness_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_num BIGINT NOT NULL,
      operation VARCHAR(256) NOT NULL,
      random_value BIGINT NOT NULL,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      step_id VARCHAR(128),
      context JSONB,
      CONSTRAINT ${namespace}_randomness_log_unique_seq UNIQUE (sequence_num)
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_randomness_log_seq
      ON ${namespace}_randomness_log (sequence_num);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_randomness_log_operation
      ON ${namespace}_randomness_log (operation);
  `,

  /**
   * State snapshots table - stores execution state snapshots for checkpointing.
   * Required for reproducibility (GUA-REP-003) and recovery.
   * From Refinement Section 3.3.
   */
  STATE_SNAPSHOTS: (namespace: string) => `
    CREATE TABLE IF NOT EXISTS ${namespace}_state_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id VARCHAR(128) NOT NULL UNIQUE,
      checkpoint_id VARCHAR(128) NOT NULL,
      step_id VARCHAR(128) NOT NULL,
      snapshot_type VARCHAR(32) NOT NULL DEFAULT 'CHECKPOINT',
      prng_state BYTEA,
      step_states BYTEA NOT NULL,
      agent_states BYTEA,
      integration_states BYTEA,
      snapshot_hash VARCHAR(64) NOT NULL,
      compressed BOOLEAN DEFAULT TRUE,
      compression_algorithm VARCHAR(16) DEFAULT 'LZ4',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ${namespace}_valid_snapshot_type CHECK (snapshot_type IN (
        'CHECKPOINT', 'STEP_BOUNDARY', 'ERROR_RECOVERY', 'MANUAL'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_${namespace}_state_snapshots_checkpoint
      ON ${namespace}_state_snapshots (checkpoint_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_state_snapshots_step
      ON ${namespace}_state_snapshots (step_id);
    CREATE INDEX IF NOT EXISTS idx_${namespace}_state_snapshots_created
      ON ${namespace}_state_snapshots (created_at DESC);
  `,

  /**
   * Sequence for randomness log ordering.
   */
  RANDOMNESS_SEQUENCE: (namespace: string) => `
    CREATE SEQUENCE IF NOT EXISTS ${namespace}_randomness_seq
      START WITH 1
      INCREMENT BY 1
      NO CYCLE;
  `,
};

/**
 * SQL to drop all namespaced tables for an execution (cleanup).
 */
export function getDropNamespacedTablesSql(namespace: string): string {
  return `
    DROP TABLE IF EXISTS ${namespace}_step_states CASCADE;
    DROP TABLE IF EXISTS ${namespace}_agent_invocations CASCADE;
    DROP TABLE IF EXISTS ${namespace}_integration_calls CASCADE;
    DROP TABLE IF EXISTS ${namespace}_metrics CASCADE;
    DROP TABLE IF EXISTS ${namespace}_events CASCADE;
    DROP TABLE IF EXISTS ${namespace}_randomness_log CASCADE;
    DROP TABLE IF EXISTS ${namespace}_state_snapshots CASCADE;
    DROP SEQUENCE IF EXISTS ${namespace}_randomness_seq CASCADE;
  `;
}

/**
 * SQL to create all namespaced tables for an execution.
 */
export function getCreateNamespacedTablesSql(namespace: string): string[] {
  return [
    NAMESPACED_TABLE_TEMPLATES.RANDOMNESS_SEQUENCE(namespace),
    NAMESPACED_TABLE_TEMPLATES.STEP_STATES(namespace),
    NAMESPACED_TABLE_TEMPLATES.AGENT_INVOCATIONS(namespace),
    NAMESPACED_TABLE_TEMPLATES.INTEGRATION_CALLS(namespace),
    NAMESPACED_TABLE_TEMPLATES.METRICS(namespace),
    NAMESPACED_TABLE_TEMPLATES.EVENTS(namespace),
    NAMESPACED_TABLE_TEMPLATES.RANDOMNESS_LOG(namespace),
    NAMESPACED_TABLE_TEMPLATES.STATE_SNAPSHOTS(namespace),
  ];
}

/**
 * SQL to create all global tables.
 */
export function getCreateGlobalTablesSql(): string[] {
  return [
    GLOBAL_TABLES.EXECUTION_CONTEXTS,
    GLOBAL_TABLES.SIMULATION_RESULTS,
    GLOBAL_TABLES.RESULT_IMMUTABILITY_LOCKS,
    GLOBAL_TABLES.EXECUTION_CONTEXTS_DEFAULT_PARTITION,
    GLOBAL_TABLES.SIMULATION_RESULTS_DEFAULT_PARTITION,
  ];
}

/**
 * SQL to create a tenant partition for execution_contexts and simulation_results.
 */
export function getCreateTenantPartitionSql(tenantId: string): string[] {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);
  return [
    `CREATE TABLE IF NOT EXISTS execution_contexts_${sanitizedTenantId}
       PARTITION OF execution_contexts FOR VALUES IN ('${tenantId}');`,
    `CREATE TABLE IF NOT EXISTS simulation_results_${sanitizedTenantId}
       PARTITION OF simulation_results FOR VALUES IN ('${tenantId}');`,
  ];
}

/**
 * Type definitions for table rows.
 */

export interface ExecutionContextRow {
  execution_id: string;
  tenant_id: string;
  plan_id: string;
  plan_hash: string;
  deterministic_seed: bigint;
  status: 'INITIALIZING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK' | 'TIMED_OUT' | 'ABORTED';
  namespace_prefix: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

export interface SimulationResultRow {
  result_id: string;
  execution_id: string;
  tenant_id: string;
  plan_id: string;
  plan_hash: string;
  result_hash: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  schema_version: string;
  result_data: Record<string, unknown>;
  telemetry_summary: Record<string, unknown> | null;
  execution_fingerprint: string | null;
  created_at: Date;
  immutable_after: Date;
}

export interface StepStateRow {
  id: string;
  step_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'RETRYING';
  step_order: number;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  error_info: Record<string, unknown> | null;
  retry_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentInvocationRow {
  id: string;
  invocation_id: string;
  agent_id: string;
  step_id: string;
  agent_type: string;
  invocation_spec: Record<string, unknown>;
  request_data: Record<string, unknown> | null;
  response_data: Record<string, unknown> | null;
  token_usage: Record<string, unknown> | null;
  cost_breakdown: Record<string, unknown> | null;
  latency_ms: number | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  error_info: Record<string, unknown> | null;
  determinism_level: 'STRICT' | 'REPRODUCIBLE' | 'AUDITED';
  llm_seed: bigint | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface IntegrationCallRow {
  id: string;
  call_id: string;
  integration_id: string;
  step_id: string;
  endpoint_url: string;
  method: string;
  request_headers: Record<string, unknown> | null;
  request_body: Record<string, unknown> | null;
  response_status: number | null;
  response_headers: Record<string, unknown> | null;
  response_body: Record<string, unknown> | null;
  latency_ms: number | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  retry_count: number;
  error_info: Record<string, unknown> | null;
  is_idempotent: boolean;
  compensation_action: Record<string, unknown> | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface MetricRow {
  id: string;
  metric_name: string;
  metric_type: 'COUNTER' | 'GAUGE' | 'HISTOGRAM' | 'SUMMARY';
  metric_value: number;
  labels: Record<string, unknown>;
  step_id: string | null;
  agent_id: string | null;
  timestamp: Date;
}

export interface EventRow {
  id: string;
  event_type: string;
  event_category: string;
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  event_data: Record<string, unknown>;
  step_id: string | null;
  agent_id: string | null;
  correlation_id: string | null;
  timestamp: Date;
}

export interface RandomnessLogRow {
  id: string;
  sequence_num: bigint;
  operation: string;
  random_value: bigint;
  used_at: Date;
  step_id: string | null;
  context: Record<string, unknown> | null;
}

export interface StateSnapshotRow {
  id: string;
  snapshot_id: string;
  checkpoint_id: string;
  step_id: string;
  snapshot_type: 'CHECKPOINT' | 'STEP_BOUNDARY' | 'ERROR_RECOVERY' | 'MANUAL';
  prng_state: Buffer | null;
  step_states: Buffer;
  agent_states: Buffer | null;
  integration_states: Buffer | null;
  snapshot_hash: string;
  compressed: boolean;
  compression_algorithm: string;
  created_at: Date;
}

export interface ResultImmutabilityLockRow {
  result_id: string;
  lock_hash: string;
  locked_at: Date;
  locked_by: string;
  lock_reason: string;
}
