/**
 * Commands Module
 *
 * Provides command implementations for simulation execution with synthesis integration.
 * Includes Decision Packet generation and pre-run feasibility analysis.
 *
 * @module commands
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core command types
  CommandStatus,
  SimulationScenario,
  SimulateCommandInput,
  SimulateCommandResult,
  SimulateRunInput,
  SimulateRunResult,
  ScenarioValidationResult,
  // Simulate create types
  ResourceAllocation,
  SimulateCreateInput,
  SimulationContext,
  SimulateCreateResult,
  // Enhanced result types with Decision Packet
  SimulateRunResultWithPacket,
  SimulateCommandResultWithPacket,
} from './types.js';

export {
  // Existing type guards
  isSuccessfulCommand,
  isSuccessfulRun,
  scenarioRequiresElevation,
  // New type guards
  isSuccessfulCreate,
  isContextReady,
  canProceedWithExecution,
} from './types.js';

// =============================================================================
// Command Exports
// =============================================================================

export {
  // Validation and helpers
  validateScenario,
  extractBlockingIssues,
  // Core commands
  executeSimulateCommand,
  executeSimulateRunCommand,
  // Simulate create command
  executeSimulateCreateCommand,
  // Enhanced commands with Decision Packet
  executeSimulateCommandWithPacket,
  executeSimulateRunCommandWithPacket,
} from './simulate.js';
