/**
 * ExecutionContext Type Definitions for Agentics Simulation Runner
 *
 * The ExecutionContext provides runtime context for simulation execution,
 * including state isolation, deterministic random generation, and resource
 * management. This enforces the invariants from the SPARC specification.
 *
 * Based on SPARC Specification Sections 3.3, 6.1, 6.2.
 *
 * @module types/execution-context
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  DurationSeconds,
  IsolationLevel,
  ResourceLimits,
  ExecutionStatus,
  AgentStatus,
  LogLevel,
  Metadata,
} from './common.js';

import type { SimulationPlan, ExecutionConfig, StateConfig } from './simulation-plan.js';

// =============================================================================
// Seeded Random Generator Interface (INV-EX-001)
// =============================================================================

/**
 * Interface for seeded pseudo-random number generator
 *
 * Ensures deterministic execution (INV-EX-001):
 * "Given identical SimulationPlan and initial state, execution MUST
 * produce identical SimulationResult"
 */
export interface SeededRandomGenerator {
  /**
   * The seed used to initialize the generator
   */
  readonly seed: number;

  /**
   * Generate a random number between 0 (inclusive) and 1 (exclusive)
   */
  next(): number;

  /**
   * Generate a random integer between min (inclusive) and max (exclusive)
   */
  nextInt(min: number, max: number): number;

  /**
   * Generate a random boolean
   */
  nextBoolean(): boolean;

  /**
   * Pick a random element from an array
   */
  pick<T>(array: readonly T[]): T;

  /**
   * Shuffle an array (returns new array)
   */
  shuffle<T>(array: readonly T[]): T[];

  /**
   * Generate a random UUID (deterministic based on seed)
   */
  nextUUID(): UUID;

  /**
   * Clone the generator with current state
   */
  clone(): SeededRandomGenerator;

  /**
   * Get current internal state for checkpointing
   */
  getState(): unknown;

  /**
   * Restore from saved state
   */
  setState(state: unknown): void;
}

// =============================================================================
// State Namespace Interface (INV-EX-002)
// =============================================================================

/**
 * Interface for isolated state namespace
 *
 * Ensures state isolation (INV-ST-002, INV-ST-003):
 * - "State MUST be consistent across all queries within a transaction"
 * - "No state mutation may occur outside a tracked transaction"
 */
export interface StateNamespace {
  /**
   * Namespace identifier (typically schema name)
   */
  readonly namespaceId: string;

  /**
   * Execution ID this namespace belongs to
   */
  readonly executionId: UUID;

  /**
   * Database schema name
   */
  readonly schemaName: string;

  /**
   * Whether namespace is initialized
   */
  readonly initialized: boolean;

  /**
   * Isolation level for transactions
   */
  readonly isolationLevel: IsolationLevel;

  /**
   * Vector dimensions (if vector operations enabled)
   */
  readonly vectorDimensions?: number;

  /**
   * Get a value from state
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Set a value in state (within transaction)
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a key from state
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get all keys matching pattern
   */
  keys(pattern?: string): Promise<string[]>;

  /**
   * Get current state hash
   */
  getStateHash(): Promise<SHA256Hash>;

  /**
   * Begin a transaction
   */
  beginTransaction(): Promise<StateTransaction>;

  /**
   * Get vector collection interface
   */
  getVectorCollection(name: string): VectorCollection;
}

/**
 * Transaction interface for atomic state operations
 */
export interface StateTransaction {
  /**
   * Transaction identifier
   */
  readonly transactionId: string;

  /**
   * Get value within transaction
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Set value within transaction
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete key within transaction
   */
  delete(key: string): Promise<boolean>;

  /**
   * Commit the transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback the transaction
   */
  rollback(): Promise<void>;

  /**
   * Whether transaction is still active
   */
  readonly isActive: boolean;
}

/**
 * Vector collection interface for similarity search
 */
export interface VectorCollection {
  /**
   * Collection name
   */
  readonly name: string;

  /**
   * Vector dimensions
   */
  readonly dimensions: number;

  /**
   * Insert a vector
   */
  insert(id: string, vector: number[], metadata?: Metadata): Promise<void>;

