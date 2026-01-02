# SPARC Pseudocode: agentics-simulation-runner

## Document Control

| Property | Value |
|----------|-------|
| Document ID | SPARC-PSEUDO-001 |
| Version | 1.0.0 |
| Status | FINAL |
| Created | 2026-01-02 |
| Derives From | SPARC_SPECIFICATION.md |

---

## 1. Overview

This document describes the end-to-end execution flows for the agentics-simulation-runner. All flows derive directly from SPARC_SPECIFICATION.md and demonstrate how SimulationPlans are validated, instantiated, executed, observed, and finalized into immutable SimulationResults.

**State Substrate**: All state operations use `ruvvector-postgres` as the mandatory persistence layer.

---

## 2. Master Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MASTER EXECUTION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   INPUT: SimulationPlan                                                      │
│      │                                                                       │
│      ▼                                                                       │
│   ┌──────────────────────────────────────┐                                  │
│   │ PHASE 1: VALIDATION                  │                                  │
│   │ • Schema validation                  │                                  │
│   │ • Semantic validation                │                                  │
│   │ • Resource availability check        │                                  │
│   │ • Integration connectivity test      │                                  │
│   └──────────────────┬───────────────────┘                                  │
│                      │                                                       │
│                      ▼                                                       │
│   ┌──────────────────────────────────────┐                                  │
│   │ PHASE 2: INSTANTIATION               │                                  │
│   │ • Create execution context           │                                  │
│   │ • Initialize state in ruvvector-pg   │                                  │
│   │ • Resolve agent instances            │                                  │
│   │ • Establish integration connections  │                                  │
│   └──────────────────┬───────────────────┘                                  │
│                      │                                                       │
│                      ▼                                                       │
│   ┌──────────────────────────────────────┐                                  │
│   │ PHASE 3: EXECUTION                   │                                  │
│   │ • Execute workflow steps             │                                  │
│   │ • Invoke agents per invocationSpec   │                                  │
│   │ • Call integrations as specified     │                                  │
│   │ • Capture all observations           │                                  │
│   └──────────────────┬───────────────────┘                                  │
│                      │                                                       │
│                      ▼                                                       │
│   ┌──────────────────────────────────────┐                                  │
│   │ PHASE 4: OBSERVATION                 │                                  │
│   │ • Aggregate metrics                  │                                  │
│   │ • Compile event logs                 │                                  │
│   │ • Assemble trace data                │                                  │
│   │ • Validate against observability req │                                  │
│   └──────────────────┬───────────────────┘                                  │
│                      │                                                       │
│                      ▼                                                       │
│   ┌──────────────────────────────────────┐                                  │
│   │ PHASE 5: FINALIZATION                │                                  │
│   │ • Evaluate validation rules          │                                  │
│   │ • Generate reproducibility proof     │                                  │
│   │ • Assemble SimulationResult          │                                  │
│   │ • Persist as immutable record        │                                  │
│   └──────────────────┬───────────────────┘                                  │
│                      │                                                       │
│                      ▼                                                       │
│   OUTPUT: SimulationResult (Immutable)                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phase 1: Validation

### 3.1 Schema Validation

```pseudocode
FUNCTION validateSchema(plan: SimulationPlan) -> ValidationResult:
    // INV-IN-001: SimulationPlan MUST be syntactically valid

    errors = []

    // Validate required fields exist
    IF plan.planId IS NULL:
        errors.append(SchemaError("planId is required"))

    IF plan.planVersion IS NULL:
        errors.append(SchemaError("planVersion is required"))

    IF plan.planHash IS NULL:
        errors.append(SchemaError("planHash is required"))

    IF plan.workflow IS NULL OR plan.workflow.steps IS EMPTY:
        errors.append(SchemaError("workflow.steps must not be empty"))

    // Validate field types
    FOR EACH field IN plan.getAllFields():
        IF NOT field.matchesExpectedType():
            errors.append(TypeError(field.name, field.expectedType, field.actualType))

    // Validate nested structures
    FOR EACH step IN plan.workflow.steps:
        stepErrors = validateStepSchema(step)
        errors.appendAll(stepErrors)

    FOR EACH agent IN plan.agents:
        agentErrors = validateAgentSchema(agent)
        errors.appendAll(agentErrors)

    FOR EACH integration IN plan.integrations:
        integrationErrors = validateIntegrationSchema(integration)
        errors.appendAll(integrationErrors)

    RETURN ValidationResult(
        valid: errors.isEmpty(),
        errors: errors,
        phase: "SCHEMA_VALIDATION"
    )
```

### 3.2 Semantic Validation

```pseudocode
FUNCTION validateSemantics(plan: SimulationPlan) -> ValidationResult:
    // INV-IN-002: SimulationPlan MUST be semantically complete

    errors = []

    // Validate hash integrity
    // INV-IN-003: SimulationPlan MUST have valid planHash
    computedHash = computeSHA256(plan.canonicalize())
    IF computedHash != plan.planHash:
        errors.append(IntegrityError("planHash mismatch"))

    // Validate dependency graph is acyclic
    IF hasCycles(plan.workflow.dependencies):
        errors.append(DependencyError("workflow contains cycles"))

    // Validate all step references exist
    stepIds = plan.workflow.steps.map(s => s.stepId)
    FOR EACH dependency IN plan.workflow.dependencies:
        IF dependency.from NOT IN stepIds:
            errors.append(ReferenceError("unknown step: " + dependency.from))
        IF dependency.to NOT IN stepIds:
            errors.append(ReferenceError("unknown step: " + dependency.to))

    // INV-IN-005: All referenced agents MUST be resolvable
    agentIds = plan.agents.map(a => a.agentId)
    FOR EACH step IN plan.workflow.steps:
        IF step.agentRef NOT IN agentIds:
            errors.append(ReferenceError("unknown agent: " + step.agentRef))

    // Validate agent invocation specs are complete
    FOR EACH agent IN plan.agents:
        IF agent.invocationSpec.modelId IS NULL:
            errors.append(SemanticError("agent " + agent.agentId + " missing modelId"))
        IF agent.invocationSpec.promptTemplate IS NULL:
            errors.append(SemanticError("agent " + agent.agentId + " missing promptTemplate"))

    // Validate checkpoint definitions
    FOR EACH checkpoint IN plan.workflow.checkpoints:
        IF checkpoint.stepRef NOT IN stepIds:
            errors.append(ReferenceError("checkpoint references unknown step: " + checkpoint.stepRef))

    RETURN ValidationResult(
        valid: errors.isEmpty(),
        errors: errors,
        phase: "SEMANTIC_VALIDATION"
    )
```

### 3.3 Resource Availability Check

