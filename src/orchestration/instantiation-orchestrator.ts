/**
 * Instantiation Orchestrator (MOD-003)
 *
 * Coordinates execution context setup including state initialization,
 * agent resolution, and connection establishment.
 * Implements Phase 2 from the Master Execution Flow - INSTANTIATION.
 *
 * References:
 * - SPARC_PSEUDOCODE.md Section 4 - Phase 2: Instantiation
 * - SPARC_ARCHITECTURE.md MOD-003
 *
 * Invariants enforced:
 * - INV-EX-002: Concurrent executions MUST NOT observe or affect each other's state
 * - INV-EX-007: All state mutations MUST be recorded in ruvvector-postgres
 */

import type { AgentId, IntegrationId, UUID, DurationMs } from '../types/common.js';
import type {
  ExecutionContext,
  StateHandle,
  AgentInstance,
  IntegrationConnection,
} from '../types/execution.js';
import type { SimulationPlan } from '../types/plan.js';
import type { StateRepository, StateRepositoryConfig } from '../state/repository.js';

import {
  createExecutionContext,
  validateExecutionContext,
  type ExecutionContextConfig,
  type ExecutionContextResult,
} from './context-factory.js';
import {
  StateInitializer,
  createStateInitializer,
  countTotalSteps,
  validateDependencyGraph,
  type StateInitializerConfig,
  type StateInitializationResult,
} from './state-initializer.js';
import {
  AgentResolver,
  createAgentResolver,
  type AgentResolverConfig,
  type AgentResolutionResult,
} from './agent-resolver.js';
import {
  ConnectionEstablisher,
  createConnectionEstablisher,
  type ConnectionEstablisherConfig,
  type ConnectionEstablishmentResult,
} from './connection-establisher.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the Instantiation Orchestrator
 */
export interface InstantiationOrchestratorConfig {
  readonly stateRepository?: StateRepository;
  readonly repositoryConfig?: StateRepositoryConfig;
  readonly agentResolverConfig?: AgentResolverConfig;
  readonly connectionEstablisherConfig?: ConnectionEstablisherConfig;
  readonly stateInitializerConfig?: StateInitializerConfig;
  readonly enableStrictValidation?: boolean;
  readonly instantiationTimeout?: DurationMs;
}

/**
 * Complete execution context with all resources
 */
export interface CompleteExecutionContext {
  readonly context: ExecutionContext;
  readonly stateHandle: StateHandle;
  readonly agents: Map<AgentId, AgentInstance>;
  readonly connections: Map<IntegrationId, IntegrationConnection>;
  readonly instantiatedAt: Date;
}

/**
 * Result of the instantiation phase
 */
export interface InstantiationResult {
  readonly success: boolean;
  readonly executionContext?: CompleteExecutionContext;
  readonly errors: InstantiationError[];
  readonly warnings: InstantiationWarning[];
  readonly metrics: InstantiationMetrics;
}

/**
 * Error during instantiation
 */
export interface InstantiationError {
  readonly phase: InstantiationPhase;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly fatal: boolean;
}

/**
 * Warning during instantiation
 */
