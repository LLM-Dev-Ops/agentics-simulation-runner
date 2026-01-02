/**
 * SimulationPlan type definitions
 * Defines the input artifact schema from agentics-simulation-planner
 *
 * References:
 * - SPARC_SPECIFICATION.md Section 3.1
 * - SPARC_ARCHITECTURE.md MOD-001, MOD-002
 */

import { z } from 'zod';
import type {
  UUID,
  SHA256Hash,
  SemanticVersion,
  ISO8601Timestamp,
  DurationMs,
  ResourceLimits,
  ConcurrencyModel,
  IsolationLevel,
  StepId,
  AgentId,
  IntegrationId,
  CheckpointId,
} from './common.js';
import {
  UUIDSchema,
  SHA256HashSchema,
  SemanticVersionSchema,
  ISO8601TimestampSchema,
  DurationMsSchema,
  ResourceLimitsSchema,
} from './common.js';

// ============================================================================
// Workflow Step Types
// ============================================================================

export type StepType =
  | 'AGENT_INVOCATION'
  | 'INTEGRATION_CALL'
  | 'CONDITIONAL'
  | 'PARALLEL_GROUP'
  | 'LOOP';

export interface WorkflowStep {
  readonly stepId: StepId;
  readonly stepType: StepType;
  readonly name: string;
  readonly description?: string;
  readonly agentRef?: AgentId;
  readonly integrationRef?: IntegrationId;
  readonly inputs: Record<string, unknown>;
  readonly timeout?: DurationMs;
  readonly retryPolicy?: RetryPolicy;
  readonly fallbackStep?: StepId;
  readonly critical: boolean;
  readonly subSteps?: WorkflowStep[];
  readonly condition?: Condition;
  readonly loopConfig?: LoopConfig;
  readonly integrationMethod?: string;
  readonly integrationPath?: string;
  readonly integrationParams?: Record<string, unknown>;
  readonly integrationBody?: unknown;
  readonly integrationHeaders?: Record<string, string>;
  readonly idempotencyKey?: string;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
}

export interface LoopConfig {
  readonly type: 'COUNT' | 'CONDITION' | 'COLLECTION';
  readonly count?: number;
  readonly condition?: Condition;
  readonly collection?: string;
  readonly itemVariable?: string;
  readonly maxIterations: number;
}

// ============================================================================
// Dependency Graph
// ============================================================================

export interface Dependency {
  readonly from: StepId;
  readonly to: StepId;
  readonly type: 'REQUIRES' | 'OPTIONAL';
}

export interface DependencyGraph {
  readonly edges: Dependency[];
}

// ============================================================================
// Checkpoint Definitions
// ============================================================================

export interface CheckpointDefinition {
  readonly checkpointId: CheckpointId;
  readonly stepRef: StepId;
  readonly name: string;
  readonly captureState: boolean;
  readonly captureMetrics: boolean;
}

// ============================================================================
// Agent Definitions
// ============================================================================

export type LLMProvider =
  | 'ANTHROPIC'
  | 'OPENAI'
  | 'AZURE_OPENAI'
  | 'GOOGLE'
  | 'COHERE'
  | 'CUSTOM';

export interface LLMInvocationSpec {
  readonly provider: LLMProvider;
  readonly modelId: string;
  readonly promptTemplate: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP?: number;
  readonly stopSequences?: string[];
  readonly systemPrompt?: string;
}

export type AgentType =
  | 'CONVERSATIONAL'
  | 'TOOL_USE'
  | 'REASONING'
  | 'PLANNING'
  | 'CODING'
  | 'ANALYSIS'
  | 'CUSTOM';