  /**
   * Search for similar vectors
   */
  search(
    queryVector: number[],
    options?: {
      limit?: number;
      minSimilarity?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<VectorSearchResult[]>;

  /**
   * Delete a vector by ID
   */
  delete(id: string): Promise<boolean>;

  /**
   * Get vector by ID
   */
  get(id: string): Promise<{ vector: number[]; metadata?: Metadata } | undefined>;

  /**
   * Count vectors in collection
   */
  count(): Promise<number>;
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  readonly id: string;
  readonly vector: number[];
  readonly similarity: number;
  readonly metadata?: Metadata;
}

// =============================================================================
// Agent Context Interface
// =============================================================================

/**
 * Runtime context for an agent
 */
export interface AgentContext {
  /**
   * Agent identifier
   */
  readonly agentId: string;

  /**
   * Execution context reference
   */
  readonly executionContext: ExecutionContext;

  /**
   * Agent status
   */
  status: AgentStatus;

  /**
   * Invocation counter
   */
  invocationCount: number;

  /**
   * Total tokens consumed
   */
  totalTokensConsumed: number;

  /**
   * Working memory (in-process)
   */
  readonly workingMemory: Map<string, unknown>;

  /**
   * Long-term memory collection (if enabled)
   */
  readonly longTermMemory?: VectorCollection;

  /**
   * Agent-scoped state keys this agent can access
   */
  readonly allowedStateKeys: readonly string[];

  /**
   * Rate limiter for this agent
   */
  readonly rateLimiter?: RateLimiter;

  /**
   * Invoke the agent's LLM
   */
  invokeLLM(prompt: string, options?: LLMInvokeOptions): Promise<LLMResponse>;

  /**
   * Record an action taken by the agent
   */
  recordAction(action: string, details?: Metadata): void;

  /**
   * Get agent metrics
   */
  getMetrics(): AgentMetrics;
}

/**
 * LLM invocation options
 */
export interface LLMInvokeOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly systemPromptOverride?: string;
}

/**
 * LLM response
 */
export interface LLMResponse {
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: DurationMs;
  readonly model: string;
  readonly finishReason: 'stop' | 'length' | 'content_filter' | 'error';
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  readonly invocationCount: number;
  readonly totalTokensConsumed: number;
  readonly averageLatencyMs: number;
  readonly errorCount: number;
  readonly lastInvocationAt?: ISO8601Timestamp;
}

// =============================================================================
// Rate Limiter Interface
// =============================================================================

/**
 * Rate limiter interface for agent/resource throttling
 */
export interface RateLimiter {
  /**
   * Try to acquire a permit
   * @returns true if permit acquired, false if rate limited
   */
  tryAcquire(): boolean;

  /**
   * Acquire a permit, waiting if necessary
   * @returns wait time in ms (0 if immediate)
   */
  acquire(): Promise<number>;

  /**
   * Get remaining permits
   */
  getRemaining(): number;

  /**
   * Get time until next permit is available
   */
  getWaitTimeMs(): number;

  /**
   * Reset the rate limiter
   */
  reset(): void;
}

// =============================================================================
// Resource Manager Interface
// =============================================================================

/**
 * Resource manager for tracking and enforcing limits
 */
export interface ResourceManager {
  /**
   * Current resource limits
   */
  readonly limits: ResourceLimits;

  /**
   * Current resource usage
   */
  readonly usage: ResourceUsage;

  /**
   * Check if resource can be allocated
   */
  canAllocate(resource: ResourceType, amount: number): boolean;

  /**
   * Allocate resource
   * @throws if allocation would exceed limits
   */
  allocate(resource: ResourceType, amount: number): void;

  /**
   * Release allocated resource
   */
  release(resource: ResourceType, amount: number): void;

  /**
   * Get usage percentage for a resource
   */
  getUsagePercent(resource: ResourceType): number;

  /**
   * Check if any limit is exceeded
   */
  isAnyLimitExceeded(): boolean;