export interface InstantiationWarning {
  readonly phase: InstantiationPhase;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Metrics collected during instantiation
 */
export interface InstantiationMetrics {
  totalDurationMs: number;
  contextCreationMs: number;
  stateInitializationMs: number;
  agentResolutionMs: number;
  connectionEstablishmentMs: number;
  totalSteps: number;
  totalAgents: number;
  totalConnections: number;
  failedAgents: number;
  failedConnections: number;
}

export type InstantiationPhase =
  | 'CONTEXT_CREATION'
  | 'STATE_INITIALIZATION'
  | 'AGENT_RESOLUTION'
  | 'CONNECTION_ESTABLISHMENT'
  | 'VALIDATION';

/**
 * Result of teardown operation
 */
export interface TeardownResult {
  readonly success: boolean;
  readonly cleanedUpResources: string[];
  readonly errors: string[];
  readonly durationMs: number;
}

// ============================================================================
// Instantiation Orchestrator
// ============================================================================

/**
 * InstantiationOrchestrator coordinates the complete setup of an execution context
 *
 * Main interface:
 * - instantiate(plan: SimulationPlan): Promise<ExecutionContext>
 *   Creates isolated execution context with all resources ready
 *
 * - teardown(ctx: ExecutionContext): Promise<TeardownResult>
 *   Releases all resources, closes connections, cleans up state namespace
 */
export class InstantiationOrchestrator {
  private readonly config: InstantiationOrchestratorConfig;
  private readonly stateInitializer: StateInitializer;
  private readonly agentResolver: AgentResolver;
  private readonly connectionEstablisher: ConnectionEstablisher;
  private readonly enableStrictValidation: boolean;
  private readonly instantiationTimeout: DurationMs;

  constructor(config: InstantiationOrchestratorConfig = {}) {
    this.config = config;
    this.enableStrictValidation = config.enableStrictValidation ?? true;
    this.instantiationTimeout = config.instantiationTimeout ?? 60000;

    // Initialize sub-components
    this.stateInitializer = createStateInitializer({
      stateRepository: config.stateRepository,
      repositoryConfig: config.repositoryConfig,
      ...config.stateInitializerConfig,
    });

    this.agentResolver = createAgentResolver({
      stateRepository: config.stateRepository,
      ...config.agentResolverConfig,
    });

    this.connectionEstablisher = createConnectionEstablisher({
      stateRepository: config.stateRepository,
      ...config.connectionEstablisherConfig,
    });
  }

