/**
 * Integration Adapter Manager (MOD-008)
 *
 * Manages integration adapters for external system access.
 * Handles adapter lifecycle, connection pooling, credential resolution,
 * and integration call execution with telemetry.
 *
 * @module core/integration-adapter-manager
 * @see SPARC_ARCHITECTURE.md MOD-008 - Integration Adapter Manager
 * @see SPARC_PSEUDOCODE.md Section 5.4 - Integration Call
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
  CallId,
  IntegrationId,
} from '../types/common.js';

import type {
  IntegrationDefinition,
  AdapterType,
  ConnectionSpec,
} from '../types/plan.js';

import type {
  ExecutionContext,
  IntegrationConnection,
  IntegrationRequest,
  IntegrationResponse,
} from '../types/execution.js';

import type { WorkflowStep } from '../types/plan.js';

import type {
  IntegrationCallResult,
  IntegrationCallRequest,
  IntegrationCallError,
} from './integration-call-result.js';

import {
  createSuccessResult,
  createErrorResult,
  createIntegrationError,
  generateIdempotencyKey,
} from './integration-call-result.js';

import { computeObjectHash } from './hash-utils.js';

import {
  BaseAdapter,
  type AdapterConnection,
  type ResolvedCredentials,
  type AdapterConfig,
  AdapterFactory,
  HttpAdapter,
  type HttpConnectionConfig,
  DatabaseAdapter,
  type DatabaseConnectionConfig,
  MessageQueueAdapter,
  type MessageQueueConnectionConfig,
} from './adapters/index.js';

// =============================================================================
// Integration Adapter Manager Types
// =============================================================================

/**
 * Credential vault interface for resolving secrets
 *
 * This interface abstracts the credential storage mechanism.
 * Implementations might use:
 * - Environment variables
 * - HashiCorp Vault
 * - AWS Secrets Manager
 * - Azure Key Vault
 * - Local encrypted file
 */
export interface CredentialVault {
  /**
   * Resolve a credential reference to actual credentials
   *
   * @param credentialRef - Reference to the credential in the vault
   * @returns Resolved credentials
   * @throws Error if credential not found or access denied
   */
  resolve(credentialRef: string): Promise<ResolvedCredentials>;

  /**
   * Check if a credential exists
   */
  exists(credentialRef: string): Promise<boolean>;

  /**
   * Refresh credentials if they are expiring
   */
  refresh?(credentialRef: string): Promise<ResolvedCredentials>;
}

/**
 * Telemetry sink for integration call metrics
 */
export interface IntegrationTelemetry {
  /**
   * Record an integration call start
   */
  recordCallStart(
    callId: CallId,
    integrationId: string,
    operation: string
  ): void;

  /**
   * Record an integration call completion
   */
  recordCallComplete(
    callId: CallId,
    result: IntegrationCallResult
  ): void;

  /**
   * Record an integration call error
   */
  recordCallError(
    callId: CallId,
    error: IntegrationCallError
  ): void;

  /**
   * Start a telemetry span for the call
   */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): TelemetrySpan;
}

/**
 * Telemetry span for tracing
 */
export interface TelemetrySpan {
  end(): void;
  recordError(error: Error): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
}

/**
 * Integration connection wrapper
 */
export interface ManagedIntegrationConnection {
  /**
   * Unique connection ID
   */
  readonly connectionId: UUID;

  /**
   * Integration ID this connection serves
   */
  readonly integrationId: IntegrationId;

  /**
   * Adapter type
   */
  readonly adapterType: AdapterType;

  /**
   * The underlying adapter
   */
  readonly adapter: BaseAdapter;

  /**
   * When the connection was established
   */
  readonly connectedAt: ISO8601Timestamp;

  /**
   * Last activity timestamp
   */
  lastActivityAt: ISO8601Timestamp;

  /**
   * Number of active requests
   */
  activeRequests: number;

  /**
   * Total requests served
   */
  totalRequests: number;

  /**
   * Whether the connection is healthy
   */
  healthy: boolean;
}

/**
 * Idempotency cache entry
 */
interface IdempotencyCacheEntry {
  readonly result: IntegrationCallResult;
  readonly expiresAt: Date;
}

/**
 * Integration adapter manager options
 */
export interface IntegrationAdapterManagerOptions {
  /**
   * Credential vault for resolving secrets
   */
  readonly credentialVault: CredentialVault;

