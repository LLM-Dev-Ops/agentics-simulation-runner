/**
 * ADR-0001 Verification 3, 7, 8 — real execution, no fanout without
 * execution, span continuity.
 *
 * A plan with two agents and one HTTP integration is POSTed to
 * /v1/runner/plans against a stub LLM server and a stub integration endpoint.
 * Nothing here is faked on the runner side: the real AnthropicClient talks to
 * the stub LLM server, and the real HttpAdapter talks to the stub integration
 * server. The assertions are on what those stubs actually received.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'http';
import type { AddressInfo } from 'net';

import { computeObjectHash } from '../../src/core/hash-utils.js';

// ---------------------------------------------------------------------------
// Stub servers
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

/** Delay the stub LLM injects into every completion, in milliseconds. */
const LLM_STUB_DELAY_MS = 200;

function listenOn(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

const llmRequests: RecordedRequest[] = [];
const integrationRequests: RecordedRequest[] = [];
const fanoutRequests: RecordedRequest[] = [];

const llmStub = createServer(async (req, res) => {
  const body = await readBody(req);
  llmRequests.push({ method: req.method ?? '', url: req.url ?? '', body });

  await new Promise((resolve) => setTimeout(resolve, LLM_STUB_DELAY_MS));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_stub',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20241022',
      content: [{ type: 'text', text: 'stub completion' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 3 },
    })
  );
});

