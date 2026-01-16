/**
 * Executive Synthesis Module
 *
 * Provides executive-level summary and readiness reporting for simulation execution.
 *
 * @module synthesis
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  DeploymentRecommendation,
  RiskLevel,
  BlockingSeverity,
  BlockingIssue,
  SynthesisMetrics,
  DeployReference,
  DeployReferenceInput,
  RiskAssessment,
  RiskFactor,
  ExecutiveSummary,
  MetricsInput,
} from './types.js';

export {
  isApproved,
  isRejected,
  isDeferred,
  hasBlockingIssues,
  hasElevatedRisk,
  isProductionTarget,
} from './types.js';

// =============================================================================
// Builder Exports
// =============================================================================

export {
  // Blocking issue creators
  createValidationBlockingIssue,
  createTimeoutBlockingIssue,
  createPreconditionBlockingIssue,
  createExecutionBlockingIssue,
  createResourceBlockingIssue,
  // Risk assessment
  calculateRiskLevel,
  buildRiskAssessment,
  elevateRiskForProduction,
  // Recommendation
  determineRecommendation,
  generateRationale,
  // Executive summary builder
  buildExecutiveSummary,
  // Helpers
  determineEnvironmentFromCategory,
  countFailedSteps,
  calculateSuccessRate,
  shouldElevateRisk,
} from './builder.js';
