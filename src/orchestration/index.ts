/**
 * Orchestration module exports
 *
 * MOD-002: Validation Orchestrator
 * MOD-003: Instantiation Orchestrator
 * MOD-004: Execution Orchestrator
 * MOD-005: Finalization Orchestrator
 */

// Legacy validation exports (for backward compatibility)
// These are aliased to avoid conflicts with new modular validators
export {
  validateSchema as legacyValidateSchema,
  validateSemantics as legacyValidateSemantics,
  validateResourceAvailability as legacyValidateResourceAvailability,
  validateConnectivity as legacyValidateConnectivity,
  evaluatePreConditions as legacyEvaluatePreConditions,
  validatePlan as legacyValidatePlan,
  type ValidationError as LegacyValidationError,
  type ValidationWarning as LegacyValidationWarning,
  type ValidationResult as LegacyValidationResult,
  type FullValidationResult as LegacyFullValidationResult,
  type ResourcePool as LegacyResourcePool,
  type ConnectivityTester as LegacyConnectivityTester,
  type ConditionEvaluator as LegacyConditionEvaluator,
} from './validation.js';

// New modular validation system (MOD-002)
export * from './validators/index.js';

// Main Validation Orchestrator
export {
  ValidationOrchestrator,
  createValidationOrchestrator,
  getSharedValidationOrchestrator,
  validatePlan,
  type ValidationOrchestratorOptions,
} from './validation-orchestrator.js';

// MOD-003: Instantiation Orchestrator
export * from './instantiation-orchestrator.js';
export * from './context-factory.js';
export * from './state-initializer.js';
export * from './agent-resolver.js';
export * from './connection-establisher.js';

// MOD-004: Execution Orchestrator
export * from './types.js';
export * from './execution-orchestrator.js';
export * from './step-executor.js';
export * from './checkpoint-manager.js';
export * from './failure-handler.js';

// MOD-005: Finalization Orchestrator
export * from './finalization-orchestrator.js';
export * from './observation-aggregator.js';
export * from './postcondition-evaluator.js';
export * from './reproducibility-prover.js';
export * from './result-assembler.js';