  /**
   * Telemetry sink for metrics
   */
  readonly telemetry?: IntegrationTelemetry;

  /**
   * Maximum connections per integration
   */
  readonly maxConnectionsPerIntegration?: number;

  /**
   * Connection idle timeout in milliseconds
   */
  readonly connectionIdleTimeoutMs?: DurationMs;

  /**
   * Idempotency cache TTL in milliseconds
   */
  readonly idempotencyCacheTtlMs?: DurationMs;

  /**
   * Whether to enable connection health checks
   */
  readonly enableHealthChecks?: boolean;

  /**
   * Health check interval in milliseconds
   */
  readonly healthCheckIntervalMs?: DurationMs;

  /**
   * Default request timeout in milliseconds
   */
  readonly defaultTimeoutMs?: DurationMs;
}

// =============================================================================
// Default Implementations
// =============================================================================

/**
 * Default no-op telemetry implementation
 */
const noopTelemetry: IntegrationTelemetry = {
  recordCallStart: () => {},
  recordCallComplete: () => {},
  recordCallError: () => {},
  startSpan: () => ({
    end: () => {},
    recordError: () => {},
    setAttributes: () => {},
  }),
};

/**
 * Environment variable credential vault
 */
export class EnvironmentCredentialVault implements CredentialVault {
  async resolve(credentialRef: string): Promise<ResolvedCredentials> {
    // Parse credential reference format: "env:VAR_NAME" or just "VAR_NAME"
    const varName = credentialRef.startsWith('env:')
      ? credentialRef.substring(4)
      : credentialRef;

    const value = process.env[varName];

    if (!value) {
      throw new Error(`Credential not found: ${credentialRef}`);
    }

    // Check for username:password format for basic auth
    if (value.includes(':')) {
      const [username, password] = value.split(':', 2);
      return {
        type: 'basic',
        value: password,
        secondary: username,
      };
    }

    // Default to bearer token
    return {
      type: 'bearer',
      value,
    };
  }

  async exists(credentialRef: string): Promise<boolean> {
    const varName = credentialRef.startsWith('env:')
      ? credentialRef.substring(4)
      : credentialRef;
    return varName in process.env;
  }
}

// =============================================================================
// Integration Adapter Manager Implementation
// =============================================================================

/**
 * Integration Adapter Manager
 *
 * Manages the lifecycle of integration adapters and connections.
 * Provides a unified interface for executing integration calls across
 * different adapter types.
 *
 * Responsibilities:
 * - Create adapters from integration definitions
 * - Resolve credentials from vault (INV-IN-001)
 * - Manage connection pool
 * - Execute integration calls with idempotency (INV-IN-002)
 * - Capture telemetry (INV-IN-003)
 * - Isolate failures (INV-IN-004)
 *
 * @see SPARC_ARCHITECTURE.md MOD-008
 * @see SPARC_PSEUDOCODE.md Section 5.4
 */
export class IntegrationAdapterManager {
  private readonly credentialVault: CredentialVault;
  private readonly telemetry: IntegrationTelemetry;
  private readonly options: Required<Omit<IntegrationAdapterManagerOptions, 'credentialVault' | 'telemetry'>>;

  /**
   * Connection pool: integration ID -> connections
   */
  private readonly connectionPool: Map<string, ManagedIntegrationConnection[]> = new Map();

  /**
   * Adapter instances: integration ID -> adapter
   */
  private readonly adapters: Map<string, BaseAdapter> = new Map();

  /**
   * Integration definitions: integration ID -> definition
   */
  private readonly integrationDefs: Map<string, IntegrationDefinition> = new Map();

  /**
   * Idempotency cache: idempotency key -> cached result
   */
  private readonly idempotencyCache: Map<string, IdempotencyCacheEntry> = new Map();

  /**
   * Health check timer
   */
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /**
   * Default options
   */
  private static readonly DEFAULT_OPTIONS = {
    maxConnectionsPerIntegration: 10,
    connectionIdleTimeoutMs: 300000, // 5 minutes
    idempotencyCacheTtlMs: 3600000, // 1 hour
    enableHealthChecks: true,
    healthCheckIntervalMs: 60000, // 1 minute
    defaultTimeoutMs: 30000, // 30 seconds
  };

