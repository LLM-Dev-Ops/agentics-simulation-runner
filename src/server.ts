/**
 * HTTP Server for Cloud Run deployment
 *
 * Exposes the /v1/runner endpoint for simulation execution.
 * Designed for Cloud Run with health checks and graceful shutdown.
 *
 * CONTRACT ENFORCEMENT:
 * This is the SINGLE validation boundary for all incoming requests.
 * All simulation requests are validated using Ajv against the
 * simulation/v1/request.schema.json contract BEFORE any execution
 * logic runs.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { randomBytes } from 'crypto';
import { pathToFileURL } from 'url';
import { createExecutionGateway, DEFAULT_GATEWAY_CONFIG } from './api/execution-gateway.js';
import type { SimulationPlan } from './types/simulation-plan.js';
import type { SimulationPlan as ExecutionPlan } from './types/plan.js';
import { v4 as uuidv4 } from 'uuid';
import {
  getContractValidator,
  getPlanSubmissionValidator,
  ContractValidationException,
  createExecutionProof,
  type LayerExecuted,
  type ExecutionGraphNode,
  type ExecutionProof,
} from './contracts/index.js';
import { fireFanout, type FanoutContext } from './hooks/core-fanout.js';
import { createAgentResolver } from './orchestration/agent-resolver.js';
import { createConnectionEstablisher } from './orchestration/connection-establisher.js';
import {
  executePlan,
  deserializePlan,
  toLayersExecuted,
  PlanDeserializationError,
  type PipelineStageRecord,
  type PlanExecutionDependencies,
} from './orchestration/plan-execution-pipeline.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Initialize the execution gateway
const gateway = createExecutionGateway({
  runnerName: 'agentics-runner',
  runnerVersion: '1.0.0',
  runnerInstanceId: uuidv4(),
  defaultTimeout: 300000,
  maxConcurrentExecutions: 100,
});

// Initialize the contract validators (single instance each)
const contractValidator = getContractValidator();
const planSubmissionValidator = getPlanSubmissionValidator();

/**
 * Real execution dependencies.
 *
 * Constructed at module load so a deployment with no provider credentials or
 * no vault configuration fails at startup rather than silently mocking
 * (ADR-0001 Decision 3).
 */
const pipelineDeps: PlanExecutionDependencies = {
  gateway,
  agentResolver: createAgentResolver(),
  connectionEstablisher: createConnectionEstablisher(),
};

const STAGE_LAYER_TYPE: Record<PipelineStageRecord['stage'], LayerExecuted['layerType']> = {
  'agent-resolution': 'execution',
  'connection-establishment': 'execution',
  'engine-dispatch': 'dispatch',
};

/** Generate a W3C trace-context compatible span id */
function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Parse JSON body from request
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response with optional execution proof
 */
function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  executionProof?: ExecutionProof
): void {
  const responseData = executionProof
    ? { ...(data as object), execution_proof: executionProof }
    : data;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseData));
}

/**
 * Create a layer execution record
 */
function createLayerRecord(
  layerId: string,
  layerType: LayerExecuted['layerType'],
  startTime: number,
  status: LayerExecuted['status'],
  details?: Record<string, unknown>
): LayerExecuted {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;
  return {
    layerId,
    layerType,
    startedAt: new Date(startTime).toISOString(),
    completedAt,
    durationMs,
    status,
    details,
  };
}

/**
 * Validate request against contract schema
 *
 * This is the SINGLE validation boundary. All incoming simulation
 * requests MUST pass this validation before any execution logic.
 *
 * @param body - Request body to validate
 * @throws ContractValidationException if validation fails
 */
function validateRequestContract(body: unknown): void {
  contractValidator.validateOrThrow(body);
}

/**
 * Handle POST /v1/runner/plans - submit a SimulationPlan for real execution
 *
 * Body: { execution_id, parent_span_id?, plan }
 * Validated against runner/v1/plan-submission.schema.json (envelope) and
 * simulation/v1/request.schema.json (plan).
 *
 * The plan is executed by the real pipeline. Telemetry — layers executed,
 * completion time, duration — is taken from what the pipeline observed, and
 * fanout to the Layer-3 cores happens only if a plan actually executed.
 */
