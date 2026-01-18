/**
 * Executive Synthesis Module
 *
 * Provides executive-level summary and readiness reporting for simulation execution.
 * Includes Decision Packet generation with confidence intervals and anomaly detection.
 * Includes Micro-to-Macro synthesis for board-level executive narratives.
 *
 * @module synthesis
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core synthesis types
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
  // Confidence interval types
  ConfidenceInterval,
  OutcomeConfidenceIntervals,
  // Anomaly types
  AnomalySeverity,
  AnomalyCategory,
  SimulationAnomaly,
  // Pre-run feasibility types
  FeasibilityStatus,
  ResourceProjection,
  FeasibilityConstraint,
  PreRunFeasibility,
  // Decision Packet types
  OutcomeCategory,
  OutcomeSummary,
  DecisionPacket,
} from './types.js';

export {
  // Executive summary type guards
  isApproved,
  isRejected,
  isDeferred,
  hasBlockingIssues,
  hasElevatedRisk,
  isProductionTarget,
  // Decision Packet type guards
  hasConverged,
  hasValidOutput,
  hasCriticalAnomalies,
  hasFeasibilityAnalysis,
  isDeterministicExecution,
  // Pre-run feasibility type guards
  isFeasible,
  hasBlockingConstraints,
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
  // Confidence interval builders
  buildConfidenceInterval,
  buildDurationConfidenceInterval,
  // Anomaly detection
  createSimulationAnomaly,
  detectAnomalies,
  // Outcome summary builder
  determineOutcomeCategory,
  buildOutcomeSummary,
  // Pre-run feasibility builder
  buildPreRunFeasibility,
  // Decision Packet builder
  buildDecisionPacket,
} from './builder.js';

export type { PreRunFeasibilityInput, DecisionPacketInput } from './builder.js';

// =============================================================================
// Micro-to-Macro Synthesis Exports
// =============================================================================

export type {
  // Micro behavior types
  TokenUsageBehavior,
  LatencyBehavior,
  ErrorProbability,
  MicroBehaviorSummary,
  // Macro impact types
  CostVarianceLevel,
  BottleneckSeverity,
  PolicyFriction,
  MacroEnterpriseImpact,
  // Scaling and synthesis types
  ScalingScenario,
  MicroMacroSynthesis,
  SimulationTelemetryInput,
} from './micro-macro-synthesis.js';

export {
  // Classification functions
  classifyTokenUsage,
  classifyLatency,
  classifyErrorProbability,
  // Translation functions
  translateToCostVariance,
  translateToBottleneck,
  translateToPolicyFriction,
  getScalingMultiplier,
  // Narrative generation
  generateCostDescription,
  generateThroughputDescription,
  generatePolicyDescription,
  generateExecutiveNarrative,
  generateKeyTakeaways,
  generateStrategicRecommendation,
  generateRiskSummary,
  // Main synthesis builder
  buildMicroMacroSynthesis,
  formatSynthesisForBoard,
} from './micro-macro-synthesis.js';
