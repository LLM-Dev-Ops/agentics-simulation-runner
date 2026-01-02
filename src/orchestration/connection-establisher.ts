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
  ConnectionSpec,
} from '../types/plan.js';
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
// Mock Implementations (for testing/development)
// ============================================================================

/**
 * Mock secure vault for testing
 */
class MockSecureVault implements SecureVault {
  private readonly credentials: Map<string, Credential> = new Map();

  constructor() {
    // Add some default mock credentials
    this.credentials.set('default-api-key', {
      type: 'API_KEY',
      value: 'mock-api-key-12345',
    });
    this.credentials.set('default-bearer-token', {
      type: 'BEARER_TOKEN',
      value: 'mock-bearer-token-67890',
    });
  }

  async resolveCredential(credentialRef: string): Promise<Credential> {
    const credential = this.credentials.get(credentialRef);
    if (!credential) {
      // Return a mock credential for any reference in testing
      return {
        type: 'API_KEY',
        value: `mock-resolved-${credentialRef}`,
      };
    }
    return credential;
  }

  async isCredentialValid(credentialRef: string): Promise<boolean> {
    const credential = this.credentials.get(credentialRef);
    if (!credential) {
      return true; // Assume valid in mock mode
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

/**
 * Mock integration adapter for testing
 */
class MockIntegrationAdapter implements IntegrationAdapter {
  readonly adapterType: AdapterType;
  private connected: boolean = false;
  private status: ConnectionStatus = 'DISCONNECTED';
  private readonly connectionSpec: ConnectionSpec;
  private readonly credential: Credential;

  constructor(
    definition: IntegrationDefinition,
    credential: Credential
  ) {
    this.adapterType = definition.adapterType;
    this.connectionSpec = definition.connectionSpec;
    this.credential = credential;
  }

  async connect(): Promise<void> {
    this.status = 'CONNECTING';

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Mock connection success
    this.connected = true;
    this.status = 'CONNECTED';
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.status = 'DISCONNECTED';
  }

  async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    const startTime = Date.now();

    // Simulate request processing
    await new Promise((resolve) => setTimeout(resolve, 5));

    return {
      statusCode: 200,
      body: {
        success: true,
        data: { method: request.method, path: request.path },
      },
      headers: { 'content-type': 'application/json' },
      latencyMs: Date.now() - startTime,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
}

/**
 * Default adapter factory that creates mock adapters
 */
class DefaultAdapterFactory implements IntegrationAdapterFactory {
  async createAdapter(
    definition: IntegrationDefinition,
    credential: Credential
  ): Promise<IntegrationAdapter> {
    // In production, this would create real adapter implementations
    // based on the adapter type (HttpAdapter, GrpcAdapter, etc.)
    return new MockIntegrationAdapter(definition, credential);
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
    this.secureVault = config.secureVault ?? new MockSecureVault();
    this.adapterFactory = config.adapterFactory ?? new DefaultAdapterFactory();
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
        `Credential ${credentialRef} is expired or invalid`,
        'CREDENTIAL_EXPIRED',
        integration.integrationId
      );
    }

    // Resolve the credential
    const credential = await this.secureVault.resolveCredential(credentialRef);
    if (!credential) {
      throw new ConnectionEstablishmentError(
        `Credential ${credentialRef} not found`,
        'CREDENTIAL_NOT_FOUND',
        integration.integrationId
      );
    }

    return credential;
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
 * Creates a mock SecureVault for testing
 */
export function createMockSecureVault(): SecureVault {
  return new MockSecureVault();
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