async function handlePlanSubmission(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const proofId = uuidv4();
  const requestStartTime = Date.now();
  const layers: LayerExecuted[] = [];
  const graphNodes: ExecutionGraphNode[] = [];
  const graphEdges: { from: string; to: string; type: 'dependency' | 'sequence' | 'parallel' }[] = [];

  const body = (await parseBody(req)) as {
    execution_id?: string;
    parent_span_id?: string;
    plan?: unknown;
  };

  // --- Envelope + plan contract validation ---
  const validationStartTime = Date.now();
  let plan;
  try {
    planSubmissionValidator.validateOrThrow(body);
    plan = deserializePlan(body.plan);
  } catch (error) {
    if (error instanceof PlanDeserializationError) {
      sendJson(res, 400, { success: false, error: error.message, code: error.code });
      return;
    }
    if (error instanceof ContractValidationException) {
      layers.push(
        createLayerRecord('contract-validation', 'validation', validationStartTime, 'error', {
          errors: error.result.errors.slice(0, 10),
        })
      );
      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(
        res,
        400,
        {
          success: false,
          error: 'Contract validation failed',
          validation_errors: error.result.errors,
          schema_id: error.result.schemaId,
        },
        proof
      );
      return;
    }
    throw error;
  }

  layers.push(
    createLayerRecord('contract-validation', 'validation', validationStartTime, 'success', {
      schemaId: planSubmissionValidator.getSchemaInfo().id,
    })
  );
  graphNodes.push({
    nodeId: 'contract-validation',
    nodeType: 'checkpoint',
    status: 'completed',
    startedAt: new Date(validationStartTime).toISOString(),
    completedAt: new Date().toISOString(),
    parentNodes: [],
    childNodes: [],
  });

  // --- Real execution ---
  const parentSpanId = body.parent_span_id;
  const outcome = await executePlan(pipelineDeps, {
    plan,
    executionId: body.execution_id,
    parentSpanId,
  });

  // Layers and spans are derived from the stages that actually ran.
  const spans = outcome.stagesExecuted.map((stage) => ({
    span_id: newSpanId(),
    parent_span_id: parentSpanId,
    name: stage.stage,
    started_at: stage.startedAt,
    completed_at: stage.completedAt,
    duration_ms: stage.durationMs,
    status: stage.status,
  }));

  let previousNodeId = 'contract-validation';
  for (const stage of outcome.stagesExecuted) {
    layers.push({
      layerId: stage.stage,
      layerType: STAGE_LAYER_TYPE[stage.stage],
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      durationMs: stage.durationMs,
      status: stage.status,
      details: stage.details,
    });
    graphNodes.push({
      nodeId: stage.stage,
      nodeType: 'step',
      status: stage.status === 'success' ? 'completed' : 'failed',
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      parentNodes: [previousNodeId],
      childNodes: [],
    });
    graphEdges.push({ from: previousNodeId, to: stage.stage, type: 'sequence' });
    previousNodeId = stage.stage;
  }

  const layersExecuted = toLayersExecuted(outcome.stagesExecuted);
  const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);

  const responseBody = {
    success: outcome.status === 'completed',
    execution_id: outcome.executionId,
    status: outcome.status,
    started_at: outcome.startedAt,
    completed_at: outcome.completedAt,
    duration_ms: outcome.durationMs,
    layers_executed: layersExecuted,
    spans,
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.engineResult
      ? {
          execution_metadata: {
            resultId: outcome.engineResult.handle.executionId,
            planId: outcome.engineResult.engineResult.executionId,
            planVersion: '1.0.0',
            startedAt: outcome.engineResult.engineResult.startedAt,
            completedAt: outcome.engineResult.engineResult.completedAt,
            durationMs: outcome.engineResult.engineResult.durationMs,
            status: outcome.engineResult.engineResult.status,
            executedBy: 'agentics-simulation-runner',
            environment: {
              hostname: 'agentics-runner',
              version: '1.0.0',
              region: process.env.CLOUD_RUN_REGION || 'local',
            },
          },
        }
      : {}),
  };

  sendJson(res, outcome.status === 'completed' ? 200 : 502, responseBody, proof);

  // Fanout is reachable only when a plan actually executed (ADR-0001).
  if (outcome.status !== 'completed') {
    return;
  }

  const correlationId = req.headers['x-correlation-id'];
  const fanoutCtx: FanoutContext = {
    executionId: outcome.executionId,
    timing: {
      startedAt: outcome.startedAt,
      completedAt: outcome.completedAt,
      durationMs: outcome.durationMs,
    },
    layersExecuted,
    proofHash: proof.proofId,
    payload: responseBody,
    artifacts: outcome.engineResult?.engineResult.artifacts,
    parentSpanId,
    correlationId: typeof correlationId === 'string' ? correlationId : undefined,
  };
  fireFanout(fanoutCtx).catch((error) => {
    console.error(
      `[fanout] failed for execution ${outcome.executionId} after ${Date.now() - requestStartTime}ms:`,
      error
    );
  });
}