```pseudocode
FUNCTION validateResourceAvailability(plan: SimulationPlan) -> ValidationResult:
    // INV-IN-007: Resource limits MUST be satisfiable

    errors = []
    limits = plan.executionConfig.resourceLimits

    // Query ruvvector-postgres for resource pool status
    resourcePool = ruvvector.query("""
        SELECT available_cpu, available_memory, available_storage
        FROM resource_pools
        WHERE tenant_id = :tenantId AND pool_status = 'ACTIVE'
    """, tenantId: getCurrentTenantId())

    IF resourcePool.available_cpu < limits.maxCpu:
        errors.append(ResourceError("insufficient CPU: need " + limits.maxCpu + ", have " + resourcePool.available_cpu))

    IF resourcePool.available_memory < limits.maxMemory:
        errors.append(ResourceError("insufficient memory: need " + limits.maxMemory + ", have " + resourcePool.available_memory))

    IF resourcePool.available_storage < limits.maxStorage:
        errors.append(ResourceError("insufficient storage: need " + limits.maxStorage + ", have " + resourcePool.available_storage))

    // Validate execution duration is within tenant limits
    tenantLimits = ruvvector.query("""
        SELECT max_execution_duration FROM tenant_config WHERE tenant_id = :tenantId
    """, tenantId: getCurrentTenantId())

    IF plan.executionConfig.maxDuration > tenantLimits.max_execution_duration:
        errors.append(ResourceError("maxDuration exceeds tenant limit"))

    RETURN ValidationResult(
        valid: errors.isEmpty(),
        errors: errors,
        phase: "RESOURCE_VALIDATION"
    )
```

### 3.4 Integration Connectivity Test

```pseudocode
FUNCTION validateIntegrationConnectivity(plan: SimulationPlan) -> ValidationResult:
    // INV-IN-006: All referenced integrations MUST be connectable

    errors = []
    warnings = []

    FOR EACH integration IN plan.integrations:
        TRY:
            adapter = IntegrationAdapterFactory.create(integration.adapterType)
            connectionResult = adapter.testConnection(integration.connectionSpec)

            IF NOT connectionResult.success:
                errors.append(ConnectivityError(
                    "integration " + integration.integrationId + " failed: " + connectionResult.reason
                ))
            ELSE IF connectionResult.hasWarnings:
                warnings.appendAll(connectionResult.warnings)
        CATCH Exception e:
            errors.append(ConnectivityError(
                "integration " + integration.integrationId + " error: " + e.message
            ))

    RETURN ValidationResult(
        valid: errors.isEmpty(),
        errors: errors,
        warnings: warnings,
        phase: "CONNECTIVITY_VALIDATION"
    )
```

### 3.5 Pre-Condition Evaluation

```pseudocode
FUNCTION evaluatePreConditions(plan: SimulationPlan) -> ValidationResult:
    // Evaluate all pre-conditions before execution begins

    results = []

    FOR EACH condition IN plan.validation.preConditions:
        evaluator = ConditionEvaluator.forType(condition.type)
        result = evaluator.evaluate(condition, currentContext())

        results.append(ConditionResult(
            conditionId: condition.conditionId,
            passed: result.passed,
            message: result.message,
            evaluatedAt: now()
        ))

        IF NOT result.passed AND condition.required:
            RETURN ValidationResult(
                valid: FALSE,
                errors: [PreConditionError(condition.conditionId + " failed: " + result.message)],
                phase: "PRECONDITION_VALIDATION"
            )

    RETURN ValidationResult(
        valid: TRUE,
        conditionResults: results,
        phase: "PRECONDITION_VALIDATION"
    )
```

---

## 4. Phase 2: Instantiation

### 4.1 Create Execution Context

```pseudocode
FUNCTION createExecutionContext(plan: SimulationPlan) -> ExecutionContext:
    // Create isolated execution context

    executionId = generateUUID()

    // Initialize deterministic random generator
    // GUA-REP-002: Random operations use deterministicSeed
    randomGenerator = DeterministicRandom(plan.executionConfig.deterministicSeed)

    // Create context in ruvvector-postgres
    // INV-EX-007: All state mutations MUST be recorded in ruvvector-postgres
    ruvvector.execute("""
        INSERT INTO execution_contexts (
            execution_id, plan_id, plan_hash, tenant_id,
            status, deterministic_seed, started_at, isolation_level
        ) VALUES (
            :executionId, :planId, :planHash, :tenantId,
            'INITIALIZING', :seed, :startedAt, :isolationLevel
        )
    """,
        executionId: executionId,
        planId: plan.planId,
        planHash: plan.planHash,
        tenantId: getCurrentTenantId(),
        seed: plan.executionConfig.deterministicSeed,
        startedAt: now(),
        isolationLevel: plan.executionConfig.isolationLevel
    )

    // INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
    stateNamespace = "execution:" + executionId

    RETURN ExecutionContext(
        executionId: executionId,
        planRef: PlanReference(plan.planId, plan.planHash),
        tenantId: getCurrentTenantId(),
        stateNamespace: stateNamespace,
        randomGenerator: randomGenerator,
        startTime: now(),
        resourceLimits: plan.executionConfig.resourceLimits,
        maxDuration: plan.executionConfig.maxDuration
    )
```

### 4.2 Initialize State

```pseudocode
FUNCTION initializeState(ctx: ExecutionContext, plan: SimulationPlan) -> StateHandle:
    // Initialize all state structures in ruvvector-postgres

    // Create step state tracking table
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_step_states (
            step_id VARCHAR(255) PRIMARY KEY,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            outputs JSONB,
            metrics JSONB,
            errors JSONB,
            checkpoint_data BYTEA
        )
    """.replace("{namespace}", ctx.stateNamespace))

    // Insert initial step states
    FOR EACH step IN plan.workflow.steps:
        ruvvector.execute("""
            INSERT INTO {namespace}_step_states (step_id, status)
            VALUES (:stepId, 'PENDING')
        """.replace("{namespace}", ctx.stateNamespace),
            stepId: step.stepId
        )

    // Create agent invocation tracking
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_agent_invocations (
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
    """.replace("{namespace}", ctx.stateNamespace))

    // Create integration call tracking
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_integration_calls (
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
    """.replace("{namespace}", ctx.stateNamespace))

    // Create telemetry tables
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_metrics (
            metric_id VARCHAR(255) PRIMARY KEY,
            metric_name VARCHAR(255) NOT NULL,
            metric_value DOUBLE PRECISION NOT NULL,
            labels JSONB,
            captured_at TIMESTAMP NOT NULL
        )
    """.replace("{namespace}", ctx.stateNamespace))

    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_events (
            event_id VARCHAR(255) PRIMARY KEY,
            event_type VARCHAR(255) NOT NULL,
            event_data JSONB,
            occurred_at TIMESTAMP NOT NULL
        )
    """.replace("{namespace}", ctx.stateNamespace))

    // Create randomness log for reproducibility
    // GUA-REP-002: Random operations use deterministicSeed
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_randomness_log (
            sequence_num SERIAL PRIMARY KEY,
            operation VARCHAR(255) NOT NULL,
            random_value BYTEA NOT NULL,
            used_at TIMESTAMP NOT NULL
        )
    """.replace("{namespace}", ctx.stateNamespace))

    // Create state snapshots table for checkpoints
    // GUA-REP-003: State snapshots enable point-in-time replay
    ruvvector.execute("""
        CREATE TABLE IF NOT EXISTS {namespace}_state_snapshots (
            snapshot_id VARCHAR(255) PRIMARY KEY,
            checkpoint_id VARCHAR(255) NOT NULL,
            step_id VARCHAR(255) NOT NULL,
            snapshot_data BYTEA NOT NULL,
            snapshot_hash VARCHAR(64) NOT NULL,
            created_at TIMESTAMP NOT NULL
        )
    """.replace("{namespace}", ctx.stateNamespace))

    RETURN StateHandle(
        namespace: ctx.stateNamespace,
        initialized: TRUE,
        tables: ["step_states", "agent_invocations", "integration_calls",
                 "metrics", "events", "randomness_log", "state_snapshots"]
    )
```

