/**
 * Core Bundle Fanout Hooks
 *
 * Fires non-blocking POST calls to core bundles after a simulation
 * completes successfully. Uses Promise.allSettled so fanout failures
 * never block or alter the simulation response.
 */

// ---------------------------------------------------------------------------
// Service URL configuration (env overrides with Cloud Run defaults)
// ---------------------------------------------------------------------------

const SERVICE_URLS = {
  intelligenceCore:
    process.env.INTELLIGENCE_CORE_URL ??
    'https://intelligence-core-1062287243982.us-central1.run.app',
  automationCore:
    process.env.AUTOMATION_CORE_URL ??
    'https://automation-core-1062287243982.us-central1.run.app',
  dataCore:
    process.env.DATA_CORE_URL ??
    'https://data-core-1062287243982.us-central1.run.app',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload shape passed into fireFanout from the simulation handler. */
export interface FanoutContext {
  /** Unique execution / simulation ID */
  executionId: string;
  /** Scenario identifier (e.g. "load-test", "chaos") */
  scenario?: string;
  /** Wall-clock timing of the simulation in ms */
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  /** Layers that were executed (names / ids) */
  layersExecuted: string[];
  /** Proof hash from the execution proof */
  proofHash?: string;
  /** The runner result payload to forward to downstream services */
  payload?: unknown;
  /** Artifacts produced by the simulation */
  artifacts?: unknown;
  /** Optional parent span ID for distributed tracing */
  parentSpanId?: string;
  /** Input hash for lineage tracking */
  inputHash?: string;
  /** Output hash for lineage tracking */
  outputHash?: string;
  /** Correlation ID forwarded from the inbound request */
  correlationId?: string;
}

interface FanoutTarget {
  name: string;
  url: string;
  body: Record<string, unknown>;
}

interface FanoutOutcome {
  target: string;
  status: number | null;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Core fanout logic
// ---------------------------------------------------------------------------

/**
 * Fire non-blocking POST calls to the three core bundles.
 *
 * Uses `Promise.allSettled` — individual failures are logged at WARN
 * level and never propagate to the caller.
 */
export async function fireFanout(ctx: FanoutContext): Promise<void> {
  const timestamp = new Date().toISOString();

  const targets: FanoutTarget[] = [
    {
      name: 'intelligence-core',
      url: `${SERVICE_URLS.intelligenceCore}/v1/ingest/telemetry`,
      body: {
        source: 'agentics-simulator-runner',
        event_type: 'runner_completed',
        execution_id: ctx.executionId,
        timestamp,
        payload: ctx.payload ?? null,
      },
    },
    {
      name: 'automation-core',
      url: `${SERVICE_URLS.automationCore}/v1/orchestration/event`,
      body: {
        source: 'agentics-simulator-runner',
        event_type: 'runner_completed',
        execution_id: ctx.executionId,
        timestamp,
        payload: ctx.payload ?? null,
      },
    },
    {
      name: 'data-core',
      url: `${SERVICE_URLS.dataCore}/v1/lineage/record`,
      body: {
        source: 'agentics-simulator-runner',
        event_type: 'execution_lineage',
        execution_id: ctx.executionId,
        timestamp,
        payload: ctx.payload ?? null,
      },
    },
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ctx.correlationId) {
    headers['X-Correlation-ID'] = ctx.correlationId;
  }

  const results = await Promise.allSettled(
    targets.map((t) => postWithTiming(t, headers)),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const o = result.value;
      if (o.error) {
        console.warn(`Fanout to ${o.target}: FAILED (${o.durationMs}ms) - ${o.error}`);
      } else {
        console.info(`Fanout to ${o.target}: ${o.status} (${o.durationMs}ms)`);
      }
    } else {
      // Should not happen since postWithTiming catches internally, but guard anyway
      console.warn(`Fanout unexpected rejection: ${result.reason}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postWithTiming(
  target: FanoutTarget,
  headers: Record<string, string>,
): Promise<FanoutOutcome> {
  const start = Date.now();
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(5000), // 5 s hard cap per call
    });
    return {
      target: target.name,
      status: res.status,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      target: target.name,
      status: null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
