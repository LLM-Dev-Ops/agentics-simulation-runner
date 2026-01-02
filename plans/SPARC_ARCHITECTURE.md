# SPARC Architecture: agentics-simulation-runner

## Document Control

| Property | Value |
|----------|-------|
| Document ID | SPARC-ARCH-001 |
| Version | 1.0.0 |
| Status | FINAL |
| Created | 2026-01-02 |
| Derives From | SPARC_SPECIFICATION.md, SPARC_PSEUDOCODE.md |

---

## 1. Architecture Overview

### 1.1 Design Philosophy

The agentics-simulation-runner architecture follows these principles:

1. **Single Responsibility**: Each module has exactly one reason to change
2. **Execution Surfaces, Not Duplication**: Other Agentics repositories are invoked as execution surfaces
3. **State Externalization**: All state resides in ruvvector-postgres, making the runner stateless
4. **Strict Boundaries**: Clear interfaces between modules with no cross-boundary leakage
5. **Observable by Default**: Telemetry is woven into the fabric, not bolted on

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              agentics-simulation-runner                                          │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                 API BOUNDARY                                              │   │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │                         Execution Gateway                                         │   │   │
│  │  │  • Plan Ingestion  • Result Retrieval  • Status Queries  • Health Checks        │   │   │
│  │  └──────────────────────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              ORCHESTRATION LAYER                                          │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │   │
│  │  │   Validation    │  │ Instantiation   │  │   Execution     │  │  Finalization   │    │   │
│  │  │   Orchestrator  │  │  Orchestrator   │  │  Orchestrator   │  │  Orchestrator   │    │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                               EXECUTION CORE                                              │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐             │   │
│  │  │   Workflow    │  │    Agent      │  │  Integration  │  │   Telemetry   │             │   │
│  │  │   Scheduler   │  │   Lifecycle   │  │    Adapter    │  │   Collector   │             │   │
│  │  │   Manager     │  │   Manager     │  │    Manager    │  │               │             │   │
│  │  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                               INVOCATION SURFACES                                         │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐             │   │
│  │  │     LLM       │  │   External    │  │   Agentics    │  │   Telemetry   │             │   │
│  │  │  Invocation   │  │  Integration  │  │  Ecosystem    │  │    Export     │             │   │
│  │  │   Surface     │  │   Surface     │  │   Surface     │  │   Surface     │             │   │
│  │  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              STATE SUBSTRATE                                              │   │
│  │                          ┌─────────────────────┐                                         │   │
│  │                          │  ruvvector-postgres │                                         │   │
│  │                          │                     │                                         │   │
│  │                          │  • Execution State  │                                         │   │
│  │                          │  • Telemetry Data   │                                         │   │
│  │                          │  • Result Storage   │                                         │   │
│  │                          │  • Vector Indices   │                                         │   │
│  │                          └─────────────────────┘                                         │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Definitions

### 2.1 Module Inventory

| Module ID | Module Name | Layer | Responsibility |
|-----------|-------------|-------|----------------|
| MOD-001 | Execution Gateway | API Boundary | External interface for plan submission and result retrieval |
| MOD-002 | Validation Orchestrator | Orchestration | Coordinates all validation activities |
| MOD-003 | Instantiation Orchestrator | Orchestration | Coordinates execution context setup |
| MOD-004 | Execution Orchestrator | Orchestration | Coordinates workflow execution |
| MOD-005 | Finalization Orchestrator | Orchestration | Coordinates result assembly and persistence |
| MOD-006 | Workflow Scheduler | Execution Core | Manages step ordering and scheduling |
| MOD-007 | Agent Lifecycle Manager | Execution Core | Manages agent instances and invocations |
| MOD-008 | Integration Adapter Manager | Execution Core | Manages integration connections and calls |
| MOD-009 | Telemetry Collector | Execution Core | Captures metrics, events, and traces |
| MOD-010 | LLM Invocation Surface | Invocation | Abstracts LLM provider interactions |
| MOD-011 | External Integration Surface | Invocation | Abstracts external system interactions |
| MOD-012 | Agentics Ecosystem Surface | Invocation | Abstracts interactions with other Agentics repos |
| MOD-013 | Telemetry Export Surface | Invocation | Abstracts telemetry backend interactions |
| MOD-014 | State Repository | State Substrate | ruvvector-postgres access layer |

---

## 3. Module Specifications

