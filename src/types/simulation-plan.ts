/**
 * SimulationPlan Type Definitions for Agentics Simulation Runner
 *
 * The SimulationPlan is the primary input artifact for the simulation runner.
 * It is produced by agentics-simulation-planner and executed deterministically.
 *
 * Based on SPARC Specification Section 4.1.
 *
 * @module types/simulation-plan
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  DurationSeconds,
  SemanticVersion,
  SecretReference,
  AgentType,
  LLMProvider,
  LLMModelConfig,
  IsolationLevel,
  WorkingMemoryConfig,
  LongTermMemoryConfig,
  RetryPolicy,
  Condition,
  ResourceLimits,
  IntegrationEndpointType,
  HttpIntegrationConfig,
  GrpcIntegrationConfig,
  WebSocketIntegrationConfig,
  MessageQueueIntegrationConfig,
  Metadata,
} from './common.js';

import type { WorkflowDefinition, WorkflowStep } from './workflow.js';

// =============================================================================
// Plan Metadata
// =============================================================================

/**
 * Metadata for the simulation plan
 * From Section 4.1: simulation_plan.metadata
 */
export interface SimulationPlanMetadata {
  /**
   * Unique plan identifier (UUID v4)
   */
  readonly id: UUID;

  /**
   * Human-readable plan name
   */
  readonly name: string;

  /**
   * Optional plan description
   */
  readonly description?: string;

  /**
   * When the plan was created
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * Who created the plan (user ID or system identifier)
   */
  readonly createdBy: string;

  /**
   * Optional tags for categorization
   */
  readonly tags?: readonly string[];
}

// =============================================================================
// Execution Configuration
// =============================================================================

/**
 * Concurrency model for execution
 */
export type ConcurrencyModel =
  | 'sequential'    // Steps execute one at a time
  | 'parallel'      // Steps execute in parallel where dependencies allow
  | 'bounded'       // Parallel with max concurrency limit
  | 'adaptive';     // System determines optimal concurrency

/**
 * Execution configuration
 * From Section 4.1: execution_config
 */
export interface ExecutionConfig {
  /**
   * Maximum execution time in seconds
   * Min: 1, Max: 86400 (24 hours)
   */
  readonly timeoutSeconds: DurationSeconds;

  /**
   * Maximum number of steps to execute
   * Min: 1, Max: 100000
   */
  readonly maxSteps: number;

  /**
   * Interval for automatic checkpoints (number of steps)
   * Default: 100
   */
  readonly checkpointInterval?: number;

  /**
   * Retry policy for failed operations
   */
  readonly retryPolicy?: RetryPolicy;

  /**
   * Resource limits for the execution
   */
  readonly resourceLimits?: ResourceLimits;

  /**
   * Concurrency model for step execution
   */
  readonly concurrencyModel?: ConcurrencyModel;

  /**
   * Maximum concurrent agent invocations
   */
  readonly maxConcurrentAgents?: number;

  /**
   * Deterministic seed for reproducible execution
   * If provided, ensures deterministic PRNG behavior
   */
  readonly deterministicSeed?: number;
}

// =============================================================================
// State Configuration
// =============================================================================

/**
 * State configuration for ruvvector-postgres
 * From Section 4.1: state_config
 */
export interface StateConfig {
  /**
   * Database connection identifier
   */
  readonly databaseConnectionId: string;

  /**
   * Schema namespace for isolation
   */
  readonly schemaNamespace: string;

  /**
   * Transaction isolation level
   */
  readonly isolationLevel: IsolationLevel;

  /**
   * Vector dimensions for embedding operations
   */
  readonly vectorDimensions?: number;

  /**
   * Initial state to populate
   */
  readonly initialState?: Record<string, unknown>;
}

// =============================================================================
// Agent Configuration
// =============================================================================

/**
 * LLM binding configuration for an agent
 * From Section 4.3: agent_manifest.llm_binding
 */
export interface AgentLLMBinding {
  /**
   * LLM provider
   */
  readonly provider: LLMProvider;

  /**
   * Model identifier
   */
  readonly modelId: string;

  /**
   * Reference to API key in secret manager (NOT the actual key)
   */
  readonly apiKeyReference: SecretReference;

  /**
   * Model configuration
   */
  readonly configuration: LLMModelConfig;

  /**
   * System prompt for the agent
   */
  readonly systemPrompt: string;

  /**
   * Optional base URL for custom endpoints
   */
  readonly baseUrl?: string;

  /**
   * API version
   */
  readonly apiVersion?: string;
}

/**
 * Memory binding configuration for an agent
 * From Section 4.3: agent_manifest.memory_binding
 */
export interface AgentMemoryBinding {
  /**
   * Working memory configuration
   */
  readonly workingMemory: WorkingMemoryConfig;

  /**
   * Long-term memory configuration
   */
  readonly longTermMemory?: LongTermMemoryConfig;
}

/**
 * Agent capability definition
 */
export interface AgentCapability {
  /**
   * Capability identifier
   */
  readonly capabilityId: string;

  /**
   * Capability parameters
   */
  readonly parameters?: Record<string, unknown>;

