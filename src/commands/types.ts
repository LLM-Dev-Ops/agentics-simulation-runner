/**
 * Command Types for Simulation Runner
 *
 * Defines types for command execution results including synthesis integration.
 *
 * @module commands/types
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  DurationMs,
  ExecutionStatus,
} from '../types/common.js';

import type { SimulationPlan } from '../types/simulation-plan.js';
import type { SimulationResult, StepResult } from '../types/simulation-result.js';
import type {
  ExecutiveSummary,
  PreRunFeasibility,
  DecisionPacket,
} from '../synthesis/index.js';

// =============================================================================
// Command Status Types
// =============================================================================

/**
 * Command execution status
 */
export type CommandStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// =============================================================================
// Scenario Types
// =============================================================================

/**
 * Scenario input for simulation
 */
export interface SimulationScenario {
  /**
   * Unique scenario identifier
   */
  readonly id: string;

  /**
   * Scenario name
   */
  readonly name: string;

  /**
   * Scenario category (e.g., 'enterprise', 'production', 'development')
   */
  readonly category?: string;

  /**
   * Scenario description
   */
  readonly description?: string;

  /**
   * Scenario-specific parameters
   */
  readonly parameters?: Record<string, unknown>;

  /**
   * Expected outcomes for validation
   */
  readonly expectedOutcomes?: readonly {
    readonly key: string;
    readonly value: unknown;
    readonly operator: 'equals' | 'contains' | 'greater_than' | 'less_than';
  }[];

  /**
   * Preconditions required for scenario
   */
  readonly preconditions?: readonly string[];

  /**
   * Tags for categorization
   */
  readonly tags?: readonly string[];
}

// =============================================================================
// Simulate Command Types
// =============================================================================

/**
 * Input for simulate command
 */
export interface SimulateCommandInput {
  /**
   * Simulation plan to execute
   */
  readonly plan: SimulationPlan;

  /**
   * Optional scenario configuration
   */
  readonly scenario?: SimulationScenario;

  /**
   * Optional deterministic seed override
   */
  readonly seed?: number;

  /**
   * Whether to run in dry-run mode
   */
  readonly dryRun?: boolean;

  /**
   * Timeout override in milliseconds
   */
  readonly timeoutMs?: DurationMs;

  /**
   * Additional execution options
   */
  readonly options?: {
    /**
     * Enable verbose logging
     */
    readonly verbose?: boolean;

    /**
     * Skip precondition validation
     */
    readonly skipPreconditions?: boolean;

    /**
     * Force execution even with warnings
     */
    readonly force?: boolean;
  };
}

/**
 * Result of simulate command execution
 */
export interface SimulateCommandResult {
  /**
   * Command execution ID
   */
  readonly commandId: UUID;

  /**
   * Command status
   */
  readonly status: CommandStatus;

  /**
   * When command started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When command completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Reference to the executed plan
   */
  readonly planReference: {
    readonly planId: UUID;
    readonly planHash: SHA256Hash;
    readonly planVersion: string;
  };

  /**
   * Simulation result (if completed)
   */
  readonly result?: SimulationResult;

  /**
   * Error details (if failed)
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };

  /**
   * Executive synthesis for readiness reporting
   */
  readonly synthesis?: ExecutiveSummary;
}

// =============================================================================
// Simulate Run Command Types
// =============================================================================

/**
 * Input for simulate run command (direct execution)
 */
export interface SimulateRunInput {
  /**
   * Simulation plan to execute
   */
  readonly plan: SimulationPlan;

  /**
   * Optional scenario configuration
   */
  readonly scenario?: SimulationScenario;

  /**
   * Optional deterministic seed
   */
  readonly seed?: number;

  /**
   * Environment context
   */
  readonly environment?: {
    /**
     * Target environment name
     */
    readonly name: 'development' | 'staging' | 'production' | 'enterprise';

    /**
     * Environment-specific variables
     */
    readonly variables?: Record<string, string>;
  };

  /**
   * Git context for traceability
   */
  readonly gitContext?: {
    /**
     * Current commit SHA
     */
    readonly commitSha?: string;

    /**
     * Branch name
     */
    readonly branch?: string;

    /**
     * Repository URL
     */
    readonly repository?: string;
  };
}

/**
 * Result of simulate run command execution
 */
export interface SimulateRunResult {
  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Execution status
   */
  readonly status: ExecutionStatus;

  /**
   * Whether execution was successful
   */
  readonly success: boolean;

  /**
   * When execution started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When execution completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Reference to the executed plan
   */
  readonly planReference: {
    readonly planId: UUID;
    readonly planHash: SHA256Hash;
  };

  /**
   * Step results
   */
  readonly stepResults: readonly StepResult[];

  /**
   * Final state hash
   */
  readonly finalStateHash?: SHA256Hash;

  /**
   * Errors encountered
   */
  readonly errors: readonly {
    readonly code: string;
    readonly message: string;
    readonly stepId?: string;
  }[];

  /**
   * Warnings generated
   */
  readonly warnings: readonly string[];

  /**
   * Executive synthesis for readiness reporting
   */
  readonly synthesis?: ExecutiveSummary;
}

// =============================================================================
// Validation Result Types
// =============================================================================

/**
 * Scenario validation result
 */
export interface ScenarioValidationResult {
  /**
   * Whether scenario is valid
   */
  readonly valid: boolean;

  /**
   * Validation errors
   */
  readonly errors: readonly {
    readonly type: 'validation' | 'precondition' | 'resource';
    readonly message: string;
    readonly field?: string;
  }[];

  /**
   * Validation warnings
   */
  readonly warnings: readonly string[];