### 3.1 Execution Gateway (MOD-001)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Execution Gateway                           │
│                         (MOD-001)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Single entry point for all external interactions with the      │
│  runner. Enforces authentication, authorization, and request    │
│  validation before delegating to orchestration layer.           │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ submitPlan(plan: SimulationPlan) -> ExecutionHandle        │ │
│  │   • Accepts a SimulationPlan for execution                 │ │
│  │   • Returns handle for tracking and result retrieval       │ │
│  │   • Enforces: INV-IN-001 through INV-IN-007               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ getExecutionStatus(handle: ExecutionHandle) -> Status      │ │
│  │   • Returns current execution status                        │ │
│  │   • Includes progress information if in-progress            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ getResult(handle: ExecutionHandle) -> SimulationResult     │ │
│  │   • Returns completed SimulationResult                      │ │
│  │   • Blocks until completion or timeout                      │ │
│  │   • Enforces: INV-OUT-001 through INV-OUT-007             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ abortExecution(handle: ExecutionHandle) -> AbortResult     │ │
│  │   • Requests graceful abort of execution                    │ │
│  │   • Returns partial result if available                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ healthCheck() -> HealthStatus                               │ │
│  │   • Returns runner health status                            │ │
│  │   • Includes dependency connectivity status                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • Validation Orchestrator (MOD-002)                            │
│  • Execution Orchestrator (MOD-004)                             │
│  • State Repository (MOD-014)                                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STATE:                                                          │
│  • Stateless - all state delegated to State Repository          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Validation Orchestrator (MOD-002)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Validation Orchestrator                        │
│                         (MOD-002)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Coordinates all validation activities for submitted            │
│  SimulationPlans. Ensures plans are syntactically valid,        │
│  semantically complete, and executable before acceptance.       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ validatePlan(plan: SimulationPlan) -> ValidationResult     │ │
│  │   • Orchestrates all validation phases                      │ │
│  │   • Returns aggregated validation result                    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COMPONENTS:                                                     │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │  Schema Validator  │ │ Semantic Validator │                  │
│  │  • JSON Schema     │ │ • Hash integrity   │                  │
│  │  • Type checking   │ │ • Cycle detection  │                  │
│  │  • Required fields │ │ • Reference checks │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │ Resource Validator │ │Connectivity Tester │                  │
│  │  • Limit checks    │ │ • Integration ping │                  │
│  │  • Quota checks    │ │ • LLM model check  │                  │
│  │  • Capacity check  │ │ • Credential valid │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
│  ┌────────────────────┐                                         │
│  │PreCondition Eval   │                                         │
│  │  • Condition types │                                         │
│  │  • Context binding │                                         │
│  │  • Result capture  │                                         │
│  └────────────────────┘                                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • LLM Invocation Surface (MOD-010)                             │
│  • External Integration Surface (MOD-011)                       │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Instantiation Orchestrator (MOD-003)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Instantiation Orchestrator                      │
│                         (MOD-003)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Coordinates the setup of execution context including state     │
│  initialization, agent resolution, and connection establishment.│
│  Prepares all resources needed for workflow execution.          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ instantiate(plan: SimulationPlan) -> ExecutionContext      │ │
│  │   • Creates isolated execution context                      │ │
│  │   • Initializes all state structures                        │ │
│  │   • Resolves all agent instances                            │ │
│  │   • Establishes all integration connections                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ teardown(ctx: ExecutionContext) -> TeardownResult          │ │
│  │   • Releases all resources                                  │ │
│  │   • Closes all connections                                  │ │
│  │   • Cleans up state namespace                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COMPONENTS:                                                     │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │  Context Factory   │ │   State Initializer│                  │
│  │  • ID generation   │ │  • Table creation  │                  │
│  │  • Namespace setup │ │  • Index creation  │                  │
│  │  • Random init     │ │  • Initial records │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │  Agent Resolver    │ │Connection Establisher│                │
│  │  • Type lookup     │ │ • Adapter creation │                  │
│  │  • Config binding  │ │ • Credential fetch │                  │
│  │  • Client creation │ │ • Connection pool  │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • Agent Lifecycle Manager (MOD-007)                            │
│  • Integration Adapter Manager (MOD-008)                        │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Execution Orchestrator (MOD-004)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Orchestrator                        │
│                         (MOD-004)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Central coordinator for workflow execution. Manages the        │
│  execution lifecycle from start to completion, coordinating     │
│  with all execution core modules.                               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ execute(ctx: ExecutionContext, plan: SimulationPlan)       │ │
│  │          -> WorkflowResult                                  │ │
│  │   • Executes complete workflow                              │ │
│  │   • Enforces: INV-EX-001 through INV-EX-007                │ │
│  │   • Returns comprehensive workflow result                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ pause(ctx: ExecutionContext) -> PauseResult                │ │
│  │   • Pauses execution at next checkpoint                     │ │
│  │   • Preserves state for resumption                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ resume(ctx: ExecutionContext) -> ResumeResult              │ │
│  │   • Resumes paused execution                                │ │
│  │   • Restores state from checkpoint                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ abort(ctx: ExecutionContext, reason: String)               │ │
│  │          -> AbortResult                                     │ │
│  │   • Aborts execution immediately                            │ │
│  │   • Triggers rollback if needed                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EXECUTION FLOW:                                                 │
│                                                                  │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐              │
│    │  Start   │────▶│  Step    │────▶│Checkpoint│              │
│    │ Workflow │     │ Execute  │     │  Create  │              │
│    └──────────┘     └────┬─────┘     └────┬─────┘              │
│                          │                │                     │
│                          ▼                ▼                     │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐              │
│    │ Complete │◀────│  Next    │◀────│  More    │              │
│    │ Workflow │     │  Step    │ yes │  Steps?  │              │
│    └──────────┘     └──────────┘     └──────────┘              │
│                                           │ no                  │
│                                           ▼                     │
│                                      ┌──────────┐              │
│                                      │ Finalize │              │
│                                      └──────────┘              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • Workflow Scheduler (MOD-006)                                 │
│  • Agent Lifecycle Manager (MOD-007)                            │
│  • Integration Adapter Manager (MOD-008)                        │
│  • Telemetry Collector (MOD-009)                                │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Finalization Orchestrator (MOD-005)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Finalization Orchestrator                      │
│                         (MOD-005)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Coordinates all activities required to finalize execution      │
│  into an immutable SimulationResult. Ensures completeness,      │
│  integrity, and reproducibility of the output.                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ finalize(ctx: ExecutionContext,                            │ │
│  │          workflowResult: WorkflowResult,                   │ │
│  │          plan: SimulationPlan) -> SimulationResult         │ │
│  │   • Aggregates all observations                             │ │
│  │   • Evaluates post-conditions                               │ │
│  │   • Generates reproducibility proof                         │ │
│  │   • Assembles and persists result                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COMPONENTS:                                                     │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │ Observation        │ │ Validation         │                  │
│  │   Aggregator       │ │   Evaluator        │                  │
│  │  • Metrics         │ │ • Post-conditions  │                  │
│  │  • Events          │ │ • Invariants       │                  │
│  │  • Traces          │ │ • Result validation│                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
│  ┌────────────────────┐ ┌────────────────────┐                  │
│  │ Reproducibility    │ │ Result Assembler   │                  │
│  │   Prover           │ │  • Schema conform  │                  │
│  │  • Fingerprint     │ │  • Hash compute    │                  │
│  │  • Snapshots       │ │  • Immutable store │                  │
│  │  • Randomness log  │ │  • Lock creation   │                  │
│  └────────────────────┘ └────────────────────┘                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • Telemetry Collector (MOD-009)                                │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.6 Workflow Scheduler (MOD-006)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Workflow Scheduler                           │
│                         (MOD-006)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Manages workflow step scheduling and execution ordering.       │
│  Enforces dependency constraints and handles parallel           │
│  execution when permitted by the plan.                          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ buildExecutionOrder(workflow: Workflow)                    │ │
│  │                     -> ExecutionOrder                       │ │
│  │   • Topologically sorts steps by dependencies              │ │
│  │   • Identifies parallelization opportunities               │ │
│  │   • Enforces: INV-EX-004 (dependency ordering)            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ getNextSteps(order: ExecutionOrder,                        │ │
│  │              completed: Set<StepId>) -> List<Step>         │ │
│  │   • Returns steps ready for execution                       │ │
│  │   • Respects dependency constraints                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ executeStep(ctx: ExecutionContext,                         │ │
│  │             step: WorkflowStep) -> StepResult              │ │
│  │   • Delegates to appropriate executor                       │ │
│  │   • Handles step-level timeout                              │ │
│  │   • Records step execution                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STEP TYPE DISPATCH:                                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ AGENT_INVOCATION   -> Agent Lifecycle Manager              │ │
│  │ INTEGRATION_CALL   -> Integration Adapter Manager          │ │
│  │ CONDITIONAL        -> Conditional Evaluator (internal)     │ │
│  │ PARALLEL_GROUP     -> Parallel Executor (internal)         │ │
│  │ LOOP               -> Loop Executor (internal)             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • Agent Lifecycle Manager (MOD-007)                            │
│  • Integration Adapter Manager (MOD-008)                        │
│  • Telemetry Collector (MOD-009)                                │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.7 Agent Lifecycle Manager (MOD-007)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Agent Lifecycle Manager                        │
│                         (MOD-007)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Manages the complete lifecycle of agent instances including    │
│  instantiation, invocation, and termination. Ensures all        │
│  agent interactions follow the invocation spec from the plan.   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ resolveAgent(agentDef: AgentDefinition) -> AgentInstance   │ │
│  │   • Creates agent instance from definition                  │ │
│  │   • Validates LLM model availability                        │ │
│  │   • Binds configuration                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ invoke(ctx: ExecutionContext,                              │ │
│  │        agent: AgentInstance,                               │ │
│  │        step: WorkflowStep) -> InvocationResult             │ │
│  │   • Renders prompt template                                 │ │
│  │   • Invokes LLM via surface                                 │ │
│  │   • Captures tokens and latency                             │ │
│  │   • Enforces: GUA-COR-003 (invocationSpec compliance)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ terminateAgent(agent: AgentInstance)                       │ │
│  │   • Releases agent resources                                │ │
│  │   • Closes LLM client connections                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AGENT STATE MACHINE:                                            │
│                                                                  │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐              │
│    │ CREATED  │────▶│  READY   │────▶│ INVOKING │              │
│    └──────────┘     └────┬─────┘     └────┬─────┘              │
│                          │                │                     │
│                          │                ▼                     │
│    ┌──────────┐          │          ┌──────────┐               │
│    │TERMINATED│◀─────────┴──────────│  READY   │               │
│    └──────────┘                      └──────────┘               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • LLM Invocation Surface (MOD-010)                             │
│  • Telemetry Collector (MOD-009)                                │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.8 Integration Adapter Manager (MOD-008)