  /**
   * Whether this capability is required
   */
  readonly required?: boolean;
}

/**
 * Agent constraints
 * From Section 4.3: agent_manifest.constraints
 */
export interface AgentConstraints {
  /**
   * Maximum concurrent actions the agent can perform
   */
  readonly maxConcurrentActions?: number;

  /**
   * Rate limit for agent invocations per minute
   */
  readonly rateLimitPerMinute?: number;

  /**
   * State keys the agent is allowed to mutate
   */
  readonly allowedStateMutations?: readonly string[];

  /**
   * Maximum tokens per invocation
   */
  readonly maxTokensPerInvocation?: number;

  /**
   * Maximum invocations during the simulation
   */
  readonly maxTotalInvocations?: number;
}

/**
 * Complete agent definition
 * From Section 4.1: agents[] and Section 4.3: agent_manifest
 */
export interface AgentDefinition {
  /**
   * Unique agent identifier within the plan
   */
  readonly id: string;

  /**
   * Agent type (autonomous, reactive, hybrid)
   */
  readonly type: AgentType;

  /**
   * Agent role description
   */
  readonly role: string;

  /**
   * Optional agent description
   */
  readonly description?: string;

  /**
   * Agent capabilities
   */
  readonly capabilities: readonly AgentCapability[];

  /**
   * LLM binding configuration
   */
  readonly llmBinding: AgentLLMBinding;

  /**
   * Memory binding configuration
   */
  readonly memoryBinding: AgentMemoryBinding;

  /**
   * Agent constraints
   */
  readonly constraints?: AgentConstraints;

  /**
   * Agent-specific metadata
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Integration Endpoint Configuration
// =============================================================================

/**
 * Authentication configuration for integration endpoints
 */
export interface IntegrationAuthentication {
  /**
   * Authentication type
   */
  readonly type: 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'mtls';

  /**
   * Reference to credentials in secret manager
   */
  readonly credentialReference?: SecretReference;

  /**
   * Additional authentication parameters
   */
  readonly parameters?: Record<string, unknown>;
}

/**
 * Integration endpoint definition
 * From Section 4.5
 */
export interface IntegrationEndpoint {
  /**
   * Unique endpoint identifier
   */
  readonly id: string;

  /**
   * Endpoint type
   */
  readonly type: IntegrationEndpointType;

  /**
   * Type-specific configuration
   */
  readonly config:
    | HttpIntegrationConfig
    | GrpcIntegrationConfig
    | WebSocketIntegrationConfig
    | MessageQueueIntegrationConfig;

  /**
   * Authentication configuration
   */
  readonly authentication?: IntegrationAuthentication;

  /**
   * Whether calls should be recorded for replay
   */
  readonly recordForReplay?: boolean;

  /**
   * Whether to use mock responses in simulation
   */
  readonly useMock?: boolean;

  /**
   * Mock response configuration
   */
  readonly mockConfig?: {
    readonly responses: readonly Record<string, unknown>[];
    readonly strategy: 'sequential' | 'random' | 'conditional';
  };

  /**
   * Endpoint metadata
   */
  readonly metadata?: Metadata;
}

// =============================================================================
// Observability Configuration
// =============================================================================

/**
 * Tracing configuration
 */
export interface TracingConfig {
  /**
   * Whether tracing is enabled
   */
  readonly enabled: boolean;

  /**
   * Sampling rate (0.0-1.0)
   */
  readonly samplingRate?: number;

  /**
   * Whether to sample all spans on error
   */
  readonly sampleOnError?: boolean;

  /**
   * Additional span attributes
   */
  readonly spanAttributes?: Record<string, string>;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /**
   * Whether metrics are enabled
   */
  readonly enabled: boolean;

  /**
   * Export interval in milliseconds
   */
  readonly exportIntervalMs?: DurationMs;

  /**
   * Custom metrics to collect
   */
  readonly customMetrics?: readonly string[];
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  /**
   * Minimum log level
   */
  readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

  /**
   * Whether to log prompts (may contain sensitive data)
   */
  readonly logPrompts?: boolean;

  /**
   * Whether to log completions (may contain sensitive data)
   */
  readonly logCompletions?: boolean;

  /**
   * Whether to log state mutations
   */
  readonly logStateMutations?: boolean;
}

/**
 * Observability configuration
 */
export interface ObservabilityConfig {
  /**
   * Tracing configuration
   */
  readonly tracing?: TracingConfig;

  /**
   * Metrics configuration
   */
  readonly metrics?: MetricsConfig;

  /**
   * Logging configuration
   */
  readonly logging?: LoggingConfig;
}

// =============================================================================
// Validation Configuration
// =============================================================================

/**
 * Invariant definition for continuous validation
 */
export interface Invariant {
  /**
   * Invariant identifier
   */
  readonly id: string;

  /**
   * Invariant expression to evaluate
   */
  readonly expression: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Whether violation should halt execution
   */
  readonly haltOnViolation: boolean;
}

/**
 * Validation configuration
 */
export interface ValidationConfig {
  /**
   * Preconditions to check before execution starts
   */
  readonly preConditions?: readonly Condition[];

