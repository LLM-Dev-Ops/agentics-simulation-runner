/**
 * State Repository (MOD-014)
 *
 * Provides unified access to ruvvector-postgres for all state persistence needs.
 * This is the ONLY module that directly interacts with the database.
 *
 * Implements:
 * - INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
 * - INV-EX-007: All state mutations MUST be recorded in ruvvector-postgres
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-014
 * - SPARC_PSEUDOCODE.md All ruvvector.* calls
 */

import pg from 'pg';
import type {
  UUID,
  SHA256Hash,
  ExecutionId,
  StepId,
  AgentId,
  IntegrationId,
} from '../types/common.js';
import type { ExecutionContext, StateHandle } from '../types/execution.js';
import type { SimulationResult } from '../types/result.js';

const { Pool } = pg;

// ============================================================================
// Configuration
// ============================================================================

export interface StateRepositoryConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl?: boolean;
  readonly maxConnections?: number;
}

// ============================================================================
// State Repository Interface
// ============================================================================

export interface StateRepository {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Execution state
  createExecutionContext(
    executionId: ExecutionId,
    planId: UUID,
    planHash: SHA256Hash,
    tenantId: UUID,
    deterministicSeed: bigint,
    isolationLevel: string
  ): Promise<void>;
  updateExecutionStatus(executionId: ExecutionId, status: string): Promise<void>;
  getExecutionContext(executionId: ExecutionId): Promise<ExecutionContextRecord | null>;

  // Step state
  createStepState(namespace: string, stepId: StepId): Promise<void>;
  updateStepState(
    namespace: string,
    stepId: StepId,
    status: string,
    outputs?: unknown,
    metrics?: unknown,
    errors?: unknown
  ): Promise<void>;
  getStepState(namespace: string, stepId: StepId): Promise<StepStateRecord | null>;

  // Agent invocations
  recordAgentInvocation(
    namespace: string,
    invocationId: UUID,
    agentId: AgentId,
    stepId: StepId,
    startedAt: Date
  ): Promise<void>;
  updateAgentInvocation(
    namespace: string,
    invocationId: UUID,
    completedAt: Date,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    status: string,
    response?: unknown,
    errorMessage?: string
  ): Promise<void>;

  // Integration calls
  recordIntegrationCall(
    namespace: string,
    callId: UUID,
    integrationId: IntegrationId,
    stepId: StepId,
    calledAt: Date,
    request: unknown
  ): Promise<void>;
  updateIntegrationCall(
    namespace: string,
    callId: UUID,
    completedAt: Date,
    latencyMs: number,
    status: string,
    response?: unknown,
    errorMessage?: string
  ): Promise<void>;

  // Telemetry
  recordMetric(
    namespace: string,
    metricId: UUID,
    metricName: string,
    metricValue: number,
    labels: Record<string, string>
  ): Promise<void>;
  recordEvent(
    namespace: string,
    eventId: UUID,
    eventType: string,
    eventData: unknown
  ): Promise<void>;

  // Randomness log
  logRandomValue(
    namespace: string,
    operation: string,
    randomValue: Uint8Array
  ): Promise<void>;

  // Checkpoints
  createSnapshot(
    namespace: string,
    snapshotId: UUID,
    checkpointId: string,
    stepId: StepId,
    snapshotData: Uint8Array,
    snapshotHash: SHA256Hash
  ): Promise<void>;

  // Results
  persistResult(result: SimulationResult): Promise<void>;
  getResult(resultId: UUID): Promise<SimulationResult | null>;
  lockResult(resultId: UUID): Promise<void>;

  // Namespace management
  initializeNamespace(namespace: string): Promise<StateHandle>;
  cleanupNamespace(namespace: string): Promise<void>;
}

// ============================================================================
// Record Types
// ============================================================================

export interface ExecutionContextRecord {
  executionId: ExecutionId;
  planId: UUID;
  planHash: SHA256Hash;
  tenantId: UUID;
  status: string;
  deterministicSeed: bigint;
  startedAt: Date;
  completedAt?: Date;
  isolationLevel: string;
}

export interface StepStateRecord {
  stepId: StepId;
  status: string;
  startedAt?: Date;
  completedAt?: Date;
  outputs?: unknown;
  metrics?: unknown;
  errors?: unknown;
}

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

export class PostgresStateRepository implements StateRepository {
  private pool: pg.Pool | null = null;
  private connected = false;