export interface AgentConfiguration {
  readonly parameters: Record<string, unknown>;
  readonly tools?: ToolDefinition[];
  readonly constraints?: AgentConstraints;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface AgentConstraints {
  readonly maxTokensPerInvocation?: number;
  readonly maxInvocationsPerStep?: number;
  readonly allowedTools?: string[];
  readonly forbiddenPatterns?: string[];
}

export interface AgentDefinition {
  readonly agentId: AgentId;
  readonly agentType: AgentType;
  readonly name: string;
  readonly description?: string;
  readonly configuration: AgentConfiguration;
  readonly invocationSpec: LLMInvocationSpec;
}

// ============================================================================
// Integration Definitions
// ============================================================================

export type AdapterType =
  | 'HTTP_REST'
  | 'GRAPHQL'
  | 'GRPC'
  | 'DATABASE'
  | 'MESSAGE_QUEUE'
  | 'FILE_SYSTEM'
  | 'AGENTICS_ECOSYSTEM'
  | 'CUSTOM';

export interface ConnectionSpec {
  readonly baseUrl?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly credentialRef: string;
  readonly options?: Record<string, unknown>;
  readonly timeout?: DurationMs;
  readonly poolSize?: number;
}

export interface IntegrationDefinition {
  readonly integrationId: IntegrationId;
  readonly adapterType: AdapterType;
  readonly name: string;
  readonly description?: string;
  readonly connectionSpec: ConnectionSpec;
  readonly idempotent: boolean;
}

// ============================================================================
// Observability Configuration
// ============================================================================

export interface MetricDefinition {
  readonly metricId: string;
  readonly name: string;
  readonly namePattern: string;
  readonly aggregation: MetricAggregation;
  readonly required: boolean;
  readonly buckets?: number[];
}

export type MetricAggregation =
  | 'SUM'
  | 'AVG'
  | 'MAX'
  | 'MIN'
  | 'COUNT'
  | 'P50'
  | 'P95'
  | 'P99'
  | 'HISTOGRAM'
  | 'RAW';

export interface EventDefinition {
  readonly eventType: string;
  readonly description?: string;
  readonly required: boolean;
  readonly schema?: Record<string, unknown>;
}

export interface TracingConfig {
  readonly enabled: boolean;
  readonly sampleRate: number;
  readonly propagateContext: boolean;
  readonly exportFormat?: 'OTLP' | 'JAEGER' | 'ZIPKIN';
}

export interface ObservabilityConfig {
  readonly metricsToCapture: MetricDefinition[];
  readonly eventsToRecord: EventDefinition[];
  readonly tracingConfig: TracingConfig;
}

// ============================================================================
// Validation Configuration
// ============================================================================

export type ConditionType =
  | 'EXPRESSION'
  | 'STATE_CHECK'
  | 'RESOURCE_CHECK'
  | 'EXTERNAL_CHECK';

export interface Condition {
  readonly conditionId: string;
  readonly type: ConditionType;
  readonly expression: string;
  readonly required: boolean;
  readonly description?: string;
}

export interface Invariant {
  readonly invariantId: string;
  readonly expression: string;
  readonly description: string;
  readonly severity: 'ERROR' | 'WARNING';
}

export interface ValidationConfig {
  readonly preConditions: Condition[];
  readonly postConditions: Condition[];
  readonly invariants: Invariant[];
}

// ============================================================================
// Execution Configuration
// ============================================================================

export interface ExecutionConfig {
  readonly maxDuration: DurationMs;
  readonly resourceLimits: ResourceLimits;
  readonly concurrencyModel: ConcurrencyModel;
  readonly isolationLevel: IsolationLevel;
  readonly deterministicSeed: bigint;
}

// ============================================================================
// Workflow Definition
// ============================================================================

export interface WorkflowDefinition {
  readonly steps: WorkflowStep[];
  readonly dependencies: DependencyGraph;
  readonly checkpoints: CheckpointDefinition[];
}

// ============================================================================
// SimulationPlan (Primary Input)
// ============================================================================

export interface SimulationPlan {
  // Identity
  readonly planId: UUID;
  readonly planVersion: SemanticVersion;
  readonly planHash: SHA256Hash;

  // Provenance
  readonly createdAt: ISO8601Timestamp;
  readonly createdBy: {
    readonly name: string;
    readonly version: SemanticVersion;
    readonly instanceId: UUID;
  };
  readonly sourceIntent: {
    readonly intentId: UUID;
    readonly intentHash: SHA256Hash;
  };

  // Execution Configuration
  readonly executionConfig: ExecutionConfig;

  // Workflow Definition
  readonly workflow: WorkflowDefinition;

  // Agent Definitions
  readonly agents: AgentDefinition[];

  // Integration Points
  readonly integrations: IntegrationDefinition[];

  // Observation Requirements
  readonly observability: ObservabilityConfig;

  // Validation Rules
  readonly validation: ValidationConfig;
}

// ============================================================================
// Zod Schemas for Plan Validation (INV-IN-001)
// ============================================================================

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  backoffMs: z.number().int().positive(),
  backoffMultiplier: z.number().positive(),
  maxBackoffMs: z.number().int().positive(),
});

export const ConditionSchema = z.object({
  conditionId: z.string().min(1),
  type: z.enum(['EXPRESSION', 'STATE_CHECK', 'RESOURCE_CHECK', 'EXTERNAL_CHECK']),
  expression: z.string().min(1),
  required: z.boolean(),
  description: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WorkflowStepSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    stepId: z.string().min(1),
    stepType: z.enum(['AGENT_INVOCATION', 'INTEGRATION_CALL', 'CONDITIONAL', 'PARALLEL_GROUP', 'LOOP']),
    name: z.string().min(1),
    description: z.string().optional(),
    agentRef: z.string().optional(),
    integrationRef: z.string().optional(),
    inputs: z.record(z.unknown()),
    timeout: DurationMsSchema.optional(),
    retryPolicy: RetryPolicySchema.optional(),
    fallbackStep: z.string().optional(),
    critical: z.boolean(),
    subSteps: z.array(WorkflowStepSchema).optional(),
    condition: ConditionSchema.optional(),
    loopConfig: z.object({
      type: z.enum(['COUNT', 'CONDITION', 'COLLECTION']),
      count: z.number().int().positive().optional(),
      condition: ConditionSchema.optional(),
      collection: z.string().optional(),
      itemVariable: z.string().optional(),
      maxIterations: z.number().int().positive(),
    }).optional(),
    integrationMethod: z.string().optional(),
    integrationPath: z.string().optional(),
    integrationParams: z.record(z.unknown()).optional(),
    integrationBody: z.unknown().optional(),
    integrationHeaders: z.record(z.string()).optional(),
    idempotencyKey: z.string().optional(),
  })
);

