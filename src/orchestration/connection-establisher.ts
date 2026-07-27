/**
 * Connection Establisher (MOD-003.4)
 *
 * Establishes connections to external integrations.
 * Implements Phase 2, Step 4.4 from SPARC Pseudocode.
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4.4 - Establish Integration Connections
 * - SPARC_ARCHITECTURE.md MOD-003, MOD-008
 *
 * Features:
 * - Creates adapters for each integration type
 * - Resolves credentials from SecureVault
 * - Establishes connections with retry (exponential backoff)
 * - Records connection establishment in state
 */

import { randomUUID } from 'crypto';
import type { IntegrationId, UUID, DurationMs } from '../types/common.js';
import type {
  ExecutionContext,
  IntegrationConnection,
  ConnectionStatus,
  IntegrationRequest,
  IntegrationResponse,
} from '../types/execution.js';
import type {
  SimulationPlan,
  IntegrationDefinition,
  AdapterType,
} from '../types/plan.js';
import { HttpAdapter } from '../core/adapters/http-adapter.js';
import type { ResolvedCredentials } from '../core/adapters/base-adapter.js';
import {
  executeWithRetry,
  createRetryContext,
  type RetryContext,
  type RetryConfig,
} from '../utils/retry.js';
import { StateRepository } from '../state/repository.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the connection establisher
 */
export interface ConnectionEstablisherConfig {
  readonly secureVault?: SecureVault;
  readonly stateRepository?: StateRepository;
  readonly adapterFactory?: IntegrationAdapterFactory;
  readonly retryConfig?: Partial<RetryConfig>;
  readonly connectionTimeout?: DurationMs;
}

/**
 * Secure vault interface for credential resolution
 */
export interface SecureVault {
  resolveCredential(credentialRef: string): Promise<Credential>;
  isCredentialValid(credentialRef: string): Promise<boolean>;
}

/**
 * Credential retrieved from secure vault
 */
export interface Credential {
  readonly type: CredentialType;
  readonly value: string;
  readonly expiresAt?: Date;
  readonly metadata?: Record<string, string>;
}

export type CredentialType = 'API_KEY' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'OAUTH2' | 'CERTIFICATE';

/**
 * Factory for creating integration adapters
 */
export interface IntegrationAdapterFactory {
  createAdapter(
    definition: IntegrationDefinition,
    credential: Credential
  ): Promise<IntegrationAdapter>;
}

/**
 * Integration adapter interface
 */
export interface IntegrationAdapter {
  readonly adapterType: AdapterType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;
  isConnected(): boolean;
  getStatus(): ConnectionStatus;
}

/**
 * Result of connection establishment
 */
export interface ConnectionEstablishmentResult {
  readonly connections: Map<IntegrationId, IntegrationConnection>;
  readonly establishedAt: Date;
  readonly connectionErrors: ConnectionError[];
}

/**
 * Connection error details
 */
export interface ConnectionError {
  readonly integrationId: string;
  readonly errorCode: ConnectionErrorCode;
  readonly message: string;
  readonly retryAttempts: number;
  readonly details?: Record<string, unknown>;
}

export type ConnectionErrorCode =
  | 'UNSUPPORTED_ADAPTER_TYPE'
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_EXPIRED'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'AUTHENTICATION_FAILED'
  | 'ADAPTER_CREATION_FAILED';

// ============================================================================
// Vault Implementations
// ============================================================================

/**
 * Error raised by a SecureVault when a credential cannot be produced.
 */
export class SecureVaultError extends Error {
  constructor(
    message: string,
    public readonly code: ConnectionErrorCode
  ) {
    super(message);
    this.name = 'SecureVaultError';
  }
}

/**
 * Thrown when vault configuration is missing at construction time.
 */
export class VaultConfigurationError extends Error {
  readonly code = 'VAULT_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'VaultConfigurationError';
  }
}