  /**
   * Get current usage snapshot
   */
  snapshot(): ResourceSnapshot;
}

/**
 * Resource types that can be managed
 */
export type ResourceType =
  | 'memory'
  | 'cpu'
  | 'tokens'
  | 'agents'
  | 'state_size'
  | 'api_calls';

/**
 * Current resource usage
 */
export interface ResourceUsage {
  readonly memoryBytes: number;
  readonly cpuPercent: number;
  readonly tokensConsumed: number;
  readonly activeAgents: number;
  readonly stateSizeBytes: number;
  readonly apiCallsCount: number;
}

/**
 * Resource snapshot for checkpointing
 */
export interface ResourceSnapshot {
  readonly timestamp: ISO8601Timestamp;
  readonly usage: ResourceUsage;
  readonly limits: ResourceLimits;
}

// =============================================================================
// Telemetry Collector Interface
// =============================================================================

/**
 * Telemetry collector for runtime observability
 */
export interface TelemetryCollector {
  /**
   * Start a trace span
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): SpanHandle;

  /**
   * Record a metric
   */
  recordMetric(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Emit a log entry
   */
  log(level: LogLevel, message: string, context?: Metadata): void;

  /**
   * Emit an event
   */
  emitEvent(eventType: string, payload: Metadata): void;

  /**
   * Flush all pending telemetry
   */
  flush(): Promise<void>;
}

/**
 * Handle for an active span
 */
export interface SpanHandle {
  /**
   * Span ID
   */
  readonly spanId: string;

  /**
   * Add attributes to the span
   */
  setAttribute(key: string, value: string | number | boolean): void;

  /**
   * Record an error
   */
  recordError(error: Error): void;

  /**
   * End the span
   */
  end(): void;
}

// =============================================================================
// Checkpoint Manager Interface
// =============================================================================

/**
 * Checkpoint manager for state snapshots
 */
export interface CheckpointManager {
  /**
   * Create a checkpoint
   */
  create(label: string, stepId?: string): Promise<Checkpoint>;

  /**
   * Restore from a checkpoint
   */
  restore(checkpointId: UUID): Promise<void>;

  /**
   * List available checkpoints
   */
  list(): Promise<CheckpointInfo[]>;

  /**
   * Get checkpoint by ID
   */
  get(checkpointId: UUID): Promise<Checkpoint | undefined>;

  /**
   * Delete a checkpoint
   */
  delete(checkpointId: UUID): Promise<boolean>;

  /**
   * Get latest checkpoint
   */
  getLatest(): Promise<Checkpoint | undefined>;
}

/**
 * Checkpoint data
 */
export interface Checkpoint {
  readonly checkpointId: UUID;
  readonly label: string;
  readonly executionId: UUID;
  readonly stepId?: string;
  readonly sequenceNumber: number;
  readonly createdAt: ISO8601Timestamp;
  readonly stateHash: SHA256Hash;
  readonly randomGeneratorState: unknown;
  readonly agentStates: Record<string, unknown>;
}

/**
 * Checkpoint info (summary without full state)
 */
export interface CheckpointInfo {
  readonly checkpointId: UUID;
  readonly label: string;
  readonly stepId?: string;
  readonly sequenceNumber: number;
  readonly createdAt: ISO8601Timestamp;
  readonly stateHash: SHA256Hash;
}

// =============================================================================
// ExecutionContext
// =============================================================================

/**
 * Main execution context for a simulation run
 *
 * This is the runtime environment for executing a SimulationPlan.
 * It provides access to all resources needed during execution while
 * enforcing isolation and determinism invariants.
 *
 * Invariants enforced:
 * - INV-EX-001: Deterministic execution via seeded PRNG
 * - INV-EX-002: Precondition validation via step executor
 * - INV-ST-001: Atomic mutations via state transactions
 * - INV-ST-002: Consistent state via isolation levels
 * - INV-AG-001: Agent isolation via state substrate communication only
 */
export interface ExecutionContext {
  // ===========================================================================
  // Identity
  // ===========================================================================

  /**
   * Unique execution identifier
   */
  readonly executionId: UUID;

  /**
   * Reference to the plan being executed
   */
  readonly planRef: {
    readonly planId: UUID;
    readonly planVersion: string;
    readonly planHash: SHA256Hash;
  };

  /**
   * Tenant identifier for multi-tenancy
   */
  readonly tenantId?: string;

  // ===========================================================================
  // State Management (INV-EX-002, INV-ST-*)
  // ===========================================================================