  constructor(private readonly config: StateRepositoryConfig) {}

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      max: this.config.maxConnections ?? 20,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      this.connected = true;
    } finally {
      client.release();
    }

    // Initialize base tables
    await this.initializeBaseTables();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async initializeBaseTables(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS execution_contexts (
          execution_id VARCHAR(255) PRIMARY KEY,
          plan_id VARCHAR(255) NOT NULL,
          plan_hash VARCHAR(64) NOT NULL,
          tenant_id VARCHAR(255) NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'INITIALIZING',
          deterministic_seed BIGINT NOT NULL,
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP,
          isolation_level VARCHAR(50) NOT NULL,
          abort_reason TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS simulation_results (
          result_id VARCHAR(255) PRIMARY KEY,
          result_version VARCHAR(50) NOT NULL,
          result_hash VARCHAR(64) NOT NULL,
          executed_at TIMESTAMP NOT NULL,
          executed_by JSONB NOT NULL,
          source_plan_id VARCHAR(255) NOT NULL,
          source_plan_hash VARCHAR(64) NOT NULL,
          status VARCHAR(50) NOT NULL,
          duration_ms BIGINT NOT NULL,
          result_data BYTEA NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          immutable BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS result_immutability_locks (
          result_id VARCHAR(255) PRIMARY KEY REFERENCES simulation_results(result_id),
          locked_at TIMESTAMP NOT NULL,
          lock_reason VARCHAR(255) NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS simulation_artifacts (
          artifact_id VARCHAR(255) PRIMARY KEY,
          result_id VARCHAR(255) NOT NULL REFERENCES simulation_results(result_id),
          artifact_type VARCHAR(50) NOT NULL,
          content_hash VARCHAR(64) NOT NULL,
          storage_ref TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } finally {
      client.release();
    }
  }

  private async getClient(): Promise<pg.PoolClient> {
    if (!this.pool) {
      throw new Error('State repository not connected');
    }
    return this.pool.connect();
  }

  async createExecutionContext(
    executionId: ExecutionId,
    planId: UUID,
    planHash: SHA256Hash,
    tenantId: UUID,
    deterministicSeed: bigint,
    isolationLevel: string
  ): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `INSERT INTO execution_contexts (
          execution_id, plan_id, plan_hash, tenant_id,
          status, deterministic_seed, started_at, isolation_level
        ) VALUES ($1, $2, $3, $4, 'INITIALIZING', $5, NOW(), $6)`,
        [executionId, planId, planHash, tenantId, deterministicSeed.toString(), isolationLevel]
      );
    } finally {
      client.release();
    }
  }

  async updateExecutionStatus(executionId: ExecutionId, status: string): Promise<void> {
    const client = await this.getClient();
    try {
      const completedAt = ['COMPLETED', 'FAILED', 'TIMEOUT', 'ABORTED', 'ROLLED_BACK'].includes(status)
        ? 'NOW()'
        : 'NULL';
      await client.query(
        `UPDATE execution_contexts SET status = $1, completed_at = ${completedAt} WHERE execution_id = $2`,
        [status, executionId]
      );
    } finally {
      client.release();
    }
  }

  async getExecutionContext(executionId: ExecutionId): Promise<ExecutionContextRecord | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        'SELECT * FROM execution_contexts WHERE execution_id = $1',
        [executionId]
      );
      if (result.rows.length === 0) {
        return null;
      }
      const row = result.rows[0];
      return {
        executionId: row.execution_id as ExecutionId,
        planId: row.plan_id,
        planHash: row.plan_hash,
        tenantId: row.tenant_id,
        status: row.status,
        deterministicSeed: BigInt(row.deterministic_seed),
        startedAt: row.started_at,
        completedAt: row.completed_at,
        isolationLevel: row.isolation_level,
      };
    } finally {
      client.release();
    }
  }

  async initializeNamespace(namespace: string): Promise<StateHandle> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      // Create step states table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_step_states" (
          step_id VARCHAR(255) PRIMARY KEY,
          status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          outputs JSONB,
          metrics JSONB,
          errors JSONB,
          checkpoint_data BYTEA
        )
      `);

      // Create agent invocations table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_agent_invocations" (
          invocation_id VARCHAR(255) PRIMARY KEY,
          agent_id VARCHAR(255) NOT NULL,
          step_id VARCHAR(255) NOT NULL,
          started_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          input_tokens INTEGER,
          output_tokens INTEGER,
          latency_ms INTEGER,
          status VARCHAR(50),
          response JSONB,
          error_message TEXT
        )
      `);

      // Create integration calls table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_integration_calls" (
          call_id VARCHAR(255) PRIMARY KEY,
          integration_id VARCHAR(255) NOT NULL,
          step_id VARCHAR(255) NOT NULL,
          called_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          latency_ms INTEGER,
          status VARCHAR(50),
          request JSONB,
          response JSONB,
          error_message TEXT
        )
      `);

      // Create metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_metrics" (
          metric_id VARCHAR(255) PRIMARY KEY,
          metric_name VARCHAR(255) NOT NULL,
          metric_value DOUBLE PRECISION NOT NULL,
          labels JSONB,
          captured_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create events table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_events" (
          event_id VARCHAR(255) PRIMARY KEY,
          event_type VARCHAR(255) NOT NULL,
          event_data JSONB,
          occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create randomness log table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_randomness_log" (
          sequence_num SERIAL PRIMARY KEY,
          operation VARCHAR(255) NOT NULL,
          random_value BYTEA NOT NULL,
          used_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      // Create state snapshots table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${safeNamespace}_state_snapshots" (
          snapshot_id VARCHAR(255) PRIMARY KEY,
          checkpoint_id VARCHAR(255) NOT NULL,
          step_id VARCHAR(255) NOT NULL,
          snapshot_data BYTEA NOT NULL,
          snapshot_hash VARCHAR(64) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      return {
        namespace: safeNamespace,
        initialized: true,
        tables: [
          'step_states',
          'agent_invocations',
          'integration_calls',
          'metrics',
          'events',
          'randomness_log',
          'state_snapshots',
        ],
      };
    } finally {
      client.release();
    }
  }

  async cleanupNamespace(namespace: string): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      const tables = [
        'step_states',
        'agent_invocations',
        'integration_calls',
        'metrics',
        'events',
        'randomness_log',
        'state_snapshots',
      ];

      for (const table of tables) {
        await client.query(`DROP TABLE IF EXISTS "${safeNamespace}_${table}"`);
      }
    } finally {
      client.release();
    }
  }

  async createStepState(namespace: string, stepId: StepId): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_step_states" (step_id, status) VALUES ($1, 'PENDING')`,
        [stepId]
      );
    } finally {
      client.release();
    }
  }

  async updateStepState(
    namespace: string,
    stepId: StepId,
    status: string,
    outputs?: unknown,
    metrics?: unknown,
    errors?: unknown
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      const updates: string[] = ['status = $2'];
      const values: unknown[] = [stepId, status];
      let paramIndex = 3;

      if (status === 'EXECUTING') {
        updates.push('started_at = NOW()');
      }

      if (['COMPLETED', 'FAILED', 'SKIPPED'].includes(status)) {
        updates.push('completed_at = NOW()');
      }

      if (outputs !== undefined) {
        updates.push(`outputs = $${paramIndex}`);
        values.push(JSON.stringify(outputs));
        paramIndex++;
      }

      if (metrics !== undefined) {
        updates.push(`metrics = $${paramIndex}`);
        values.push(JSON.stringify(metrics));
        paramIndex++;
      }

      if (errors !== undefined) {
        updates.push(`errors = $${paramIndex}`);
        values.push(JSON.stringify(errors));
        paramIndex++;
      }

      await client.query(
        `UPDATE "${safeNamespace}_step_states" SET ${updates.join(', ')} WHERE step_id = $1`,
        values
      );
    } finally {
      client.release();
    }
  }

  async getStepState(namespace: string, stepId: StepId): Promise<StepStateRecord | null> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      const result = await client.query(
        `SELECT * FROM "${safeNamespace}_step_states" WHERE step_id = $1`,
        [stepId]
      );
      if (result.rows.length === 0) {
        return null;
      }
      const row = result.rows[0];
      return {
        stepId: row.step_id as StepId,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        outputs: row.outputs,
        metrics: row.metrics,
        errors: row.errors,
      };
    } finally {
      client.release();
    }
  }

  async recordAgentInvocation(
    namespace: string,
    invocationId: UUID,
    agentId: AgentId,
    stepId: StepId,
    startedAt: Date
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_agent_invocations" (
          invocation_id, agent_id, step_id, started_at, status
        ) VALUES ($1, $2, $3, $4, 'EXECUTING')`,
        [invocationId, agentId, stepId, startedAt]
      );
    } finally {
      client.release();
    }
  }

  async updateAgentInvocation(
    namespace: string,
    invocationId: UUID,
    completedAt: Date,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    status: string,
    response?: unknown,
    errorMessage?: string
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `UPDATE "${safeNamespace}_agent_invocations"
         SET completed_at = $2, input_tokens = $3, output_tokens = $4,
             latency_ms = $5, status = $6, response = $7, error_message = $8
         WHERE invocation_id = $1`,
        [
          invocationId,
          completedAt,
          inputTokens,
          outputTokens,
          latencyMs,
          status,
          response ? JSON.stringify(response) : null,
          errorMessage,
        ]
      );
    } finally {
      client.release();
    }
  }

  async recordIntegrationCall(
    namespace: string,
    callId: UUID,
    integrationId: IntegrationId,
    stepId: StepId,
    calledAt: Date,
    request: unknown
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_integration_calls" (
          call_id, integration_id, step_id, called_at, status, request
        ) VALUES ($1, $2, $3, $4, 'EXECUTING', $5)`,
        [callId, integrationId, stepId, calledAt, JSON.stringify(request)]
      );
    } finally {
      client.release();
    }
  }

  async updateIntegrationCall(
    namespace: string,
    callId: UUID,
    completedAt: Date,
    latencyMs: number,
    status: string,
    response?: unknown,
    errorMessage?: string
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `UPDATE "${safeNamespace}_integration_calls"
         SET completed_at = $2, latency_ms = $3, status = $4, response = $5, error_message = $6
         WHERE call_id = $1`,
        [callId, completedAt, latencyMs, status, response ? JSON.stringify(response) : null, errorMessage]
      );
    } finally {
      client.release();
    }
  }

  async recordMetric(
    namespace: string,
    metricId: UUID,
    metricName: string,
    metricValue: number,
    labels: Record<string, string>
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_metrics" (metric_id, metric_name, metric_value, labels, captured_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [metricId, metricName, metricValue, JSON.stringify(labels)]
      );
    } finally {
      client.release();
    }
  }

  async recordEvent(
    namespace: string,
    eventId: UUID,
    eventType: string,
    eventData: unknown
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_events" (event_id, event_type, event_data, occurred_at)
         VALUES ($1, $2, $3, NOW())`,
        [eventId, eventType, JSON.stringify(eventData)]
      );
    } finally {
      client.release();
    }
  }

  async logRandomValue(namespace: string, operation: string, randomValue: Uint8Array): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_randomness_log" (operation, random_value, used_at)
         VALUES ($1, $2, NOW())`,
        [operation, Buffer.from(randomValue)]
      );
    } finally {
      client.release();
    }
  }

  async createSnapshot(
    namespace: string,
    snapshotId: UUID,
    checkpointId: string,
    stepId: StepId,
    snapshotData: Uint8Array,
    snapshotHash: SHA256Hash
  ): Promise<void> {
    const client = await this.getClient();
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');

    try {
      await client.query(
        `INSERT INTO "${safeNamespace}_state_snapshots" (
          snapshot_id, checkpoint_id, step_id, snapshot_data, snapshot_hash, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [snapshotId, checkpointId, stepId, Buffer.from(snapshotData), snapshotHash]
      );
    } finally {
      client.release();
    }
  }

  async persistResult(result: SimulationResult): Promise<void> {
    const client = await this.getClient();

    try {
      const resultData = Buffer.from(JSON.stringify(result));

      await client.query(
        `INSERT INTO simulation_results (
          result_id, result_version, result_hash,
          executed_at, executed_by, source_plan_id, source_plan_hash,
          status, duration_ms, result_data, created_at, immutable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), TRUE)`,
        [
          result.resultId,
          result.resultVersion,
          result.resultHash,
          result.executedAt,
          JSON.stringify(result.executedBy),
          result.sourcePlan.planId,
          result.sourcePlan.planHash,
          result.execution.status,
          result.execution.duration,
          resultData,
        ]
      );
    } finally {
      client.release();
    }
  }

  async getResult(resultId: UUID): Promise<SimulationResult | null> {
    const client = await this.getClient();

    try {
      const result = await client.query(
        'SELECT result_data FROM simulation_results WHERE result_id = $1',
        [resultId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return JSON.parse(result.rows[0].result_data.toString()) as SimulationResult;
    } finally {
      client.release();
    }
  }

  async lockResult(resultId: UUID): Promise<void> {
    const client = await this.getClient();

    try {
      await client.query(
        `INSERT INTO result_immutability_locks (result_id, locked_at, lock_reason)
         VALUES ($1, NOW(), 'RESULT_FINALIZED')
         ON CONFLICT (result_id) DO NOTHING`,
        [resultId]
      );
    } finally {
      client.release();
    }
  }
}

/**
 * Create a state repository instance
 */
export function createStateRepository(config: StateRepositoryConfig): StateRepository {
  return new PostgresStateRepository(config);
}