export const LLMInvocationSpecSchema = z.object({
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'AZURE_OPENAI', 'GOOGLE', 'COHERE', 'CUSTOM']),
  modelId: z.string().min(1),
  promptTemplate: z.string().min(1),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
});

export const AgentDefinitionSchema = z.object({
  agentId: z.string().min(1),
  agentType: z.enum(['CONVERSATIONAL', 'TOOL_USE', 'REASONING', 'PLANNING', 'CODING', 'ANALYSIS', 'CUSTOM']),
  name: z.string().min(1),
  description: z.string().optional(),
  configuration: z.object({
    parameters: z.record(z.unknown()),
    tools: z.array(z.object({
      name: z.string().min(1),
      description: z.string(),
      inputSchema: z.record(z.unknown()),
      outputSchema: z.record(z.unknown()).optional(),
    })).optional(),
    constraints: z.object({
      maxTokensPerInvocation: z.number().int().positive().optional(),
      maxInvocationsPerStep: z.number().int().positive().optional(),
      allowedTools: z.array(z.string()).optional(),
      forbiddenPatterns: z.array(z.string()).optional(),
    }).optional(),
  }),
  invocationSpec: LLMInvocationSpecSchema,
});

export const IntegrationDefinitionSchema = z.object({
  integrationId: z.string().min(1),
  adapterType: z.enum(['HTTP_REST', 'GRAPHQL', 'GRPC', 'DATABASE', 'MESSAGE_QUEUE', 'FILE_SYSTEM', 'AGENTICS_ECOSYSTEM', 'CUSTOM']),
  name: z.string().min(1),
  description: z.string().optional(),
  connectionSpec: z.object({
    baseUrl: z.string().url().optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    database: z.string().optional(),
    credentialRef: z.string().min(1),
    options: z.record(z.unknown()).optional(),
    timeout: DurationMsSchema.optional(),
    poolSize: z.number().int().positive().optional(),
  }),
  idempotent: z.boolean(),
});

export const SimulationPlanSchema = z.object({
  planId: UUIDSchema,
  planVersion: SemanticVersionSchema,
  planHash: SHA256HashSchema,
  createdAt: ISO8601TimestampSchema,
  createdBy: z.object({
    name: z.string().min(1),
    version: SemanticVersionSchema,
    instanceId: UUIDSchema,
  }),
  sourceIntent: z.object({
    intentId: UUIDSchema,
    intentHash: SHA256HashSchema,
  }),
  executionConfig: z.object({
    maxDuration: DurationMsSchema,
    resourceLimits: ResourceLimitsSchema,
    concurrencyModel: z.enum(['SEQUENTIAL', 'PARALLEL', 'ADAPTIVE']),
    isolationLevel: z.enum(['READ_COMMITTED', 'REPEATABLE_READ', 'SERIALIZABLE']),
    deterministicSeed: z.bigint(),
  }),
  workflow: z.object({
    steps: z.array(WorkflowStepSchema).min(1),
    dependencies: z.object({
      edges: z.array(z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        type: z.enum(['REQUIRES', 'OPTIONAL']),
      })),
    }),
    checkpoints: z.array(z.object({
      checkpointId: z.string().min(1),
      stepRef: z.string().min(1),
      name: z.string().min(1),
      captureState: z.boolean(),
      captureMetrics: z.boolean(),
    })),
  }),
  agents: z.array(AgentDefinitionSchema),
  integrations: z.array(IntegrationDefinitionSchema),
  observability: z.object({
    metricsToCapture: z.array(z.object({
      metricId: z.string().min(1),
      name: z.string().min(1),
      namePattern: z.string().min(1),
      aggregation: z.enum(['SUM', 'AVG', 'MAX', 'MIN', 'COUNT', 'P50', 'P95', 'P99', 'HISTOGRAM', 'RAW']),
      required: z.boolean(),
      buckets: z.array(z.number()).optional(),
    })),
    eventsToRecord: z.array(z.object({
      eventType: z.string().min(1),
      description: z.string().optional(),
      required: z.boolean(),
      schema: z.record(z.unknown()).optional(),
    })),
    tracingConfig: z.object({
      enabled: z.boolean(),
      sampleRate: z.number().min(0).max(1),
      propagateContext: z.boolean(),
      exportFormat: z.enum(['OTLP', 'JAEGER', 'ZIPKIN']).optional(),
    }),
  }),
  validation: z.object({
    preConditions: z.array(ConditionSchema),
    postConditions: z.array(ConditionSchema),
    invariants: z.array(z.object({
      invariantId: z.string().min(1),
      expression: z.string().min(1),
      description: z.string(),
      severity: z.enum(['ERROR', 'WARNING']),
    })),
  }),
});