const integrationStub = createServer(async (req, res) => {
  const body = await readBody(req);
  integrationRequests.push({ method: req.method ?? '', url: req.url ?? '', body });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

const coreStub = createServer(async (req, res) => {
  const body = await readBody(req);
  fanoutRequests.push({ method: req.method ?? '', url: req.url ?? '', body });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
});

// ---------------------------------------------------------------------------
// Plan fixture
// ---------------------------------------------------------------------------

const PLAN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const INTENT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const PLANNER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const EXECUTION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';
const PARENT_SPAN_ID = 'a1b2c3d4e5f60718';

function buildAgent(agentId: string) {
  return {
    agentId,
    agentType: 'CONVERSATIONAL',
    name: `Agent ${agentId}`,
    configuration: { parameters: {} },
    invocationSpec: {
      provider: 'ANTHROPIC',
      modelId: 'claude-3-5-sonnet-20241022',
      promptTemplate: 'Answer: {{input}}',
      maxTokens: 256,
      temperature: 0,
    },
  };
}

/**
 * Builds the domain plan (deterministicSeed as bigint) and its wire form
 * (deterministicSeed as a decimal string). The plan hash is defined over the
 * domain form, which is what the runner reconstructs on receipt.
 */
function buildPlan(integrationBaseUrl: string) {
  const planWithoutHash = {
    planId: PLAN_ID,
    planVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    createdBy: { name: 'integration-test', version: '1.0.0', instanceId: PLANNER_ID },
    sourceIntent: { intentId: INTENT_ID, intentHash: 'c'.repeat(64) },
    executionConfig: {
      maxDuration: 300000,
      resourceLimits: { maxMemoryBytes: 512 * 1024 * 1024, maxConcurrentAgents: 2 },
      concurrencyModel: 'SEQUENTIAL',
      isolationLevel: 'READ_COMMITTED',
      deterministicSeed: BigInt(4242),
    },
    workflow: {
      steps: [
        {
          stepId: 'step-1',
          stepType: 'AGENT_INVOCATION',
          name: 'Ask agent one',
          agentRef: 'agent-1',
          inputs: {},
          critical: true,
        },
        {
          stepId: 'step-2',
          stepType: 'INTEGRATION_CALL',
          name: 'Call the integration',
          integrationRef: 'integration-1',
          inputs: {},
          critical: true,
        },
      ],
      dependencies: { edges: [{ from: 'step-1', to: 'step-2', type: 'REQUIRES' }] },
      checkpoints: [],
    },
    agents: [buildAgent('agent-1'), buildAgent('agent-2')],
    integrations: [
      {
        integrationId: 'integration-1',
        adapterType: 'HTTP_REST',
        name: 'Stub integration',
        connectionSpec: {
          baseUrl: integrationBaseUrl,
          credentialRef: 'stub-integration-key',
          timeout: 5000,
        },
        idempotent: true,
      },
    ],
    observability: {
      metricsToCapture: [],
      eventsToRecord: [],
      tracingConfig: { enabled: true, sampleRate: 1, propagateContext: true },
    },
    validation: { preConditions: [], postConditions: [], invariants: [] },
  };

  const planHash = computeObjectHash(planWithoutHash);
  const domainPlan = { ...planWithoutHash, planHash };

  return {
    ...domainPlan,
    executionConfig: {
      ...domainPlan.executionConfig,
      deterministicSeed: domainPlan.executionConfig.deterministicSeed.toString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let runner: Server;
let runnerUrl: string;
let wirePlan: ReturnType<typeof buildPlan>;

beforeAll(async () => {
  const llmPort = await listenOn(llmStub);
  const integrationPort = await listenOn(integrationStub);
  const corePort = await listenOn(coreStub);

  const integrationBaseUrl = `http://127.0.0.1:${integrationPort}`;
  wirePlan = buildPlan(integrationBaseUrl);

  // Real provider client, pointed at the stub LLM server.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-integration-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${llmPort}`;

  // Real environment-backed vault holding the integration credential.
  process.env.RUNNER_CREDENTIAL_PREFIX = 'RUNNER_CREDENTIAL_';
  process.env.RUNNER_CREDENTIAL_STUB_INTEGRATION_KEY = 'integration-secret';

  // Contain the Layer-3 fanout so we can observe it instead of calling out.
  process.env.INTELLIGENCE_CORE_URL = `http://127.0.0.1:${corePort}`;
  process.env.AUTOMATION_CORE_URL = `http://127.0.0.1:${corePort}`;
  process.env.DATA_CORE_URL = `http://127.0.0.1:${corePort}`;

  // Imported only after the environment is configured: the runner builds its
  // real execution dependencies at module load and fails closed without them.
  const { createRunnerServer } = await import('../../src/server.js');
  runner = createRunnerServer();
  const runnerPort = await listenOn(runner);
  runnerUrl = `http://127.0.0.1:${runnerPort}`;
}, 30000);

afterAll(async () => {
  for (const server of [runner, llmStub, integrationStub, coreStub]) {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

describe('Verification 3 — real execution proven', () => {
  let response: Response;
  let payload: {
    success: boolean;
    status: string;
    duration_ms: number;
    layers_executed: string[];
    spans: { span_id: string; parent_span_id?: string; name: string; duration_ms: number }[];
    error?: { stage: string; message: string };
    execution_proof?: { layers_executed: { layerId: string; durationMs: number }[] };
  };

  beforeAll(async () => {
    response = await fetch(`${runnerUrl}/v1/runner/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        execution_id: EXECUTION_ID,
        parent_span_id: PARENT_SPAN_ID,
        plan: wirePlan,
      }),
    });
    payload = await response.json();
  }, 30000);

  it('reports a completed execution', () => {
    expect(payload.error).toBeUndefined();
    expect(payload.status).toBe('completed');
    expect(payload.success).toBe(true);
    expect(response.status).toBe(200);
  });

  it('the stub LLM server actually received requests', () => {
    expect(llmRequests.length).toBeGreaterThan(0);
    expect(llmRequests.every((r) => r.method === 'POST')).toBe(true);
    expect(llmRequests[0].url).toContain('/v1/messages');
  });

  it('the stub integration endpoint actually received a request', () => {
    expect(integrationRequests.length).toBeGreaterThan(0);
  });

  it('layers_executed matches the observed stage list', () => {
    expect(payload.layers_executed).toEqual([
      'agent-resolution',
      'connection-establishment',
      'engine-dispatch',
    ]);
  });

  it('durationMs exceeds the delay the stub injected', () => {
    expect(payload.duration_ms).toBeGreaterThan(LLM_STUB_DELAY_MS);

    const resolutionLayer = payload.execution_proof?.layers_executed.find(
      (l) => l.layerId === 'agent-resolution'
    );
    expect(resolutionLayer?.durationMs).toBeGreaterThan(LLM_STUB_DELAY_MS);
  });

  it('fans out to the Layer-3 cores once a plan really executed', async () => {
    await expect
      .poll(() => fanoutRequests.length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(3);
  });
});

describe('Verification 8 — span continuity', () => {
  it('emits a child span per stage under the submitted parent span', async () => {
    const res = await fetch(`${runnerUrl}/v1/runner/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        execution_id: EXECUTION_ID,
        parent_span_id: PARENT_SPAN_ID,
        plan: wirePlan,
      }),
    });
    const payload = (await res.json()) as {
      spans: { span_id: string; parent_span_id?: string; name: string }[];
    };

    expect(payload.spans.map((s) => s.name)).toEqual([
      'agent-resolution',
      'connection-establishment',
      'engine-dispatch',
    ]);
    expect(payload.spans.every((s) => s.parent_span_id === PARENT_SPAN_ID)).toBe(true);
    expect(new Set(payload.spans.map((s) => s.span_id)).size).toBe(payload.spans.length);
  }, 30000);
});

describe('Verification 7 — no fanout without execution', () => {
  it('the deprecated flat endpoint executes nothing and does not fan out', async () => {
    // Earlier suites submitted real plans, whose fanout is fire-and-forget.
    // Wait for it to settle so this assertion measures only this request.
    let previous = -1;
    while (previous !== fanoutRequests.length) {
      previous = fanoutRequests.length;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const before = fanoutRequests.length;

    const res = await fetch(`${runnerUrl}/v1/runner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulationId: 'sim-1',
        name: 'flat payload',
        scenario: 'load-test',
      }),
    });
    const payload = (await res.json()) as { status: string; deprecated: boolean };

    expect(res.status).toBe(200);
    expect(payload.status).toBe('not_executed');
    expect(payload.deprecated).toBe(true);

    // Give any (incorrect) fanout a chance to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fanoutRequests.length).toBe(before);
  });
});

describe('Plan submission contract', () => {
  it('rejects an envelope missing execution_id', async () => {
    const res = await fetch(`${runnerUrl}/v1/runner/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: wirePlan }),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Contract validation failed');
  });

  it('rejects a plan whose agents carry no invocation spec', async () => {
    const res = await fetch(`${runnerUrl}/v1/runner/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        execution_id: EXECUTION_ID,
        plan: { ...wirePlan, agents: [{ agentId: 'a', agentType: 'CONVERSATIONAL', name: 'a' }] },
      }),
    });
    expect(res.status).toBe(400);
  });
});