```
┌─────────────────────────────────────────────────────────────────┐
│                 Integration Adapter Manager                      │
│                         (MOD-008)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Manages integration adapters for external system access.       │
│  Enforces that all external calls go through declared           │
│  integrations and handles connection lifecycle.                 │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ createAdapter(integrationDef: IntegrationDefinition)       │ │
│  │               -> IntegrationAdapter                         │ │
│  │   • Creates adapter for integration type                    │ │
│  │   • Resolves credentials from vault                         │ │
│  │   • Enforces: INV-IN-001 (declared integrations only)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ connect(adapter: IntegrationAdapter)                       │ │
│  │         -> IntegrationConnection                            │ │
│  │   • Establishes connection with retry                       │ │
│  │   • Validates connectivity                                  │ │
│  │   • Adds to connection pool                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ execute(ctx: ExecutionContext,                             │ │
│  │         connection: IntegrationConnection,                 │ │
│  │         step: WorkflowStep) -> IntegrationCallResult       │ │
│  │   • Executes integration call                               │ │
│  │   • Handles idempotency                                     │ │
│  │   • Enforces: INV-IN-002 (idempotency rules)               │ │
│  │   • Enforces: INV-IN-003 (telemetry capture)               │ │
│  │   • Enforces: INV-IN-004 (failure isolation)               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ disconnect(connection: IntegrationConnection)              │ │
│  │   • Gracefully closes connection                            │ │
│  │   • Removes from pool                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ADAPTER TYPES:                                                  │
│                                                                  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │   HTTP/REST   │ │    GraphQL    │ │     gRPC      │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │   Database    │ │ Message Queue │ │  File System  │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐                            │
│  │   Agentics    │ │    Custom     │                            │
│  │   Ecosystem   │ │   Adapters    │                            │
│  └───────────────┘ └───────────────┘                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • External Integration Surface (MOD-011)                       │
│  • Agentics Ecosystem Surface (MOD-012)                         │
│  • Telemetry Collector (MOD-009)                                │
│  • State Repository (MOD-014)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.9 Telemetry Collector (MOD-009)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Telemetry Collector                          │
│                         (MOD-009)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Captures all telemetry data (metrics, events, traces) during   │
│  execution. Provides interfaces for recording and querying      │
│  telemetry data stored in ruvvector-postgres.                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ recordMetric(ctx: ExecutionContext,                        │ │
│  │              name: String, value: Number,                  │ │
│  │              labels: Map<String, String>)                  │ │
│  │   • Records metric with labels                              │ │
│  │   • Persists to state substrate                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ recordEvent(ctx: ExecutionContext,                         │ │
│  │             eventType: String, eventData: Object)          │ │
│  │   • Records event with structured data                      │ │
│  │   • Timestamps automatically                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ startSpan(ctx: ExecutionContext,                           │ │
│  │           operationName: String,                           │ │
│  │           parentSpanId: Optional<String>) -> SpanHandle    │ │
│  │   • Starts trace span                                       │ │
│  │   • Links to parent if provided                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ endSpan(handle: SpanHandle, status: SpanStatus)            │ │
│  │   • Ends trace span                                         │ │
│  │   • Records duration and status                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ aggregateMetrics(ctx: ExecutionContext,                    │ │
│  │                  requirements: MetricRequirements)         │ │
│  │                  -> CapturedMetrics                         │ │
│  │   • Aggregates metrics per observability spec              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ compileEvents(ctx: ExecutionContext,                       │ │
│  │               requirements: EventRequirements)             │ │
│  │               -> CapturedEvents                             │ │
│  │   • Compiles events per observability spec                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ assembleTraces(ctx: ExecutionContext,                      │ │
│  │                config: TracingConfig) -> CapturedTraces    │ │
│  │   • Assembles complete trace trees                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPENDENCIES:                                                   │
│  • State Repository (MOD-014)                                   │
│  • Telemetry Export Surface (MOD-013) - for external export    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.10 LLM Invocation Surface (MOD-010)

```
┌─────────────────────────────────────────────────────────────────┐
│                    LLM Invocation Surface                        │
│                         (MOD-010)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Abstracts LLM provider interactions. Provides a unified        │
│  interface for invoking language models regardless of the       │
│  underlying provider (OpenAI, Anthropic, etc.).                 │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ createClient(provider: LLMProvider,                        │ │
│  │              credentials: Credentials) -> LLMClient        │ │
│  │   • Creates provider-specific client                        │ │
│  │   • Validates credentials                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ validateModel(client: LLMClient,                           │ │
│  │               modelId: String) -> Boolean                  │ │
│  │   • Checks if model is available                            │ │
│  │   • Validates model capabilities                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ invoke(client: LLMClient,                                  │ │
│  │        request: LLMRequest) -> LLMResponse                 │ │
│  │   • Invokes LLM with request                                │ │
│  │   • Handles retries for transient failures                  │ │
│  │   • Returns response with usage metrics                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUPPORTED PROVIDERS:                                            │
│                                                                  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │   Anthropic   │ │    OpenAI     │ │    Azure      │         │
│  │   (Claude)    │ │   (GPT-4)     │ │   OpenAI      │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │    Google     │ │    Cohere     │ │   Custom/     │         │
│  │   (Gemini)    │ │  (Command-R)  │ │   Self-host   │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  REQUEST/RESPONSE:                                               │
│                                                                  │
│  LLMRequest:                                                     │
│    • model: String                                               │
│    • prompt: String                                              │
│    • maxTokens: Integer                                          │
│    • temperature: Float                                          │
│    • stopSequences: List<String>                                 │
│    • seed: Optional<Integer>  (for reproducibility)             │
│                                                                  │
│  LLMResponse:                                                    │
│    • content: String                                             │
│    • usage: { inputTokens, outputTokens }                       │
│    • finishReason: String                                        │
│    • latencyMs: Integer                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.11 External Integration Surface (MOD-011)