### 4.3 Resolve Agent Instances

```pseudocode
FUNCTION resolveAgentInstances(ctx: ExecutionContext, plan: SimulationPlan) -> Map<AgentId, AgentInstance>:
    // Resolve all agents defined in the plan

    agentInstances = Map()

    FOR EACH agentDef IN plan.agents:
        // Validate agent type is supported
        IF NOT AgentRegistry.supports(agentDef.agentType):
            THROW AgentResolutionError("unsupported agent type: " + agentDef.agentType)

        // Create agent instance with invocation spec
        instance = AgentInstance(
            agentId: agentDef.agentId,
            agentType: agentDef.agentType,
            configuration: agentDef.configuration,
            invocationSpec: agentDef.invocationSpec,
            stateNamespace: ctx.stateNamespace + ":agent:" + agentDef.agentId
        )

        // Validate LLM provider is reachable
        llmClient = LLMClientFactory.create(agentDef.invocationSpec.provider)
        IF NOT llmClient.validateModel(agentDef.invocationSpec.modelId):
            THROW AgentResolutionError("model not available: " + agentDef.invocationSpec.modelId)

        instance.llmClient = llmClient
        agentInstances.put(agentDef.agentId, instance)

        // Record agent instantiation
        ruvvector.execute("""
            INSERT INTO {namespace}_agent_instances (
                agent_id, agent_type, model_id, instantiated_at, status
            ) VALUES (:agentId, :agentType, :modelId, :instantiatedAt, 'READY')
        """.replace("{namespace}", ctx.stateNamespace),
            agentId: agentDef.agentId,
            agentType: agentDef.agentType,
            modelId: agentDef.invocationSpec.modelId,
            instantiatedAt: now()
        )

    RETURN agentInstances
```

### 4.4 Establish Integration Connections

```pseudocode
FUNCTION establishIntegrationConnections(ctx: ExecutionContext, plan: SimulationPlan) -> Map<IntegrationId, IntegrationConnection>:
    // Establish connections to all integrations

    connections = Map()

    FOR EACH integrationDef IN plan.integrations:
        adapter = IntegrationAdapterFactory.create(integrationDef.adapterType)

        // Resolve credentials from secure vault
        credentials = SecureVault.resolve(integrationDef.connectionSpec.credentialRef)

        // Establish connection with retry
        connection = NULL
        retryCount = 0
        maxRetries = 3

        WHILE connection IS NULL AND retryCount < maxRetries:
            TRY:
                connection = adapter.connect(
                    integrationDef.connectionSpec,
                    credentials
                )
            CATCH TransientError e:
                retryCount++
                IF retryCount >= maxRetries:
                    THROW IntegrationConnectionError(
                        "failed to connect to " + integrationDef.integrationId + " after " + maxRetries + " attempts"
                    )
                sleep(exponentialBackoff(retryCount))

        connections.put(integrationDef.integrationId, connection)

        // Record connection establishment
        ruvvector.execute("""
            INSERT INTO {namespace}_integration_connections (
                integration_id, adapter_type, connected_at, status
            ) VALUES (:integrationId, :adapterType, :connectedAt, 'CONNECTED')
        """.replace("{namespace}", ctx.stateNamespace),
            integrationId: integrationDef.integrationId,
            adapterType: integrationDef.adapterType,
            connectedAt: now()
        )

    RETURN connections
```

---

## 5. Phase 3: Execution

### 5.1 Workflow Orchestrator

```pseudocode
FUNCTION executeWorkflow(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    agents: Map<AgentId, AgentInstance>,
    integrations: Map<IntegrationId, IntegrationConnection>
) -> WorkflowResult:
    // INV-EX-004: Step execution MUST respect dependency graph ordering

    // Update execution status
    ruvvector.execute("""
        UPDATE execution_contexts SET status = 'EXECUTING' WHERE execution_id = :executionId
    """, executionId: ctx.executionId)

    // Build execution order from dependency graph
    executionOrder = topologicalSort(plan.workflow.dependencies, plan.workflow.steps)

    // Track completed steps
    completedSteps = Set()
    stepResults = []

    // Initialize deadline tracker
    // INV-EX-006: Execution MUST terminate within maxDuration or abort
    deadline = ctx.startTime + ctx.maxDuration

    FOR EACH step IN executionOrder:
        // Check deadline
        IF now() > deadline:
            abortExecution(ctx, "execution exceeded maxDuration")
            THROW TimeoutError("execution exceeded maxDuration")

        // Wait for dependencies to complete
        // INV-EX-004: Step execution MUST respect dependency graph ordering
        dependencies = getDependencies(step, plan.workflow.dependencies)
        FOR EACH depStepId IN dependencies:
            WHILE depStepId NOT IN completedSteps:
                IF now() > deadline:
                    abortExecution(ctx, "execution exceeded maxDuration waiting for " + depStepId)
                    THROW TimeoutError("execution exceeded maxDuration")
                sleep(100ms)

        // Execute the step
        TRY:
            stepResult = executeStep(ctx, step, agents, integrations, plan)
            stepResults.append(stepResult)
            completedSteps.add(step.stepId)

            // Create checkpoint if defined
            checkpoint = findCheckpoint(step.stepId, plan.workflow.checkpoints)
            IF checkpoint IS NOT NULL:
                createCheckpoint(ctx, checkpoint, stepResult)

        CATCH StepExecutionError e:
            // INV-EX-003: Execution MUST complete fully or rollback to initial state
            handleStepFailure(ctx, step, e, plan)

            // Record failure but continue if step is not critical
            IF step.critical:
                rollbackExecution(ctx)
                THROW ExecutionFailedError("critical step " + step.stepId + " failed: " + e.message)
            ELSE:
                stepResults.append(StepResult(
                    stepId: step.stepId,
                    status: "FAILED",
                    error: e.message
                ))
                completedSteps.add(step.stepId)

    RETURN WorkflowResult(
        status: "COMPLETED",
        stepResults: stepResults,
        completedAt: now()
    )
```

### 5.2 Step Executor

