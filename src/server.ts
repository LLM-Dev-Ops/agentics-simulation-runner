/**
 * HTTP Server for Cloud Run deployment
 *
 * Exposes the /v1/runner endpoint for simulation execution.
 * Designed for Cloud Run with health checks and graceful shutdown.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createExecutionGateway, DEFAULT_GATEWAY_CONFIG } from './api/execution-gateway.js';
import type { SimulationPlan } from './types/simulation-plan.js';
import { v4 as uuidv4 } from 'uuid';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Initialize the execution gateway
const gateway = createExecutionGateway({
  runnerName: 'agentics-runner',
  runnerVersion: '1.0.0',
  runnerInstanceId: uuidv4(),
  defaultTimeout: 300000,
  maxConcurrentExecutions: 100,
});

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
 * Send JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Handle /v1/runner endpoints
 */
async function handleRunner(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method?.toUpperCase();

  // POST /v1/runner/submit - Submit a simulation plan
  if (path === '/v1/runner/submit' && method === 'POST') {
    try {
      const body = await parseBody(req) as SimulationPlan;
      const handle = await gateway.submitPlan(body);
      sendJson(res, 202, {
        success: true,
        handle,
        message: 'Simulation plan submitted successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 400, { success: false, error: message });
    }
    return;
  }

  // POST /v1/runner/execute - Submit and execute via engine
  if (path === '/v1/runner/execute' && method === 'POST') {
    try {
      const body = await parseBody(req) as { plan: SimulationPlan; options?: unknown };
      const result = await gateway.submitPlanToEngine(body.plan, body.options as never);
      sendJson(res, 200, {
        success: true,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, 400, { success: false, error: message });
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

  // GET /v1/runner - API info
  if (path === '/v1/runner' && method === 'GET') {
    sendJson(res, 200, {
      name: 'agentics-runner',
      version: '1.0.0',
      endpoints: [
        'POST /v1/runner/submit - Submit a simulation plan',
        'POST /v1/runner/execute - Execute via simulation engine',
        'GET /v1/runner/status/:id - Get execution status',
        'GET /v1/runner/result/:id - Get execution result',
        'POST /v1/runner/abort/:id - Abort execution',
        'GET /v1/runner/health - Health check',
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
  console.log(`Endpoints available at /v1/runner`);
});