  /**
   * Postconditions to check after execution completes
   */
  readonly postConditions?: readonly Condition[];

  /**
   * Invariants to check throughout execution
   */
  readonly invariants?: readonly Invariant[];

  /**
   * Whether to validate state schema on mutations
   */
  readonly validateStateSchema?: boolean;

  /**
   * State schema (JSON Schema)
   */
  readonly stateSchema?: Record<string, unknown>;
}

// =============================================================================
// Workflow Configuration
// =============================================================================

/**
 * Workflow configuration wrapper
 */
export interface WorkflowConfig {
  /**
   * Workflow steps
   */
  readonly steps: readonly WorkflowStep[];

  /**
   * Step dependency map (step ID -> dependent step IDs)
   */
  readonly dependencies?: Record<string, readonly string[]>;

  /**
   * Checkpoint step IDs
   */
  readonly checkpoints?: readonly string[];
}

// =============================================================================
// SimulationPlan
// =============================================================================

/**
 * Complete SimulationPlan artifact
 *
 * This is the immutable input to the Simulation Runner, produced by
 * agentics-simulation-planner. The runner executes this plan deterministically
 * without modification or interpretation.
 *
 * From SPARC Specification Section 4.1
 */
export interface SimulationPlan {
  /**
   * Plan schema version
   */
  readonly version: SemanticVersion;

  // =========================================================================
  // Plan Identity (Section 3.1 equivalent)
  // =========================================================================

  /**
   * Unique plan identifier (UUID v4)
   */
  readonly planId: UUID;

  /**
   * Plan version (semantic version)
   */
  readonly planVersion: SemanticVersion;

  /**
   * SHA-256 hash of the plan content (excluding this field)
   * Used for integrity verification
   */
  readonly planHash: SHA256Hash;

  /**
   * When the plan was created
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * Who created the plan
   */
  readonly createdBy: string;

  /**
   * Original intent that generated this plan (for traceability)
   */
  readonly sourceIntent?: string;

  // =========================================================================
  // Plan Metadata
  // =========================================================================

  /**
   * Plan metadata
   */
  readonly metadata: SimulationPlanMetadata;

  // =========================================================================
  // Configuration Sections
  // =========================================================================

  /**
   * Execution configuration
   */
  readonly executionConfig: ExecutionConfig;

  /**
   * State configuration for ruvvector-postgres
   */
  readonly stateConfig: StateConfig;

  // =========================================================================
  // Workflow Definition
  // =========================================================================

  /**
   * Workflow configuration with steps and dependencies
   */
  readonly workflow: WorkflowConfig;

  /**
   * Complete workflow definitions (if using named workflows)
   */
  readonly workflows?: readonly WorkflowDefinition[];

  // =========================================================================
  // Agent Definitions
  // =========================================================================

  /**
   * Agent definitions
   */
  readonly agents: readonly AgentDefinition[];

  // =========================================================================
  // Integration Definitions
  // =========================================================================

  /**
   * Integration endpoint definitions
   */
  readonly integrations?: readonly IntegrationEndpoint[];

  // =========================================================================
  // Observability Configuration
  // =========================================================================

  /**
   * Observability configuration
   */
  readonly observability?: ObservabilityConfig;

  // =========================================================================
  // Validation Configuration
  // =========================================================================

  /**
   * Validation configuration
   */
  readonly validation?: ValidationConfig;
}

// =============================================================================
// Plan Validation Types
// =============================================================================

/**
 * Result of plan validation
 */
export interface PlanValidationResult {
  /**
   * Whether the plan is valid
   */
  readonly valid: boolean;

  /**
   * Validation errors (if any)
   */
  readonly errors: readonly {
    readonly code: string;
    readonly severity: 'FATAL' | 'ERROR' | 'WARNING';
    readonly message: string;
    readonly path?: string;
    readonly context?: Record<string, unknown>;
  }[];

  /**
   * Validation warnings
   */
  readonly warnings: readonly string[];

  /**
   * Validated at timestamp
   */
  readonly validatedAt: ISO8601Timestamp;

  /**
   * Schema version used for validation
   */
  readonly schemaVersion: SemanticVersion;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a config is HTTP integration
 */
export function isHttpIntegrationConfig(
  config: IntegrationEndpoint['config']
): config is HttpIntegrationConfig {
  return 'url' in config && 'method' in config;
}

/**
 * Type guard to check if a config is gRPC integration
 */
export function isGrpcIntegrationConfig(
  config: IntegrationEndpoint['config']
): config is GrpcIntegrationConfig {
  return 'host' in config && 'service' in config && 'protoDescriptor' in config;
}

/**
 * Type guard to check if a config is WebSocket integration
 */
export function isWebSocketIntegrationConfig(
  config: IntegrationEndpoint['config']
): config is WebSocketIntegrationConfig {
  return 'url' in config && 'protocols' in config;
}

/**
 * Type guard to check if a config is message queue integration
 */
export function isMessageQueueIntegrationConfig(
  config: IntegrationEndpoint['config']
): config is MessageQueueIntegrationConfig {
  return 'type' in config && 'topicOrQueue' in config;
}
