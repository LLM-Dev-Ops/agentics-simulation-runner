# SPARC Architecture Document: Agentics Simulation Runner

**Version**: 1.0.0
**Status**: Draft
**Last Updated**: 2026-01-02
**Author**: SPARC Architecture Agent

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Module Boundaries](#module-boundaries)
4. [External Dependencies](#external-dependencies)
5. [Interface Definitions](#interface-definitions)
6. [Data Flow Diagrams](#data-flow-diagrams)
7. [Deployment Topology](#deployment-topology)
8. [Security Architecture](#security-architecture)
9. [Observability Strategy](#observability-strategy)
10. [Appendix](#appendix)

---

## Executive Summary

The Agentics Simulation Runner is the execution engine for simulation plans within the Agentics ecosystem. It serves as the orchestration layer that:

- **Ingests** simulation plans from `agentics-simulation-planner`
- **Executes** agent workflows with proper lifecycle management
- **Persists** state to `ruvvector-postgres` substrate
- **Emits** results to `agentics-deployment-intent` consumer
- **Captures** comprehensive telemetry for observability

### Core Design Principles

1. **Single Responsibility**: Each module owns one concern
2. **Execution Surface Consumer**: External dependencies are consumed, not duplicated
3. **Clean Boundaries**: Explicit interfaces between all modules
4. **Observable by Default**: Every operation emits telemetry
5. **Failure Resilient**: Graceful degradation and recovery semantics

---

## Architecture Overview

### High-Level System Diagram

```
+==============================================================================+
|                        AGENTICS SIMULATION RUNNER                            |
+==============================================================================+
|                                                                              |
|  +------------------------+     +-------------------------+                   |
|  |   PLAN INGESTION       |---->|  EXECUTION ORCHESTRATION|                   |
|  |   MODULE               |     |  MODULE                 |                   |
|  +------------------------+     +-------------------------+                   |
|           |                              |                                    |
|           v                              v                                    |
|  +------------------------+     +-------------------------+                   |
|  |   WORKFLOW SCHEDULING  |<--->|   AGENT RUNTIME         |                   |
|  |   MODULE               |     |   MODULE                |                   |
|  +------------------------+     +-------------------------+                   |
|           |                              |                                    |
|           v                              v                                    |
|  +------------------------+     +-------------------------+                   |
|  |   LLM INVOCATION       |     |   INTEGRATION ADAPTERS  |                   |
|  |   SURFACE              |     |   MODULE                |                   |
|  +------------------------+     +-------------------------+                   |
|           |                              |                                    |
|           v                              v                                    |
|  +------------------------+     +-------------------------+                   |
|  |   TELEMETRY CAPTURE    |---->|   RESULT AGGREGATION    |                   |
|  |   MODULE               |     |   MODULE                |                   |
|  +------------------------+     +-------------------------+                   |
|                                                                              |
+==============================================================================+
                    |                                    |
                    v                                    v
+------------------+---+  +-------------------+  +---------------------+
| agentics-simulation- |  | ruvvector-postgres|  | agentics-deployment-|
| planner              |  | (State Substrate) |  | intent              |
+----------------------+  +-------------------+  +---------------------+
```

### Component Interaction Flow

```
                                 EXTERNAL SYSTEMS
                                       |
    +----------------------------------+----------------------------------+
    |                                  |                                  |
    v                                  v                                  v
+--------+                      +------------+                     +-----------+
| Planner|                      | PostgreSQL |                     | Deployment|
| Artifact                      | Substrate  |                     | Intent    |
+--------+                      +------------+                     +-----------+
    |                                  ^                                  ^
    |                                  |                                  |
    v                                  |                                  |
+=========================================================================+
|                           SIMULATION RUNNER                             |
|                                                                         |
|  [Ingestion] -> [Orchestration] -> [Runtime] -> [Aggregation]          |
|       |              |                |              |                  |
|       +-------> [Scheduling] <--------+              |                  |
|                      |                               |                  |
|                      v                               |                  |
|               [LLM Surface] ----------------------->+                  |
|                      |                               |                  |
|                      v                               v                  |
|              [Telemetry] <----- All Modules ------->+                  |
|                                                                         |
+=========================================================================+
```

---

## Module Boundaries

### Module Overview Matrix

| Module | Responsibility | Input | Output | Dependencies |
|--------|---------------|-------|--------|--------------|
| Plan Ingestion | Parse and validate simulation plans | Plan artifacts | Validated execution plan | Schema validator |
| Execution Orchestration | Coordinate simulation lifecycle | Execution plan | Execution events | All runtime modules |
| Agent Runtime | Manage agent lifecycles | Agent configs | Agent states | Communication bus |
| Workflow Scheduling | Schedule and sequence tasks | Task graph | Scheduled tasks | Dependency resolver |
| Integration Adapters | Connect external services | API requests | API responses | External clients |
| LLM Invocation Surface | Abstract LLM interactions | Prompts | Completions | LLM providers |
| Telemetry Capture | Collect observability data | All events | Metrics/traces/logs | Collectors |
| Result Aggregation | Aggregate and persist results | Observations | Final results | Storage writers |

---

### 1. Plan Ingestion Module

**Purpose**: Parse, validate, and transform simulation plans from external sources into executable internal representations.

```
+===========================================================================+
|                         PLAN INGESTION MODULE                             |
+===========================================================================+
|                                                                           |
|  +-----------------+    +------------------+    +--------------------+    |
|  | SimulationPlan  |--->| Schema           |--->| Dependency         |    |
|  | Parser          |    | Validator        |    | Resolver           |    |
|  +-----------------+    +------------------+    +--------------------+    |
|         |                       |                        |                |
|         v                       v                        v                |
|  +-----------------+    +------------------+    +--------------------+    |
|  | Format Detector |    | Version Checker  |    | Resource Allocator |    |
|  +-----------------+    +------------------+    +--------------------+    |
|                                                                           |
+===========================================================================+
           |
           v
    [Validated Execution Plan]
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| SimulationPlan Parser | Parse JSON/YAML plan artifacts into internal AST |
| Schema Validator | Validate plans against versioned JSON schemas |
| Dependency Resolver | Resolve inter-step dependencies and build DAG |
| Resource Allocator | Allocate resources based on plan requirements |

**Boundary Rules**:
- MUST NOT execute any plan steps
- MUST NOT communicate with external services (except plan source)
- MUST validate all input before passing downstream
- MUST emit ingestion telemetry events

---

### 2. Execution Orchestration Module

**Purpose**: Coordinate the overall simulation lifecycle from initialization through completion.

```
+===========================================================================+
|                     EXECUTION ORCHESTRATION MODULE                        |
+===========================================================================+
|                                                                           |
|  +-------------------+    +--------------------+    +------------------+  |
|  | Simulation        |--->| Step               |--->| Checkpoint       |  |
|  | Coordinator       |    | Sequencer          |    | Manager          |  |
|  +-------------------+    +--------------------+    +------------------+  |
|         |                        |                         |              |
|         v                        v                         v              |
|  +-------------------+    +--------------------+    +------------------+  |
|  | State Machine     |    | Parallel Executor  |    | Progress Tracker |  |
|  | Controller        |    |                    |    |                  |  |
|  +-------------------+    +--------------------+    +------------------+  |
|                                                                           |
+===========================================================================+
           |                       |                         |
           v                       v                         v
    [Runtime Commands]    [Scheduling Requests]    [State Snapshots]
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| Simulation Coordinator | High-level orchestration of simulation lifecycle |
| Step Sequencer | Order steps respecting dependencies and constraints |
| Checkpoint Manager | Create and restore execution checkpoints |
| Progress Tracker | Track and report simulation progress |

**State Machine**:

```
    +----------+
    |  PENDING |
    +----+-----+
         |
         v
    +----+-------+     +-----------+
    | INITIALIZING|--->| RUNNING   |
    +----+-------+     +-----+-----+
         |                   |
         |              +----+----+
         |              |         |
         v              v         v
    +----+-----+   +----+----+ +--+------+
    |  FAILED  |   | PAUSED  | | COMPLETED|
    +----------+   +---------+ +---------+
```

**Boundary Rules**:
- MUST NOT directly spawn agents (delegate to Agent Runtime)
- MUST NOT directly invoke LLMs (delegate to LLM Surface)
- MUST maintain single source of truth for simulation state
- MUST support pause/resume/cancel operations

---

### 3. Agent Runtime Module

**Purpose**: Manage agent lifecycles including spawning, state management, and inter-agent communication.

```
+===========================================================================+
|                          AGENT RUNTIME MODULE                             |
+===========================================================================+
|                                                                           |
|  +------------------+    +-------------------+    +-------------------+   |
|  | Agent            |--->| Lifecycle         |--->| State             |   |
|  | Spawner          |    | Manager           |    | Persister         |   |
|  +------------------+    +-------------------+    +-------------------+   |
|         |                       |                        |                |
|         v                       v                        v                |
|  +------------------+    +-------------------+    +-------------------+   |
|  | Agent Registry   |    | Health Monitor    |    | Communication Bus |   |
|  +------------------+    +-------------------+    +-------------------+   |
|                                                                           |
|                    +-------------------------+                            |
|                    | Agent Isolation Sandbox |                            |
|                    +-------------------------+                            |
|                                                                           |
+===========================================================================+
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| Agent Spawner | Create agent instances from configurations |
| Lifecycle Manager | Manage agent states (init, running, paused, terminated) |
| State Persister | Persist agent state to substrate |
| Communication Bus | Enable inter-agent message passing |

**Agent Lifecycle**:

```
    [Spawn Request]
          |
          v
    +-----+------+     +-----------+     +-----------+
    | SPAWNING   |---->| IDLE      |---->| EXECUTING |
    +------------+     +-----+-----+     +-----+-----+
                             |                 |
                             v                 v
                       +-----+-----+     +-----+------+
                       | SUSPENDED |     | TERMINATED |
                       +-----------+     +------------+
```

**Boundary Rules**:
- MUST provide complete isolation between agents
- MUST NOT allow direct agent-to-agent memory access
- MUST enforce resource limits per agent
- MUST support graceful and forced termination

---

### 4. Workflow Scheduling Module

**Purpose**: Schedule and manage task execution with dependency awareness and parallelization.

```
+===========================================================================+
|                       WORKFLOW SCHEDULING MODULE                          |
+===========================================================================+
|                                                                           |
|  +-------------------+    +----------------------+    +-----------------+ |
|  | Task              |--->| Dependency Graph     |--->| Parallel        | |
|  | Scheduler         |    | Processor            |    | Execution Mgr   | |
|  +-------------------+    +----------------------+    +-----------------+ |
|         |                         |                          |            |
|         v                         v                          v            |
|  +-------------------+    +----------------------+    +-----------------+ |
|  | Priority          |    | Cycle Detector       |    | Queue           | |
|  | Calculator        |    |                      |    | Manager         | |
|  +-------------------+    +----------------------+    +-----------------+ |
|                                                                           |
+===========================================================================+
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| Task Scheduler | Schedule tasks based on dependencies and priorities |
| Dependency Graph Processor | Process DAG to determine execution order |
| Parallel Execution Manager | Manage concurrent task execution within limits |
| Queue Manager | Manage task queues with backpressure support |

**Scheduling Algorithm**:

```
Input: Task Graph G = (V, E) where V = tasks, E = dependencies

1. Topological Sort:
   sorted_tasks = topological_sort(G)

2. Level Assignment:
   for each task t in sorted_tasks:
     t.level = max(predecessor.level) + 1

3. Priority Calculation:
   for each task t:
     t.priority = calculate_priority(t.level, t.cost, t.deadline)

4. Parallel Bucketing:
   buckets = group_by_level(sorted_tasks)

5. Execution:
   for each bucket in buckets:
     execute_parallel(bucket, max_concurrency)
```

**Boundary Rules**:
- MUST detect and reject cyclic dependencies
- MUST respect maximum concurrency limits
- MUST support dynamic priority adjustment
- MUST handle task failures with retry policies

---

### 5. Integration Adapters Module

**Purpose**: Provide standardized adapters for external service integration.

```
+===========================================================================+
|                      INTEGRATION ADAPTERS MODULE                          |
+===========================================================================+
|                                                                           |
|  +--------------------+   +---------------------+   +------------------+  |
|  | External Service   |   | API Client          |   | Event            |  |
|  | Connectors         |   | Factory             |   | Publishers       |  |
|  +--------------------+   +---------------------+   +------------------+  |
|         |                        |                        |               |
|         v                        v                        v               |
|  +--------------------+   +---------------------+   +------------------+  |
|  | Connection Pool    |   | Request/Response    |   | Webhook          |  |
|  | Manager            |   | Interceptors        |   | Handlers         |  |
|  +--------------------+   +---------------------+   +------------------+  |
|                                                                           |
|  Adapter Registry:                                                        |
|  +-------+  +-------+  +-------+  +-------+  +-------+                   |
|  | HTTP  |  | gRPC  |  | Queue |  | Event |  | File  |                   |
|  +-------+  +-------+  +-------+  +-------+  +-------+                   |
|                                                                           |
+===========================================================================+
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| External Service Connectors | Manage connections to external systems |
| API Client Factory | Create typed API clients for services |
| Event Publishers | Publish events to external consumers |
| Webhook Handlers | Handle incoming webhook requests |

**Adapter Interface**:

```typescript
interface IAdapter<TConfig, TRequest, TResponse> {
  // Lifecycle
  initialize(config: TConfig): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  // Operations
  execute(request: TRequest): Promise<TResponse>;

  // Observability
  getMetrics(): AdapterMetrics;
}
```

**Boundary Rules**:
- MUST implement circuit breaker patterns
- MUST support connection pooling
- MUST log all external requests/responses
- MUST implement retry with exponential backoff

---

### 6. LLM Invocation Surface Module

**Purpose**: Abstract LLM provider interactions with unified interface, logging, and cost tracking.

```
+===========================================================================+
|                      LLM INVOCATION SURFACE MODULE                        |
+===========================================================================+
|                                                                           |
|  +--------------------+   +---------------------+   +------------------+  |
|  | LLM Client         |   | Request/Response    |   | Token            |  |
|  | Abstraction        |   | Logger              |   | Tracker          |  |
|  +--------------------+   +---------------------+   +------------------+  |
|         |                        |                        |               |
|         v                        v                        v               |
|  +--------------------+   +---------------------+   +------------------+  |
|  | Provider           |   | Prompt              |   | Cost             |  |
|  | Router             |   | Sanitizer           |   | Accounting       |  |
|  +--------------------+   +---------------------+   +------------------+  |
|                                                                           |
|  Provider Adapters:                                                       |
|  +---------+  +----------+  +--------+  +---------+  +--------+          |
|  | Anthropic|  | OpenAI   |  | Azure  |  | Bedrock |  | Local  |          |
|  +---------+  +----------+  +--------+  +---------+  +--------+          |
|                                                                           |
+===========================================================================+
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| LLM Client Abstraction | Unified interface for all LLM providers |
| Request/Response Logger | Log all LLM interactions for audit |
| Token Tracker | Track token usage per request/session |
| Cost Accounting | Calculate and track LLM costs |

**Unified Interface**:

```typescript
interface ILLMClient {
  // Core operations
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  // Metadata
  getProvider(): ProviderInfo;
  getCapabilities(): ModelCapabilities;

  // Cost tracking
  getUsage(): UsageMetrics;
  estimateCost(request: CompletionRequest): CostEstimate;
}

interface CompletionRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  metadata?: RequestMetadata;
}

interface CompletionResponse {
  id: string;
  content: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  latency: number;
  provider: string;
}
```

**Boundary Rules**:
- MUST NOT expose provider-specific APIs to consumers
- MUST log all requests with configurable PII redaction
- MUST track tokens and costs per simulation/agent
- MUST support fallback providers

---

### 7. Telemetry Capture Module

**Purpose**: Collect, aggregate, and ship observability data from all modules.

```
+===========================================================================+
|                       TELEMETRY CAPTURE MODULE                            |
+===========================================================================+
|                                                                           |
|  +-------------------+   +--------------------+   +-------------------+   |
|  | Metrics           |   | Trace              |   | Log               |   |
|  | Collector         |   | Aggregator         |   | Shipper           |   |
|  +-------------------+   +--------------------+   +-------------------+   |
|         |                       |                        |                |
|         v                       v                        v                |
|  +-------------------+   +--------------------+   +-------------------+   |
|  | Metric            |   | Span               |   | Log               |   |
|  | Registry          |   | Context            |   | Buffer            |   |
|  +-------------------+   +--------------------+   +-------------------+   |
|                                                                           |
|                    +------------------------+                             |
|                    | Alert Manager          |                             |
|                    +------------------------+                             |
|                                                                           |
+===========================================================================+
            |                    |                     |
            v                    v                     v
    [Prometheus]          [Jaeger/Zipkin]        [ELK Stack]
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| Metrics Collector | Collect and expose Prometheus-compatible metrics |
| Trace Aggregator | Aggregate distributed traces with context propagation |
| Log Shipper | Buffer and ship structured logs to aggregators |
| Alert Manager | Evaluate alert rules and trigger notifications |

**Metric Categories**:

```yaml
metrics:
  simulation:
    - simulation_duration_seconds
    - simulation_steps_total
    - simulation_failures_total
    - simulation_checkpoints_created

  agent:
    - agent_spawn_duration_seconds
    - agent_execution_duration_seconds
    - agent_memory_bytes
    - agent_messages_sent_total

  llm:
    - llm_request_duration_seconds
    - llm_tokens_used_total
    - llm_cost_dollars_total
    - llm_errors_total

  system:
    - process_cpu_seconds_total
    - process_memory_bytes
    - go_goroutines (or equivalent)
```

**Boundary Rules**:
- MUST NOT block critical paths for telemetry
- MUST support sampling for high-volume traces
- MUST buffer and batch for efficiency
- MUST support multiple export backends

---

### 8. Result Aggregation Module

**Purpose**: Collect observations from execution, compute metrics, and persist results.

```
+===========================================================================+
|                       RESULT AGGREGATION MODULE                           |
+===========================================================================+
|                                                                           |
|  +--------------------+   +---------------------+   +------------------+  |
|  | Observation        |   | Metric              |   | Result           |  |
|  | Collector          |   | Computer            |   | Serializer       |  |
|  +--------------------+   +---------------------+   +------------------+  |
|         |                        |                        |               |
|         v                        v                        v               |
|  +--------------------+   +---------------------+   +------------------+  |
|  | Observation        |   | Statistical         |   | Storage          |  |
|  | Validator          |   | Aggregator          |   | Writer           |  |
|  +--------------------+   +---------------------+   +------------------+  |
|                                                                           |
+===========================================================================+
            |
            v
    [Result Artifact] --> [agentics-deployment-intent]
```

**Components**:

| Component | Responsibility |
|-----------|---------------|
| Observation Collector | Collect observations from all sources |
| Metric Computer | Compute derived metrics and aggregations |
| Result Serializer | Serialize results to standard formats |
| Storage Writer | Write results to configured storage backends |

**Result Schema**:

```typescript
interface SimulationResult {
  id: string;
  planId: string;
  status: 'completed' | 'failed' | 'partial';
  startTime: ISO8601String;
  endTime: ISO8601String;
  duration: number;

  execution: {
    stepsCompleted: number;
    stepsFailed: number;
    checkpointsCreated: number;
  };

  agents: AgentResult[];

  llm: {
    totalRequests: number;
    totalTokens: TokenBreakdown;
    totalCost: CostBreakdown;
    providers: ProviderUsage[];
  };

  observations: Observation[];

  artifacts: Artifact[];

  errors: ErrorRecord[];
}
```

**Boundary Rules**:
- MUST validate all observations before aggregation
- MUST support incremental result computation
- MUST handle partial results from failed simulations
- MUST emit results in standard artifact format

---

## External Dependencies

### Dependency Map

```
+===========================================================================+
|                          EXTERNAL DEPENDENCIES                            |
+===========================================================================+
|                                                                           |
|  +--------------------------+     +------------------------------+        |
|  | agentics-simulation-     |     | Consumption Mode: READ ONLY  |        |
|  | planner                  |     | Artifact Type: SimulationPlan|        |
|  |                          |     | Transport: File / S3 / HTTP  |        |
|  +--------------------------+     +------------------------------+        |
|                                                                           |
|  +--------------------------+     +------------------------------+        |
|  | ruvvector-postgres       |     | Consumption Mode: READ/WRITE |        |
|  |                          |     | Usage: State Substrate       |        |
|  |                          |     | Transport: PostgreSQL Wire   |        |
|  +--------------------------+     +------------------------------+        |
|                                                                           |
|  +--------------------------+     +------------------------------+        |
|  | agentics-deployment-     |     | Consumption Mode: WRITE ONLY |        |
|  | intent                   |     | Artifact Type: SimulationResult|      |
|  |                          |     | Transport: Queue / API       |        |
|  +--------------------------+     +------------------------------+        |
|                                                                           |
+===========================================================================+
```

### 1. agentics-simulation-planner

**Role**: Source of simulation plan artifacts

**Interface Contract**:

```typescript
// Plan artifact schema (consumed, not owned)
interface SimulationPlan {
  version: string;
  metadata: PlanMetadata;
  agents: AgentDefinition[];
  steps: StepDefinition[];
  resources: ResourceRequirement[];
  constraints: ExecutionConstraint[];
}

// Ingestion interface
interface IPlanSource {
  fetchPlan(planId: string): Promise<SimulationPlan>;
  validatePlan(plan: SimulationPlan): ValidationResult;
  getPlanSchema(version: string): JSONSchema;
}
```

**Integration Pattern**: File-based or API-based retrieval with schema validation

---

### 2. ruvvector-postgres

**Role**: State substrate for agent and simulation state

**Interface Contract**:

```typescript
// State operations (consumed via client)
interface IStateSubstrate {
  // Agent state
  saveAgentState(agentId: string, state: AgentState): Promise<void>;
  loadAgentState(agentId: string): Promise<AgentState | null>;

  // Simulation state
  saveCheckpoint(simId: string, checkpoint: Checkpoint): Promise<void>;
  loadCheckpoint(simId: string, checkpointId: string): Promise<Checkpoint>;

  // Vector operations (for similarity search)
  storeEmbedding(key: string, embedding: number[]): Promise<void>;
  queryEmbeddings(query: number[], limit: number): Promise<EmbeddingResult[]>;
}
```

**Integration Pattern**: Direct PostgreSQL client with connection pooling

**Schema Requirements**:

```sql
-- Required tables (owned by ruvvector-postgres, consumed by runner)
-- Agent state table
CREATE TABLE agent_states (
    id UUID PRIMARY KEY,
    simulation_id UUID NOT NULL,
    agent_id VARCHAR(255) NOT NULL,
    state JSONB NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Checkpoint table
CREATE TABLE simulation_checkpoints (
    id UUID PRIMARY KEY,
    simulation_id UUID NOT NULL,
    checkpoint_name VARCHAR(255),
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector embeddings (pgvector)
CREATE TABLE embeddings (
    id UUID PRIMARY KEY,
    key VARCHAR(255) NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 3. agentics-deployment-intent

**Role**: Consumer of simulation results for deployment decisions

**Interface Contract**:

```typescript
// Result publication interface
interface IResultPublisher {
  publishResult(result: SimulationResult): Promise<PublishAck>;
  publishPartialResult(result: PartialResult): Promise<PublishAck>;
  publishError(error: SimulationError): Promise<PublishAck>;
}

// Event schema
interface SimulationResultEvent {
  type: 'simulation.completed' | 'simulation.failed' | 'simulation.partial';
  simulationId: string;
  planId: string;
  timestamp: ISO8601String;
  payload: SimulationResult | SimulationError;
}
```

**Integration Pattern**: Message queue or webhook publication

---

### 4. Other Ecosystem Components

| Component | Role | Integration |
|-----------|------|-------------|
| agentics-mcp-server | MCP tool provider | Tool invocation via MCP protocol |
| agentics-ui | Dashboard UI | REST API / WebSocket for real-time updates |
| agentics-auth | Authentication | JWT validation for API access |

---

## Interface Definitions

### Module Interface Contracts

#### Plan Ingestion Module

```typescript
// Input contract
interface PlanIngestionInput {
  source: PlanSource;
  planId: string;
  options?: IngestionOptions;
}

interface PlanSource {
  type: 'file' | 's3' | 'http' | 'inline';
  location: string;
  credentials?: Credentials;
}

// Output contract
interface PlanIngestionOutput {
  plan: ValidatedPlan;
  dependencies: DependencyGraph;
  resources: AllocatedResources;
  warnings: ValidationWarning[];
}

// Error contract
type PlanIngestionError =
  | { code: 'PLAN_NOT_FOUND'; planId: string }
  | { code: 'SCHEMA_VALIDATION_FAILED'; errors: SchemaError[] }
  | { code: 'DEPENDENCY_CYCLE'; cycle: string[] }
  | { code: 'RESOURCE_UNAVAILABLE'; resource: string };

// Observability hooks
interface PlanIngestionHooks {
  onPlanFetched: (planId: string, size: number) => void;
  onValidationComplete: (result: ValidationResult) => void;
  onError: (error: PlanIngestionError) => void;
}
```

---

#### Execution Orchestration Module

```typescript
// Input contract
interface ExecutionInput {
  plan: ValidatedPlan;
  options: ExecutionOptions;
  hooks?: ExecutionHooks;
}

interface ExecutionOptions {
  mode: 'full' | 'dry-run' | 'resume';
  checkpointId?: string;
  maxConcurrency: number;
  timeout: number;
}

// Output contract
interface ExecutionOutput {
  simulationId: string;
  status: ExecutionStatus;
  progress: ExecutionProgress;
  checkpoints: CheckpointInfo[];
}

// Error contract
type ExecutionError =
  | { code: 'EXECUTION_TIMEOUT'; elapsed: number }
  | { code: 'STEP_FAILED'; stepId: string; error: Error }
  | { code: 'CHECKPOINT_FAILED'; checkpointId: string }
  | { code: 'RESOURCE_EXHAUSTED'; resource: string };

// Observability hooks
interface ExecutionHooks {
  onStart: (simulationId: string) => void;
  onStepStart: (stepId: string) => void;
  onStepComplete: (stepId: string, result: StepResult) => void;
  onCheckpoint: (checkpointId: string) => void;
  onComplete: (result: ExecutionResult) => void;
  onError: (error: ExecutionError) => void;
}
```

---

#### Agent Runtime Module

```typescript
// Input contract
interface AgentSpawnRequest {
  definition: AgentDefinition;
  simulationId: string;
  initialState?: AgentState;
}

// Output contract
interface AgentHandle {
  id: string;
  status: AgentStatus;

  // Lifecycle operations
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  terminate(): Promise<void>;

  // State operations
  getState(): Promise<AgentState>;
  setState(state: AgentState): Promise<void>;

  // Communication
  send(message: AgentMessage): Promise<void>;
  receive(): AsyncIterable<AgentMessage>;
}

// Error contract
type AgentRuntimeError =
  | { code: 'SPAWN_FAILED'; reason: string }
  | { code: 'AGENT_TIMEOUT'; agentId: string }
  | { code: 'COMMUNICATION_FAILED'; agentId: string }
  | { code: 'STATE_CORRUPTION'; agentId: string };

// Observability hooks
interface AgentRuntimeHooks {
  onSpawn: (agentId: string) => void;
  onStateChange: (agentId: string, state: AgentState) => void;
  onMessage: (from: string, to: string, message: AgentMessage) => void;
  onTerminate: (agentId: string, reason: string) => void;
}
```

---

#### LLM Invocation Surface Module

```typescript
// Input contract
interface LLMInvocationRequest {
  provider?: string;
  model: string;
  messages: Message[];
  options?: LLMOptions;
  metadata?: InvocationMetadata;
}

interface InvocationMetadata {
  simulationId: string;
  agentId: string;
  stepId: string;
  purpose: string;
}

// Output contract
interface LLMInvocationResponse {
  id: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: 'USD';
  };
  latency: number;
  provider: string;
  model: string;
}

// Error contract
type LLMInvocationError =
  | { code: 'PROVIDER_UNAVAILABLE'; provider: string }
  | { code: 'RATE_LIMITED'; retryAfter: number }
  | { code: 'CONTEXT_TOO_LONG'; tokens: number; limit: number }
  | { code: 'CONTENT_FILTERED'; reason: string };

// Observability hooks
interface LLMInvocationHooks {
  onRequest: (request: LLMInvocationRequest) => void;
  onResponse: (response: LLMInvocationResponse) => void;
  onError: (error: LLMInvocationError) => void;
  onTokenUsage: (usage: TokenUsage) => void;
}
```

---

## Data Flow Diagrams

### Primary Execution Flow

```
+===========================================================================+
|                          PRIMARY EXECUTION FLOW                           |
+===========================================================================+

    [External: Simulation Plan]
              |
              | (1) Fetch Plan
              v
    +-------------------+
    | Plan Ingestion    |----> Telemetry: plan.ingested
    | Module            |
    +-------------------+
              |
              | (2) Validated Plan + DAG
              v
    +-------------------+
    | Execution         |----> Telemetry: simulation.started
    | Orchestration     |
    +-------------------+
              |
              | (3) Schedule Tasks
              v
    +-------------------+
    | Workflow          |----> Telemetry: tasks.scheduled
    | Scheduling        |
    +-------------------+
              |
              | (4) Execute Tasks (parallel)
              v
    +-------------------+         +-------------------+
    | Agent Runtime     |<------->| LLM Invocation    |
    | Module            |         | Surface           |
    +-------------------+         +-------------------+
         |    |                         |
         |    | (5) State               | (6) LLM Calls
         |    v                         v
         |   [ruvvector-postgres]    [LLM Providers]
         |
         | (7) Observations
         v
    +-------------------+
    | Result            |----> Telemetry: results.aggregated
    | Aggregation       |
    +-------------------+
              |
              | (8) Simulation Result
              v
    [External: agentics-deployment-intent]
```

### Agent Interaction Flow

```
+===========================================================================+
|                         AGENT INTERACTION FLOW                            |
+===========================================================================+

    Agent A                    Communication Bus                    Agent B
       |                              |                                |
       |  (1) send(message)           |                                |
       |----------------------------->|                                |
       |                              |  (2) route(message)            |
       |                              |------------------------------->|
       |                              |                                |
       |                              |  (3) ack                       |
       |                              |<-------------------------------|
       |  (4) delivery confirmation   |                                |
       |<-----------------------------|                                |
       |                              |                                |
       |                              |  (5) response                  |
       |                              |<-------------------------------|
       |  (6) receive(response)       |                                |
       |<-----------------------------|                                |
       |                              |                                |

    Message Format:
    +------------------------------------------+
    | MessageEnvelope                          |
    +------------------------------------------+
    | id: UUID                                 |
    | from: AgentId                            |
    | to: AgentId | AgentId[]                  |
    | type: 'request' | 'response' | 'event'   |
    | payload: Any                             |
    | metadata: {                              |
    |   timestamp: ISO8601                     |
    |   correlationId: UUID                    |
    |   ttl: number                            |
    | }                                        |
    +------------------------------------------+
```

### State Persistence Flow

```
+===========================================================================+
|                        STATE PERSISTENCE FLOW                             |
+===========================================================================+

    [Agent Runtime]
          |
          | (1) State Change Event
          v
    +-------------------+
    | State Persister   |
    +-------------------+
          |
          | (2) Serialize State
          v
    +-------------------+
    | State Serializer  |----> JSON/Binary format
    +-------------------+
          |
          | (3) Write to Substrate
          v
    +-------------------+         +----------------------+
    | Storage Writer    |-------->| ruvvector-postgres   |
    +-------------------+         +----------------------+
          |                                 |
          | (4) Confirm Write               |
          v                                 |
    [Telemetry: state.persisted]            |
                                            |
    [Recovery Flow]                         |
          ^                                 |
          | (5) Load State                  |
          +----------------------------------
```

### Telemetry Emission Flow

```
+===========================================================================+
|                        TELEMETRY EMISSION FLOW                            |
+===========================================================================+

    [All Modules]
          |
          | Events/Metrics/Traces
          |
    +-----+-----+-----+-----+
    |     |     |     |     |
    v     v     v     v     v
   Metrics  Traces  Logs  Alerts
    |        |       |      |
    v        v       v      v
+-------+ +-------+ +----+ +------+
|Collect| |Collect| |Buff| |Evalua|
|or     | |or     | |er  | |te    |
+-------+ +-------+ +----+ +------+
    |        |       |      |
    v        v       v      v
+-------+ +-------+ +----+ +------+
|Prome- | |Jaeger/| |ELK | |Alert |
|theus  | |Zipkin | |    | |Mgr   |
+-------+ +-------+ +----+ +------+
```

---

## Deployment Topology

### Single-Node Deployment

```
+===========================================================================+
|                       SINGLE-NODE DEPLOYMENT                              |
+===========================================================================+

    +---------------------------------------------------------------+
    |                        HOST MACHINE                           |
    +---------------------------------------------------------------+
    |                                                               |
    |  +-------------------+    +-------------------+               |
    |  | Simulation Runner |    | PostgreSQL        |               |
    |  | (All Modules)     |    | (ruvvector)       |               |
    |  +-------------------+    +-------------------+               |
    |         |                        |                            |
    |         +------------------------+                            |
    |                                                               |
    |  +-------------------+    +-------------------+               |
    |  | Redis             |    | Prometheus        |               |
    |  | (Cache/Queue)     |    | (Metrics)         |               |
    |  +-------------------+    +-------------------+               |
    |                                                               |
    +---------------------------------------------------------------+

    Resource Requirements:
    - CPU: 4+ cores
    - Memory: 8GB+ RAM
    - Storage: 50GB+ SSD
    - Network: Standard
```

**Use Cases**: Development, small-scale simulations, testing

---

### Distributed Deployment (Enterprise Scale)

```
+===========================================================================+
|                    DISTRIBUTED DEPLOYMENT (ENTERPRISE)                    |
+===========================================================================+

                            Load Balancer
                                 |
            +--------------------+--------------------+
            |                    |                    |
            v                    v                    v
    +---------------+    +---------------+    +---------------+
    | API Gateway   |    | API Gateway   |    | API Gateway   |
    | (Region A)    |    | (Region B)    |    | (Region C)    |
    +---------------+    +---------------+    +---------------+
            |                    |                    |
            v                    v                    v
    +==============================================================+
    |                    KUBERNETES CLUSTER                        |
    +==============================================================+
    |                                                              |
    |  +------------------+  +------------------+                  |
    |  | Orchestration    |  | Orchestration    |  (Stateless)    |
    |  | Pod (x3)         |  | Pod (x3)         |                  |
    |  +------------------+  +------------------+                  |
    |                                                              |
    |  +------------------+  +------------------+                  |
    |  | Agent Runtime    |  | Agent Runtime    |  (Stateless)    |
    |  | Pod (x5)         |  | Pod (x5)         |                  |
    |  +------------------+  +------------------+                  |
    |                                                              |
    |  +------------------+  +------------------+                  |
    |  | LLM Surface      |  | LLM Surface      |  (Stateless)    |
    |  | Pod (x3)         |  | Pod (x3)         |                  |
    |  +------------------+  +------------------+                  |
    |                                                              |
    +==============================================================+
            |                    |                    |
            v                    v                    v
    +==============================================================+
    |                      DATA LAYER                              |
    +==============================================================+
    |                                                              |
    |  +------------------+  +------------------+  +-------------+ |
    |  | PostgreSQL       |  | PostgreSQL       |  | Redis       | |
    |  | Primary          |  | Replica (x2)     |  | Cluster     | |
    |  +------------------+  +------------------+  +-------------+ |
    |                                                              |
    |  +------------------+  +------------------+                  |
    |  | RabbitMQ         |  | S3-Compatible    |                  |
    |  | Cluster          |  | Object Storage   |                  |
    |  +------------------+  +------------------+                  |
    |                                                              |
    +==============================================================+
            |
            v
    +==============================================================+
    |                    OBSERVABILITY LAYER                       |
    +==============================================================+
    |                                                              |
    |  +------------------+  +------------------+  +-------------+ |
    |  | Prometheus       |  | Jaeger           |  | ELK Stack   | |
    |  | + Grafana        |  |                  |  |             | |
    |  +------------------+  +------------------+  +-------------+ |
    |                                                              |
    +==============================================================+
```

**Scaling Strategy**:

| Component | Scaling Dimension | Trigger |
|-----------|------------------|---------|
| API Gateway | Horizontal | Request rate > 1000 RPS |
| Orchestration | Horizontal | Active simulations > 100 |
| Agent Runtime | Horizontal | Active agents > 500 |
| LLM Surface | Horizontal | LLM request rate > 100 RPS |
| PostgreSQL | Vertical + Read Replicas | Write latency > 50ms |
| Redis | Cluster Sharding | Memory > 80% |

---

### State Partitioning Strategy

```
+===========================================================================+
|                       STATE PARTITIONING STRATEGY                         |
+===========================================================================+

    Partition Key: simulation_id

    +-------------------+    +-------------------+    +-------------------+
    | Partition 0       |    | Partition 1       |    | Partition 2       |
    | sim_id % 3 == 0   |    | sim_id % 3 == 1   |    | sim_id % 3 == 2   |
    +-------------------+    +-------------------+    +-------------------+
    | - Agent states    |    | - Agent states    |    | - Agent states    |
    | - Checkpoints     |    | - Checkpoints     |    | - Checkpoints     |
    | - Observations    |    | - Observations    |    | - Observations    |
    +-------------------+    +-------------------+    +-------------------+
           |                        |                        |
           v                        v                        v
    +-------------------+    +-------------------+    +-------------------+
    | PostgreSQL        |    | PostgreSQL        |    | PostgreSQL        |
    | Shard 0           |    | Shard 1           |    | Shard 2           |
    +-------------------+    +-------------------+    +-------------------+

    Benefits:
    - Isolation: Simulation failures don't affect others
    - Scalability: Add shards as needed
    - Locality: Related data co-located
```

---

### Failover Semantics

```
+===========================================================================+
|                          FAILOVER SEMANTICS                               |
+===========================================================================+

    SCENARIO 1: Orchestration Pod Failure

    +---------------+         +---------------+
    | Orchestration | FAILS   | Orchestration |
    | Pod A         |-------->| Pod B         |
    +---------------+         +---------------+
           |                        |
           v                        |
    +--------------+                |
    | Checkpoint   |                |
    | (last known) |<---------------+
    +--------------+     Load checkpoint & resume


    SCENARIO 2: Agent Runtime Failure

    +---------------+         +---------------+
    | Agent Runtime | FAILS   | Agent Runtime |
    | Pod A         |-------->| Pod B         |
    +---------------+         +---------------+
           |                        |
           v                        |
    +--------------+                |
    | Agent State  |                |
    | (PostgreSQL) |<---------------+
    +--------------+     Respawn agent with saved state


    SCENARIO 3: Database Primary Failure

    +---------------+         +---------------+
    | PostgreSQL    | FAILS   | PostgreSQL    |
    | Primary       |-------->| Replica       |
    +---------------+         +---------------+
           |                        |
           v                        v
    [Automatic promotion via Patroni/pg_auto_failover]


    Recovery Time Objectives:
    +------------------+----------+----------+
    | Component        | RTO      | RPO      |
    +------------------+----------+----------+
    | Orchestration    | < 30s    | 0        |
    | Agent Runtime    | < 60s    | < 5s     |
    | Database         | < 30s    | 0        |
    | Message Queue    | < 60s    | 0        |
    +------------------+----------+----------+
```

---

## Security Architecture

### Security Boundaries

```
+===========================================================================+
|                         SECURITY BOUNDARIES                               |
+===========================================================================+

    TRUST BOUNDARY 1: External API
    +---------------------------------------------------------------+
    |  [Internet] ---> [WAF] ---> [API Gateway] ---> [Auth Filter]  |
    +---------------------------------------------------------------+
                                                          |
                                                          v
    TRUST BOUNDARY 2: Internal Services
    +---------------------------------------------------------------+
    |  [Authenticated Request] ---> [Service Mesh (mTLS)]           |
    |                              |                                |
    |    +-------------------+     |     +-------------------+      |
    |    | Orchestration     |<----+--->| Agent Runtime     |      |
    |    +-------------------+           +-------------------+      |
    +---------------------------------------------------------------+
                                                          |
                                                          v
    TRUST BOUNDARY 3: Data Layer
    +---------------------------------------------------------------+
    |  [Service Account] ---> [PostgreSQL (TLS + Auth)]             |
    |                                                               |
    |  Data encrypted at rest (AES-256)                            |
    +---------------------------------------------------------------+
```

### Security Controls

| Control | Implementation |
|---------|---------------|
| Authentication | JWT tokens with RS256, service accounts |
| Authorization | RBAC with fine-grained permissions |
| Encryption in Transit | TLS 1.3 (external), mTLS (internal) |
| Encryption at Rest | AES-256 for database, S3 SSE |
| Secrets Management | HashiCorp Vault / K8s Secrets |
| Audit Logging | All API calls logged with user context |
| Network Segmentation | VPC with private subnets |
| Rate Limiting | Per-user and per-IP limits |

---

## Observability Strategy

### Three Pillars of Observability

```
+===========================================================================+
|                      OBSERVABILITY STRATEGY                               |
+===========================================================================+

    METRICS (Prometheus)
    +-------------------+
    | - Request rates   |
    | - Latencies       |
    | - Error rates     |
    | - Resource usage  |
    | - Business KPIs   |
    +-------------------+
            |
            v
    [Grafana Dashboards]


    TRACES (Jaeger/Zipkin)
    +-------------------+
    | - Request flow    |
    | - Latency breakdown|
    | - Error location  |
    | - Dependency map  |
    +-------------------+
            |
            v
    [Trace Analysis]


    LOGS (ELK Stack)
    +-------------------+
    | - Structured logs |
    | - Error details   |
    | - Audit trail     |
    | - Debug info      |
    +-------------------+
            |
            v
    [Kibana Search]
```

### Key Metrics

```yaml
# SLI/SLO Definitions
slis:
  availability:
    description: "Percentage of successful requests"
    target: 99.9%
    measurement: "success_count / total_count"

  latency:
    description: "Request latency at p99"
    target: < 500ms
    measurement: "histogram_quantile(0.99, request_duration)"

  simulation_success:
    description: "Percentage of simulations completing successfully"
    target: 95%
    measurement: "completed_simulations / total_simulations"

# Alerting Rules
alerts:
  - name: HighErrorRate
    expr: "error_rate > 0.01"
    severity: critical

  - name: HighLatency
    expr: "p99_latency > 1s"
    severity: warning

  - name: LLMCostSpike
    expr: "rate(llm_cost_total[1h]) > threshold"
    severity: warning
```

---

## Appendix

### A. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | TypeScript | Primary implementation |
| Runtime | Node.js 20+ | Execution environment |
| Framework | NestJS | Service framework |
| Database | PostgreSQL 15+ | State persistence |
| Cache | Redis 7+ | Caching and queuing |
| Message Queue | RabbitMQ | Async messaging |
| Container | Docker | Packaging |
| Orchestration | Kubernetes | Deployment |
| Observability | Prometheus/Jaeger/ELK | Monitoring |

### B. Configuration Schema

```yaml
# config.yaml
simulation_runner:
  server:
    port: 3000
    host: "0.0.0.0"

  database:
    host: "${DB_HOST}"
    port: 5432
    database: "simulation_runner"
    pool:
      min: 10
      max: 100

  redis:
    host: "${REDIS_HOST}"
    port: 6379

  llm:
    providers:
      - name: anthropic
        apiKey: "${ANTHROPIC_API_KEY}"
        models: ["claude-3-opus", "claude-3-sonnet"]
      - name: openai
        apiKey: "${OPENAI_API_KEY}"
        models: ["gpt-4", "gpt-4-turbo"]

    defaults:
      provider: anthropic
      model: claude-3-sonnet
      maxTokens: 4096

  telemetry:
    metrics:
      enabled: true
      port: 9090
    tracing:
      enabled: true
      samplingRate: 0.1
    logging:
      level: info
      format: json
```

### C. API Reference

See [API Documentation](/docs/api/README.md) for complete OpenAPI specification.

### D. Glossary

| Term | Definition |
|------|-----------|
| Simulation Plan | Declarative specification of a simulation |
| Agent | Autonomous unit executing within a simulation |
| Step | Atomic unit of work within a plan |
| Checkpoint | Persisted simulation state for recovery |
| Observation | Data point collected during execution |
| Substrate | Underlying storage layer (ruvvector-postgres) |

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-02 | SPARC Architecture Agent | Initial architecture document |

---

*This document was generated following SPARC methodology Architecture phase guidelines.*