  constructor(options: IntegrationAdapterManagerOptions) {
    this.credentialVault = options.credentialVault;
    this.telemetry = options.telemetry ?? noopTelemetry;
    this.options = {
      ...IntegrationAdapterManager.DEFAULT_OPTIONS,
      ...options,
    };

    // Start health check timer if enabled
    if (this.options.enableHealthChecks) {
      this.startHealthChecks();
    }
  }

  // ===========================================================================
  // Adapter Lifecycle
  // ===========================================================================

  /**
   * Create an adapter for an integration definition
   *
   * @param integrationDef - The integration definition from the plan
   * @returns The created adapter
   * @throws Error if adapter type is not supported or credentials invalid
   */
  async createAdapter(integrationDef: IntegrationDefinition): Promise<BaseAdapter> {
    const integrationId = integrationDef.integrationId as IntegrationId;

    // Check if adapter already exists
    const existingAdapter = this.adapters.get(integrationId);
    if (existingAdapter) {
      return existingAdapter;
    }

    // Store the definition
    this.integrationDefs.set(integrationId, integrationDef);

    // Build adapter configuration
    const config = this.buildAdapterConfig(integrationDef);

    // Create adapter using factory
    const adapter = AdapterFactory.getInstance().create(
      integrationDef.adapterType,
      integrationId,
      config
    );

    // Store adapter
    this.adapters.set(integrationId, adapter);

    return adapter;
  }

  /**
   * Connect an adapter
   *
   * @param adapter - The adapter to connect
   * @returns Managed connection handle
   * @throws Error if connection fails
   */
  async connect(adapter: BaseAdapter): Promise<ManagedIntegrationConnection> {
    const integrationId = adapter.getIntegrationId();
    const integrationDef = this.integrationDefs.get(integrationId);

    if (!integrationDef) {
      throw new Error(`Integration definition not found: ${integrationId}`);
    }

    // Resolve credentials from vault
    const credentials = await this.resolveCredentials(integrationDef.connectionSpec);

    // Establish connection
    const adapterConnection = await adapter.connect(credentials);

    // Create managed connection
    const now = new Date().toISOString() as ISO8601Timestamp;
    const managedConnection: ManagedIntegrationConnection = {
      connectionId: uuidv4() as UUID,
      integrationId,
      adapterType: integrationDef.adapterType,
      adapter,
      connectedAt: now,
      lastActivityAt: now,
      activeRequests: 0,
      totalRequests: 0,
      healthy: true,
    };

    // Add to connection pool
    const connections = this.connectionPool.get(integrationId) ?? [];
    connections.push(managedConnection);
    this.connectionPool.set(integrationId, connections);

    return managedConnection;
  }

