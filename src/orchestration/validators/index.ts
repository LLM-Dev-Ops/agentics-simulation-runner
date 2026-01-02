/**
 * Validators Module Index
 *
 * Exports all validator functions and types for the Validation Orchestrator (MOD-002).
 *
 * This module implements Phase 1 (VALIDATION) of the Master Execution Flow:
 * - Schema Validation (INV-IN-001)
 * - Semantic Validation (INV-IN-002, INV-IN-003, INV-IN-005)
 * - Resource Validation (INV-IN-007)
 * - Connectivity Validation (INV-IN-006)
 * - Pre-Condition Evaluation
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3
 */

// Types
export type {
  ValidationSeverity,
  ValidationError,
  ValidationWarning,
  ValidationPhase,
  ValidationResult,
  FullValidationResult,
  ResourcePool,
  TenantResourceLimits,
  ConnectivityTestResult,
  ConnectivityTester,
  ConditionEvaluationResult,
  ConditionEvaluator,
  SyncValidator,
  AsyncValidator,
} from './types.js';

export {
  createEmptyResult,
  createErrorResult,
  mergeResults,
} from './types.js';

// Schema Validator (INV-IN-001)
export {
  validateSchema,
  validateRequiredFields,
  validateWorkflowStepsStructure,
  type SchemaValidatorOptions,
} from './schema-validator.js';

// Semantic Validator (INV-IN-002, INV-IN-003, INV-IN-005)
export {
  validateSemantics,
  verifyPlanHash,
  checkDependencyCycles,
  validateAllReferences,
  validateAgentInvocationSpecs,
  validateStepUniqueness,
  type SemanticValidatorOptions,
} from './semantic-validator.js';

// Resource Validator (INV-IN-007)
export {
  validateResourceAvailability,
  queryResourcePool,
  estimateResourceRequirements,
  DEFAULT_RESOURCE_POOL,
  type ResourceValidatorOptions,
} from './resource-validator.js';

// Connectivity Validator (INV-IN-006)
export {
  validateIntegrationConnectivity,
  validateIntegrationCredentials,
  validateIntegrationConfigurations,
  DefaultConnectivityTester,
  type ConnectivityValidatorOptions,
} from './connectivity-validator.js';

// Pre-Condition Evaluator
export {
  evaluatePreConditions,
  evaluatePostConditions,
  createEvaluationContext,
  DefaultConditionEvaluator,
  type PreConditionEvaluatorOptions,
} from './precondition-evaluator.js';