```pseudocode
FUNCTION executeStep(
    ctx: ExecutionContext,
    step: WorkflowStep,
    agents: Map<AgentId, AgentInstance>,
    integrations: Map<IntegrationId, IntegrationConnection>,
    plan: SimulationPlan
) -> StepResult:
    // Execute a single workflow step

    stepStartTime = now()

    // Update step status in state
    ruvvector.execute("""
        UPDATE {namespace}_step_states
        SET status = 'EXECUTING', started_at = :startedAt
        WHERE step_id = :stepId
    """.replace("{namespace}", ctx.stateNamespace),
        stepId: step.stepId,
        startedAt: stepStartTime
    )

    // Record step start event
    recordEvent(ctx, "STEP_STARTED", {
        stepId: step.stepId,
        stepType: step.stepType
    })

    outputs = []
    metrics = StepMetrics()
    errors = []

    TRY:
        SWITCH step.stepType:
            CASE "AGENT_INVOCATION":
                result = executeAgentInvocation(ctx, step, agents.get(step.agentRef))
                outputs.append(result.output)
                metrics.merge(result.metrics)

            CASE "INTEGRATION_CALL":
                result = executeIntegrationCall(ctx, step, integrations.get(step.integrationRef))
                outputs.append(result.output)
                metrics.merge(result.metrics)

            CASE "CONDITIONAL":
                result = evaluateConditional(ctx, step)
                outputs.append(result.decision)

            CASE "PARALLEL_GROUP":
                result = executeParallelSteps(ctx, step.subSteps, agents, integrations, plan)
                outputs.appendAll(result.outputs)
                metrics.merge(result.metrics)

            CASE "LOOP":
                result = executeLoop(ctx, step, agents, integrations, plan)
                outputs.appendAll(result.outputs)
                metrics.merge(result.metrics)

            DEFAULT:
                THROW UnsupportedStepTypeError(step.stepType)

        // Update step status to completed
        ruvvector.execute("""
            UPDATE {namespace}_step_states
            SET status = 'COMPLETED', completed_at = :completedAt,
                outputs = :outputs, metrics = :metrics
            WHERE step_id = :stepId
        """.replace("{namespace}", ctx.stateNamespace),
            stepId: step.stepId,
            completedAt: now(),
            outputs: toJson(outputs),
            metrics: toJson(metrics)
        )

        // Record step completion event
        recordEvent(ctx, "STEP_COMPLETED", {
            stepId: step.stepId,
            duration: now() - stepStartTime
        })

        RETURN StepResult(
            stepId: step.stepId,
            status: "COMPLETED",
            startTime: stepStartTime,
            endTime: now(),
            outputs: outputs,
            metrics: metrics,
            errors: []
        )

    CATCH Exception e:
        errors.append(StepError(e.type, e.message, e.stackTrace))

        ruvvector.execute("""
            UPDATE {namespace}_step_states
            SET status = 'FAILED', completed_at = :completedAt, errors = :errors
            WHERE step_id = :stepId
        """.replace("{namespace}", ctx.stateNamespace),
            stepId: step.stepId,
            completedAt: now(),
            errors: toJson(errors)
        )

        recordEvent(ctx, "STEP_FAILED", {
            stepId: step.stepId,
            error: e.message
        })

        THROW StepExecutionError(step.stepId, e)
```

### 5.3 Agent Invocation

```pseudocode
FUNCTION executeAgentInvocation(
    ctx: ExecutionContext,
    step: WorkflowStep,
    agent: AgentInstance
) -> AgentInvocationResult:
    // INV-IN-001: External systems MUST be accessed only via declared integrations
    // GUA-COR-003: All agent invocations follow invocationSpec

    invocationId = generateUUID()
    invocationStartTime = now()

    // Record invocation start
    ruvvector.execute("""
        INSERT INTO {namespace}_agent_invocations (
            invocation_id, agent_id, step_id, started_at, status
        ) VALUES (:invocationId, :agentId, :stepId, :startedAt, 'EXECUTING')
    """.replace("{namespace}", ctx.stateNamespace),
        invocationId: invocationId,
        agentId: agent.agentId,
        stepId: step.stepId,
        startedAt: invocationStartTime
    )

    // Build prompt from template and step inputs
    prompt = renderPromptTemplate(
        agent.invocationSpec.promptTemplate,
        step.inputs,
        ctx
    )

    // Use deterministic random for any randomness in invocation
    // GUA-REP-002: Random operations use deterministicSeed
    IF agent.invocationSpec.temperature > 0:
        // Log the random seed used
        randomValue = ctx.randomGenerator.next()
        ruvvector.execute("""
            INSERT INTO {namespace}_randomness_log (operation, random_value, used_at)
            VALUES (:operation, :randomValue, :usedAt)
        """.replace("{namespace}", ctx.stateNamespace),
            operation: "agent_invocation:" + invocationId,
            randomValue: toBytes(randomValue),
            usedAt: now()
        )

    TRY:
        // Make LLM call
        response = agent.llmClient.invoke(
            model: agent.invocationSpec.modelId,
            prompt: prompt,
            maxTokens: agent.invocationSpec.maxTokens,
            temperature: agent.invocationSpec.temperature,
            stopSequences: agent.invocationSpec.stopSequences,
            seed: ctx.randomGenerator.currentSeed()  // For reproducibility
        )

        invocationEndTime = now()

        // Record successful invocation
        ruvvector.execute("""
            UPDATE {namespace}_agent_invocations
            SET completed_at = :completedAt,
                input_tokens = :inputTokens,
                output_tokens = :outputTokens,
                latency_ms = :latencyMs,
                status = 'COMPLETED',
                response = :response
            WHERE invocation_id = :invocationId
        """.replace("{namespace}", ctx.stateNamespace),
            invocationId: invocationId,
            completedAt: invocationEndTime,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            latencyMs: (invocationEndTime - invocationStartTime).toMillis(),
            response: toJson(response)
        )

        // Capture metrics
        recordMetric(ctx, "agent.invocation.tokens.input", response.usage.inputTokens, {
            agentId: agent.agentId,
            stepId: step.stepId
        })
        recordMetric(ctx, "agent.invocation.tokens.output", response.usage.outputTokens, {
            agentId: agent.agentId,
            stepId: step.stepId
        })
        recordMetric(ctx, "agent.invocation.latency_ms", (invocationEndTime - invocationStartTime).toMillis(), {
            agentId: agent.agentId,
            stepId: step.stepId
        })

        RETURN AgentInvocationResult(
            invocationId: invocationId,
            output: response.content,
            metrics: {
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                latencyMs: (invocationEndTime - invocationStartTime).toMillis()
            }
        )

    CATCH LLMError e:
        ruvvector.execute("""
            UPDATE {namespace}_agent_invocations
            SET completed_at = :completedAt,
                status = 'FAILED',
                error_message = :errorMessage
            WHERE invocation_id = :invocationId
        """.replace("{namespace}", ctx.stateNamespace),
            invocationId: invocationId,
            completedAt: now(),
            errorMessage: e.message
        )

        THROW AgentInvocationError(agent.agentId, e.message)
```

### 5.4 Integration Call