const CREDENTIAL_TYPE_BY_SUFFIX: Record<string, CredentialType> = {
  API_KEY: 'API_KEY',
  BEARER_TOKEN: 'BEARER_TOKEN',
  BASIC_AUTH: 'BASIC_AUTH',
  OAUTH2: 'OAUTH2',
  CERTIFICATE: 'CERTIFICATE',
};

/**
 * Resolves credentials from process environment variables.
 *
 * A credential reference `payments-api-key` with prefix `RUNNER_CREDENTIAL_`
 * is read from `RUNNER_CREDENTIAL_PAYMENTS_API_KEY`. An optional
 * `..._TYPE` companion variable selects the credential type
 * (default `API_KEY`).
 */
export class EnvSecureVault implements SecureVault {
  private readonly prefix: string;

  constructor(prefix?: string) {
    const effectivePrefix = prefix ?? process.env.RUNNER_CREDENTIAL_PREFIX;
    if (!effectivePrefix) {
      throw new VaultConfigurationError(
        'No secure vault configured. Set RUNNER_CREDENTIAL_PREFIX (e.g. RUNNER_CREDENTIAL_) ' +
          'or supply an explicit secureVault in ConnectionEstablisherConfig.'
      );
    }
    this.prefix = effectivePrefix;
  }