```
┌─────────────────────────────────────────────────────────────────┐
│                 External Integration Surface                     │
│                         (MOD-011)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Abstracts interactions with external systems. Provides         │
│  unified interface for HTTP, database, message queue, and       │
│  other external system interactions.                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ createConnection(spec: ConnectionSpec,                     │ │
│  │                  credentials: Credentials)                 │ │
│  │                  -> ExternalConnection                      │ │
│  │   • Creates connection for external system                  │ │
│  │   • Validates connectivity                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ execute(connection: ExternalConnection,                    │ │
│  │         request: ExternalRequest) -> ExternalResponse      │ │
│  │   • Executes request against external system               │ │
│  │   • Handles timeout and retry                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ testConnectivity(spec: ConnectionSpec) -> ConnectivityResult│ │
│  │   • Tests if connection can be established                  │ │
│  │   • Returns diagnostic information                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CONNECTION TYPES:                                               │
│                                                                  │
│  HTTP/REST:                                                      │
│    • Base URL, headers, auth                                     │
│    • Request/response handling                                   │
│    • Retry policies                                              │
│                                                                  │
│  Database:                                                       │
│    • Connection string, pool config                              │
│    • Query execution                                             │
│    • Transaction support                                         │
│                                                                  │
│  Message Queue:                                                  │
│    • Broker connection                                           │
│    • Publish/subscribe                                           │
│    • Acknowledgment handling                                     │
│                                                                  │
│  File System:                                                    │
│    • Path resolution                                             │
│    • Read/write operations                                       │
│    • Permission handling                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.12 Agentics Ecosystem Surface (MOD-012)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Agentics Ecosystem Surface                      │
│                         (MOD-012)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Abstracts interactions with other Agentics ecosystem           │
│  repositories. Treats them as execution surfaces rather than    │
│  duplicating their logic. This is the ONLY module that should  │
│  know about other Agentics repository interfaces.               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ECOSYSTEM INTEGRATION POINTS:                                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ agentics-simulation-planner (UPSTREAM)                     │ │
│  │   • Plan schema validation                                  │ │
│  │   • Plan reference resolution                               │ │
│  │   • NOT: Plan creation (out of scope)                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ agentics-deployment-intent (DOWNSTREAM)                    │ │
│  │   • Result schema compatibility                             │ │
│  │   • Result delivery notification                            │ │
│  │   • NOT: Deployment execution (out of scope)               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Other Agentics Repos (AS EXECUTION SURFACES)               │ │
│  │   • Tool invocation via adapters                            │ │
│  │   • Capability discovery                                    │ │
│  │   • NOT: Logic duplication                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ resolvePlanReference(ref: PlanReference)                   │ │
│  │                      -> SimulationPlan                      │ │
│  │   • Fetches plan from planner if needed                     │ │
│  │   • Validates plan hash                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ notifyResultReady(result: SimulationResult)                │ │
│  │   • Notifies downstream systems                             │ │
│  │   • Does NOT trigger deployment                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ invokeEcosystemTool(toolRef: ToolReference,                │ │
│  │                     inputs: ToolInputs) -> ToolOutputs     │ │
│  │   • Invokes tool from another Agentics repo                 │ │
│  │   • Uses that repo's interface, not duplicated logic       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BOUNDARY ENFORCEMENT:                                           │
│                                                                  │
│  This module enforces that:                                      │
│  • No planning logic is duplicated from planner                 │
│  • No deployment logic is duplicated from deployment-intent     │
│  • Other repos are invoked as services, not embedded            │
│  • All ecosystem calls are observable and recorded              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.13 Telemetry Export Surface (MOD-013)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Telemetry Export Surface                       │
│                         (MOD-013)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Abstracts telemetry export to external observability           │
│  platforms. Supports multiple export formats and destinations   │
│  while keeping the core telemetry collection decoupled.         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ exportMetrics(metrics: CapturedMetrics,                    │ │
│  │               destination: ExportDestination)              │ │
│  │   • Exports metrics to external system                      │ │
│  │   • Transforms to destination format                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ exportTraces(traces: CapturedTraces,                       │ │
│  │              destination: ExportDestination)               │ │
│  │   • Exports traces to external system                       │ │
│  │   • Supports OTLP, Jaeger, Zipkin formats                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ exportEvents(events: CapturedEvents,                       │ │
│  │              destination: ExportDestination)               │ │
│  │   • Exports events to external system                       │ │
│  │   • Supports various log aggregation formats               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUPPORTED DESTINATIONS:                                         │
│                                                                  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │  Prometheus   │ │    Jaeger     │ │   Datadog     │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │   New Relic   │ │     Splunk    │ │  OpenTelemetry│         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐                            │
│  │  Elasticsearch│ │    Custom     │                            │
│  └───────────────┘ └───────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.14 State Repository (MOD-014)

```
┌─────────────────────────────────────────────────────────────────┐
│                       State Repository                           │
│                         (MOD-014)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PURPOSE:                                                        │
│  Provides unified access to ruvvector-postgres for all state    │
│  persistence needs. This is the ONLY module that directly       │
│  interacts with the database. All other modules use this        │
│  repository for state operations.                               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INTERFACES:                                                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ EXECUTION STATE                                             │ │
│  │ • createExecutionContext(planRef) -> ExecutionContext      │ │
│  │ • updateExecutionStatus(ctxId, status)                     │ │
│  │ • getExecutionContext(ctxId) -> ExecutionContext           │ │
│  │ • listExecutions(filters) -> List<ExecutionSummary>        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP STATE                                                  │ │
│  │ • createStepState(ctxId, stepId) -> StepState              │ │
│  │ • updateStepState(ctxId, stepId, state)                    │ │
│  │ • getStepState(ctxId, stepId) -> StepState                 │ │
│  │ • listStepStates(ctxId) -> List<StepState>                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ AGENT STATE                                                 │ │
│  │ • recordAgentInvocation(ctxId, invocation)                 │ │
│  │ • getAgentInvocations(ctxId, agentId) -> List<Invocation>  │ │
│  │ • aggregateAgentMetrics(ctxId) -> AgentMetrics             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ INTEGRATION STATE                                           │ │
│  │ • recordIntegrationCall(ctxId, call)                       │ │
│  │ • getIntegrationCalls(ctxId, integrationId) -> List<Call>  │ │
│  │ • aggregateIntegrationMetrics(ctxId) -> IntegrationMetrics │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ TELEMETRY STATE                                             │ │
│  │ • recordMetric(ctxId, metric)                              │ │
│  │ • recordEvent(ctxId, event)                                │ │
│  │ • recordSpan(ctxId, span)                                  │ │
│  │ • queryMetrics(ctxId, query) -> List<Metric>               │ │
│  │ • queryEvents(ctxId, query) -> List<Event>                 │ │
│  │ • querySpans(ctxId, query) -> List<Span>                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ CHECKPOINT STATE                                            │ │
│  │ • createSnapshot(ctxId, checkpointId, data) -> SnapshotId  │ │
│  │ • getSnapshot(snapshotId) -> SnapshotData                  │ │
│  │ • listSnapshots(ctxId) -> List<SnapshotRef>                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RESULT STATE                                                │ │
│  │ • persistResult(result) -> ResultRef                       │ │
│  │ • getResult(resultId) -> SimulationResult                  │ │
│  │ • lockResult(resultId) -> LockConfirmation                 │ │
│  │ • listResults(filters) -> List<ResultSummary>              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RANDOMNESS STATE                                            │ │
│  │ • logRandomValue(ctxId, operation, value)                  │ │
│  │ • getRandomnessLog(ctxId) -> List<RandomnessEntry>         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ISOLATION ENFORCEMENT:                                          │
│                                                                  │
│  • All operations are scoped to execution namespace             │
│  • INV-EX-002: Concurrent executions cannot see each other     │
│  • Tenant isolation enforced at database level                  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  UNDERLYING STORAGE:                                             │
│                                                                  │
│  ruvvector-postgres provides:                                    │
│  • Transactional consistency                                     │
│  • Vector indexing for similarity queries                        │
│  • JSON/JSONB for flexible schema                               │
│  • Partitioning for multi-tenant isolation                      │
│  • Write-ahead logging for durability                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Module Interactions