```pseudocode
FUNCTION executeIntegrationCall(
    ctx: ExecutionContext,
    step: WorkflowStep,
    connection: IntegrationConnection
) -> IntegrationCallResult:
    // INV-IN-001: External systems MUST be accessed only via declared integrations
    // INV-IN-002: Integration calls MUST be idempotent or explicitly marked non-idempotent
    // INV-IN-003: All external calls MUST be captured in telemetry

    callId = generateUUID()
    callStartTime = now()

    // Build request from step definition
    request = IntegrationRequest(
        method: step.integrationMethod,
        path: step.integrationPath,
        parameters: step.integrationParams,
        body: step.integrationBody,
        headers: step.integrationHeaders,
        idempotencyKey: step.idempotencyKey OR callId
    )

    // Record call start
    ruvvector.execute("""
        INSERT INTO {namespace}_integration_calls (
            call_id, integration_id, step_id, called_at, status, request
        ) VALUES (:callId, :integrationId, :stepId, :calledAt, 'EXECUTING', :request)
    """.replace("{namespace}", ctx.stateNamespace),
        callId: callId,
        integrationId: connection.integrationId,
        stepId: step.stepId,
        calledAt: callStartTime,
        request: toJson(request)
    )

    TRY:
        // Execute integration call with retry for transient failures
        response = connection.execute(request)

        callEndTime = now()

        // Record successful call
        ruvvector.execute("""
            UPDATE {namespace}_integration_calls
            SET completed_at = :completedAt,
                latency_ms = :latencyMs,
                status = 'COMPLETED',
                response = :response
            WHERE call_id = :callId
        """.replace("{namespace}", ctx.stateNamespace),
            callId: callId,
            completedAt: callEndTime,
            latencyMs: (callEndTime - callStartTime).toMillis(),
            response: toJson(response)
        )

        // Capture metrics
        recordMetric(ctx, "integration.call.latency_ms", (callEndTime - callStartTime).toMillis(), {
            integrationId: connection.integrationId,
            stepId: step.stepId
        })
        recordMetric(ctx, "integration.call.status", response.statusCode, {
            integrationId: connection.integrationId,
            stepId: step.stepId
        })

        RETURN IntegrationCallResult(
            callId: callId,
            output: response.body,
            metrics: {
                latencyMs: (callEndTime - callStartTime).toMillis(),
                statusCode: response.statusCode
            }
        )

    CATCH IntegrationError e:
        // INV-IN-004: Integration failures MUST NOT corrupt execution state
        ruvvector.execute("""
            UPDATE {namespace}_integration_calls
            SET completed_at = :completedAt,
                status = 'FAILED',
                error_message = :errorMessage
            WHERE call_id = :callId
        """.replace("{namespace}", ctx.stateNamespace),
            callId: callId,
            completedAt: now(),
            errorMessage: e.message
        )

        THROW IntegrationCallError(connection.integrationId, e.message)
```

### 5.5 Checkpoint Creation

```pseudocode
FUNCTION createCheckpoint(
    ctx: ExecutionContext,
    checkpointDef: CheckpointDefinition,
    stepResult: StepResult
) -> Checkpoint:
    // GUA-REP-003: State snapshots enable point-in-time replay

    snapshotId = generateUUID()

    // Capture current state
    stateSnapshot = captureCurrentState(ctx)
    snapshotData = serialize(stateSnapshot)
    snapshotHash = computeSHA256(snapshotData)

    // Store checkpoint
    ruvvector.execute("""
        INSERT INTO {namespace}_state_snapshots (
            snapshot_id, checkpoint_id, step_id, snapshot_data, snapshot_hash, created_at
        ) VALUES (:snapshotId, :checkpointId, :stepId, :snapshotData, :snapshotHash, :createdAt)
    """.replace("{namespace}", ctx.stateNamespace),
        snapshotId: snapshotId,
        checkpointId: checkpointDef.checkpointId,
        stepId: stepResult.stepId,
        snapshotData: snapshotData,
        snapshotHash: snapshotHash,
        createdAt: now()
    )

    recordEvent(ctx, "CHECKPOINT_CREATED", {
        checkpointId: checkpointDef.checkpointId,
        stepId: stepResult.stepId,
        snapshotHash: snapshotHash
    })

    RETURN Checkpoint(
        checkpointId: checkpointDef.checkpointId,
        snapshotId: snapshotId,
        snapshotHash: snapshotHash
    )
```

---

## 6. Phase 4: Observation

### 6.1 Metrics Aggregation

```pseudocode
FUNCTION aggregateMetrics(ctx: ExecutionContext, plan: SimulationPlan) -> CapturedMetrics:
    // Aggregate all captured metrics according to observability requirements

    capturedMetrics = []

    FOR EACH metricDef IN plan.observability.metricsToCapture:
        // Query metrics from ruvvector-postgres
        rawMetrics = ruvvector.query("""
            SELECT metric_name, metric_value, labels, captured_at
            FROM {namespace}_metrics
            WHERE metric_name LIKE :pattern
            ORDER BY captured_at
        """.replace("{namespace}", ctx.stateNamespace),
            pattern: metricDef.namePattern
        )

        // Apply aggregation function
        aggregatedValue = SWITCH metricDef.aggregation:
            CASE "SUM": rawMetrics.sum(m => m.metric_value)
            CASE "AVG": rawMetrics.average(m => m.metric_value)
            CASE "MAX": rawMetrics.max(m => m.metric_value)
            CASE "MIN": rawMetrics.min(m => m.metric_value)
            CASE "COUNT": rawMetrics.count()
            CASE "P50": rawMetrics.percentile(50)
            CASE "P95": rawMetrics.percentile(95)
            CASE "P99": rawMetrics.percentile(99)
            CASE "HISTOGRAM": rawMetrics.histogram(metricDef.buckets)
            DEFAULT: rawMetrics.values()

        capturedMetrics.append(CapturedMetric(
            metricId: metricDef.metricId,
            metricName: metricDef.name,
            aggregationType: metricDef.aggregation,
            value: aggregatedValue,
            sampleCount: rawMetrics.count(),
            timeRange: {
                start: rawMetrics.first().captured_at,
                end: rawMetrics.last().captured_at
            }
        ))

    RETURN capturedMetrics
```

### 6.2 Event Log Compilation

```pseudocode
FUNCTION compileEventLog(ctx: ExecutionContext, plan: SimulationPlan) -> CapturedEvents:
    // Compile all events matching the observability requirements

    capturedEvents = []

    // Get all relevant event types
    eventTypes = plan.observability.eventsToRecord.map(e => e.eventType)

    // Query events from ruvvector-postgres
    events = ruvvector.query("""
        SELECT event_id, event_type, event_data, occurred_at
        FROM {namespace}_events
        WHERE event_type = ANY(:eventTypes)
        ORDER BY occurred_at
    """.replace("{namespace}", ctx.stateNamespace),
        eventTypes: eventTypes
    )

    FOR EACH event IN events:
        capturedEvents.append(CapturedEvent(
            eventId: event.event_id,
            eventType: event.event_type,
            data: fromJson(event.event_data),
            occurredAt: event.occurred_at
        ))

    RETURN capturedEvents
```

### 6.3 Trace Assembly