  private envKey(credentialRef: string): string {
    return `${this.prefix}${credentialRef.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
  }

  async resolveCredential(credentialRef: string): Promise<Credential> {
    const key = this.envKey(credentialRef);
    const value = process.env[key];
    if (!value) {
      throw new SecureVaultError(
        `Credential ${credentialRef} not found (expected environment variable ${key})`,
        'CREDENTIAL_NOT_FOUND'
      );
    }

    const declaredType = process.env[`${key}_TYPE`];
    return {
      type: declaredType ? CREDENTIAL_TYPE_BY_SUFFIX[declaredType] ?? 'API_KEY' : 'API_KEY',
      value,
    };
  }

  async isCredentialValid(credentialRef: string): Promise<boolean> {
    return process.env[this.envKey(credentialRef)] !== undefined;
  }
}

/**
 * In-memory vault holding only credentials explicitly handed to it.
 *
 * Test-only: nothing under `src/` outside this module constructs it, and it
 * seeds no credentials of its own. Unknown references fail closed.
 */
export class InMemorySecureVault implements SecureVault {
  private readonly credentials: Map<string, Credential>;

  constructor(seed: Record<string, Credential> = {}) {
    this.credentials = new Map(Object.entries(seed));
  }

  async resolveCredential(credentialRef: string): Promise<Credential> {
    const credential = this.credentials.get(credentialRef);
    if (!credential) {
      throw new SecureVaultError(
        `Credential ${credentialRef} not found`,
        'CREDENTIAL_NOT_FOUND'
      );
    }
    return credential;
  }

  async isCredentialValid(credentialRef: string): Promise<boolean> {
    const credential = this.credentials.get(credentialRef);
    if (!credential) {
      return false;
    }
    if (credential.expiresAt && credential.expiresAt < new Date()) {
      return false;
    }
    return true;
  }

  addCredential(ref: string, credential: Credential): void {
    this.credentials.set(ref, credential);
  }
}

// ============================================================================
// Real Integration Adapters
// ============================================================================

const ADAPTER_CREDENTIAL_TYPE: Record<CredentialType, ResolvedCredentials['type']> = {
  API_KEY: 'api_key',
  BEARER_TOKEN: 'bearer',
  BASIC_AUTH: 'basic',
  OAUTH2: 'oauth2',
  CERTIFICATE: 'mtls',
};

/**
 * Adapts the real {@link HttpAdapter} onto the orchestration
 * {@link IntegrationAdapter} contract.
 */
export class HttpIntegrationAdapter implements IntegrationAdapter {
  readonly adapterType: AdapterType = 'HTTP_REST';
  private readonly adapter: HttpAdapter;
  private readonly integrationId: string;
  private readonly credential: Credential;
  private status: ConnectionStatus = 'DISCONNECTED';

  constructor(definition: IntegrationDefinition, credential: Credential) {
    const baseUrl = definition.connectionSpec.baseUrl;
    if (!baseUrl) {
      throw new ConnectionEstablishmentError(
        `Integration ${definition.integrationId} has no baseUrl in its connectionSpec`,
        'ADAPTER_CREATION_FAILED',
        definition.integrationId
      );
    }

    this.integrationId = definition.integrationId;
    this.credential = credential;
    this.adapter = new HttpAdapter(definition.integrationId as IntegrationId, {
      baseUrl,
      connectionTimeoutMs: definition.connectionSpec.timeout,
      requestTimeoutMs: definition.connectionSpec.timeout,
    });
  }

  async connect(): Promise<void> {
    this.status = 'CONNECTING';
    try {
      await this.adapter.connect({
        type: ADAPTER_CREDENTIAL_TYPE[this.credential.type],
        value: this.credential.value,
      });
      this.status = 'CONNECTED';
    } catch (error) {
      this.status = 'ERROR';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.adapter.close();
    this.status = 'DISCONNECTED';
  }

  async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
    const result = await this.adapter.execute({
      integrationId: this.integrationId,
      operation: request.method,
      path: request.path,
      parameters: request.parameters,
      body: request.body,
      headers: request.headers,
      idempotencyKey: request.idempotencyKey,
      timeoutMs: request.timeout,
    });

    if (!result.success) {
      throw new Error(
        `Integration ${this.integrationId} call failed: ${result.error?.message ?? 'unknown error'}`
      );
    }

    return {
      statusCode: result.metrics.statusCode ?? 200,
      body: result.output,
      headers: result.responseHeaders ?? {},
      latencyMs: result.metrics.latencyMs,
    };
  }

  isConnected(): boolean {
    return this.adapter.isConnected();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
}

/**
 * Builds real adapters. Adapter types without a concrete implementation are
 * rejected rather than silently mocked.
 */
export class RealAdapterFactory implements IntegrationAdapterFactory {
  async createAdapter(
    definition: IntegrationDefinition,
    credential: Credential
  ): Promise<IntegrationAdapter> {
    if (definition.adapterType !== 'HTTP_REST') {
      throw new ConnectionEstablishmentError(
        `No adapter implementation for type ${definition.adapterType}`,
        'UNSUPPORTED_ADAPTER_TYPE',
        definition.integrationId
      );
    }
    return new HttpIntegrationAdapter(definition, credential);
  }
}

// ============================================================================
// Integration Connection Wrapper
// ============================================================================

/**
 * Wrapper class that implements IntegrationConnection interface
 */
class IntegrationConnectionImpl implements IntegrationConnection {
  readonly integrationId: IntegrationId;
  readonly adapterType: string;
  readonly connectionSpec: Record<string, unknown>;
  private adapter: IntegrationAdapter;
  private _status: ConnectionStatus;

  constructor(
    integrationId: IntegrationId,
    definition: IntegrationDefinition,
    adapter: IntegrationAdapter
  ) {
    this.integrationId = integrationId;
    this.adapterType = definition.adapterType;
    this.connectionSpec = definition.connectionSpec as unknown as Record<string, unknown>;
    this.adapter = adapter;
    this._status = adapter.getStatus();
  }

  get status(): ConnectionStatus {
    return this.adapter.getStatus();
  }

  async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
    return this.adapter.execute(request);
  }

  async close(): Promise<void> {
    await this.adapter.disconnect();
    this._status = 'DISCONNECTED';
  }
}

// ============================================================================
// Connection Establisher
// ============================================================================

/**
 * ConnectionEstablisher manages establishing connections to external integrations
 */
export class ConnectionEstablisher {
  private readonly config: ConnectionEstablisherConfig;
  private readonly secureVault: SecureVault;
  private readonly adapterFactory: IntegrationAdapterFactory;
  private readonly connectionTimeout: DurationMs;

  constructor(config: ConnectionEstablisherConfig = {}) {
    this.config = config;
    this.secureVault = config.secureVault ?? new EnvSecureVault();
    this.adapterFactory = config.adapterFactory ?? new RealAdapterFactory();
    this.connectionTimeout = config.connectionTimeout ?? 30000;
  }

  /**
   * Establishes all integration connections for a simulation plan
   *
   * From Pseudocode 4.4:
   * 1. Create adapter for each integration type
   * 2. Resolve credentials from SecureVault
   * 3. Establish connection with retry (exponential backoff)
   * 4. Record connection establishment in state
   *
   * @param ctx - The execution context
   * @param plan - The simulation plan
   * @returns ConnectionEstablishmentResult with established connections
   */
  async establishIntegrationConnections(
    ctx: ExecutionContext,
    plan: SimulationPlan
  ): Promise<ConnectionEstablishmentResult> {
    const connections = new Map<IntegrationId, IntegrationConnection>();
    const connectionErrors: ConnectionError[] = [];
    const establishedAt = new Date();

    // Create retry context from execution context seed
    const retryCtx = createRetryContext(
      ctx.randomGenerator.initialSeed.toString(),
      this.config.retryConfig
    );

    for (const integration of plan.integrations) {
      try {
        // 1. Resolve credential from secure vault
        const credential = await this.resolveCredential(integration);

        // 2. Create adapter
        const adapter = await this.createAdapter(integration, credential);

        // 3. Establish connection with retry
        const connection = await this.establishConnectionWithRetry(
          ctx,
          integration,
          adapter,
          retryCtx
        );

        connections.set(integration.integrationId as IntegrationId, connection);

        // 4. Record connection establishment
        if (this.config.stateRepository) {
          await this.recordConnectionEstablishment(ctx, integration, connection);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const connectionError: ConnectionError = {
          integrationId: integration.integrationId,
          errorCode: this.mapErrorToCode(error),
          message: errorMessage,
          retryAttempts: this.config.retryConfig?.maxRetries ?? 3,
          details: { error: errorMessage },
        };
        connectionErrors.push(connectionError);
      }
    }

    return {
      connections,
      establishedAt,
      connectionErrors,
    };
  }

  /**
   * Resolves credential from secure vault with validation
   */
  private async resolveCredential(integration: IntegrationDefinition): Promise<Credential> {
    const credentialRef = integration.connectionSpec.credentialRef;

    // Validate credential exists and is valid
    const isValid = await this.secureVault.isCredentialValid(credentialRef);
    if (!isValid) {
      throw new ConnectionEstablishmentError(
        `Credential ${credentialRef} is missing, expired or invalid`,
        'CREDENTIAL_EXPIRED',
        integration.integrationId
      );
    }

    // Resolve the credential
    try {
      return await this.secureVault.resolveCredential(credentialRef);
    } catch (error) {
      if (error instanceof SecureVaultError) {
        throw new ConnectionEstablishmentError(
          error.message,
          error.code,
          integration.integrationId
        );
      }
      throw error;
    }
  }

  /**
   * Creates an adapter for the integration
   */
  private async createAdapter(
    integration: IntegrationDefinition,
    credential: Credential
  ): Promise<IntegrationAdapter> {
    try {
      return await this.adapterFactory.createAdapter(integration, credential);
    } catch (error) {
      throw new ConnectionEstablishmentError(
        `Failed to create adapter: ${error instanceof Error ? error.message : String(error)}`,
        'ADAPTER_CREATION_FAILED',
        integration.integrationId
      );
    }
  }

  /**
   * Establishes connection with retry logic
   */
  private async establishConnectionWithRetry(
    ctx: ExecutionContext,
    integration: IntegrationDefinition,
    adapter: IntegrationAdapter,
    retryCtx: RetryContext
  ): Promise<IntegrationConnection> {
    const operation = `connection:${integration.integrationId}`;

    const result = await executeWithRetry(retryCtx, operation, async () => {
      // Connect with timeout
      const connectPromise = adapter.connect();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
        }, this.connectionTimeout);
      });

      await Promise.race([connectPromise, timeoutPromise]);

      if (!adapter.isConnected()) {
        throw new Error('Connection failed: adapter not connected after connect()');
      }

      return new IntegrationConnectionImpl(
        integration.integrationId as IntegrationId,
        integration,
        adapter
      );
    });

    if (!result.success) {
      throw result.error ?? new Error('Connection failed after retries');
    }

    return result.result!;
  }

  /**
   * Records connection establishment in state
   */
  private async recordConnectionEstablishment(
    ctx: ExecutionContext,
    integration: IntegrationDefinition,
    connection: IntegrationConnection
  ): Promise<void> {
    if (!this.config.stateRepository) {
      return;
    }

    const eventId = randomUUID();
    await this.config.stateRepository.recordEvent(
      ctx.stateNamespace,
      eventId,
      'CONNECTION_ESTABLISHED',
      {
        integrationId: integration.integrationId,
        adapterType: integration.adapterType,
        status: connection.status,
        establishedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Maps an error to a ConnectionErrorCode
   */
  private mapErrorToCode(error: unknown): ConnectionErrorCode {
    if (error instanceof ConnectionEstablishmentError) {
      return error.code;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : '';

    if (message.includes('timeout')) {
      return 'CONNECTION_TIMEOUT';
    }
    if (message.includes('refused') || message.includes('econnrefused')) {
      return 'CONNECTION_REFUSED';
    }
    if (message.includes('authentication') || message.includes('unauthorized')) {
      return 'AUTHENTICATION_FAILED';
    }
    if (message.includes('credential')) {
      return 'CREDENTIAL_NOT_FOUND';
    }

    return 'ADAPTER_CREATION_FAILED';
  }

  /**
   * Closes all established connections
   *
   * @param connections - Map of connections to close
   */
  async closeConnections(connections: Map<IntegrationId, IntegrationConnection>): Promise<void> {
    const closePromises: Promise<void>[] = [];

    connections.forEach((connection, integrationId) => {
      closePromises.push(
        connection.close().catch((error) => {
          console.error(`Failed to close connection ${integrationId}:`, error);
        })
      );
    });

    await Promise.all(closePromises);
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when connection establishment fails
 */
export class ConnectionEstablishmentError extends Error {
  constructor(
    message: string,
    public readonly code: ConnectionErrorCode,
    public readonly integrationId: string
  ) {
    super(message);
    this.name = 'ConnectionEstablishmentError';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a ConnectionEstablisher instance
 */
export function createConnectionEstablisher(
  config: ConnectionEstablisherConfig = {}
): ConnectionEstablisher {
  return new ConnectionEstablisher(config);
}

/**
 * Creates an in-memory SecureVault seeded with the given credentials.
 *
 * TEST-ONLY. It is never a production default — the default vault is
 * {@link EnvSecureVault}, which fails closed when unconfigured.
 */
export function createMockSecureVault(
  seed: Record<string, Credential> = {}
): SecureVault {
  return new InMemorySecureVault(seed);
}

/**
 * Validates an integration definition
 *
 * @param integration - The integration definition to validate
 * @returns true if valid, throws on validation failure
 */
export function validateIntegrationDefinition(integration: IntegrationDefinition): boolean {
  if (!integration.integrationId) {
    throw new Error('Integration definition missing integrationId');
  }

  if (!integration.adapterType) {
    throw new Error('Integration definition missing adapterType');
  }

  if (!integration.connectionSpec) {
    throw new Error('Integration definition missing connectionSpec');
  }

  if (!integration.connectionSpec.credentialRef) {
    throw new Error('Integration connectionSpec missing credentialRef');
  }

  return true;
}

/**
 * Gets supported adapter types
 */
export function getSupportedAdapterTypes(): AdapterType[] {
  return [
    'HTTP_REST',
    'GRAPHQL',
    'GRPC',
    'DATABASE',
    'MESSAGE_QUEUE',
    'FILE_SYSTEM',
    'AGENTICS_ECOSYSTEM',
    'CUSTOM',
  ];
}
