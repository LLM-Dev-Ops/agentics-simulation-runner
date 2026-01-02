/**
 * Agentics Ecosystem Surface
 *
 * MOD-012: Abstracts interactions with other Agentics repositories
 *
 * This surface provides a unified interface for:
 * - Validating ecosystem component availability
 * - Emitting simulation results to deployment-intent or other targets
 * - Handling handoff protocols between ecosystem components
 *
 * Ecosystem components from SPARC Specification:
 * - agentics-simulation-planner: Source of SimulationPlan (consumed, not invoked)
 * - agentics-deployment-intent: Target for SimulationResult (output emitted to)
 * - agentics-skill-registry: For agent skill lookup
 * - agentics-credential-vault: For credential resolution
 * - ruvvector-postgres: State substrate (handled by MOD-014)
 *
 * @module surfaces/agentics-ecosystem-surface
 */

import { v4 as uuidv4 } from 'uuid';
import type { SimulationResult } from '../types/simulation-result.js';
import type { UUID, ISO8601Timestamp } from '../types/common.js';
import { computeSHA256 } from '../utils/hash.js';
import type {
  EcosystemComponent,
  EcosystemStatus,
  EcosystemHealthStatus,
  EcosystemComponentStatus,
  EcosystemComponentType,
  EcosystemRepository,
  EmitConfirmation,
  EmitError,
  EmitTarget,
  EmitTargetType,
  HandoffRequest,
  HandoffResponse,
  HandoffProtocolVersion,
  EcosystemSurfaceConfig,
  EcosystemDiscoveryConfig,
} from './ecosystem-types.js';

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default ecosystem surface configuration
 */
const DEFAULT_CONFIG: EcosystemSurfaceConfig = {
  discovery: {
    autoDiscover: false,
    discoveryMethod: 'static',
    staticEndpoints: {},
    healthCheckIntervalMs: 30000,
    healthCheckTimeoutMs: 5000,
    failureThreshold: 3,
  },
  defaultEmitConfig: {
    timeoutMs: 30000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelayMs: 1000,
  },
  handoffProtocolVersion: '1.0',
  criticalComponents: ['agentics-deployment-intent'],
};

/**
 * Known ecosystem components and their default endpoints
 */
const KNOWN_COMPONENTS: Record<EcosystemRepository, { type: EcosystemComponentType; defaultEndpoint: string }> = {
  'agentics-simulation-planner': {
    type: 'planner',
    defaultEndpoint: 'http://localhost:3001',
  },
  'agentics-deployment-intent': {
    type: 'intent',
    defaultEndpoint: 'http://localhost:3002',
  },
  'agentics-skill-registry': {
    type: 'registry',
    defaultEndpoint: 'http://localhost:3003',
  },
  'agentics-credential-vault': {
    type: 'vault',
    defaultEndpoint: 'http://localhost:3004',
  },
  'ruvvector-postgres': {
    type: 'state',
    defaultEndpoint: 'postgresql://localhost:5432/agentics',
  },
};

// =============================================================================
// Ecosystem Surface Class
// =============================================================================

/**
 * Agentics Ecosystem Surface
 *
 * Provides a unified interface for interacting with the Agentics ecosystem,
 * including component health checks and result emission.
 */