```pseudocode
FUNCTION assembleTraces(ctx: ExecutionContext, plan: SimulationPlan) -> CapturedTraces:
    // Assemble distributed traces from execution data

    IF NOT plan.observability.tracingConfig.enabled:
        RETURN []

    traces = []

    // Build trace from step execution sequence
    stepStates = ruvvector.query("""
        SELECT step_id, status, started_at, completed_at
        FROM {namespace}_step_states
        WHERE started_at IS NOT NULL
        ORDER BY started_at
    """.replace("{namespace}", ctx.stateNamespace))

    // Create root span for execution
    rootSpan = TraceSpan(
        spanId: ctx.executionId,
        traceId: ctx.executionId,
        operationName: "execution:" + ctx.planRef.planId,
        startTime: ctx.startTime,
        endTime: now(),
        tags: {
            "execution.plan_id": ctx.planRef.planId,
            "execution.plan_hash": ctx.planRef.planHash
        }
    )

    childSpans = []

    FOR EACH stepState IN stepStates:
        // Create span for each step
        stepSpan = TraceSpan(
            spanId: stepState.step_id,
            traceId: ctx.executionId,
            parentSpanId: ctx.executionId,
            operationName: "step:" + stepState.step_id,
            startTime: stepState.started_at,
            endTime: stepState.completed_at,
            tags: {
                "step.status": stepState.status
            }
        )

        // Add agent invocation spans
        invocations = ruvvector.query("""
            SELECT invocation_id, agent_id, started_at, completed_at, status, latency_ms
            FROM {namespace}_agent_invocations
            WHERE step_id = :stepId
        """.replace("{namespace}", ctx.stateNamespace),
            stepId: stepState.step_id
        )

        FOR EACH inv IN invocations:
            invSpan = TraceSpan(
                spanId: inv.invocation_id,
                traceId: ctx.executionId,
                parentSpanId: stepState.step_id,
                operationName: "agent:" + inv.agent_id,
                startTime: inv.started_at,
                endTime: inv.completed_at,
                tags: {
                    "agent.id": inv.agent_id,
                    "agent.status": inv.status,
                    "agent.latency_ms": inv.latency_ms
                }
            )
            stepSpan.addChild(invSpan)

        // Add integration call spans
        calls = ruvvector.query("""
            SELECT call_id, integration_id, called_at, completed_at, status, latency_ms
            FROM {namespace}_integration_calls
            WHERE step_id = :stepId
        """.replace("{namespace}", ctx.stateNamespace),
            stepId: stepState.step_id
        )

        FOR EACH call IN calls:
            callSpan = TraceSpan(
                spanId: call.call_id,
                traceId: ctx.executionId,
                parentSpanId: stepState.step_id,
                operationName: "integration:" + call.integration_id,
                startTime: call.called_at,
                endTime: call.completed_at,
                tags: {
                    "integration.id": call.integration_id,
                    "integration.status": call.status,
                    "integration.latency_ms": call.latency_ms
                }
            )
            stepSpan.addChild(callSpan)

        childSpans.append(stepSpan)

    rootSpan.children = childSpans
    traces.append(CapturedTrace(
        traceId: ctx.executionId,
        rootSpan: rootSpan
    ))

    RETURN traces
```

### 6.4 Observability Validation

```pseudocode
FUNCTION validateObservabilityCompleteness(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    metrics: CapturedMetrics,
    events: CapturedEvents,
    traces: CapturedTraces
) -> ObservabilityValidationResult:
    // Validate that all required observability data was captured

    errors = []
    warnings = []

    // Validate required metrics are present
    FOR EACH metricDef IN plan.observability.metricsToCapture:
        IF metricDef.required:
            captured = metrics.find(m => m.metricId == metricDef.metricId)
            IF captured IS NULL:
                errors.append("Required metric missing: " + metricDef.name)
            ELSE IF captured.sampleCount == 0:
                errors.append("Required metric has no samples: " + metricDef.name)

    // Validate required events are present
    FOR EACH eventDef IN plan.observability.eventsToRecord:
        IF eventDef.required:
            matchingEvents = events.filter(e => e.eventType == eventDef.eventType)
            IF matchingEvents.isEmpty():
                errors.append("Required event type missing: " + eventDef.eventType)

    // Validate tracing completeness
    IF plan.observability.tracingConfig.enabled:
        IF traces.isEmpty():
            errors.append("Tracing enabled but no traces captured")
        ELSE:
            // Verify all steps have spans
            stepIds = plan.workflow.steps.map(s => s.stepId)
            capturedStepIds = traces.flatMap(t => t.rootSpan.children).map(s => s.spanId)
            missingSpans = stepIds.filter(id => id NOT IN capturedStepIds)
            IF NOT missingSpans.isEmpty():
                warnings.append("Steps missing trace spans: " + missingSpans.join(", "))

    RETURN ObservabilityValidationResult(
        valid: errors.isEmpty(),
        errors: errors,
        warnings: warnings
    )
```

---

## 7. Phase 5: Finalization

### 7.1 Post-Condition Evaluation

```pseudocode
FUNCTION evaluatePostConditions(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    workflowResult: WorkflowResult
) -> PostConditionResults:
    // Evaluate all post-conditions after execution completes

    results = []

    FOR EACH condition IN plan.validation.postConditions:
        evaluator = ConditionEvaluator.forType(condition.type)

        // Build evaluation context with execution results
        evalContext = {
            execution: ctx,
            workflowResult: workflowResult,
            stepResults: workflowResult.stepResults,
            state: getCurrentState(ctx)
        }

        result = evaluator.evaluate(condition, evalContext)

        results.append(ConditionResult(
            conditionId: condition.conditionId,
            passed: result.passed,
            message: result.message,
            evaluatedAt: now()
        ))

        recordEvent(ctx, "POSTCONDITION_EVALUATED", {
            conditionId: condition.conditionId,
            passed: result.passed
        })

    RETURN PostConditionResults(
        allPassed: results.all(r => r.passed),
        results: results
    )
```

### 7.2 Invariant Verification

```pseudocode
FUNCTION verifyInvariants(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    workflowResult: WorkflowResult
) -> InvariantResults:
    // Verify all invariants held throughout execution

    results = []

    FOR EACH invariant IN plan.validation.invariants:
        // Query invariant check history from execution log
        violations = ruvvector.query("""
            SELECT occurred_at, violation_data
            FROM {namespace}_invariant_violations
            WHERE invariant_id = :invariantId
        """.replace("{namespace}", ctx.stateNamespace),
            invariantId: invariant.invariantId
        )

        IF violations.isEmpty():
            results.append(InvariantResult(
                invariantId: invariant.invariantId,
                held: TRUE,
                violations: []
            ))
        ELSE:
            results.append(InvariantResult(
                invariantId: invariant.invariantId,
                held: FALSE,
                violations: violations.map(v => {
                    occurredAt: v.occurred_at,
                    data: fromJson(v.violation_data)
                })
            ))

    RETURN InvariantResults(
        allHeld: results.all(r => r.held),
        results: results
    )
```

### 7.3 Reproducibility Proof Generation

```pseudocode
FUNCTION generateReproducibilityProof(ctx: ExecutionContext) -> ReproducibilityProof:
    // GUA-REP-001: Identical inputs produce identical outputs
    // GUA-REP-004: Execution fingerprint is verifiable

    // Collect all state snapshots
    snapshots = ruvvector.query("""
        SELECT snapshot_id, checkpoint_id, step_id, snapshot_hash, created_at
        FROM {namespace}_state_snapshots
        ORDER BY created_at
    """.replace("{namespace}", ctx.stateNamespace))

    // Collect randomness log
    randomnessLog = ruvvector.query("""
        SELECT sequence_num, operation, random_value, used_at
        FROM {namespace}_randomness_log
        ORDER BY sequence_num
    """.replace("{namespace}", ctx.stateNamespace))

    // Compute execution fingerprint
    fingerprintData = {
        planHash: ctx.planRef.planHash,
        deterministicSeed: ctx.randomGenerator.initialSeed,
        snapshotHashes: snapshots.map(s => s.snapshot_hash),
        randomnessEntries: randomnessLog.map(r => {
            sequence: r.sequence_num,
            operation: r.operation,
            valueHash: computeSHA256(r.random_value)
        })
    }

    executionFingerprint = computeSHA256(canonicalize(fingerprintData))

    // Store fingerprint
    ruvvector.execute("""
        INSERT INTO {namespace}_execution_fingerprint (
            execution_id, fingerprint, computed_at
        ) VALUES (:executionId, :fingerprint, :computedAt)
    """.replace("{namespace}", ctx.stateNamespace),
        executionId: ctx.executionId,
        fingerprint: executionFingerprint,
        computedAt: now()
    )

    RETURN ReproducibilityProof(
        executionFingerprint: executionFingerprint,
        stateSnapshots: snapshots.map(s => StateSnapshot(
            snapshotId: s.snapshot_id,
            checkpointId: s.checkpoint_id,
            stepId: s.step_id,
            snapshotHash: s.snapshot_hash,
            createdAt: s.created_at
        )),
        randomnessLog: randomnessLog.map(r => RandomnessEntry(
            sequenceNum: r.sequence_num,
            operation: r.operation,
            randomValue: r.random_value,
            usedAt: r.used_at
        ))
    )
```