### 4.1 Execution Flow Sequence

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Gateway │  │Validation│  │Instant- │  │Execution│  │ Final-  │  │  State  │
│ MOD-001 │  │ MOD-002 │  │  iation │  │ MOD-004 │  │ ization │  │ MOD-014 │
│         │  │         │  │ MOD-003 │  │         │  │ MOD-005 │  │         │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │            │            │
     │ submitPlan │            │            │            │            │
     │───────────>│            │            │            │            │
     │            │ validatePlan            │            │            │
     │            │─────────────────────────────────────>│            │
     │            │            │            │            │ persist    │
     │            │            │            │            │<───────────│
     │            │            │            │            │            │
     │            │ valid      │            │            │            │
     │<───────────│            │            │            │            │
     │            │            │            │            │            │
     │            │ instantiate│            │            │            │
     │───────────────────────>│            │            │            │
     │            │            │ createCtx  │            │            │
     │            │            │─────────────────────────────────────>│
     │            │            │            │            │            │
     │            │            │ context    │            │            │
     │<───────────────────────│            │            │            │
     │            │            │            │            │            │
     │            │            │ execute    │            │            │
     │────────────────────────────────────>│            │            │
     │            │            │            │ updateState│            │
     │            │            │            │─────────────────────────>│
     │            │            │            │            │            │
     │            │            │            │ workflowResult          │
     │<────────────────────────────────────│            │            │
     │            │            │            │            │            │
     │            │            │            │ finalize   │            │
     │─────────────────────────────────────────────────>│            │
     │            │            │            │            │persistResult
     │            │            │            │            │───────────>│
     │            │            │            │            │            │
     │            │            │            │            │ result     │
     │<─────────────────────────────────────────────────│            │
     │            │            │            │            │            │
