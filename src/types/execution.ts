/**
 * Execution context and runtime type definitions
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-003, MOD-004
 * - SPARC_PSEUDOCODE.md Phase 2, Phase 3
 */

import type seedrandom from 'seedrandom';
import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  ResourceLimits,
  IsolationLevel,
  ExecutionId,
  StepId,
  AgentId,
  IntegrationId,
} from './common.js';
import type { PlanReference } from './common.js';
import type {
  SimulationPlan,
  AgentDefinition,
  IntegrationDefinition,
  LLMInvocationSpec,
  WorkflowStep,
} from './plan.js';
import type { StepResult } from './result.js';

// ============================================================================
// Execution Context
// ============================================================================

/**
 * ExecutionContext represents the isolated runtime environment for a single
 * simulation execution. All state is namespaced and isolated.
 *
 * Invariants enforced:
 * - INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
 * - INV-EX-007: All state mutations MUST be recorded in ruvvector-postgres
 */
export interface ExecutionContext {
  readonly executionId: ExecutionId;
  readonly planRef: PlanReference;
  readonly tenantId: UUID;
  readonly stateNamespace: string;
  readonly randomGenerator: DeterministicRandom;
  readonly startTime: Date;
  readonly resourceLimits: ResourceLimits;
  readonly maxDuration: DurationMs;
  readonly isolationLevel: IsolationLevel;
}

/**
 * Deterministic random number generator wrapper
 * Implements INV-EX-001: Determinism via seeded PRNG
 * Implements GUA-REP-002: Random operations use deterministicSeed
 */
export interface DeterministicRandom {
  readonly initialSeed: bigint;
  next(): number;
  nextInt(min: number, max: number): number;
  nextBytes(length: number): Uint8Array;
  getState(): RandomState;
  currentSeed(): bigint;
}

export interface RandomState {
  readonly seed: bigint;
  readonly callCount: number;
  readonly state: unknown;
}

// ============================================================================
// Agent Instance
// ============================================================================

/**
 * AgentInstance represents a resolved and ready-to-invoke agent
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-007
 */
export interface AgentInstance {
  readonly agentId: AgentId;
  readonly agentType: string;
  readonly configuration: Record<string, unknown>;
  readonly invocationSpec: LLMInvocationSpec;
  readonly stateNamespace: string;
  readonly llmClient: LLMClient;
  readonly status: AgentInstanceStatus;
}

export type AgentInstanceStatus = 'CREATED' | 'READY' | 'INVOKING' | 'TERMINATED';

export interface LLMClient {
  validateModel(modelId: string): Promise<boolean>;
  invoke(request: LLMRequest): Promise<LLMResponse>;
  close(): Promise<void>;
}

export interface LLMRequest {
  readonly model: string;
  readonly prompt: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP?: number;
  readonly stopSequences?: string[];
  readonly systemPrompt?: string;
  readonly seed?: bigint;
}

export interface LLMResponse {
  readonly content: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly finishReason: string;
  readonly latencyMs: number;
  readonly modelId: string;
}

// ============================================================================
// Integration Connection
// ============================================================================

/**
 * IntegrationConnection represents an established connection to an external system
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-008
 */
export interface IntegrationConnection {
  readonly integrationId: IntegrationId;
  readonly adapterType: string;
  readonly connectionSpec: Record<string, unknown>;
  readonly status: ConnectionStatus;
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;
  close(): Promise<void>;
}

export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface IntegrationRequest {
  readonly method: string;
  readonly path: string;
  readonly parameters?: Record<string, unknown>;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly idempotencyKey?: string;
  readonly timeout?: DurationMs;
}

export interface IntegrationResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  readonly latencyMs: number;
}

// ============================================================================
// Workflow Execution
// ============================================================================

export interface ExecutionOrder {
  readonly steps: WorkflowStep[];
  readonly parallelGroups: WorkflowStep[][];
  readonly criticalPath: StepId[];
}

export interface WorkflowResult {
  readonly status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'ABORTED';
  readonly stepResults: StepResult[];
  readonly completedAt: Date;
  readonly abortReason?: string;
}

// ============================================================================
// Invocation Results
// ============================================================================

export interface AgentInvocationResult {
  readonly invocationId: UUID;
  readonly output: string;
  readonly metrics: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly latencyMs: number;
  };
}

export interface IntegrationCallResult {
  readonly callId: UUID;
  readonly output: unknown;
  readonly metrics: {
    readonly latencyMs: number;
    readonly statusCode: number;
  };
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  readonly checkpointId: string;
  readonly snapshotId: UUID;
  readonly snapshotHash: SHA256Hash;
  readonly createdAt: Date;
}

export interface StateData {
  readonly capturedAt: Date;
  readonly randomGeneratorState: RandomState;
  readonly stepStates: StepStateRecord[];
  readonly agentInvocations: AgentInvocationRecord[];
  readonly integrationCalls: IntegrationCallRecord[];
}

export interface StepStateRecord {
  readonly stepId: StepId;
  readonly status: string;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly outputs?: unknown;
  readonly metrics?: unknown;
  readonly errors?: unknown;
}

export interface AgentInvocationRecord {
  readonly invocationId: UUID;
  readonly agentId: AgentId;
  readonly stepId: StepId;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly status: string;
  readonly response?: unknown;
  readonly errorMessage?: string;
}

export interface IntegrationCallRecord {
  readonly callId: UUID;
  readonly integrationId: IntegrationId;
  readonly stepId: StepId;
  readonly calledAt: Date;
  readonly completedAt?: Date;
  readonly latencyMs?: number;
  readonly status: string;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly errorMessage?: string;
}

// ============================================================================
// State Handle
// ============================================================================

export interface StateHandle {
  readonly namespace: string;
  readonly initialized: boolean;
  readonly tables: string[];
}

// ============================================================================
// Execution Handle (returned to caller)
// ============================================================================

export interface ExecutionHandle {
  readonly executionId: ExecutionId;
  readonly planId: UUID;
  readonly planHash: SHA256Hash;
  readonly startedAt: ISO8601Timestamp;
  readonly estimatedDuration?: DurationMs;
}

// ============================================================================
// Health Status
// ============================================================================

export interface HealthStatus {
  readonly healthy: boolean;
  readonly timestamp: ISO8601Timestamp;
  readonly components: ComponentHealth[];
  readonly version: string;
}

export interface ComponentHealth {
  readonly name: string;
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly message?: string;
}