  /**
   * Execute an integration call
   *
   * Implements Pseudocode 5.4 - Integration Call:
   * 1. Build request from step definition
   * 2. Handle idempotency (INV-IN-002)
   * 3. Capture in telemetry (INV-IN-003)
   * 4. Isolate failures (INV-IN-004)
   *
   * @param ctx - Execution context
   * @param connection - The connection to use
   * @param step - The workflow step with integration details
   * @returns Integration call result
   */
  async execute(
    ctx: ExecutionContext,
    connection: ManagedIntegrationConnection,
    step: WorkflowStep
  ): Promise<IntegrationCallResult> {
    const callId = uuidv4() as CallId;
    const initiatedAt = new Date().toISOString() as ISO8601Timestamp;
    const startTime = Date.now();

    // Build request from step
    const request = this.buildRequestFromStep(step, connection.integrationId);

    // Check idempotency cache (INV-IN-002)
    const cachedResult = this.getCachedResult(request.idempotencyKey!);
    if (cachedResult) {
      return {
        ...cachedResult,
        cached: true,
      };
    }

    // Start telemetry span (INV-IN-003)
    const span = this.telemetry.startSpan(`integration:${connection.integrationId}`, {
      integrationId: connection.integrationId as string,
      adapterType: connection.adapterType,
      operation: request.operation,
    });

    this.telemetry.recordCallStart(callId, connection.integrationId as string, request.operation);

    // Update connection state
    connection.activeRequests++;
    connection.lastActivityAt = new Date().toISOString() as ISO8601Timestamp;

    try {
      // Execute the request
      const result = await connection.adapter.execute(request);

      // Update connection state
      connection.activeRequests--;
      connection.totalRequests++;

      // Cache successful result for idempotency
      if (result.success) {
        this.cacheResult(result.idempotencyKey, result);
      }

      // Record telemetry
      this.telemetry.recordCallComplete(callId, result);
      span.end();

      return result;
    } catch (error) {
      // Update connection state
      connection.activeRequests--;
      connection.healthy = false;

      // Build error result (INV-IN-004: Isolate failures)
      const integrationError = createIntegrationError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : String(error),
        {
          retryable: this.isRetryableError(error),
          cause: error instanceof Error ? error.cause?.toString() : undefined,
        }
      );

      const errorResult = createErrorResult(
        callId,
        integrationError,
        { latencyMs: Date.now() - startTime },
        request.idempotencyKey!,
        initiatedAt
      );

      // Record telemetry
      this.telemetry.recordCallError(callId, integrationError);
      span.recordError(error instanceof Error ? error : new Error(String(error)));
      span.end();

      return errorResult;
    }
  }

  /**
   * Disconnect a connection
   *
   * @param connection - The connection to disconnect
   */
  async disconnect(connection: ManagedIntegrationConnection): Promise<void> {
    try {
      await connection.adapter.close();
    } finally {
      // Remove from pool
      const connections = this.connectionPool.get(connection.integrationId as string) ?? [];
      const index = connections.findIndex((c) => c.connectionId === connection.connectionId);
      if (index >= 0) {
        connections.splice(index, 1);
      }
    }
  }

  /**
   * Get a connection for an integration
   *
   * Returns an existing healthy connection or creates a new one.
   *
   * @param integrationId - The integration to connect to
   * @returns Managed connection
   */
  async getConnection(integrationId: string): Promise<ManagedIntegrationConnection> {
    // Look for existing healthy connection
    const connections = this.connectionPool.get(integrationId) ?? [];
    const healthyConnection = connections.find((c) => c.healthy && c.activeRequests < 10);

    if (healthyConnection) {
      return healthyConnection;
    }

    // Check if we can create a new connection
    if (connections.length >= this.options.maxConnectionsPerIntegration) {
      // Wait for an available connection
      throw new Error(`Connection pool exhausted for integration: ${integrationId}`);
    }

    // Create new connection
    const adapter = this.adapters.get(integrationId);
    if (!adapter) {
      throw new Error(`Adapter not found for integration: ${integrationId}`);
    }

    return this.connect(adapter);
  }

  /**
   * Shutdown the manager and close all connections
   */
  async shutdown(): Promise<void> {
    // Stop health checks
    this.stopHealthChecks();

    // Close all connections
    for (const [_, connections] of this.connectionPool) {
      for (const connection of connections) {
        try {
          await this.disconnect(connection);
        } catch {
          // Ignore errors during shutdown
        }
      }
    }

    // Clear caches
    this.connectionPool.clear();
    this.adapters.clear();
    this.integrationDefs.clear();
    this.idempotencyCache.clear();
  }

  // ===========================================================================
  // Integration Definition Validation
  // ===========================================================================

  /**
   * Validate that an integration is declared in the plan
   *
   * Enforces INV-IN-001: Only declared integrations can be used
   *
   * @param integrationId - Integration ID to validate
   * @param declaredIntegrations - Declared integrations from the plan
   * @returns true if valid
   * @throws Error if integration not declared
   */
  validateIntegration(
    integrationId: string,
    declaredIntegrations: IntegrationDefinition[]
  ): boolean {
    const declared = declaredIntegrations.some(
      (i) => i.integrationId === integrationId
    );

    if (!declared) {
      throw new Error(
        `INV-IN-001 Violation: Integration "${integrationId}" is not declared in the simulation plan`
      );
    }

    return true;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Build adapter configuration from integration definition
   */
  private buildAdapterConfig(integrationDef: IntegrationDefinition): AdapterConfig {
    const spec = integrationDef.connectionSpec;

    switch (integrationDef.adapterType) {
      case 'HTTP_REST':
      case 'GRAPHQL':
        return {
          baseUrl: spec.baseUrl ?? `https://${spec.host}:${spec.port ?? 443}`,
          connectionTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          requestTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          poolSize: spec.poolSize,
          options: spec.options,
        } as HttpConnectionConfig;

      case 'DATABASE':
        return {
          databaseType: (spec.options?.databaseType as 'postgresql') ?? 'postgresql',
          host: spec.host ?? 'localhost',
          port: spec.port ?? 5432,
          database: spec.database ?? 'postgres',
          connectionTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          requestTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          pool: {
            min: 1,
            max: spec.poolSize ?? 10,
          },
          options: spec.options,
        } as DatabaseConnectionConfig;

      case 'MESSAGE_QUEUE':
        return {
          queueType: (spec.options?.queueType as 'rabbitmq') ?? 'rabbitmq',
          hosts: [spec.host ?? 'localhost'],
          port: spec.port,
          connectionTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          requestTimeoutMs: spec.timeout ?? this.options.defaultTimeoutMs,
          options: spec.options,
        } as MessageQueueConnectionConfig;

      default:
        return {
          baseUrl: spec.baseUrl,
          host: spec.host,
          port: spec.port,
          connectionTimeoutMs: spec.timeout,
          requestTimeoutMs: spec.timeout,
          poolSize: spec.poolSize,
          options: spec.options,
        };
    }
  }

  /**
   * Resolve credentials from vault
   */
  private async resolveCredentials(spec: ConnectionSpec): Promise<ResolvedCredentials> {
    return this.credentialVault.resolve(spec.credentialRef);
  }

  /**
   * Build an integration request from a workflow step
   */
  private buildRequestFromStep(
    step: WorkflowStep,
    integrationId: IntegrationId
  ): IntegrationCallRequest {
    // Generate idempotency key
    const contentHash = computeObjectHash({
      stepId: step.stepId,
      integrationId,
      method: step.integrationMethod,
      path: step.integrationPath,
      params: step.integrationParams,
      body: step.integrationBody,
    });

    const idempotencyKey = step.idempotencyKey ?? generateIdempotencyKey(
      integrationId as string,
      step.integrationMethod ?? 'execute',
      contentHash
    );

    return {
      integrationId: integrationId as string,
      operation: step.integrationMethod ?? 'execute',
      path: step.integrationPath,
      parameters: step.integrationParams,
      body: step.integrationBody,
      headers: step.integrationHeaders,
      idempotencyKey,
      timeoutMs: step.timeout ?? this.options.defaultTimeoutMs,
    };
  }

  /**
   * Get cached result by idempotency key
   */
  private getCachedResult(idempotencyKey: string): IntegrationCallResult | undefined {
    const entry = this.idempotencyCache.get(idempotencyKey);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (new Date() > entry.expiresAt) {
      this.idempotencyCache.delete(idempotencyKey);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Cache a result for idempotency
   */
  private cacheResult(idempotencyKey: string, result: IntegrationCallResult): void {
    const expiresAt = new Date(Date.now() + this.options.idempotencyCacheTtlMs);
    this.idempotencyCache.set(idempotencyKey, { result, expiresAt });
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('rate limit') ||
        message.includes('503') ||
        message.includes('service unavailable')
      );
    }
    return false;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => this.runHealthChecks(),
      this.options.healthCheckIntervalMs
    );
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Run health checks on all connections
   */
  private async runHealthChecks(): Promise<void> {
    for (const [integrationId, connections] of this.connectionPool) {
      for (const connection of connections) {
        try {
          const healthy = await connection.adapter.testConnection();
          connection.healthy = healthy;
        } catch {
          connection.healthy = false;
        }

        // Check for idle connections
        const idleTime = Date.now() - new Date(connection.lastActivityAt).getTime();
        if (idleTime > this.options.connectionIdleTimeoutMs && connection.activeRequests === 0) {
          // Close idle connection
          await this.disconnect(connection);
        }
      }
    }

    // Clean up expired idempotency cache entries
    const now = new Date();
    for (const [key, entry] of this.idempotencyCache) {
      if (now > entry.expiresAt) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an integration adapter manager
 */
export function createIntegrationAdapterManager(
  options: IntegrationAdapterManagerOptions
): IntegrationAdapterManager {
  return new IntegrationAdapterManager(options);
}

/**
 * Create an integration adapter manager with environment credentials
 */
export function createIntegrationAdapterManagerWithEnvCredentials(
  telemetry?: IntegrationTelemetry,
  options?: Partial<Omit<IntegrationAdapterManagerOptions, 'credentialVault' | 'telemetry'>>
): IntegrationAdapterManager {
  return new IntegrationAdapterManager({
    credentialVault: new EnvironmentCredentialVault(),
    telemetry,
    ...options,
  });
}