```

### 4.2 Module Dependency Matrix

| Module | Depends On |
|--------|------------|
| MOD-001 Execution Gateway | MOD-002, MOD-003, MOD-004, MOD-005, MOD-014 |
| MOD-002 Validation Orchestrator | MOD-010, MOD-011, MOD-014 |
| MOD-003 Instantiation Orchestrator | MOD-007, MOD-008, MOD-014 |
| MOD-004 Execution Orchestrator | MOD-006, MOD-007, MOD-008, MOD-009, MOD-014 |
| MOD-005 Finalization Orchestrator | MOD-009, MOD-014 |
| MOD-006 Workflow Scheduler | MOD-007, MOD-008, MOD-009, MOD-014 |
| MOD-007 Agent Lifecycle Manager | MOD-010, MOD-009, MOD-014 |
| MOD-008 Integration Adapter Manager | MOD-011, MOD-012, MOD-009, MOD-014 |
| MOD-009 Telemetry Collector | MOD-013, MOD-014 |
| MOD-010 LLM Invocation Surface | (External LLM Providers) |
| MOD-011 External Integration Surface | (External Systems) |
| MOD-012 Agentics Ecosystem Surface | (Other Agentics Repos) |
| MOD-013 Telemetry Export Surface | (External Observability) |
| MOD-014 State Repository | (ruvvector-postgres) |

### 4.3 Dependency Rules

1. **Layer Discipline**: Modules may only depend on modules in the same layer or lower layers
2. **Surface Isolation**: Invocation surfaces are the only modules that interact with external systems
3. **State Centralization**: Only MOD-014 directly accesses ruvvector-postgres
4. **No Circular Dependencies**: The dependency graph is acyclic

---

## 5. Data Flow Architecture

### 5.1 Input Processing

```
                                    SimulationPlan
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     VALIDATION PIPELINE                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Schema  │─▶│Semantic │─▶│Resource │─▶│Connec-  │            │
│  │Validate │  │Validate │  │ Check   │  │ tivity  │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INSTANTIATION PIPELINE                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Create  │─▶│ Init    │─▶│ Resolve │─▶│Establish│            │
│  │ Context │  │ State   │  │ Agents  │  │ Conn    │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                          ExecutionContext
```

### 5.2 Execution Processing

```
         ExecutionContext + SimulationPlan
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION PIPELINE                            │
│                                                                  │
│    ┌──────────────────────────────────────────────────────┐    │
│    │              Workflow Scheduler                       │    │
│    │  • Topological ordering                               │    │
│    │  • Step dispatch                                      │    │
│    │  • Checkpoint management                              │    │
│    └───────────────────────┬──────────────────────────────┘    │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│    ┌─────────┐        ┌─────────┐        ┌─────────┐           │
│    │ Agent   │        │Integra- │        │ Telem-  │           │
│    │Lifecycle│        │  tion   │        │  etry   │           │
│    │ Manager │        │ Adapter │        │Collector│           │
│    └─────────┘        └─────────┘        └─────────┘           │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│    ┌─────────┐        ┌─────────┐        ┌─────────┐           │
│    │   LLM   │        │External │        │Telemetry│           │
│    │ Surface │        │ Surface │        │ Export  │           │
│    └─────────┘        └─────────┘        └─────────┘           │
│                                                                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                          WorkflowResult
```

### 5.3 Output Processing

```
                          WorkflowResult
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FINALIZATION PIPELINE                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │Aggregate│─▶│Evaluate │─▶│Generate │─▶│Assemble │            │
│  │ Observ  │  │PostCond │  │  Proof  │  │ Result  │            │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PERSISTENCE PIPELINE                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │Compute  │─▶│ Persist │─▶│  Lock   │                         │
│  │  Hash   │  │ Result  │  │Immutable│                         │
│  └─────────┘  └─────────┘  └─────────┘                         │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                          SimulationResult
                            (Immutable)
