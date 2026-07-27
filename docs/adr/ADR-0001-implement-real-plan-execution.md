# ADR-0001: Implement Real Plan Execution and Remove Mock Defaults

**Status:** Proposed
**Date:** 2026-07-27

> See **ADR-011: Layer-4 Execution Spine Reconnection** in `agentics-enforcement`
> (`plans/adr/ADR-011-layer-4-execution-spine-reconnection.md`) for the platform-wide
> decision this ADR implements. This document covers only this repository's actions.

---

## Context

This repository is named as the executor of Layer-4 simulations. It currently executes
nothing, and reports that it did.

### The execute endpoint has an empty body

`src/server.ts:700-717`. After field and scenario validation succeed, the block commented
`--- Execute / queue the simulation ---` is an **empty `try`**:

```ts
let status: 'running' | 'completed' | 'failed' = 'running';
try {
  // Fire-and-forget style: the gateway tracks the execution.
  // For now we do a lightweight "queue" by recording the intent.
  // Full engine-backed execution can be wired via gateway.submitPlanToEngine.
  // This keeps latency low for the CLI caller.
} catch {
  status = 'failed';
}
```

`status` is therefore unconditionally `'running'` and the `catch` is unreachable. The handler
returns `{ simulationId, status: 'running', startedAt }` (`:716-717`) having dispatched nothing.

### It then fabricates telemetry and ships it to the Layer-3 cores

`src/server.ts:719-735`:

- `:730` — `layersExecuted: ['validation', 'scheduling', 'dispatch']` is a **hardcoded literal**. None of those layers ran.
- `:727-728` — `completedAt` and `durationMs` are computed microseconds after `startedAt` was assigned at `:701`, producing a near-zero duration presented as a completed simulation.
- `:734` — `fireFanout(fanoutCtx)` sends this record to `INTELLIGENCE_CORE_URL`, `AUTOMATION_CORE_URL` and `DATA_CORE_URL`, with failures swallowed by `.catch(() => {})`.

The cores are consuming **synthetic evidence of executions that never occurred**.

### The orchestration layer is mock-only — while real clients sit unused in this repo

- `src/orchestration/agent-resolver.ts:172-178` — `DefaultLLMClientFactory.createClient()` returns `new MockLLMClient(...)`. Its own comment at `:174-175` reads "In production, this would create real provider-specific clients (AnthropicClient, OpenAIClient, etc.)".
- `src/orchestration/agent-resolver.ts:141-158` — `MockLLMClient.invoke()` returns `` `Mock response for prompt: ...` `` after a 10 ms `setTimeout`.
- `src/orchestration/agent-resolver.ts:195` — the mock is the **default**: `config.llmClientFactory ?? new DefaultLLMClientFactory()`. No server path supplies a real one.
- **A real factory already exists here.** `src/surfaces/llm-client-factory.ts:133,137,141` constructs `AnthropicClient`, `OpenAIClient` and `AzureOpenAIClient` from `src/surfaces/providers/`, and is exported at `src/surfaces/index.ts:288-293`. Nothing under `src/orchestration/` imports it — the only mention is the comment at `agent-resolver.ts:175`.
- `src/orchestration/connection-establisher.ts:139-146` — `MockSecureVault` seeds hardcoded credentials `'mock-api-key-12345'` (`:141`) and `'mock-bearer-token-67890'` (`:145`).
- `src/orchestration/connection-establisher.ts:149-159` — `resolveCredential()` never fails; unknown refs return a synthesized `` `mock-resolved-${credentialRef}` ``.
- `src/orchestration/connection-establisher.ts:161-170` — `isCredentialValid()` returns `true` for unknown refs ("Assume valid in mock mode").
- `src/orchestration/connection-establisher.ts:311-312` — both mocks are **production defaults**: `config.secureVault ?? new MockSecureVault()` and `config.adapterFactory ?? new DefaultAdapterFactory()`, the latter returning `new MockIntegrationAdapter(...)` at `:252`.

### Nothing sends this repo a SimulationPlan

`agentics-simulation-planner` addresses its output to `'agentics-simulation-engine'`, a repo
that does not exist (`agentics-simulation-planner/src/types/simulation-plan.ts:266`). This
repo's live endpoint accepts an unrelated flat shape —
`{ simulationId, name, scenario, parameters }` (`src/server.ts:653-658`) — with no agents, no
integrations, and no execution graph. `AgentResolver.resolveAgentInstances(ctx, plan)`
(`src/orchestration/agent-resolver.ts:217`) takes a `SimulationPlan` that never arrives.

## Decision

**This repository becomes the sole real executor of `SimulationPlan`.** Three changes:

1. **Accept plans.** Add `POST /v1/runner/plans` taking `{ execution_id, parent_span_id, plan: SimulationPlan }`, validated against `runner/v1/plan-submission.schema.json`. The flat `POST /v1/runner` is deprecated for one release for CLI compatibility and **must not fan out to cores**.
2. **Actually execute.** Replace the empty `try` with the real pipeline: `AgentResolver` → `ConnectionEstablisher` → `gateway.submitPlanToEngine`, awaited, with `status` derived from the result.
3. **Fail closed instead of mocking.** Per ADR-011 Decision 4, no `??`-default to a mock in any server-reachable path. Real clients are built from environment configuration; if that configuration is missing, the service **fails at startup**. Mock factories remain exported for tests only.

Telemetry becomes evidence-driven: `layersExecuted`, `completedAt` and `durationMs` are
observed, never literal, and `fireFanout` is unreachable unless a plan actually executed
(ADR-011 Decision 3).

