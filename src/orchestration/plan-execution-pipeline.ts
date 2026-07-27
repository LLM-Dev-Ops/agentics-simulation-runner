/**
 * Plan Execution Pipeline (ADR-0001)
 *
 * Runs a submitted SimulationPlan through the real execution stages:
 *
 *   agent-resolution -> connection-establishment -> engine-dispatch
 *
 * Every stage is recorded from observation: a stage appears in
 * `stagesExecuted` only after it has actually run, and its timings come from
 * the clock around the call, never from literals. Downstream telemetry is
 * built from this record.
 */

import { randomUUID } from 'crypto';

import { AgentResolver } from './agent-resolver.js';
import { ConnectionEstablisher } from './connection-establisher.js';
import type { ExecutionGateway, EngineExecutionCompleteResult } from '../api/execution-gateway.js';
import { createDeterministicRandom } from '../core/deterministic-random.js';
import type { ExecutionContext } from '../types/execution.js';
import type { ExecutionId, UUID } from '../types/common.js';
import type { SimulationPlan } from '../types/plan.js';

// ============================================================================
// Types
// ============================================================================

export type PipelineStageName =
  | 'agent-resolution'
  | 'connection-establishment'
  | 'engine-dispatch';

export interface PipelineStageRecord {
  readonly stage: PipelineStageName;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: 'success' | 'error';
  readonly details?: Record<string, unknown>;
}

export interface PlanExecutionOutcome {
  readonly executionId: string;
  readonly status: 'completed' | 'failed';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  /** Stages that actually ran, in the order they ran. */
  readonly stagesExecuted: readonly PipelineStageRecord[];
  readonly engineResult?: EngineExecutionCompleteResult;
  readonly error?: { readonly stage: PipelineStageName; readonly message: string };
}

export interface PlanExecutionDependencies {
  readonly gateway: Pick<ExecutionGateway, 'submitPlanToEngine'>;
  readonly agentResolver: AgentResolver;
  readonly connectionEstablisher: ConnectionEstablisher;
}

export interface PlanExecutionRequest {
  readonly plan: SimulationPlan;
  readonly executionId?: string;
  readonly parentSpanId?: string;
}

/**
 * Layer ids derived from observed stages. Never a literal array.
 */
export function toLayersExecuted(stages: readonly PipelineStageRecord[]): string[] {
  return stages.filter((s) => s.status === 'success').map((s) => s.stage);
}

// ============================================================================
// Wire deserialization
// ============================================================================

/**
 * Thrown when a submitted plan cannot be deserialized into the domain shape.
 */
export class PlanDeserializationError extends Error {
  readonly code = 'PLAN_DESERIALIZATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'PlanDeserializationError';
  }
}

/**
 * Converts a JSON-parsed plan body into the domain plan.
 *
 * JSON has no bigint, so `executionConfig.deterministicSeed` arrives as a
 * decimal string (or number) and is widened here. The plan hash is defined
 * over the deserialized form, so this must happen before any hash check.
 */
export function deserializePlan(body: unknown): SimulationPlan {
  if (typeof body !== 'object' || body === null) {
    throw new PlanDeserializationError('plan must be an object');
  }

  const plan = body as Record<string, unknown>;
  const executionConfig = plan.executionConfig as Record<string, unknown> | undefined;
  if (!executionConfig) {
    throw new PlanDeserializationError('plan.executionConfig is required');
  }

  const rawSeed = executionConfig.deterministicSeed;
  if (typeof rawSeed !== 'string' && typeof rawSeed !== 'number') {
    throw new PlanDeserializationError(
      'plan.executionConfig.deterministicSeed must be a decimal string or number'
    );
  }

  let deterministicSeed: bigint;
  try {
    deterministicSeed = BigInt(rawSeed);
  } catch {
    throw new PlanDeserializationError(
      `plan.executionConfig.deterministicSeed is not a valid integer: ${String(rawSeed)}`
    );
  }

  return {
    ...plan,
    executionConfig: { ...executionConfig, deterministicSeed },
  } as unknown as SimulationPlan;
}

// ============================================================================
// Execution context
// ============================================================================