  /**
   * Instantiates a complete execution context for a simulation plan
   *
   * From Pseudocode Section 4:
   * 1. Create Execution Context (4.1)
   * 2. Initialize State (4.2)
   * 3. Resolve Agent Instances (4.3)
   * 4. Establish Integration Connections (4.4)
   *
   * @param tenantId - The tenant ID for multi-tenant isolation
   * @param plan - The validated simulation plan
   * @returns InstantiationResult with complete context or errors
   */
  async instantiate(tenantId: UUID, plan: SimulationPlan): Promise<InstantiationResult> {
    const startTime = Date.now();
    const errors: InstantiationError[] = [];
    const warnings: InstantiationWarning[] = [];
    const metrics: Partial<InstantiationMetrics> = {};

    let contextResult: ExecutionContextResult | undefined;
    let stateResult: StateInitializationResult | undefined;
    let agentResult: AgentResolutionResult | undefined;
    let connectionResult: ConnectionEstablishmentResult | undefined;

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Instantiation timeout after ${this.instantiationTimeout}ms`));
        }, this.instantiationTimeout);
      });

      // Run instantiation with timeout
      const instantiationPromise = this.performInstantiation(
        tenantId,
        plan,
        errors,
        warnings,
        metrics
      );

      const result = await Promise.race([instantiationPromise, timeoutPromise]);

      metrics.totalDurationMs = Date.now() - startTime;

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      errors.push({
        phase: 'VALIDATION',
        code: 'INSTANTIATION_FAILED',
        message: errorMessage,
        fatal: true,
      });

      return {
        success: false,
        errors,
        warnings,
        metrics: this.finalizeMetrics(metrics, Date.now() - startTime),
      };
    }
  }

  /**
   * Performs the actual instantiation steps
   */
  private async performInstantiation(
    tenantId: UUID,
    plan: SimulationPlan,
    errors: InstantiationError[],
    warnings: InstantiationWarning[],
    metrics: Partial<InstantiationMetrics>
  ): Promise<InstantiationResult> {
    let contextResult: ExecutionContextResult | undefined;
    let stateResult: StateInitializationResult | undefined;
    let agentResult: AgentResolutionResult | undefined;
    let connectionResult: ConnectionEstablishmentResult | undefined;

    // Phase 4.1: Create Execution Context
    const contextStartTime = Date.now();
    try {
      contextResult = createExecutionContext({
        tenantId,
        plan,
      });

      // Validate context if strict validation is enabled
      if (this.enableStrictValidation) {
        validateExecutionContext(contextResult.context);
      }
    } catch (error) {
      errors.push({
        phase: 'CONTEXT_CREATION',
        code: 'CONTEXT_CREATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      return this.buildFailureResult(errors, warnings, metrics, Date.now() - contextStartTime);
    }
    metrics.contextCreationMs = Date.now() - contextStartTime;

    // Phase 4.2: Initialize State
    const stateStartTime = Date.now();
    try {
      // Validate dependency graph before state initialization
      if (this.enableStrictValidation) {
        validateDependencyGraph(plan);
      }

      stateResult = await this.stateInitializer.initializeState(
        contextResult.context,
        plan
      );

      metrics.totalSteps = countTotalSteps(plan.workflow.steps);
    } catch (error) {
      errors.push({
        phase: 'STATE_INITIALIZATION',
        code: 'STATE_INIT_FAILED',
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      return this.buildFailureResult(errors, warnings, metrics, Date.now() - stateStartTime);
    }
    metrics.stateInitializationMs = Date.now() - stateStartTime;

    // Phase 4.3: Resolve Agent Instances
    const agentStartTime = Date.now();
    try {
      agentResult = await this.agentResolver.resolveAgentInstances(
        contextResult.context,
        plan
      );

      metrics.totalAgents = plan.agents.length;
      metrics.failedAgents = agentResult.validationErrors.length;

      // Add agent validation errors as warnings (non-fatal unless all agents failed)
      for (const agentError of agentResult.validationErrors) {
        warnings.push({
          phase: 'AGENT_RESOLUTION',
          code: agentError.errorCode,
          message: agentError.message,
          details: { agentId: agentError.agentId },
        });
      }

      // Check if we have at least one working agent
      if (agentResult.agents.size === 0 && plan.agents.length > 0) {
        errors.push({
          phase: 'AGENT_RESOLUTION',
          code: 'NO_AGENTS_AVAILABLE',
          message: 'All agents failed to resolve',
          fatal: true,
        });
        return this.buildFailureResult(errors, warnings, metrics, Date.now() - agentStartTime);
      }
    } catch (error) {
      errors.push({
        phase: 'AGENT_RESOLUTION',
        code: 'AGENT_RESOLUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      return this.buildFailureResult(errors, warnings, metrics, Date.now() - agentStartTime);
    }
    metrics.agentResolutionMs = Date.now() - agentStartTime;

    // Phase 4.4: Establish Integration Connections
    const connectionStartTime = Date.now();
    try {
      connectionResult = await this.connectionEstablisher.establishIntegrationConnections(
        contextResult.context,
        plan
      );

      metrics.totalConnections = plan.integrations.length;
      metrics.failedConnections = connectionResult.connectionErrors.length;

      // Add connection errors as warnings (non-fatal unless critical integration failed)
      for (const connError of connectionResult.connectionErrors) {
        warnings.push({
          phase: 'CONNECTION_ESTABLISHMENT',
          code: connError.errorCode,
          message: connError.message,
          details: { integrationId: connError.integrationId },
        });
      }
    } catch (error) {
      errors.push({
        phase: 'CONNECTION_ESTABLISHMENT',
        code: 'CONNECTION_ESTABLISHMENT_FAILED',
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      return this.buildFailureResult(errors, warnings, metrics, Date.now() - connectionStartTime);
    }
    metrics.connectionEstablishmentMs = Date.now() - connectionStartTime;

    // Build complete execution context
    const completeContext: CompleteExecutionContext = {
      context: contextResult.context,
      stateHandle: stateResult.stateHandle,
      agents: agentResult.agents,
      connections: connectionResult.connections,
      instantiatedAt: new Date(),
    };

    return {
      success: true,
      executionContext: completeContext,
      errors,
      warnings,
      metrics: this.finalizeMetrics(metrics, 0),
    };
  }

  /**
   * Tears down an execution context, releasing all resources
   *
   * From Pseudocode:
   * - Releases all resources
   * - Closes connections
   * - Cleans up state namespace
   *
   * @param completeContext - The complete execution context to tear down
   * @returns TeardownResult with cleanup status
   */
  async teardown(completeContext: CompleteExecutionContext): Promise<TeardownResult> {
    const startTime = Date.now();
    const cleanedUpResources: string[] = [];
    const errors: string[] = [];

    // 1. Close all integration connections
    try {
      await this.connectionEstablisher.closeConnections(completeContext.connections);
      cleanedUpResources.push('integration-connections');
    } catch (error) {
      errors.push(`Failed to close connections: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. Terminate all agent instances
    try {
      await this.agentResolver.terminateAgents(completeContext.agents);
      cleanedUpResources.push('agent-instances');
    } catch (error) {
      errors.push(`Failed to terminate agents: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Clean up state namespace
    try {
      await this.stateInitializer.cleanupState(completeContext.context);
      cleanedUpResources.push('state-namespace');
    } catch (error) {
      errors.push(`Failed to clean up state: ${error instanceof Error ? error.message : String(error)}`);
    }

    const durationMs = Date.now() - startTime;

    return {
      success: errors.length === 0,
      cleanedUpResources,
      errors,
      durationMs,
    };
  }

  /**
   * Closes all internal resources
   */
  async close(): Promise<void> {
    await this.stateInitializer.close();
  }

  /**
   * Builds a failure result with current metrics
   */
  private buildFailureResult(
    errors: InstantiationError[],
    warnings: InstantiationWarning[],
    metrics: Partial<InstantiationMetrics>,
    additionalDuration: number
  ): InstantiationResult {
    return {
      success: false,
      errors,
      warnings,
      metrics: this.finalizeMetrics(metrics, additionalDuration),
    };
  }

  /**
   * Finalizes metrics with default values
   */
  private finalizeMetrics(
    partial: Partial<InstantiationMetrics>,
    totalDuration: number
  ): InstantiationMetrics {
    return {
      totalDurationMs: partial.totalDurationMs ?? totalDuration,
      contextCreationMs: partial.contextCreationMs ?? 0,
      stateInitializationMs: partial.stateInitializationMs ?? 0,
      agentResolutionMs: partial.agentResolutionMs ?? 0,
      connectionEstablishmentMs: partial.connectionEstablishmentMs ?? 0,
      totalSteps: partial.totalSteps ?? 0,
      totalAgents: partial.totalAgents ?? 0,
      totalConnections: partial.totalConnections ?? 0,
      failedAgents: partial.failedAgents ?? 0,
      failedConnections: partial.failedConnections ?? 0,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates an InstantiationOrchestrator instance
 */
export function createInstantiationOrchestrator(
  config: InstantiationOrchestratorConfig = {}
): InstantiationOrchestrator {
  return new InstantiationOrchestrator(config);
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  createExecutionContext,
  validateExecutionContext,
  ExecutionContextConfig,
  ExecutionContextResult,
} from './context-factory.js';

export {
  StateInitializer,
  createStateInitializer,
  countTotalSteps,
  validateDependencyGraph,
  StateInitializerConfig,
  StateInitializationResult,
} from './state-initializer.js';

export {
  AgentResolver,
  createAgentResolver,
  AgentResolverConfig,
  AgentResolutionResult,
  AgentResolutionError,
} from './agent-resolver.js';

export {
  ConnectionEstablisher,
  createConnectionEstablisher,
  ConnectionEstablisherConfig,
  ConnectionEstablishmentResult,
  ConnectionEstablishmentError,
  SecureVault,
  Credential,
} from './connection-establisher.js';