## Consequences

### Easier

- The plan structure this repo already models — agents, integrations, execution graph — finally gets exercised end to end.
- Real LLM output makes simulation results meaningful rather than echoes of the prompt.
- Fail-closed startup surfaces missing configuration at deploy time instead of hiding it behind a mock that silently returns success.
- Deleting the duplicate mock factory removes the confusing situation where two LLM factories coexist and the wrong one wins by default.

### Harder

- **Latency and cost rise sharply.** `MockLLMClient` returned in ~10 ms for free; real provider calls take seconds and are billed per token. The current endpoint's "low latency for the CLI caller" (`src/server.ts:711`) is abandoned deliberately — a fast lie is worse than a slow truth. `POST /v1/runner` will likely need to become async with a polling or callback result.
- **Layer-3 core dashboards will show a gap.** They were fed by the fabricated fanout at `:730`. That feed stops before real executions replace it.
- Every deployment environment must supply provider credentials and vault configuration or the service will not boot.
- New failure modes appear that mocks masked entirely: rate limits, provider outages, credential expiry, integration timeouts. `ConnectionErrorCode` (`src/orchestration/connection-establisher.ts:118-125`) already enumerates these but they were never reachable.
- Tests that relied on the implicit mock defaults must now inject mocks explicitly.

## Implementation Plan

### Accept and execute plans

1. Add `POST /v1/runner/plans` to the route table in `src/server.ts:784-794`, validating the body against `runner/v1/plan-submission.schema.json`.
2. Replace the empty `try` at `src/server.ts:707-714` with the real pipeline — `AgentResolver.resolveAgentInstances()` → `ConnectionEstablisher.establishConnections()` → `gateway.submitPlanToEngine` — awaiting the result and setting `status` from it. The `catch` becomes reachable and must map failures to `status = 'failed'` with a meaningful error body.
3. Build `FanoutContext` (`src/server.ts:722-733`) from the pipeline result. **Delete the hardcoded array at `:730`**; populate `layersExecuted` from the stages the pipeline actually completed. Take `completedAt` and `durationMs` from observed completion rather than computing them adjacent to `startedAt` at `:727-728`.
4. Guard `fireFanout` at `:734` so it cannot run unless a plan executed. The deprecated flat `/v1/runner` path must not reach it.
5. Replace `.catch(() => {/* swallow */})` at `:734` with structured error logging — silent fanout failure hid this bug.

### Wire real LLM clients

6. Delete `MockLLMClient` (`src/orchestration/agent-resolver.ts:125-167`) and `DefaultLLMClientFactory` (`:172-178`).
7. Change the default at `src/orchestration/agent-resolver.ts:195` to the real factory from `src/surfaces/llm-client-factory.ts`. Throw at construction if no provider credentials are configured.
8. Confirm `validateModel()` (previously a stub returning a field at `:135-139`) now performs the real provider check that `AnthropicClient` / `OpenAIClient` expose.

### Remove hardcoded mock credentials

9. Delete `MockSecureVault` (`src/orchestration/connection-establisher.ts:134-175`) and `MockIntegrationAdapter` (`:180-`), including the hardcoded `'mock-api-key-12345'` (`:141`) and `'mock-bearer-token-67890'` (`:145`).
10. Change the defaults at `src/orchestration/connection-establisher.ts:311-312` to real vault and adapter implementations; throw at construction if vault configuration is absent.
11. Remove the permissive fallbacks: `resolveCredential()` must throw `CREDENTIAL_NOT_FOUND` instead of synthesizing a credential (`:152-156`), and `isCredentialValid()` must return `false` for unknown references instead of `true` (`:163-164`).
12. Retain `createMockSecureVault()` (`:578`) as a **test-only** export; ensure no `src/` file outside `test/` imports it.

## Verification

1. **The empty block is gone.** `src/server.ts` contains no `try {}` whose body is only comments. A CI hook (per `agentics-enforcement` ADR-010) fails the build on empty `try` blocks.
2. **No fabricated telemetry.** `grep -n "layersExecuted: \[" src/server.ts` returns nothing. A CI hook fails on any array literal assigned to `layersExecuted`.
3. **Real execution proven.** Integration test: POST a `SimulationPlan` with two agents and one HTTP integration to `/v1/runner/plans` against a stub LLM server and a stub integration endpoint. Assert both stubs received requests, `layersExecuted` matches the observed stage list, and `durationMs` exceeds the stub's injected 200 ms delay. **The current code returns `durationMs` near 0 and would fail this test.**
4. **No mock defaults.** `grep -rn "?? new Mock" src/` returns nothing. Constructing `AgentResolver` and `ConnectionEstablisher` with an empty config in an unconfigured environment throws rather than silently mocking.
5. **Credentials fail closed.** Assert `resolveCredential('nonexistent')` throws `CREDENTIAL_NOT_FOUND` rather than returning `mock-resolved-nonexistent`. Assert no source file under `src/` contains the string `mock-api-key-12345`.
6. **Real factory is wired.** Assert `src/orchestration/agent-resolver.ts` imports from `../surfaces/llm-client-factory.js`, and that a resolved agent's client is an `AnthropicClient` or `OpenAIClient` instance — not a mock.
7. **No fanout without execution.** Unit test: invoke the deprecated flat `/v1/runner` path and assert `fireFanout` is never called.
8. **Span continuity.** A plan submitted with `execution_id` and `parent_span_id` produces child spans under that parent for agent resolution, connection establishment and dispatch, satisfying `agentics-enforcement` ADR-009.