### 7.4 Result Assembly

```pseudocode
FUNCTION assembleSimulationResult(
    ctx: ExecutionContext,
    plan: SimulationPlan,
    workflowResult: WorkflowResult,
    metrics: CapturedMetrics,
    events: CapturedEvents,
    traces: CapturedTraces,
    preConditionResults: ConditionResult[],
    postConditionResults: ConditionResult[],
    invariantResults: InvariantResult[],
    reproducibilityProof: ReproducibilityProof
) -> SimulationResult:
    // INV-OUT-001: SimulationResult MUST be complete

    resultId = generateUUID()

    // Determine overall status
    status = SWITCH:
        CASE workflowResult.status == "COMPLETED" AND
             postConditionResults.allPassed AND
             invariantResults.allHeld:
            "COMPLETED"
        CASE workflowResult.status == "TIMEOUT":
            "TIMEOUT"
        CASE workflowResult.status == "ABORTED":
            "ABORTED"
        DEFAULT:
            "FAILED"

    // Compile agent observations
    agentObservations = compileAgentObservations(ctx, plan)

    // Compile integration observations
    integrationObservations = compileIntegrationObservations(ctx, plan)

    // Collect artifacts
    artifacts = collectArtifacts(ctx)

    result = SimulationResult(
        // Identity
        resultId: resultId,
        resultVersion: "1.0.0",
        resultHash: NULL,  // Computed after assembly

        // Provenance
        executedAt: ctx.startTime,
        executedBy: getRunnerIdentifier(),
        sourcePlan: ctx.planRef,

        // Execution Summary
        execution: ExecutionSummary(
            status: status,
            startTime: ctx.startTime,
            endTime: now(),
            duration: now() - ctx.startTime,
            deterministicSeed: ctx.randomGenerator.initialSeed
        ),

        // Step Outcomes
        stepResults: workflowResult.stepResults,

        // Agent Observations
        agentObservations: agentObservations,

        // Integration Observations
        integrationObservations: integrationObservations,

        // Telemetry
        telemetry: Telemetry(
            metrics: metrics,
            events: events,
            traces: traces
        ),

        // Validation Outcomes
        validation: ValidationOutcomes(
            preConditionResults: preConditionResults,
            postConditionResults: postConditionResults,
            invariantResults: invariantResults
        ),

        // Artifacts
        artifacts: artifacts,

        // Reproducibility Proof
        reproducibility: reproducibilityProof
    )

    // INV-OUT-003: SimulationResult MUST have valid resultHash
    result.resultHash = computeSHA256(canonicalize(result))

    RETURN result
```

### 7.5 Immutable Persistence

```pseudocode
FUNCTION persistSimulationResult(result: SimulationResult) -> PersistenceConfirmation:
    // INV-OUT-002: SimulationResult MUST be immutable after emission

    // Serialize result
    resultData = serialize(result)

    // Verify hash before persistence
    computedHash = computeSHA256(canonicalize(result))
    IF computedHash != result.resultHash:
        THROW IntegrityError("resultHash mismatch before persistence")

    // Persist to immutable store in ruvvector-postgres
    ruvvector.execute("""
        INSERT INTO simulation_results (
            result_id, result_version, result_hash,
            executed_at, executed_by, source_plan_id, source_plan_hash,
            status, duration_ms, result_data,
            created_at, immutable
        ) VALUES (
            :resultId, :resultVersion, :resultHash,
            :executedAt, :executedBy, :sourcePlanId, :sourcePlanHash,
            :status, :durationMs, :resultData,
            :createdAt, TRUE
        )
    """,
        resultId: result.resultId,
        resultVersion: result.resultVersion,
        resultHash: result.resultHash,
        executedAt: result.executedAt,
        executedBy: result.executedBy,
        sourcePlanId: result.sourcePlan.planId,
        sourcePlanHash: result.sourcePlan.planHash,
        status: result.execution.status,
        durationMs: result.execution.duration.toMillis(),
        resultData: resultData,
        createdAt: now()
    )

    // Create immutability lock
    ruvvector.execute("""
        INSERT INTO result_immutability_locks (
            result_id, locked_at, lock_reason
        ) VALUES (:resultId, :lockedAt, 'RESULT_FINALIZED')
    """,
        resultId: result.resultId,
        lockedAt: now()
    )

    // Store artifacts separately with references
    FOR EACH artifact IN result.artifacts:
        ruvvector.execute("""
            INSERT INTO simulation_artifacts (
                artifact_id, result_id, artifact_type,
                content_hash, storage_ref, created_at
            ) VALUES (:artifactId, :resultId, :artifactType, :contentHash, :storageRef, :createdAt)
        """,
            artifactId: artifact.artifactId,
            resultId: result.resultId,
            artifactType: artifact.artifactType,
            contentHash: artifact.contentHash,
            storageRef: artifact.storageRef,
            createdAt: now()
        )

    recordEvent(ctx, "RESULT_PERSISTED", {
        resultId: result.resultId,
        resultHash: result.resultHash
    })

    RETURN PersistenceConfirmation(
        resultId: result.resultId,
        resultHash: result.resultHash,
        persistedAt: now(),
        storageLocation: "ruvvector-postgres:simulation_results:" + result.resultId
    )
```

---

## 8. Error Handling Flows

### 8.1 Step Failure Handling

```pseudocode
FUNCTION handleStepFailure(
    ctx: ExecutionContext,
    step: WorkflowStep,
    error: StepExecutionError,
    plan: SimulationPlan
) -> FailureHandlingResult:
    // INV-EX-003: Execution MUST complete fully or rollback to initial state
    // INV-IN-004: Integration failures MUST NOT corrupt execution state

    // Record failure
    recordEvent(ctx, "STEP_FAILURE_HANDLING_STARTED", {
        stepId: step.stepId,
        error: error.message
    })

    // Determine failure severity
    severity = determineFailureSeverity(step, error)

    SWITCH severity:
        CASE "RECOVERABLE":
            // Try recovery actions
            IF step.retryPolicy IS NOT NULL:
                RETURN attemptRetry(ctx, step, error, plan)
            ELSE IF step.fallbackStep IS NOT NULL:
                RETURN executeFallback(ctx, step, plan)
            ELSE:
                RETURN recordAndContinue(ctx, step, error)

        CASE "CRITICAL":
            // Critical failure - prepare for rollback
            RETURN prepareRollback(ctx, step, error)

        CASE "FATAL":
            // Fatal failure - immediate abort
            abortExecution(ctx, "Fatal error in step " + step.stepId + ": " + error.message)
            THROW FatalExecutionError(step.stepId, error)
```