/**
 * Handle /v1/runner endpoints
 */
async function handleRunner(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method?.toUpperCase();
  const requestStartTime = Date.now();
  const layers: LayerExecuted[] = [];
  const graphNodes: ExecutionGraphNode[] = [];
  const graphEdges: { from: string; to: string; type: 'dependency' | 'sequence' | 'parallel' }[] = [];

  // POST /v1/runner/submit - Submit a simulation plan
  if (path === '/v1/runner/submit' && method === 'POST') {
    const proofId = uuidv4();
    try {
      const body = await parseBody(req);

      // ===================================================================
      // CONTRACT ENFORCEMENT: Validation at HTTP Boundary
      // This is the ONLY place where schema validation occurs
      // ===================================================================
      const validationStartTime = Date.now();
      try {
        validateRequestContract(body);
        layers.push(createLayerRecord(
          'contract-validation',
          'validation',
          validationStartTime,
          'success',
          { schemaId: contractValidator.getSchemaInfo().id }
        ));
        graphNodes.push({
          nodeId: 'contract-validation',
          nodeType: 'checkpoint',
          status: 'completed',
          startedAt: new Date(validationStartTime).toISOString(),
          completedAt: new Date().toISOString(),
          parentNodes: [],
          childNodes: ['scheduling'],
        });
      } catch (error) {
        if (error instanceof ContractValidationException) {
          layers.push(createLayerRecord(
            'contract-validation',
            'validation',
            validationStartTime,
            'error',
            { errors: error.result.errors.slice(0, 10) }
          ));
          graphNodes.push({
            nodeId: 'contract-validation',
            nodeType: 'checkpoint',
            status: 'failed',
            startedAt: new Date(validationStartTime).toISOString(),
            completedAt: new Date().toISOString(),
            parentNodes: [],
            childNodes: [],
          });

          // Include execution_metadata for contract validation errors
          const contractValidationErrorTime = new Date().toISOString();
          const contractValidationMetadata = {
            resultId: proofId,
            planId: proofId,
            planVersion: '1.0.0',
            startedAt: new Date(requestStartTime).toISOString(),
            completedAt: contractValidationErrorTime,
            durationMs: Date.now() - requestStartTime,
            status: 'failed' as const,
            executedBy: 'agentics-simulation-runner',
            environment: {
              hostname: 'agentics-runner',
              version: '1.0.0',
              region: process.env.CLOUD_RUN_REGION || 'local',
            },
          };

          const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
          sendJson(res, 400, {
            success: false,
            error: 'Contract validation failed',
            validation_errors: error.result.errors,
            schema_id: error.result.schemaId,
            execution_metadata: contractValidationMetadata,
          }, proof);
          return;
        }
        throw error;
      }

      // ===================================================================
      // SCHEDULING LAYER
      // ===================================================================
      const schedulingStartTime = Date.now();
      layers.push(createLayerRecord(
        'scheduling',
        'scheduling',
        schedulingStartTime,
        'success'
      ));
      graphNodes.push({
        nodeId: 'scheduling',
        nodeType: 'step',
        status: 'completed',
        startedAt: new Date(schedulingStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['contract-validation'],
        childNodes: ['dispatch'],
      });
      graphEdges.push({ from: 'contract-validation', to: 'scheduling', type: 'sequence' });

      // ===================================================================
      // DISPATCH LAYER
      // ===================================================================
      const dispatchStartTime = Date.now();
      const handle = await gateway.submitPlan(body as SimulationPlan);
      layers.push(createLayerRecord(
        'dispatch',
        'dispatch',
        dispatchStartTime,
        'success',
        { executionId: handle.executionId }
      ));
      graphNodes.push({
        nodeId: 'dispatch',
        nodeType: 'step',
        status: 'completed',
        startedAt: new Date(dispatchStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['scheduling'],
        childNodes: [],
      });
      graphEdges.push({ from: 'scheduling', to: 'dispatch', type: 'sequence' });

      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(res, 202, {
        success: true,
        handle,
        message: 'Simulation plan submitted successfully',
      }, proof);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(res, 400, { success: false, error: message }, proof);
    }
    return;
  }

  // POST /v1/runner/execute - Submit and execute via engine
  if (path === '/v1/runner/execute' && method === 'POST') {
    const proofId = uuidv4();
    try {
      const body = await parseBody(req) as { plan: unknown; options?: unknown };

      // ===================================================================
      // CONTRACT ENFORCEMENT: Validation at HTTP Boundary
      // ===================================================================
      const validationStartTime = Date.now();
      try {
        validateRequestContract(body.plan);
        layers.push(createLayerRecord(
          'contract-validation',
          'validation',
          validationStartTime,
          'success',
          { schemaId: contractValidator.getSchemaInfo().id }
        ));
        graphNodes.push({
          nodeId: 'contract-validation',
          nodeType: 'checkpoint',
          status: 'completed',
          startedAt: new Date(validationStartTime).toISOString(),
          completedAt: new Date().toISOString(),
          parentNodes: [],
          childNodes: ['scheduling'],
        });
      } catch (error) {
        if (error instanceof ContractValidationException) {
          layers.push(createLayerRecord(
            'contract-validation',
            'validation',
            validationStartTime,
            'error',
            { errors: error.result.errors.slice(0, 10) }
          ));
          graphNodes.push({
            nodeId: 'contract-validation',
            nodeType: 'checkpoint',
            status: 'failed',
            startedAt: new Date(validationStartTime).toISOString(),
            completedAt: new Date().toISOString(),
            parentNodes: [],
            childNodes: [],
          });

          // Include execution_metadata for contract validation errors
          const contractValidationErrorTime = new Date().toISOString();
          const contractValidationMetadata = {
            resultId: proofId,
            planId: proofId,
            planVersion: '1.0.0',
            startedAt: new Date(requestStartTime).toISOString(),
            completedAt: contractValidationErrorTime,
            durationMs: Date.now() - requestStartTime,
            status: 'failed' as const,
            executedBy: 'agentics-simulation-runner',
            environment: {
              hostname: 'agentics-runner',
              version: '1.0.0',
              region: process.env.CLOUD_RUN_REGION || 'local',
            },
          };

          const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
          sendJson(res, 400, {
            success: false,
            error: 'Contract validation failed',
            validation_errors: error.result.errors,
            schema_id: error.result.schemaId,
            execution_metadata: contractValidationMetadata,
          }, proof);
          return;
        }
        throw error;
      }

      // ===================================================================
      // SCHEDULING LAYER
      // ===================================================================
      const schedulingStartTime = Date.now();
      layers.push(createLayerRecord(
        'scheduling',
        'scheduling',
        schedulingStartTime,
        'success'
      ));
      graphNodes.push({
        nodeId: 'scheduling',
        nodeType: 'step',
        status: 'completed',
        startedAt: new Date(schedulingStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['contract-validation'],
        childNodes: ['dispatch'],
      });
      graphEdges.push({ from: 'contract-validation', to: 'scheduling', type: 'sequence' });

      // ===================================================================
      // DISPATCH LAYER
      // ===================================================================
      const dispatchStartTime = Date.now();
      layers.push(createLayerRecord(
        'dispatch',
        'dispatch',
        dispatchStartTime,
        'success'
      ));
      graphNodes.push({
        nodeId: 'dispatch',
        nodeType: 'step',
        status: 'completed',
        startedAt: new Date(dispatchStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['scheduling'],
        childNodes: ['execution'],
      });
      graphEdges.push({ from: 'scheduling', to: 'dispatch', type: 'sequence' });

      // ===================================================================
      // EXECUTION LAYER
      // ===================================================================
      const executionStartTime = Date.now();
      const result = await gateway.submitPlanToEngine(body.plan as ExecutionPlan, body.options as never);
      layers.push(createLayerRecord(
        'execution',
        'execution',
        executionStartTime,
        'success',
        { executionId: result.handle.executionId }
      ));
      graphNodes.push({
        nodeId: 'execution',
        nodeType: 'step',
        status: 'completed',
        startedAt: new Date(executionStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['dispatch'],
        childNodes: ['finalization'],
      });
      graphEdges.push({ from: 'dispatch', to: 'execution', type: 'sequence' });

      // ===================================================================
      // FINALIZATION LAYER
      // ===================================================================
      const finalizationStartTime = Date.now();
      layers.push(createLayerRecord(
        'finalization',
        'finalization',
        finalizationStartTime,
        'success'
      ));
      graphNodes.push({
        nodeId: 'finalization',
        nodeType: 'checkpoint',
        status: 'completed',
        startedAt: new Date(finalizationStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        parentNodes: ['execution'],
        childNodes: [],
      });
      graphEdges.push({ from: 'execution', to: 'finalization', type: 'sequence' });

      // ===================================================================
      // CONSTRUCT EXECUTION_METADATA
      // The CLI expects execution_metadata in the response. Construct it
      // from the engine result data as the runner is the execution boundary.
      // ===================================================================
      const executionMetadata = {
        resultId: result.handle.executionId,
        planId: result.engineResult.executionId,
        planVersion: '1.0.0',
        startedAt: result.engineResult.startedAt,
        completedAt: result.engineResult.completedAt,
        durationMs: result.engineResult.durationMs,
        status: result.engineResult.status,
        executedBy: 'agentics-simulation-runner',
        environment: {
          hostname: 'agentics-runner',
          version: '1.0.0',
          region: process.env.CLOUD_RUN_REGION || 'local',
        },
      };

      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      const responseBody = {
        success: true,
        result,
        execution_metadata: executionMetadata,
      };
      sendJson(res, 200, responseBody, proof);

      // Fire non-blocking fanout to core bundles
      const correlationId = req.headers['x-correlation-id'];
      const fanoutCtx: FanoutContext = {
        executionId: result.handle.executionId,
        timing: {
          startedAt: result.engineResult.startedAt,
          completedAt: result.engineResult.completedAt,
          durationMs: result.engineResult.durationMs,
        },
        layersExecuted: layers.map((l) => l.layerId),
        proofHash: proof.proofId,
        payload: responseBody,
        artifacts: result.engineResult.artifacts,
        correlationId: typeof correlationId === 'string' ? correlationId : undefined,
      };
      fireFanout(fanoutCtx).catch((fanoutError) => {
        console.error(
          `[fanout] failed for execution ${result.handle.executionId}:`,
          fanoutError
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorTime = new Date().toISOString();

      // Include execution_metadata even on error for CLI error reporting
      const errorExecutionMetadata = {
        resultId: proofId,
        planId: proofId,
        planVersion: '1.0.0',
        startedAt: new Date(requestStartTime).toISOString(),
        completedAt: errorTime,
        durationMs: Date.now() - requestStartTime,
        status: 'failed' as const,
        executedBy: 'agentics-simulation-runner',
        environment: {
          hostname: 'agentics-runner',
          version: '1.0.0',
          region: process.env.CLOUD_RUN_REGION || 'local',
        },
      };

      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(res, 400, {
        success: false,
        error: message,
        execution_metadata: errorExecutionMetadata,
      }, proof);
    }
    return;
  }

  // GET /v1/runner/status/:executionId - Get execution status
  if (path.startsWith('/v1/runner/status/') && method === 'GET') {
    try {
      const executionId = path.replace('/v1/runner/status/', '');
      const status = await gateway.getExecutionStatus({
        executionId: executionId as never,
        planId: '',
        planHash: '0'.repeat(64),
        submittedAt: new Date().toISOString(),
        tenantId: 'default',
      });
      sendJson(res, 200, { success: true, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 404, { success: false, error: message });
    }
    return;
  }

  // GET /v1/runner/result/:executionId - Get execution result
  if (path.startsWith('/v1/runner/result/') && method === 'GET') {
    try {
      const executionId = path.replace('/v1/runner/result/', '');
      const result = await gateway.getResult({
        executionId: executionId as never,
        planId: '',
        planHash: '0'.repeat(64),
        submittedAt: new Date().toISOString(),
        tenantId: 'default',
      }, { timeout: 0 });
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 404, { success: false, error: message });
    }
    return;
  }

  // POST /v1/runner/abort/:executionId - Abort execution
  if (path.startsWith('/v1/runner/abort/') && method === 'POST') {
    try {
      const executionId = path.replace('/v1/runner/abort/', '');
      const body = await parseBody(req) as { reason?: string };
      const result = await gateway.abortExecution({
        executionId: executionId as never,
        planId: '',
        planHash: '0'.repeat(64),
        submittedAt: new Date().toISOString(),
        tenantId: 'default',
      }, body.reason || 'User requested abort');
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 400, { success: false, error: message });
    }
    return;
  }

  // GET /v1/runner/health - Health check
  if (path === '/v1/runner/health' && method === 'GET') {
    try {
      const health = await gateway.healthCheck();
      sendJson(res, health.healthy ? 200 : 503, health);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 503, { healthy: false, error: message });
    }
    return;
  }

  // GET /v1/runner/contracts - Get contract schema info
  if (path === '/v1/runner/contracts' && method === 'GET') {
    const schemaInfo = contractValidator.getSchemaInfo();
    sendJson(res, 200, {
      contracts: {
        'simulation/v1/request': {
          schemaId: schemaInfo.id,
          version: schemaInfo.version,
          description: 'SimulationPlan request contract',
        },
      },
      validation: {
        engine: 'ajv',
        strict: true,
        singleBoundary: true,
      },
    });
    return;
  }

  // GET /v1/runner - API info
  if (path === '/v1/runner' && method === 'GET') {
    sendJson(res, 200, {
      name: 'agentics-runner',
      version: '1.0.0',
      contractEnforcement: {
        enabled: true,
        schema: contractValidator.getSchemaInfo().id,
        validationBoundary: 'HTTP',
        singleBoundary: true,
      },
      endpoints: [
        'POST /v1/runner/plans - Submit a SimulationPlan for real execution',
        'POST /v1/runner/submit - Submit a simulation plan',
        'POST /v1/runner/execute - Execute via simulation engine',
        'GET /v1/runner/status/:id - Get execution status',
        'GET /v1/runner/result/:id - Get execution result',
        'POST /v1/runner/abort/:id - Abort execution',
        'GET /v1/runner/health - Health check',
        'GET /v1/runner/contracts - Get contract schema info',
      ],
    });
    return;
  }

  // Not found
  sendJson(res, 404, { error: 'Not found', path });
}

/**
 * Known scenario identifiers that the runner can execute.
 */
const KNOWN_SCENARIOS = new Set([
  'load-test',
  'stress-test',
  'soak-test',
  'spike-test',
  'smoke-test',
  'capacity-test',
  'endurance-test',
  'baseline',
  'chaos',
  'canary',
  'blue-green',
  'a-b-test',
  'rollback',
  'custom',
]);

/**
 * Handle POST /v1/runner - Simulation execution endpoint
 *
 * Accepts a simulation record payload from the CLI and queues/executes it.
 * Returns the simulation status with a startedAt timestamp.
 *
 * Request body: { simulationId, name, scenario, parameters }
 * Success response (200): { simulationId, status, startedAt }
 * Validation error (422): { error, code, details }
 */
async function handleSimulationRunner(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req) as Record<string, unknown>;

    const { simulationId, name, scenario, parameters } = body as {
      simulationId?: string;
      name?: string;
      scenario?: string;
      parameters?: Record<string, unknown>;
    };

    // --- Validate required fields ---
    const missingFields: string[] = [];
    if (!simulationId || typeof simulationId !== 'string') missingFields.push('simulationId');
    if (!name || typeof name !== 'string') missingFields.push('name');
    if (!scenario || typeof scenario !== 'string') missingFields.push('scenario');

    if (missingFields.length > 0) {
      sendJson(res, 422, {
        error: 'Missing or invalid required fields',
        code: 'INVALID_PAYLOAD',
        details: missingFields.map((f) => ({ field: f, message: `${f} is required and must be a string` })),
      });
      return;
    }

    // --- Validate scenario ---
    if (!KNOWN_SCENARIOS.has(scenario!)) {
      sendJson(res, 422, {
        error: `Unknown scenario: ${scenario}`,
        code: 'INVALID_SCENARIO',
        details: [
          {
            field: 'scenario',
            message: `Scenario "${scenario}" is not recognised. Accepted values: ${[...KNOWN_SCENARIOS].join(', ')}`,
          },
        ],
      });
      return;
    }

    // --- Validate parameters when provided ---
    if (parameters !== undefined && (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters))) {
      sendJson(res, 422, {
        error: 'parameters must be a JSON object',
        code: 'INVALID_PARAMETERS',
        details: [{ field: 'parameters', message: 'Expected a JSON object' }],
      });
      return;
    }

    // --- Accepted, but not executed ---
    // This payload carries no agents, no integrations and no execution graph,
    // so there is nothing here the runner can execute. It is reported as such
    // rather than as a running simulation, and it does not fan out to the
    // Layer-3 cores. Submit a SimulationPlan to POST /v1/runner/plans for real
    // execution (ADR-0001).
    sendJson(res, 200, {
      simulationId,
      status: 'not_executed',
      startedAt: new Date().toISOString(),
      deprecated: true,
      message:
        'POST /v1/runner accepts the flat CLI payload but executes nothing. ' +
        'Submit a SimulationPlan to POST /v1/runner/plans for real execution.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid JSON') {
      sendJson(res, 422, {
        error: 'Request body is not valid JSON',
        code: 'INVALID_JSON',
        details: [],
      });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendJson(res, 500, {
      error: message,
      code: 'INTERNAL_ERROR',
    });
  }
}

/**
 * Main request handler
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Root health check for Cloud Run
  if (path === '/' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', service: 'agentics-runner' });
    return;
  }

  // GET /health endpoint
  if (path === '/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
    return;
  }

  // POST /v1/runner/plans - submit a SimulationPlan for real execution
  if (path === '/v1/runner/plans' && req.method === 'POST') {
    await handlePlanSubmission(req, res);
    return;
  }

  // POST /v1/runner - deprecated flat CLI payload, executes nothing
  if (path === '/v1/runner' && req.method === 'POST') {
    await handleSimulationRunner(req, res);
    return;
  }

  // /v1/runner/* sub-endpoints
  if (path.startsWith('/v1/runner')) {
    await handleRunner(req, res, path);
    return;
  }

  // 404 for unknown paths
  sendJson(res, 404, { error: 'Not found', path });
}

/**
 * Create a runner HTTP server without binding it to a port.
 */
export function createRunnerServer(): Server {
  return createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('Request error:', error);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });
}

const isEntrypoint =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  const server = createRunnerServer();

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  server.listen(PORT, () => {
    console.log(`agentics-runner server listening on port ${PORT}`);
    console.log(`Contract enforcement enabled: ${contractValidator.getSchemaInfo().id}`);
    console.log(`Endpoints available at /v1/runner`);
  });
}