export class AgenticsEcosystemSurface {
  private readonly config: EcosystemSurfaceConfig;
  private readonly componentEndpoints: Map<string, string>;
  private readonly componentStatus: Map<string, EcosystemComponent>;
  private readonly failureCounts: Map<string, number>;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<EcosystemSurfaceConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      discovery: {
        ...DEFAULT_CONFIG.discovery,
        ...config?.discovery,
      },
      defaultEmitConfig: {
        ...DEFAULT_CONFIG.defaultEmitConfig,
        ...config?.defaultEmitConfig,
      },
    };

    this.componentEndpoints = new Map();
    this.componentStatus = new Map();
    this.failureCounts = new Map();

    // Initialize endpoints from static configuration
    this.initializeEndpoints();
  }

  /**
   * Initialize component endpoints from configuration
   */
  private initializeEndpoints(): void {
    // Add known components with default endpoints
    for (const [name, info] of Object.entries(KNOWN_COMPONENTS)) {
      const staticEndpoint = this.config.discovery.staticEndpoints?.[name];
      this.componentEndpoints.set(name, staticEndpoint ?? info.defaultEndpoint);
    }

    // Add any additional static endpoints
    for (const [name, endpoint] of Object.entries(this.config.discovery.staticEndpoints ?? {})) {
      if (!this.componentEndpoints.has(name)) {
        this.componentEndpoints.set(name, endpoint);
      }
    }
  }

  /**
   * Start periodic health checks for ecosystem components
   */
  public startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return; // Already running
    }

    this.healthCheckInterval = setInterval(
      () => void this.validateEcosystemAvailability(),
      this.config.discovery.healthCheckIntervalMs
    );
  }

  /**
   * Stop periodic health checks
   */
  public stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Validate ecosystem availability
   *
   * Checks connectivity to all configured ecosystem components and
   * returns aggregated status information.
   *
   * @returns Promise<EcosystemStatus> - Status of all ecosystem components
   */
  public async validateEcosystemAvailability(): Promise<EcosystemStatus> {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const components: EcosystemComponent[] = [];
    const checkPromises: Promise<EcosystemComponent>[] = [];

    // Check each configured component
    for (const entry of Array.from(this.componentEndpoints.entries())) {
      const [name, endpoint] = entry;
      const knownInfo = KNOWN_COMPONENTS[name as EcosystemRepository];
      checkPromises.push(
        this.checkComponentHealth(
          name,
          endpoint,
          knownInfo?.type ?? 'custom',
          name as EcosystemRepository | undefined
        )
      );
    }

    // Wait for all health checks to complete
    const results = await Promise.allSettled(checkPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        components.push(result.value);
        this.componentStatus.set(result.value.name, result.value);
      }
    }

    // Calculate aggregated status
    const availableCount = components.filter(c => c.status === 'available').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;
    const unavailableCount = components.filter(c => c.status === 'unavailable').length;

    // Determine overall health
    let overallStatus: EcosystemHealthStatus;
    const criticalUnavailable = components.filter(
      c => this.config.criticalComponents.includes(c.name) && c.status === 'unavailable'
    );

    if (criticalUnavailable.length > 0 || unavailableCount > components.length / 2) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0 || unavailableCount > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (criticalUnavailable.length > 0) {
      recommendations.push(
        `Critical components unavailable: ${criticalUnavailable.map(c => c.name).join(', ')}`
      );
    }
    if (degradedCount > 0) {
      recommendations.push('Some components are degraded. Check logs for details.');
    }

    return {
      components,
      overallStatus,
      evaluatedAt: now,
      availableCount,
      degradedCount,
      unavailableCount,
      criticalIssues: criticalUnavailable.map(c => c.name),
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    };
  }

  /**
   * Check health of a single component
   */
  private async checkComponentHealth(
    name: string,
    endpoint: string,
    type: EcosystemComponentType,
    repository?: EcosystemRepository
  ): Promise<EcosystemComponent> {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const startTime = Date.now();

    try {
      // Determine health check method based on endpoint type
      let status: EcosystemComponentStatus;
      let latencyMs: number;
      let version: string | undefined;
      let errorMessage: string | undefined;

      if (endpoint.startsWith('postgresql://') || endpoint.startsWith('postgres://')) {
        // Database health check
        const result = await this.checkDatabaseHealth(endpoint);
        status = result.status;
        latencyMs = result.latencyMs;
        version = result.version;
        errorMessage = result.errorMessage;
      } else {
        // HTTP health check
        const result = await this.checkHttpHealth(endpoint);
        status = result.status;
        latencyMs = result.latencyMs;
        version = result.version;
        errorMessage = result.errorMessage;
      }

      // Update failure count
      if (status === 'unavailable') {
        const currentCount = this.failureCounts.get(name) ?? 0;
        this.failureCounts.set(name, currentCount + 1);
      } else {
        this.failureCounts.set(name, 0);
      }

      return {
        name,
        repository,
        type,
        endpoint,
        status,
        version,
        lastCheckedAt: now,
        latencyMs,
        errorMessage,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update failure count
      const currentCount = this.failureCounts.get(name) ?? 0;
      this.failureCounts.set(name, currentCount + 1);

      return {
        name,
        repository,
        type,
        endpoint,
        status: 'unavailable',
        lastCheckedAt: now,
        latencyMs,
        errorMessage,
      };
    }
  }

  /**
   * Check HTTP endpoint health
   */
  private async checkHttpHealth(endpoint: string): Promise<{
    status: EcosystemComponentStatus;
    latencyMs: number;
    version?: string;
    errorMessage?: string;
  }> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.discovery.healthCheckTimeoutMs
    );

    try {
      const healthEndpoint = new URL('/health', endpoint).toString();
      const response = await fetch(healthEndpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        let version: string | undefined;
        try {
          const body = await response.json() as { version?: string; status?: string };
          version = body.version;
          // Check if response indicates degraded status
          if (body.status === 'degraded') {
            return { status: 'degraded', latencyMs, version };
          }
        } catch {
          // Ignore JSON parse errors
        }
        return { status: 'available', latencyMs, version };
      } else if (response.status >= 500) {
        return {
          status: 'unavailable',
          latencyMs,
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
        };
      } else {
        return {
          status: 'degraded',
          latencyMs,
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('abort')) {
        return { status: 'unavailable', latencyMs, errorMessage: 'Health check timeout' };
      }

      return { status: 'unavailable', latencyMs, errorMessage };
    }
  }

  /**
   * Check database health (placeholder - actual implementation would use pg client)
   */
  private async checkDatabaseHealth(_endpoint: string): Promise<{
    status: EcosystemComponentStatus;
    latencyMs: number;
    version?: string;
    errorMessage?: string;
  }> {
    // In a real implementation, this would:
    // 1. Parse the connection string
    // 2. Attempt to connect to the database
    // 3. Execute a simple query (e.g., SELECT 1)
    // 4. Return the result

    // For now, return a placeholder response
    // The actual database interaction is handled by MOD-014 State Surface
    return {
      status: 'available',
      latencyMs: 1,
      version: undefined,
      errorMessage: undefined,
    };
  }

  /**
   * Emit a simulation result to a target component
   *
   * @param result - The SimulationResult to emit
   * @param target - Target configuration or component name string
   * @returns Promise<EmitConfirmation> - Confirmation of successful emission
   * @throws EmitError if emission fails
   */
  public async emitResult(
    result: SimulationResult,
    target: string | EmitTarget
  ): Promise<EmitConfirmation> {
    const now = new Date().toISOString() as ISO8601Timestamp;

    // Normalize target to EmitTarget
    const emitTarget = this.normalizeTarget(target);

    // Validate target is available
    const targetStatus = this.componentStatus.get(emitTarget.componentName ?? emitTarget.endpoint);
    if (targetStatus?.status === 'unavailable') {
      throw this.createEmitError(
        'TARGET_UNAVAILABLE',
        `Target component ${emitTarget.componentName ?? emitTarget.endpoint} is unavailable`,
        emitTarget.componentName ?? emitTarget.endpoint,
        true
      );
    }

    // Prepare handoff request
    const handoffRequest = this.createHandoffRequest(result, emitTarget);

    // Attempt emission with retries
    const maxRetries = emitTarget.maxRetries ?? this.config.defaultEmitConfig.maxRetries;
    let lastError: Error | undefined;
    let retriesAttempted = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.executeHandoff(handoffRequest, emitTarget);

        if (response.accepted) {
          return {
            targetComponent: emitTarget.componentName ?? emitTarget.endpoint,
            targetType: emitTarget.type,
            emittedAt: now,
            resultId: result.resultId,
            resultHash: result.resultHash,
            acknowledgment: true,
            acknowledgmentId: response.handoffId,
            responseTimeMs: Date.now() - new Date(now).getTime(),
            responseMetadata: { handoffStatus: response.status },
          };
        } else {
          throw new Error(response.rejectionReason ?? 'Handoff rejected');
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retriesAttempted = attempt;

        if (attempt < maxRetries && emitTarget.retryOnFailure !== false) {
          const delay = this.config.defaultEmitConfig.retryDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw this.createEmitError(
      'EMIT_FAILED',
      `Failed to emit result after ${retriesAttempted + 1} attempts: ${lastError?.message}`,
      emitTarget.componentName ?? emitTarget.endpoint,
      false,
      retriesAttempted
    );
  }

  /**
   * Normalize target to EmitTarget object
   */
  private normalizeTarget(target: string | EmitTarget): EmitTarget {
    if (typeof target === 'string') {
      // Check if it's a known component name
      if (this.componentEndpoints.has(target)) {
        const endpoint = this.componentEndpoints.get(target)!;
        const knownInfo = KNOWN_COMPONENTS[target as EcosystemRepository];
        return {
          type: knownInfo?.type === 'intent' ? 'deployment-intent' : 'custom',
          endpoint,
          componentName: target,
          timeoutMs: this.config.defaultEmitConfig.timeoutMs,
          retryOnFailure: this.config.defaultEmitConfig.retryOnFailure,
          maxRetries: this.config.defaultEmitConfig.maxRetries,
        };
      }
      // Treat as endpoint URL
      return {
        type: 'custom',
        endpoint: target,
        timeoutMs: this.config.defaultEmitConfig.timeoutMs,
        retryOnFailure: this.config.defaultEmitConfig.retryOnFailure,
        maxRetries: this.config.defaultEmitConfig.maxRetries,
      };
    }
    return target;
  }

  /**
   * Create a handoff request for the result
   */
  private createHandoffRequest(
    result: SimulationResult,
    target: EmitTarget
  ): HandoffRequest {
    const now = new Date().toISOString() as ISO8601Timestamp;
    const resultJson = JSON.stringify(result);

    return {
      protocolVersion: this.config.handoffProtocolVersion,
      source: {
        name: 'agentics-simulation-runner',
        version: '1.0.0',
        instanceId: uuidv4() as UUID,
      },
      target,
      payload: {
        resultId: result.resultId,
        resultHash: result.resultHash,
        resultType: 'simulation_result',
        sizeBytes: new TextEncoder().encode(resultJson).length,
      },
      metadata: {
        initiatedAt: now,
        correlationId: uuidv4() as UUID,
        priority: 'normal',
      },
    };
  }

  /**
   * Execute the handoff to the target
   */
  private async executeHandoff(
    request: HandoffRequest,
    target: EmitTarget
  ): Promise<HandoffResponse> {
    const controller = new AbortController();
    const timeoutMs = target.timeoutMs ?? this.config.defaultEmitConfig.timeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${target.endpoint}/handoff`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Handoff-Protocol-Version': request.protocolVersion,
          'X-Correlation-ID': request.metadata.correlationId,
          ...target.headers,
        },
        body: JSON.stringify(request),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          accepted: false,
          respondedAt: new Date().toISOString() as ISO8601Timestamp,
          status: 'rejected',
          rejectionReason: `HTTP ${response.status}: ${errorBody}`,
        };
      }

      const body = await response.json() as HandoffResponse;
      return {
        ...body,
        respondedAt: body.respondedAt ?? (new Date().toISOString() as ISO8601Timestamp),
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : 'Unknown error';

      return {
        accepted: false,
        respondedAt: new Date().toISOString() as ISO8601Timestamp,
        status: 'rejected',
        rejectionReason: message.includes('abort') ? 'Handoff timeout' : message,
      };
    }
  }

  /**
   * Create an emit error
   */
  private createEmitError(
    code: string,
    message: string,
    targetComponent: string,
    retryable: boolean,
    retriesAttempted?: number
  ): EmitError {
    return {
      code,
      message,
      targetComponent,
      occurredAt: new Date().toISOString() as ISO8601Timestamp,
      retryable,
      retriesAttempted,
    };
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current status of a specific component
   */
  public getComponentStatus(name: string): EcosystemComponent | undefined {
    return this.componentStatus.get(name);
  }

  /**
   * Register a custom component
   */
  public registerComponent(
    name: string,
    endpoint: string,
    type: EcosystemComponentType = 'custom'
  ): void {
    this.componentEndpoints.set(name, endpoint);
    // Immediately check the component's health
    void this.checkComponentHealth(name, endpoint, type).then(status => {
      this.componentStatus.set(name, status);
    });
  }

  /**
   * Unregister a component
   */
  public unregisterComponent(name: string): boolean {
    const deleted = this.componentEndpoints.delete(name);
    this.componentStatus.delete(name);
    this.failureCounts.delete(name);
    return deleted;
  }

  /**
   * Get all registered component names
   */
  public getRegisteredComponents(): string[] {
    return Array.from(this.componentEndpoints.keys());
  }

  /**
   * Dispose of the surface and clean up resources
   */
  public dispose(): void {
    this.stopHealthChecks();
    this.componentEndpoints.clear();
    this.componentStatus.clear();
    this.failureCounts.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an ecosystem surface with default configuration
 */
export function createEcosystemSurface(
  config?: Partial<EcosystemSurfaceConfig>
): AgenticsEcosystemSurface {
  return new AgenticsEcosystemSurface(config);
}

/**
 * Validate ecosystem availability using a one-off check
 */
export async function validateEcosystemAvailability(
  config?: Partial<EcosystemSurfaceConfig>
): Promise<EcosystemStatus> {
  const surface = new AgenticsEcosystemSurface(config);
  try {
    return await surface.validateEcosystemAvailability();
  } finally {
    surface.dispose();
  }
}

/**
 * Emit a result to a target using a one-off operation
 */
export async function emitResult(
  result: SimulationResult,
  target: string | EmitTarget,
  config?: Partial<EcosystemSurfaceConfig>
): Promise<EmitConfirmation> {
  const surface = new AgenticsEcosystemSurface(config);
  try {
    return await surface.emitResult(result, target);
  } finally {
    surface.dispose();
  }
}

// =============================================================================
// Re-export Types
// =============================================================================

export type {
  EcosystemComponent,
  EcosystemStatus,
  EcosystemHealthStatus,
  EcosystemComponentStatus,
  EcosystemComponentType,
  EcosystemRepository,
  EmitConfirmation,
  EmitError,
  EmitTarget,
  EmitTargetType,
  HandoffRequest,
  HandoffResponse,
  HandoffProtocolVersion,
  EcosystemSurfaceConfig,
  EcosystemDiscoveryConfig,
} from './ecosystem-types.js';
