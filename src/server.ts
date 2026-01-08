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

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createExecutionGateway, DEFAULT_GATEWAY_CONFIG } from './api/execution-gateway.js';
import type { SimulationPlan } from './types/simulation-plan.js';
import { v4 as uuidv4 } from 'uuid';
import {
  getContractValidator,
  ContractValidationException,
  createExecutionProof,
  type LayerExecuted,
  type ExecutionGraphNode,
  type ExecutionProof,
} from './contracts/index.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Initialize the execution gateway
const gateway = createExecutionGateway({
  runnerName: 'agentics-runner',
  runnerVersion: '1.0.0',
  runnerInstanceId: uuidv4(),
  defaultTimeout: 300000,
  maxConcurrentExecutions: 100,
});

// Initialize the contract validator (single instance)
const contractValidator = getContractValidator();

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

          const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
          sendJson(res, 400, {
            success: false,
            error: 'Contract validation failed',
            validation_errors: error.result.errors,
            schema_id: error.result.schemaId,
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

          const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
          sendJson(res, 400, {
            success: false,
            error: 'Contract validation failed',
            validation_errors: error.result.errors,
            schema_id: error.result.schemaId,
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
      const result = await gateway.submitPlanToEngine(body.plan as SimulationPlan, body.options as never);
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

      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(res, 200, {
        success: true,
        result,
      }, proof);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const proof = createExecutionProof(proofId, layers, graphNodes, graphEdges);
      sendJson(res, 400, { success: false, error: message }, proof);
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

  // /v1/runner endpoints
  if (path.startsWith('/v1/runner')) {
    await handleRunner(req, res, path);
    return;
  }

  // 404 for unknown paths
  sendJson(res, 404, { error: 'Not found', path });
}

// Create and start server
const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Request error:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

// Graceful shutdown
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