function buildExecutionContext(plan: SimulationPlan, executionId: string): ExecutionContext {
  return {
    executionId: executionId as ExecutionId,
    planRef: {
      planId: plan.planId,
      planHash: plan.planHash,
      planVersion: plan.planVersion,
    },
    tenantId: plan.planId as UUID,
    stateNamespace: `execution:${executionId}`,
    randomGenerator: createDeterministicRandom(plan.executionConfig.deterministicSeed),
    startTime: new Date(),
    resourceLimits: plan.executionConfig.resourceLimits,
    maxDuration: plan.executionConfig.maxDuration,
    isolationLevel: plan.executionConfig.isolationLevel,
  } as ExecutionContext;
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Executes a plan for real and reports exactly which stages ran.
 *
 * Never throws for pipeline failures: a failed stage produces an outcome with
 * `status: 'failed'`, the stages that did complete, and the error. Callers use
 * the outcome to decide whether downstream telemetry may be emitted at all.
 */
export async function executePlan(
  deps: PlanExecutionDependencies,
  request: PlanExecutionRequest
): Promise<PlanExecutionOutcome> {
  const { plan } = request;
  const executionId = request.executionId ?? randomUUID();
  const ctx = buildExecutionContext(plan, executionId);

  const stages: PipelineStageRecord[] = [];
  const pipelineStart = Date.now();
  const startedAt = new Date(pipelineStart).toISOString();

  const finish = (
    status: 'completed' | 'failed',
    engineResult?: EngineExecutionCompleteResult,
    error?: { stage: PipelineStageName; message: string }
  ): PlanExecutionOutcome => {
    const end = Date.now();
    return {
      executionId,
      status,
      startedAt,
      completedAt: new Date(end).toISOString(),
      durationMs: end - pipelineStart,
      stagesExecuted: stages,
      engineResult,
      error,
    };
  };

  const runStage = async <T>(
    stage: PipelineStageName,
    fn: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
    const stageStart = Date.now();
    try {
      const value = await fn();
      const stageEnd = Date.now();
      stages.push({
        stage,
        startedAt: new Date(stageStart).toISOString(),
        completedAt: new Date(stageEnd).toISOString(),
        durationMs: stageEnd - stageStart,
        status: 'success',
      });
      return { ok: true, value };
    } catch (error) {
      const stageEnd = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      stages.push({
        stage,
        startedAt: new Date(stageStart).toISOString(),
        completedAt: new Date(stageEnd).toISOString(),
        durationMs: stageEnd - stageStart,
        status: 'error',
        details: { error: message },
      });
      return { ok: false, message };
    }
  };

  // --- Stage 1: resolve agents against real provider clients ---
  const resolution = await runStage('agent-resolution', async () => {
    const result = await deps.agentResolver.resolveAgentInstances(ctx, plan);
    if (result.validationErrors.length > 0) {
      throw new Error(
        `Agent resolution failed: ${result.validationErrors
          .map((e) => `${e.agentId}: ${e.message}`)
          .join('; ')}`
      );
    }
    return result;
  });
  if (!resolution.ok) {
    return finish('failed', undefined, {
      stage: 'agent-resolution',
      message: resolution.message,
    });
  }

  try {
    // --- Stage 2: establish real integration connections ---
    const connections = await runStage('connection-establishment', async () => {
      const result = await deps.connectionEstablisher.establishIntegrationConnections(ctx, plan);
      if (result.connectionErrors.length > 0) {
        throw new Error(
          `Connection establishment failed: ${result.connectionErrors
            .map((e) => `${e.integrationId}: ${e.message}`)
            .join('; ')}`
        );
      }
      return result;
    });
    if (!connections.ok) {
      return finish('failed', undefined, {
        stage: 'connection-establishment',
        message: connections.message,
      });
    }

    try {
      // --- Stage 3: dispatch to the engine ---
      const dispatch = await runStage('engine-dispatch', () =>
        deps.gateway.submitPlanToEngine(plan)
      );
      if (!dispatch.ok) {
        return finish('failed', undefined, {
          stage: 'engine-dispatch',
          message: dispatch.message,
        });
      }

      return finish('completed', dispatch.value);
    } finally {
      await deps.connectionEstablisher.closeConnections(connections.value.connections);
    }
  } finally {
    await deps.agentResolver.terminateAgents(resolution.value.agents);
  }
}