### 8.2 Execution Rollback

```pseudocode
FUNCTION rollbackExecution(ctx: ExecutionContext) -> RollbackResult:
    // INV-EX-003: Execution MUST complete fully or rollback to initial state

    recordEvent(ctx, "ROLLBACK_STARTED", {})

    // Find last successful checkpoint
    lastCheckpoint = ruvvector.query("""
        SELECT snapshot_id, checkpoint_id, step_id, snapshot_data
        FROM {namespace}_state_snapshots
        ORDER BY created_at DESC
        LIMIT 1
    """.replace("{namespace}", ctx.stateNamespace))

    IF lastCheckpoint IS NOT NULL:
        // Restore to checkpoint
        restoreFromCheckpoint(ctx, lastCheckpoint)
        recordEvent(ctx, "ROLLBACK_TO_CHECKPOINT", {
            checkpointId: lastCheckpoint.checkpoint_id
        })
    ELSE:
        // No checkpoint - full rollback
        cleanupExecutionState(ctx)
        recordEvent(ctx, "ROLLBACK_FULL", {})

    // Update execution status
    ruvvector.execute("""
        UPDATE execution_contexts
        SET status = 'ROLLED_BACK', completed_at = :completedAt
        WHERE execution_id = :executionId
    """,
        executionId: ctx.executionId,
        completedAt: now()
    )

    RETURN RollbackResult(
        executionId: ctx.executionId,
        rolledBackTo: lastCheckpoint?.checkpoint_id OR "INITIAL_STATE",
        rolledBackAt: now()
    )
```

### 8.3 Execution Abort

```pseudocode
FUNCTION abortExecution(ctx: ExecutionContext, reason: String):
    // Abort execution immediately

    recordEvent(ctx, "EXECUTION_ABORTED", {
        reason: reason
    })

    // Update execution status
    ruvvector.execute("""
        UPDATE execution_contexts
        SET status = 'ABORTED',
            abort_reason = :reason,
            completed_at = :completedAt
        WHERE execution_id = :executionId
    """,
        executionId: ctx.executionId,
        reason: reason,
        completedAt: now()
    )

    // Close all integration connections
    closeAllConnections(ctx)

    // Release resources
    releaseResources(ctx)
```

---

## 9. Utility Functions

### 9.1 Event Recording

```pseudocode
FUNCTION recordEvent(ctx: ExecutionContext, eventType: String, eventData: Object):
    // INV-IN-003: All external calls MUST be captured in telemetry

    eventId = generateUUID()

    ruvvector.execute("""
        INSERT INTO {namespace}_events (event_id, event_type, event_data, occurred_at)
        VALUES (:eventId, :eventType, :eventData, :occurredAt)
    """.replace("{namespace}", ctx.stateNamespace),
        eventId: eventId,
        eventType: eventType,
        eventData: toJson(eventData),
        occurredAt: now()
    )
```

### 9.2 Metric Recording

```pseudocode
FUNCTION recordMetric(ctx: ExecutionContext, metricName: String, metricValue: Number, labels: Object):
    metricId = generateUUID()

    ruvvector.execute("""
        INSERT INTO {namespace}_metrics (metric_id, metric_name, metric_value, labels, captured_at)
        VALUES (:metricId, :metricName, :metricValue, :labels, :capturedAt)
    """.replace("{namespace}", ctx.stateNamespace),
        metricId: metricId,
        metricName: metricName,
        metricValue: metricValue,
        labels: toJson(labels),
        capturedAt: now()
    )
```

### 9.3 State Capture

```pseudocode
FUNCTION captureCurrentState(ctx: ExecutionContext) -> StateData:
    // Capture all current state for checkpointing

    stepStates = ruvvector.query("""
        SELECT * FROM {namespace}_step_states
    """.replace("{namespace}", ctx.stateNamespace))

    agentInvocations = ruvvector.query("""
        SELECT * FROM {namespace}_agent_invocations
    """.replace("{namespace}", ctx.stateNamespace))

    integrationCalls = ruvvector.query("""
        SELECT * FROM {namespace}_integration_calls
    """.replace("{namespace}", ctx.stateNamespace))

    RETURN StateData(
        capturedAt: now(),
        randomGeneratorState: ctx.randomGenerator.getState(),
        stepStates: stepStates,
        agentInvocations: agentInvocations,
        integrationCalls: integrationCalls
    )
```

---

## 10. Traceability Matrix

| Specification Section | Pseudocode Section | Implementation Functions |
|-----------------------|--------------------|--------------------------|
| 3.1 SimulationPlan Schema | 3.1-3.5 | validateSchema, validateSemantics |
| 4.1 SimulationResult Schema | 7.4 | assembleSimulationResult |
| 5.1 Execution Invariants | 5.1, 5.2 | executeWorkflow, executeStep |
| 5.2 Data Invariants | 7.5 | persistSimulationResult |
| 5.3 Integration Invariants | 5.4 | executeIntegrationCall |
| 6.1 Correctness Guarantees | 5.1-5.5 | All execution functions |
| 6.2 Reproducibility Guarantees | 7.3 | generateReproducibilityProof |
| 6.3 Reliability Guarantees | 8.1-8.3 | handleStepFailure, rollbackExecution |
| 9.1 ruvvector-postgres | All sections | All ruvvector.* calls |

---

## Appendix: Function Index

| Function | Phase | Purpose |
|----------|-------|---------|
| validateSchema | Validation | Schema validation |
| validateSemantics | Validation | Semantic validation |
| validateResourceAvailability | Validation | Resource checks |
| validateIntegrationConnectivity | Validation | Connectivity tests |
| evaluatePreConditions | Validation | Pre-condition evaluation |
| createExecutionContext | Instantiation | Context creation |
| initializeState | Instantiation | State initialization |
| resolveAgentInstances | Instantiation | Agent resolution |
| establishIntegrationConnections | Instantiation | Connection establishment |
| executeWorkflow | Execution | Workflow orchestration |
| executeStep | Execution | Step execution |
| executeAgentInvocation | Execution | Agent invocation |
| executeIntegrationCall | Execution | Integration calls |
| createCheckpoint | Execution | Checkpoint creation |
| aggregateMetrics | Observation | Metric aggregation |
| compileEventLog | Observation | Event compilation |
| assembleTraces | Observation | Trace assembly |
| validateObservabilityCompleteness | Observation | Observability validation |
| evaluatePostConditions | Finalization | Post-condition evaluation |
| verifyInvariants | Finalization | Invariant verification |
| generateReproducibilityProof | Finalization | Proof generation |
| assembleSimulationResult | Finalization | Result assembly |
| persistSimulationResult | Finalization | Immutable persistence |
| handleStepFailure | Error Handling | Failure handling |
| rollbackExecution | Error Handling | Rollback execution |
| abortExecution | Error Handling | Abort execution |

---

*End of SPARC Pseudocode Document*