```

---

## 6. Cross-Cutting Concerns

### 6.1 Error Handling Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR CLASSIFICATION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VALIDATION ERRORS (Pre-execution)                               │
│  • Schema errors → Reject immediately                            │
│  • Semantic errors → Reject immediately                          │
│  • Resource errors → Reject or queue                             │
│  • Connectivity errors → Retry or reject                         │
│                                                                  │
│  EXECUTION ERRORS (During execution)                             │
│  • Transient errors → Retry with backoff                        │
│  • Step errors → Handle per step criticality                    │
│  • Agent errors → Record and continue if non-critical           │
│  • Integration errors → Record and continue if non-critical     │
│  • Timeout errors → Abort with partial result                   │
│  • Fatal errors → Abort and rollback                            │
│                                                                  │
│  FINALIZATION ERRORS (Post-execution)                            │
│  • Aggregation errors → Degrade gracefully                      │
│  • Persistence errors → Retry critical, log others              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Observability Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   OBSERVABILITY LAYERS                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  L1: EXECUTION METRICS                                           │
│  • Execution duration                                            │
│  • Step durations                                                │
│  • Agent invocation metrics                                      │
│  • Integration call metrics                                      │
│  • Resource utilization                                          │
│                                                                  │
│  L2: EXECUTION EVENTS                                            │
│  • Execution lifecycle events                                    │
│  • Step state transitions                                        │
│  • Error events                                                  │
│  • Checkpoint events                                             │
│                                                                  │
│  L3: EXECUTION TRACES                                            │
│  • Distributed traces across steps                               │
│  • Agent invocation spans                                        │
│  • Integration call spans                                        │
│  • Parent-child relationships                                    │
│                                                                  │
│  L4: REPRODUCIBILITY DATA                                        │
│  • State snapshots                                               │
│  • Randomness logs                                               │
│  • Execution fingerprints                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Security Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY BOUNDARIES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TENANT ISOLATION                                                │
│  • All state namespaced by tenant                               │
│  • No cross-tenant data access                                   │
│  • Separate resource pools per tenant                           │
│                                                                  │
│  EXECUTION ISOLATION                                             │
│  • Concurrent executions fully isolated                         │
│  • No shared mutable state between executions                   │
│  • Resource limits enforced per execution                       │
│                                                                  │
│  CREDENTIAL PROTECTION                                           │
│  • Credentials never stored in state                            │
│  • Credentials resolved at runtime from vault                   │
│  • Credentials never exposed in logs or results                 │
│                                                                  │
│  ACCESS CONTROL                                                  │
│  • Authentication at Gateway                                     │
│  • Authorization per operation                                   │
│  • Audit trail for all access                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Deployment Topology

### 7.1 Logical Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT TOPOLOGY                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Load Balancer                         │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Runner    │    │   Runner    │    │   Runner    │         │
│  │  Instance   │    │  Instance   │    │  Instance   │         │
│  │     #1      │    │     #2      │    │     #N      │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                     │
│  ┌─────────────────────────┴───────────────────────────────┐   │
│  │                  ruvvector-postgres                      │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │   Primary   │  │   Replica   │  │   Replica   │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Scaling Characteristics

| Component | Scaling Model | Trigger |
|-----------|---------------|---------|
| Runner Instances | Horizontal | Execution queue depth |
| State Repository | Read replicas | Read load |
| LLM Surface | Connection pool | Agent concurrency |
| Integration Surface | Connection pool | Integration concurrency |

---

## 8. Traceability Matrix

| Specification Requirement | Architecture Component |
|---------------------------|------------------------|
| INV-IN-001 Schema validity | MOD-002 Schema Validator |
| INV-IN-002 Semantic completeness | MOD-002 Semantic Validator |
| INV-IN-005 Agent resolvability | MOD-003 Agent Resolver, MOD-007 |
| INV-IN-006 Integration connectivity | MOD-002 Connectivity Tester, MOD-008 |
| INV-EX-001 Determinism | MOD-014 Randomness Log |
| INV-EX-002 Isolation | MOD-014 State Namespacing |
| INV-EX-004 Ordering | MOD-006 Topological Sort |
| INV-EX-007 State consistency | MOD-014 State Repository |
| INV-OUT-002 Immutability | MOD-014 Result Lock |
| INV-IN-001 Declared integrations | MOD-008 Adapter Manager |
| INV-IN-003 Telemetry capture | MOD-009 Telemetry Collector |
| GUA-COR-003 InvocationSpec compliance | MOD-007 Agent Lifecycle Manager |
| GUA-REP-001 Reproducibility | MOD-005 Reproducibility Prover |

---

## Appendix A: Module Interface Contracts

All module interfaces are defined with:
- Input types and validation rules
- Output types and guarantees
- Error types and handling expectations
- Concurrency semantics
- State mutation effects

Detailed interface contracts are maintained in the implementation codebase.

---

## Appendix B: Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State Substrate | ruvvector-postgres | Vector + relational in one, per spec |
| Serialization | JSON + Protocol Buffers | JSON for flexibility, Protobuf for efficiency |
| Inter-module Communication | Direct function calls | Single process, no network overhead |
| External Communication | gRPC + REST | gRPC for services, REST for APIs |

---

*End of SPARC Architecture Document*
