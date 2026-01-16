/**
 * Commands Module
 *
 * Provides command implementations for simulation execution with synthesis integration.
 *
 * @module commands
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  CommandStatus,
  SimulationScenario,
  SimulateCommandInput,
  SimulateCommandResult,
  SimulateRunInput,
  SimulateRunResult,
  ScenarioValidationResult,
} from './types.js';

export {
  isSuccessfulCommand,
  isSuccessfulRun,
  scenarioRequiresElevation,
} from './types.js';

// =============================================================================
// Command Exports
// =============================================================================

export {
  validateScenario,
  extractBlockingIssues,
  executeSimulateCommand,
  executeSimulateRunCommand,
} from './simulate.js';