  /**
   * Isolated state namespace for this execution
   * Ensures no cross-execution state leakage
   */
  readonly stateNamespace: StateNamespace;

  // ===========================================================================
  // Determinism (INV-EX-001)
  // ===========================================================================

  /**
   * Seeded random generator for deterministic execution
   * All random operations MUST use this generator
   */
  readonly randomGenerator: SeededRandomGenerator;

  // ===========================================================================
  // Timing
  // ===========================================================================

  /**
   * When execution started
   */
  readonly startTime: ISO8601Timestamp;

  /**
   * Maximum execution duration in seconds
   */
  readonly maxDuration: DurationSeconds;

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): DurationMs;

  /**
   * Get remaining time in milliseconds
   */
  getRemainingMs(): DurationMs;

  /**
   * Check if execution has timed out
   */
  isTimedOut(): boolean;

  // ===========================================================================
  // Resource Management
  // ===========================================================================

  /**
   * Resource limits for this execution
   */
  readonly resourceLimits: ResourceLimits;

  /**
   * Resource manager
   */
  readonly resourceManager: ResourceManager;

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Current execution status
   */
  status: ExecutionStatus;

  /**
   * Current step sequence number
   */
  currentStepSequence: number;

  /**
   * Current step ID being executed
   */
  currentStepId?: string;

  // ===========================================================================
  // Agent Management
  // ===========================================================================

  /**
   * Get agent context by ID
   */
  getAgentContext(agentId: string): AgentContext | undefined;

  /**
   * Get all agent contexts
   */
  getAllAgentContexts(): ReadonlyMap<string, AgentContext>;

  /**
   * Spawn a new agent context
   */
  spawnAgent(agentId: string, config: AgentSpawnConfig): Promise<AgentContext>;

  /**
   * Terminate an agent
   */
  terminateAgent(agentId: string): Promise<void>;

  // ===========================================================================
  // Checkpointing
  // ===========================================================================

  /**
   * Checkpoint manager
   */
  readonly checkpointManager: CheckpointManager;

  // ===========================================================================
  // Telemetry
  // ===========================================================================

  /**
   * Telemetry collector
   */
  readonly telemetry: TelemetryCollector;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize the execution context
   */
  initialize(): Promise<void>;

  /**
   * Finalize and cleanup
   */
  finalize(): Promise<void>;

  /**
   * Cancel execution
   */
  cancel(reason: string): Promise<void>;

  /**
   * Check if execution is cancelled
   */
  isCancelled(): boolean;

  /**
   * Get cancellation reason
   */
  getCancellationReason(): string | undefined;
}

/**
 * Configuration for spawning an agent
 */
export interface AgentSpawnConfig {
  readonly agentId: string;
  readonly allowedStateKeys?: readonly string[];
  readonly rateLimitPerMinute?: number;
  readonly maxConcurrentActions?: number;
  readonly workingMemorySize?: number;
  readonly longTermMemoryEnabled?: boolean;
  readonly vectorCollection?: string;
}

// =============================================================================
// Execution Context Factory
// =============================================================================

/**
 * Configuration for creating an execution context
 */
export interface ExecutionContextConfig {
  /**
   * The simulation plan to execute
   */
  readonly plan: SimulationPlan;

  /**
   * Tenant ID for multi-tenancy
   */
  readonly tenantId?: string;

  /**
   * Override for deterministic seed
   */
  readonly seedOverride?: number;

  /**
   * Database connection string
   */
  readonly databaseUrl: string;

  /**
   * Telemetry configuration
   */
  readonly telemetryConfig?: {
    readonly enabled: boolean;
    readonly endpoint?: string;
    readonly serviceName?: string;
  };

  /**
   * Additional context metadata
   */
  readonly metadata?: Metadata;
}

/**
 * Factory interface for creating execution contexts
 */
export interface ExecutionContextFactory {
  /**
   * Create a new execution context
   */
  create(config: ExecutionContextConfig): Promise<ExecutionContext>;

  /**
   * Restore execution context from checkpoint
   */
  restore(checkpointId: UUID, config: ExecutionContextConfig): Promise<ExecutionContext>;
}