  /**
   * Missing preconditions
   */
  readonly missingPreconditions: readonly string[];
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if command result is successful
 */
export function isSuccessfulCommand(result: SimulateCommandResult): boolean {
  return result.status === 'completed' && result.result !== undefined && !result.error;
}

/**
 * Check if run result is successful
 */
export function isSuccessfulRun(result: SimulateRunResult): boolean {
  return result.success && result.errors.length === 0;
}

/**
 * Check if scenario requires risk elevation
 */
export function scenarioRequiresElevation(scenario?: SimulationScenario): boolean {
  if (!scenario?.category) {
    return false;
  }
  const category = scenario.category.toLowerCase();
  return category === 'enterprise' || category === 'production';
}

// =============================================================================
// Simulate Create Command Types
// =============================================================================

/**
 * Resource allocation configuration for simulation creation
 */
export interface ResourceAllocation {
  /**
   * Maximum memory allocation in bytes
   */
  readonly maxMemoryBytes?: number;

  /**
   * Maximum token allocation
   */
  readonly maxTokens?: number;

  /**
   * CPU core allocation
   */
  readonly cpuCores?: number;

  /**
   * Network bandwidth limit in bytes/sec
   */
  readonly networkBandwidthBps?: number;

  /**
   * Storage allocation in bytes
   */
  readonly storageBytes?: number;
}

/**
 * Input for simulate create command
 */
export interface SimulateCreateInput {
  /**
   * Simulation plan to instantiate
   */
  readonly plan: SimulationPlan;

  /**
   * Optional scenario configuration
   */
  readonly scenario?: SimulationScenario;

  /**
   * Resource allocation configuration
   */
  readonly resources?: ResourceAllocation;

  /**
   * Whether to perform pre-run feasibility analysis
   */
  readonly analyzeFeasibility?: boolean;

  /**
   * Expected duration per step (ms) for feasibility estimation
   */
  readonly expectedDurationPerStepMs?: number;

  /**
   * Environment context
   */
  readonly environment?: {
    /**
     * Target environment name
     */
    readonly name: 'development' | 'staging' | 'production' | 'enterprise';

    /**
     * Environment-specific variables
     */
    readonly variables?: Record<string, string>;
  };

  /**
   * Git context for traceability
   */
  readonly gitContext?: {
    /**
     * Current commit SHA
     */
    readonly commitSha?: string;

    /**
     * Branch name
     */
    readonly branch?: string;

    /**
     * Repository URL
     */
    readonly repository?: string;
  };
}

/**
 * Simulation context created for execution
 */
export interface SimulationContext {
  /**
   * Context identifier
   */
  readonly contextId: UUID;

  /**
   * Plan reference
   */
  readonly planReference: {
    readonly planId: UUID;
    readonly planHash: SHA256Hash;
    readonly planVersion: string;
  };

  /**
   * Scenario reference (if provided)
   */
  readonly scenarioReference?: {
    readonly scenarioId: string;
    readonly scenarioName: string;
    readonly category?: string;
  };

  /**
   * Allocated resources
   */
  readonly allocatedResources: ResourceAllocation;

  /**
   * Creation timestamp
   */
  readonly createdAt: ISO8601Timestamp;

  /**
   * Expiration timestamp (context is valid until)
   */
  readonly expiresAt: ISO8601Timestamp;

  /**
   * Target environment
   */
  readonly environment: 'development' | 'staging' | 'production' | 'enterprise';

  /**
   * Estimated step count
   */
  readonly estimatedSteps: number;

  /**
   * Ready for execution
   */
  readonly ready: boolean;
}

/**
 * Result of simulate create command
 */
export interface SimulateCreateResult {
  /**
   * Command execution ID
   */
  readonly commandId: UUID;

  /**
   * Command status
   */
  readonly status: CommandStatus;

  /**
   * When command started
   */
  readonly startedAt: ISO8601Timestamp;

  /**
   * When command completed
   */
  readonly completedAt: ISO8601Timestamp;

  /**
   * Total duration in milliseconds
   */
  readonly durationMs: DurationMs;

  /**
   * Created simulation context (if successful)
   */
  readonly context?: SimulationContext;

  /**
   * Pre-run feasibility analysis (if requested)
   */
  readonly feasibility?: PreRunFeasibility;

  /**
   * Validation warnings
   */
  readonly warnings: readonly string[];

  /**
   * Error details (if failed)
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };

  /**
   * Executive synthesis for readiness reporting
   */
  readonly synthesis?: ExecutiveSummary;
}

// =============================================================================
// Enhanced Simulate Run Result with Decision Packet
// =============================================================================

/**
 * Enhanced simulate run result with Decision Packet
 */
export interface SimulateRunResultWithPacket extends SimulateRunResult {
  /**
   * Decision Packet containing outcome summary, confidence intervals, and anomalies
   */
  readonly decisionPacket?: DecisionPacket;
}

/**
 * Enhanced simulate command result with Decision Packet
 */
export interface SimulateCommandResultWithPacket extends SimulateCommandResult {
  /**
   * Decision Packet containing outcome summary, confidence intervals, and anomalies
   */
  readonly decisionPacket?: DecisionPacket;
}

// =============================================================================
// Type Guards for New Types
// =============================================================================

/**
 * Check if create result is successful
 */
export function isSuccessfulCreate(result: SimulateCreateResult): boolean {
  return result.status === 'completed' && result.context !== undefined && !result.error;
}

/**
 * Check if simulation context is ready
 */
export function isContextReady(context: SimulationContext): boolean {
  return context.ready && new Date(context.expiresAt) > new Date();
}

/**
 * Check if feasibility allows execution
 */
export function canProceedWithExecution(result: SimulateCreateResult): boolean {
  if (!result.context?.ready) {
    return false;
  }
  if (result.feasibility && result.feasibility.status === 'INFEASIBLE') {
    return false;
  }
  return true;
}
