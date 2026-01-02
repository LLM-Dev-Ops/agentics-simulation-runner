/**
 * MOD-014 State Repository
 *
 * Implements the mandatory state substrate (Section 9.1 of Specification).
 * ALL execution state MUST be persisted here using ruvvector-postgres.
 *
 * This is the STATE SUBSTRATE layer - the foundation for:
 * - Determinism guarantees (INV-EX-001)
 * - Reproducibility constraints (GUA-REP-001, GUA-REP-002, GUA-REP-003)
 * - Result immutability (INV-OUT-002)
 * - Execution isolation (INV-EX-002)
 *
 * References:
 * - Section 9.1 of Specification (mandatory state substrate)
 * - Pseudocode Section 4.2 (state storage methods)
 * - Refinement Section 4.2 (database concurrency)
 * - Refinement Section 3 (reproducibility constraints)
 */

import { PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import {
  ConnectionPool,
  getSharedConnectionPool,
} from './connection-pool.js';
import {
  getNamespacePrefix,
  getCreateNamespacedTablesSql,
  getDropNamespacedTablesSql,
  getCreateGlobalTablesSql,
  getCreateTenantPartitionSql,
  NamespaceConfig,
  ExecutionContextRow,
  SimulationResultRow,
  StepStateRow,
  AgentInvocationRow,
  IntegrationCallRow,
  MetricRow,
  EventRow,
  RandomnessLogRow,
  StateSnapshotRow,
} from './table-definitions.js';

/**
 * Execution context containing all necessary information for an execution.
 */
export interface ExecutionContext {
  executionId: string;
  tenantId: string;
  planId: string;
  planHash: string;
  deterministicSeed: bigint;
  namespace: string;
  metadata?: Record<string, unknown>;
}

/**
 * Simulation plan reference for initialization.
 */
export interface SimulationPlanRef {
  planId: string;
  planHash: string;
  version: string;
  steps: StepDefinition[];
  metadata?: Record<string, unknown>;
}

/**
 * Step definition from the simulation plan.
 */
export interface StepDefinition {
  stepId: string;
  stepOrder: number;
  inputs?: Record<string, unknown>;
}

/**
 * Step state update data.
 */
export interface StepStateUpdate {
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'RETRYING';
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  errorInfo?: Record<string, unknown>;
  retryCount?: number;
}

/**
 * Agent invocation record.
 */
export interface AgentInvocation {
  invocationId: string;
  agentId: string;
  stepId: string;
  agentType: string;
  invocationSpec: Record<string, unknown>;
  requestData?: Record<string, unknown>;
  responseData?: Record<string, unknown>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costBreakdown?: {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: string;
  };
  latencyMs?: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  errorInfo?: Record<string, unknown>;
  determinismLevel: 'STRICT' | 'REPRODUCIBLE' | 'AUDITED';
  llmSeed?: bigint;
}

/**
 * Integration call record.
 */
export interface IntegrationCall {
  callId: string;
  integrationId: string;
  stepId: string;
  endpointUrl: string;
  method: string;
  requestHeaders?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
  responseStatus?: number;
  responseHeaders?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  latencyMs?: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  retryCount?: number;
  errorInfo?: Record<string, unknown>;
  isIdempotent: boolean;
  compensationAction?: Record<string, unknown>;
}

/**
 * Metric record for telemetry.
 */
export interface MetricRecord {
  metricName: string;
  metricType: 'COUNTER' | 'GAUGE' | 'HISTOGRAM' | 'SUMMARY';
  metricValue: number;
  labels?: Record<string, unknown>;
  stepId?: string;
  agentId?: string;
}

/**
 * Event record for audit and observability.
 */
export interface EventRecord {
  eventType: string;
  eventCategory: string;
  severity?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  eventData: Record<string, unknown>;
  stepId?: string;
  agentId?: string;
  correlationId?: string;
}

/**
 * State checkpoint for reproducibility.
 */
export interface StateCheckpoint {
  checkpointId: string;
  stepId: string;
  snapshotType?: 'CHECKPOINT' | 'STEP_BOUNDARY' | 'ERROR_RECOVERY' | 'MANUAL';
  prngState?: Buffer;
  stepStates: Record<string, unknown>;
  agentStates?: Record<string, unknown>;
  integrationStates?: Record<string, unknown>;
}

/**
 * Simulation result for immutable storage.
 */
export interface SimulationResult {
  executionId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  resultData: Record<string, unknown>;
  telemetrySummary?: Record<string, unknown>;
  executionFingerprint?: string;
}

/**
 * StateRepository - Main class for state substrate operations.
 *
 * Implements all methods from Pseudocode Section 4.2:
 * - initializeState(ctx, plan) -> creates all tables for execution
 * - getStepState(executionId, stepId)
 * - updateStepState(executionId, stepId, state)
 * - recordAgentInvocation(ctx, invocation)
 * - recordIntegrationCall(ctx, call)
 * - recordMetric(ctx, metric)
 * - recordEvent(ctx, event)
 * - recordRandomnessLog(ctx, operation, value) - for reproducibility GUA-REP-002
 * - createStateSnapshot(ctx, checkpoint) - for GUA-REP-003
 * - persistResult(result) - immutable storage INV-OUT-002
 */
export class StateRepository {
  private readonly connectionPool: ConnectionPool;
  private initialized = false;

  constructor(connectionPool?: ConnectionPool) {
    this.connectionPool = connectionPool ?? getSharedConnectionPool();
  }

  /**
   * Initializes the global tables for the state repository.
   * Must be called once at system startup.
   */
  public async initializeGlobalTables(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const globalTablesSql = getCreateGlobalTablesSql();

    await this.connectionPool.transaction(async (client: PoolClient) => {
      for (const sql of globalTablesSql) {
        await client.query(sql);
      }
    });

    this.initialized = true;
  }

  /**
   * Creates tenant partitions for a new tenant.
   * Should be called when onboarding a new tenant.
   */
  public async createTenantPartitions(tenantId: string): Promise<void> {
    const partitionsSql = getCreateTenantPartitionSql(tenantId);

    await this.connectionPool.transaction(async (client: PoolClient) => {
      for (const sql of partitionsSql) {
        try {
          await client.query(sql);
        } catch (error) {
          // Ignore if partition already exists
          const pgError = error as { code?: string };
          if (pgError.code !== '42P07') {
            // 42P07 = duplicate_table
            throw error;
          }
        }
      }
    });
  }

  /**
   * Initializes state for a new execution.
   * Creates all namespaced tables and records the execution context.
   *
   * From Pseudocode: initializeState(ctx, plan) -> creates all tables for execution
   */
  public async initializeState(
    tenantId: string,
    planRef: SimulationPlanRef,
    deterministicSeed: bigint,
    metadata?: Record<string, unknown>
  ): Promise<ExecutionContext> {
    const executionId = randomUUID();
    const namespaceConfig: NamespaceConfig = { tenantId, executionId };
    const namespace = getNamespacePrefix(namespaceConfig);
    const namespacedTablesSql = getCreateNamespacedTablesSql(namespace);

    const ctx: ExecutionContext = {
      executionId,
      tenantId,
      planId: planRef.planId,
      planHash: planRef.planHash,
      deterministicSeed,
      namespace,
      metadata,
    };

    await this.connectionPool.transactionWithRetry(async (client: PoolClient) => {
      // Create namespaced tables
      for (const sql of namespacedTablesSql) {
        await client.query(sql);
      }

      // Insert execution context
      await client.query(
        `INSERT INTO execution_contexts (
          execution_id, tenant_id, plan_id, plan_hash, deterministic_seed,
          status, namespace_prefix, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          executionId,
          tenantId,
          planRef.planId,
          planRef.planHash,
          deterministicSeed.toString(),
          'INITIALIZING',
          namespace,
          JSON.stringify(metadata ?? {}),
        ]
      );

      // Initialize step states from plan
      for (const step of planRef.steps) {
        await client.query(
          `INSERT INTO ${namespace}_step_states (
            step_id, status, step_order, inputs
          ) VALUES ($1, $2, $3, $4)`,
          [step.stepId, 'PENDING', step.stepOrder, JSON.stringify(step.inputs ?? {})]
        );
      }
    }, tenantId);

    return ctx;
  }

  /**
   * Gets the execution context for an execution.
   */
  public async getExecutionContext(executionId: string): Promise<ExecutionContext | null> {
    const result = await this.connectionPool.query<ExecutionContextRow>(
      `SELECT * FROM execution_contexts WHERE execution_id = $1`,
      [executionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      executionId: row.execution_id,
      tenantId: row.tenant_id,
      planId: row.plan_id,
      planHash: row.plan_hash,
      deterministicSeed: row.deterministic_seed,
      namespace: row.namespace_prefix,
      metadata: row.metadata,
    };
  }

  /**
   * Updates the execution status.
   */
  public async updateExecutionStatus(
    ctx: ExecutionContext,
    status: ExecutionContextRow['status'],
    errorMessage?: string
  ): Promise<void> {
    const now = new Date();
    let updateFields = 'status = $1, updated_at = $2';
    const params: unknown[] = [status, now];
    let paramIndex = 3;

    if (status === 'RUNNING') {
      updateFields += `, started_at = $${paramIndex}`;
      params.push(now);
      paramIndex++;
    }

    if (['COMPLETED', 'FAILED', 'ROLLED_BACK', 'TIMED_OUT', 'ABORTED'].includes(status)) {
      updateFields += `, completed_at = $${paramIndex}`;
      params.push(now);
      paramIndex++;
    }

    if (errorMessage) {
      updateFields += `, error_message = $${paramIndex}`;
      params.push(errorMessage);
      paramIndex++;
    }

    params.push(ctx.executionId);

    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `UPDATE execution_contexts SET ${updateFields} WHERE execution_id = $${paramIndex}`,
      params
    );
  }

  /**
   * Gets the state of a specific step.
   *
   * From Pseudocode: getStepState(executionId, stepId)
   */
  public async getStepState(ctx: ExecutionContext, stepId: string): Promise<StepStateRow | null> {
    const result = await this.connectionPool.queryForTenant<StepStateRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_step_states WHERE step_id = $1`,
      [stepId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Gets all step states for an execution.
   */
  public async getAllStepStates(ctx: ExecutionContext): Promise<StepStateRow[]> {
    const result = await this.connectionPool.queryForTenant<StepStateRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_step_states ORDER BY step_order`,
      []
    );

    return result.rows;
  }

  /**
   * Updates the state of a specific step.
   *
   * From Pseudocode: updateStepState(executionId, stepId, state)
   */
  public async updateStepState(
    ctx: ExecutionContext,
    stepId: string,
    update: StepStateUpdate
  ): Promise<void> {
    const now = new Date();
    const setClauses: string[] = ['status = $1', 'updated_at = $2'];
    const params: unknown[] = [update.status, now];
    let paramIndex = 3;

    if (update.inputs !== undefined) {
      setClauses.push(`inputs = $${paramIndex}`);
      params.push(JSON.stringify(update.inputs));
      paramIndex++;
    }

    if (update.outputs !== undefined) {
      setClauses.push(`outputs = $${paramIndex}`);
      params.push(JSON.stringify(update.outputs));
      paramIndex++;
    }

    if (update.errorInfo !== undefined) {
      setClauses.push(`error_info = $${paramIndex}`);
      params.push(JSON.stringify(update.errorInfo));
      paramIndex++;
    }

    if (update.retryCount !== undefined) {
      setClauses.push(`retry_count = $${paramIndex}`);
      params.push(update.retryCount);
      paramIndex++;
    }

    if (update.status === 'RUNNING') {
      setClauses.push(`started_at = $${paramIndex}`);
      params.push(now);
      paramIndex++;
    }

    if (['COMPLETED', 'FAILED', 'SKIPPED'].includes(update.status)) {
      setClauses.push(`completed_at = $${paramIndex}`);
      params.push(now);
      paramIndex++;
    }

    params.push(stepId);

    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `UPDATE ${ctx.namespace}_step_states SET ${setClauses.join(', ')} WHERE step_id = $${paramIndex}`,
      params
    );
  }

  /**
   * Records an agent invocation.
   *
   * From Pseudocode: recordAgentInvocation(ctx, invocation)
   */
  public async recordAgentInvocation(
    ctx: ExecutionContext,
    invocation: AgentInvocation
  ): Promise<void> {
    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_agent_invocations (
        invocation_id, agent_id, step_id, agent_type, invocation_spec,
        request_data, response_data, token_usage, cost_breakdown,
        latency_ms, status, error_info, determinism_level, llm_seed, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (invocation_id) DO UPDATE SET
        response_data = EXCLUDED.response_data,
        token_usage = EXCLUDED.token_usage,
        cost_breakdown = EXCLUDED.cost_breakdown,
        latency_ms = EXCLUDED.latency_ms,
        status = EXCLUDED.status,
        error_info = EXCLUDED.error_info,
        completed_at = EXCLUDED.completed_at`,
      [
        invocation.invocationId,
        invocation.agentId,
        invocation.stepId,
        invocation.agentType,
        JSON.stringify(invocation.invocationSpec),
        invocation.requestData ? JSON.stringify(invocation.requestData) : null,
        invocation.responseData ? JSON.stringify(invocation.responseData) : null,
        invocation.tokenUsage ? JSON.stringify(invocation.tokenUsage) : null,
        invocation.costBreakdown ? JSON.stringify(invocation.costBreakdown) : null,
        invocation.latencyMs ?? null,
        invocation.status,
        invocation.errorInfo ? JSON.stringify(invocation.errorInfo) : null,
        invocation.determinismLevel,
        invocation.llmSeed?.toString() ?? null,
        ['COMPLETED', 'FAILED'].includes(invocation.status) ? new Date() : null,
      ]
    );
  }

  /**
   * Gets all agent invocations for an execution.
   */
  public async getAgentInvocations(ctx: ExecutionContext): Promise<AgentInvocationRow[]> {
    const result = await this.connectionPool.queryForTenant<AgentInvocationRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_agent_invocations ORDER BY created_at`,
      []
    );

    return result.rows;
  }

  /**
   * Records an integration call.
   *
   * From Pseudocode: recordIntegrationCall(ctx, call)
   */
  public async recordIntegrationCall(
    ctx: ExecutionContext,
    call: IntegrationCall
  ): Promise<void> {
    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_integration_calls (
        call_id, integration_id, step_id, endpoint_url, method,
        request_headers, request_body, response_status, response_headers,
        response_body, latency_ms, status, retry_count, error_info,
        is_idempotent, compensation_action, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (call_id) DO UPDATE SET
        response_status = EXCLUDED.response_status,
        response_headers = EXCLUDED.response_headers,
        response_body = EXCLUDED.response_body,
        latency_ms = EXCLUDED.latency_ms,
        status = EXCLUDED.status,
        retry_count = EXCLUDED.retry_count,
        error_info = EXCLUDED.error_info,
        completed_at = EXCLUDED.completed_at`,
      [
        call.callId,
        call.integrationId,
        call.stepId,
        call.endpointUrl,
        call.method,
        call.requestHeaders ? JSON.stringify(call.requestHeaders) : null,
        call.requestBody ? JSON.stringify(call.requestBody) : null,
        call.responseStatus ?? null,
        call.responseHeaders ? JSON.stringify(call.responseHeaders) : null,
        call.responseBody ? JSON.stringify(call.responseBody) : null,
        call.latencyMs ?? null,
        call.status,
        call.retryCount ?? 0,
        call.errorInfo ? JSON.stringify(call.errorInfo) : null,
        call.isIdempotent,
        call.compensationAction ? JSON.stringify(call.compensationAction) : null,
        ['COMPLETED', 'FAILED'].includes(call.status) ? new Date() : null,
      ]
    );
  }

  /**
   * Gets all integration calls for an execution.
   */
  public async getIntegrationCalls(ctx: ExecutionContext): Promise<IntegrationCallRow[]> {
    const result = await this.connectionPool.queryForTenant<IntegrationCallRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_integration_calls ORDER BY created_at`,
      []
    );

    return result.rows;
  }

  /**
   * Records a metric.
   *
   * From Pseudocode: recordMetric(ctx, metric)
   */
  public async recordMetric(
    ctx: ExecutionContext,
    metric: MetricRecord
  ): Promise<void> {
    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_metrics (
        metric_name, metric_type, metric_value, labels, step_id, agent_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        metric.metricName,
        metric.metricType,
        metric.metricValue,
        JSON.stringify(metric.labels ?? {}),
        metric.stepId ?? null,
        metric.agentId ?? null,
      ]
    );
  }

  /**
   * Gets all metrics for an execution.
   */
  public async getMetrics(ctx: ExecutionContext): Promise<MetricRow[]> {
    const result = await this.connectionPool.queryForTenant<MetricRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_metrics ORDER BY timestamp`,
      []
    );

    return result.rows;
  }

  /**
   * Records an event.
   *
   * From Pseudocode: recordEvent(ctx, event)
   */
  public async recordEvent(
    ctx: ExecutionContext,
    event: EventRecord
  ): Promise<void> {
    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_events (
        event_type, event_category, severity, event_data, step_id, agent_id, correlation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.eventType,
        event.eventCategory,
        event.severity ?? 'INFO',
        JSON.stringify(event.eventData),
        event.stepId ?? null,
        event.agentId ?? null,
        event.correlationId ?? null,
      ]
    );
  }

  /**
   * Gets all events for an execution.
   */
  public async getEvents(ctx: ExecutionContext): Promise<EventRow[]> {
    const result = await this.connectionPool.queryForTenant<EventRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_events ORDER BY timestamp`,
      []
    );

    return result.rows;
  }

  /**
   * Records a random value in the randomness log for reproducibility.
   * Required for GUA-REP-002.
   *
   * From Pseudocode: recordRandomnessLog(ctx, operation, value)
   */
  public async recordRandomnessLog(
    ctx: ExecutionContext,
    operation: string,
    value: bigint,
    stepId?: string,
    context?: Record<string, unknown>
  ): Promise<bigint> {
    const result = await this.connectionPool.queryForTenant<{ sequence_num: bigint }>(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_randomness_log (
        sequence_num, operation, random_value, step_id, context
      ) VALUES (nextval('${ctx.namespace}_randomness_seq'), $1, $2, $3, $4)
      RETURNING sequence_num`,
      [
        operation,
        value.toString(),
        stepId ?? null,
        context ? JSON.stringify(context) : null,
      ]
    );

    return result.rows[0].sequence_num;
  }

  /**
   * Gets the randomness log for an execution.
   */
  public async getRandomnessLog(ctx: ExecutionContext): Promise<RandomnessLogRow[]> {
    const result = await this.connectionPool.queryForTenant<RandomnessLogRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_randomness_log ORDER BY sequence_num`,
      []
    );

    return result.rows;
  }

  /**
   * Creates a state snapshot for checkpointing.
   * Required for GUA-REP-003.
   *
   * From Pseudocode: createStateSnapshot(ctx, checkpoint)
   */
  public async createStateSnapshot(
    ctx: ExecutionContext,
    checkpoint: StateCheckpoint
  ): Promise<string> {
    const snapshotId = randomUUID();

    // Serialize and compress states
    const stepStatesBuffer = gzipSync(Buffer.from(JSON.stringify(checkpoint.stepStates)));
    const agentStatesBuffer = checkpoint.agentStates
      ? gzipSync(Buffer.from(JSON.stringify(checkpoint.agentStates)))
      : null;
    const integrationStatesBuffer = checkpoint.integrationStates
      ? gzipSync(Buffer.from(JSON.stringify(checkpoint.integrationStates)))
      : null;

    // Compute snapshot hash for integrity verification
    const hashInput = Buffer.concat([
      stepStatesBuffer,
      agentStatesBuffer ?? Buffer.alloc(0),
      integrationStatesBuffer ?? Buffer.alloc(0),
      checkpoint.prngState ?? Buffer.alloc(0),
    ]);
    const snapshotHash = createHash('sha256').update(hashInput).digest('hex');

    await this.connectionPool.queryForTenant(
      ctx.tenantId,
      `INSERT INTO ${ctx.namespace}_state_snapshots (
        snapshot_id, checkpoint_id, step_id, snapshot_type,
        prng_state, step_states, agent_states, integration_states,
        snapshot_hash, compressed, compression_algorithm
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        snapshotId,
        checkpoint.checkpointId,
        checkpoint.stepId,
        checkpoint.snapshotType ?? 'CHECKPOINT',
        checkpoint.prngState ?? null,
        stepStatesBuffer,
        agentStatesBuffer,
        integrationStatesBuffer,
        snapshotHash,
        true,
        'GZIP',
      ]
    );

    return snapshotId;
  }

  /**
   * Gets a state snapshot by ID.
   */
  public async getStateSnapshot(
    ctx: ExecutionContext,
    snapshotId: string
  ): Promise<StateCheckpoint | null> {
    const result = await this.connectionPool.queryForTenant<StateSnapshotRow>(
      ctx.tenantId,
      `SELECT * FROM ${ctx.namespace}_state_snapshots WHERE snapshot_id = $1`,
      [snapshotId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.deserializeSnapshot(row);
  }

  /**
   * Gets the latest state snapshot for a checkpoint.
   */
  public async getLatestSnapshot(
    ctx: ExecutionContext,
    checkpointId?: string
  ): Promise<StateCheckpoint | null> {
    let query = `SELECT * FROM ${ctx.namespace}_state_snapshots`;
    const params: unknown[] = [];

    if (checkpointId) {
      query += ` WHERE checkpoint_id = $1`;
      params.push(checkpointId);
    }

    query += ` ORDER BY created_at DESC LIMIT 1`;

    const result = await this.connectionPool.queryForTenant<StateSnapshotRow>(
      ctx.tenantId,
      query,
      params
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserializeSnapshot(result.rows[0]);
  }

  /**
   * Deserializes a state snapshot from database row.
   */
  private deserializeSnapshot(row: StateSnapshotRow): StateCheckpoint {
    const stepStates = JSON.parse(
      gunzipSync(row.step_states).toString('utf-8')
    ) as Record<string, unknown>;

    const agentStates = row.agent_states
      ? (JSON.parse(gunzipSync(row.agent_states).toString('utf-8')) as Record<string, unknown>)
      : undefined;

    const integrationStates = row.integration_states
      ? (JSON.parse(gunzipSync(row.integration_states).toString('utf-8')) as Record<string, unknown>)
      : undefined;

    return {
      checkpointId: row.checkpoint_id,
      stepId: row.step_id,
      snapshotType: row.snapshot_type,
      prngState: row.prng_state ?? undefined,
      stepStates,
      agentStates,
      integrationStates,
    };
  }

  /**
   * Persists the final simulation result.
   * Results are immutable once persisted (INV-OUT-002).
   *
   * From Pseudocode: persistResult(result) - immutable storage INV-OUT-002
   */
  public async persistResult(
    ctx: ExecutionContext,
    result: SimulationResult
  ): Promise<string> {
    const resultId = randomUUID();
    const now = new Date();

    // Compute result hash for integrity verification
    const resultHash = createHash('sha256')
      .update(JSON.stringify(result.resultData))
      .digest('hex');

    await this.connectionPool.transactionWithRetry(async (client: PoolClient) => {
      // Insert the result
      await client.query(
        `INSERT INTO simulation_results (
          result_id, execution_id, tenant_id, plan_id, plan_hash,
          result_hash, status, result_data, telemetry_summary,
          execution_fingerprint, created_at, immutable_after
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          resultId,
          ctx.executionId,
          ctx.tenantId,
          ctx.planId,
          ctx.planHash,
          resultHash,
          result.status,
          JSON.stringify(result.resultData),
          result.telemetrySummary ? JSON.stringify(result.telemetrySummary) : null,
          result.executionFingerprint ?? null,
          now,
          now,
        ]
      );

      // Create immutability lock
      const lockHash = createHash('sha256')
        .update(`${resultId}:${resultHash}:${now.toISOString()}`)
        .digest('hex');

      await client.query(
        `INSERT INTO result_immutability_locks (
          result_id, lock_hash, locked_at, locked_by, lock_reason
        ) VALUES ($1, $2, $3, $4, $5)`,
        [resultId, lockHash, now, ctx.executionId, 'EXECUTION_COMPLETED']
      );

      // Update execution status
      await client.query(
        `UPDATE execution_contexts
         SET status = $1, completed_at = $2, updated_at = $2
         WHERE execution_id = $3`,
        [result.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED', now, ctx.executionId]
      );
    }, ctx.tenantId);

    return resultId;
  }

  /**
   * Gets a simulation result by ID.
   */
  public async getResult(resultId: string): Promise<SimulationResultRow | null> {
    const result = await this.connectionPool.query<SimulationResultRow>(
      `SELECT * FROM simulation_results WHERE result_id = $1`,
      [resultId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Gets a simulation result by execution ID.
   */
  public async getResultByExecutionId(executionId: string): Promise<SimulationResultRow | null> {
    const result = await this.connectionPool.query<SimulationResultRow>(
      `SELECT * FROM simulation_results WHERE execution_id = $1`,
      [executionId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Verifies result immutability (checks that result has not been tampered with).
   */
  public async verifyResultImmutability(resultId: string): Promise<boolean> {
    const result = await this.connectionPool.query<{
      result_data: Record<string, unknown>;
      result_hash: string;
      lock_hash: string;
    }>(
      `SELECT sr.result_data, sr.result_hash, ril.lock_hash
       FROM simulation_results sr
       JOIN result_immutability_locks ril ON sr.result_id = ril.result_id
       WHERE sr.result_id = $1`,
      [resultId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const row = result.rows[0];
    const computedHash = createHash('sha256')
      .update(JSON.stringify(row.result_data))
      .digest('hex');

    return computedHash === row.result_hash;
  }

  /**
   * Computes the execution fingerprint for reproducibility verification.
   * From Refinement Section 3.4.
   */
  public async computeExecutionFingerprint(ctx: ExecutionContext): Promise<string> {
    // Get all snapshots
    const snapshotsResult = await this.connectionPool.queryForTenant<{ snapshot_hash: string }>(
      ctx.tenantId,
      `SELECT snapshot_hash FROM ${ctx.namespace}_state_snapshots ORDER BY created_at`,
      []
    );

    // Get randomness log
    const randomnessResult = await this.connectionPool.queryForTenant<{
      sequence_num: bigint;
      operation: string;
      random_value: bigint;
    }>(
      ctx.tenantId,
      `SELECT sequence_num, operation, random_value FROM ${ctx.namespace}_randomness_log ORDER BY sequence_num`,
      []
    );

    // Build fingerprint data
    const fingerprintData = {
      version: '1.0',
      planHash: ctx.planHash,
      seed: ctx.deterministicSeed.toString(),
      snapshotHashes: snapshotsResult.rows.map((r: { snapshot_hash: string }) => r.snapshot_hash),
      randomnessHashes: randomnessResult.rows.map((r: { sequence_num: bigint; operation: string; random_value: bigint }) =>
        createHash('sha256')
          .update(`${r.sequence_num}:${r.operation}:${r.random_value}`)
          .digest('hex')
      ),
    };

    // Compute fingerprint
    return createHash('sha256')
      .update(JSON.stringify(fingerprintData, Object.keys(fingerprintData).sort()))
      .digest('hex');
  }

  /**
   * Cleans up all state for an execution (for rollback or cleanup).
   */
  public async cleanupExecutionState(ctx: ExecutionContext): Promise<void> {
    const dropTablesSql = getDropNamespacedTablesSql(ctx.namespace);

    await this.connectionPool.transactionWithRetry(async (client: PoolClient) => {
      await client.query(dropTablesSql);
      await client.query(
        `DELETE FROM execution_contexts WHERE execution_id = $1`,
        [ctx.executionId]
      );
    }, ctx.tenantId);
  }

  /**
   * Gets connection pool statistics.
   */
  public getPoolStats() {
    return this.connectionPool.getStats();
  }
}

/**
 * Singleton instance for shared state repository.
 */
let sharedStateRepository: StateRepository | null = null;

/**
 * Gets or creates the shared state repository.
 */
export function getSharedStateRepository(): StateRepository {
  if (!sharedStateRepository) {
    sharedStateRepository = new StateRepository();
  }
  return sharedStateRepository;
}
