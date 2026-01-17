/**
 * Executive Synthesis Types
 *
 * Provides executive-level summary and readiness reporting for simulation execution.
 * Designed for decision-making and deployment approval workflows.
 *
 * @module synthesis/types
 */

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  SemanticVersion,
} from '../types/common.js';

// =============================================================================
// Recommendation Types
// =============================================================================

/**
 * Deployment recommendation based on simulation results
 */
export type DeploymentRecommendation = 'APPROVE' | 'DEFER' | 'REJECT';

/**
 * Risk level classification
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Blocking issue severity
 */
export type BlockingSeverity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR';

// =============================================================================
// Blocking Issue Types
// =============================================================================

/**
 * Blocking issue that prevents deployment approval
 */
export interface BlockingIssue {
  /**
   * Unique issue identifier
   */
  readonly id: string;

  /**
   * Issue severity
   */
  readonly severity: BlockingSeverity;

  /**
   * Issue category
   */
  readonly category: 'validation' | 'timeout' | 'precondition' | 'execution' | 'resource';

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Step ID where issue occurred (if applicable)
   */
  readonly stepId?: string;

  /**
   * Suggested remediation
   */
  readonly remediation?: string;

  /**
   * When the issue was detected
   */
  readonly detectedAt: ISO8601Timestamp;
}

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Synthesis metrics for executive reporting
 */
export interface SynthesisMetrics {
  /**
   * Success rate (0.0 - 1.0)
   */
  readonly success_rate: number;

  /**
   * Number of failed iterations/steps
   */
  readonly failed_iterations: number;

  /**
   * Blocking issues that prevent approval
   */
  readonly blocking_issues: readonly BlockingIssue[];

  /**
   * Total execution duration in milliseconds
   */
  readonly execution_duration_ms?: number;

  /**
   * Resource utilization percentage (0.0 - 1.0)
   */
  readonly resource_utilization?: number;

  /**
   * Token consumption total
   */
  readonly total_tokens_consumed?: number;
}

// =============================================================================
// Deploy Reference Types
// =============================================================================

/**
 * Deployment reference information
 */
export interface DeployReference {
  /**
   * Target environment
   */
  readonly environment: 'development' | 'staging' | 'production' | 'enterprise';

  /**
   * Deployment timestamp
   */
  readonly timestamp: ISO8601Timestamp;

  /**
   * Version being deployed
   */
  readonly version?: SemanticVersion;

  /**
   * Git commit SHA
   */
  readonly commit_sha?: string;

  /**
   * Simulation execution ID
   */
  readonly execution_id?: UUID;

  /**
   * Plan hash for verification
   */
  readonly plan_hash?: SHA256Hash;

  /**
   * Scenario category from simulation
   */
  readonly scenario_category?: string;
}

// =============================================================================
// Risk Assessment Types
// =============================================================================

/**
 * Risk assessment for deployment
 */
export interface RiskAssessment {
  /**
   * Overall risk level
   */
  readonly level: RiskLevel;

  /**
   * Risk factors identified
   */
  readonly factors: readonly RiskFactor[];

  /**
   * Whether risk was elevated due to production/enterprise target
   */
  readonly elevated: boolean;

  /**
   * Reason for elevation (if elevated)
   */
  readonly elevation_reason?: string;
}

/**
 * Individual risk factor
 */
export interface RiskFactor {
  /**
   * Factor identifier
   */
  readonly id: string;

  /**
   * Factor category
   */
  readonly category: string;

  /**
   * Impact description
   */
  readonly impact: string;

  /**
   * Likelihood (0.0 - 1.0)
   */
  readonly likelihood: number;

  /**
   * Mitigation suggestion
   */
  readonly mitigation?: string;
}

// =============================================================================
// Executive Summary Types
// =============================================================================

/**
 * Executive Summary - Top-level synthesis for decision making
 *
 * Provides a high-level view of simulation results suitable for
 * executive review and deployment approval workflows.
 */
export interface ExecutiveSummary {
  /**
   * Summary identifier
   */
  readonly summary_id: UUID;

  /**
   * When the summary was generated
   */
  readonly generated_at: ISO8601Timestamp;

  /**
   * Deployment reference information
   */
  readonly deploy_reference: DeployReference;

  /**
   * Key metrics for decision making
   */
  readonly metrics: SynthesisMetrics;

  /**
   * Steps executed during simulation
   */
  readonly steps_executed: readonly string[];

  /**
   * Risk assessment
   */
  readonly risk_assessment: RiskAssessment;

  /**
   * Final deployment recommendation
   */
  readonly recommendation: DeploymentRecommendation;

  /**
   * Recommendation rationale
   */
  readonly rationale: string;

  /**
   * Additional notes or observations
   */
  readonly notes?: readonly string[];
}

// =============================================================================
// Builder Input Types
// =============================================================================

/**
 * Input for building deploy reference
 */
export interface DeployReferenceInput {
  /**
   * Target environment
   */
  readonly environment: DeployReference['environment'];

  /**
   * Deployment timestamp
   */
  readonly timestamp: ISO8601Timestamp;

  /**
   * Version being deployed
   */
  readonly version?: SemanticVersion;

  /**
   * Git commit SHA
   */
  readonly commit_sha?: string;

  /**
   * Simulation execution ID
   */
  readonly execution_id?: UUID;

  /**
   * Plan hash for verification
   */
  readonly plan_hash?: SHA256Hash;

  /**
   * Scenario category from simulation
   */
  readonly scenario_category?: string;
}

/**
 * Input for building synthesis metrics
 */
export interface MetricsInput {
  /**
   * Success rate (0.0 - 1.0)
   */
  readonly success_rate: number;

  /**
   * Number of failed iterations/steps
   */
  readonly failed_iterations: number;

  /**
   * Blocking issues
   */
  readonly blocking_issues: readonly BlockingIssue[];

  /**
   * Total execution duration in milliseconds
   */
  readonly execution_duration_ms?: number;

  /**
   * Resource utilization percentage (0.0 - 1.0)
   */
  readonly resource_utilization?: number;

  /**
   * Token consumption total
   */
  readonly total_tokens_consumed?: number;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if recommendation is APPROVE
 */
export function isApproved(summary: ExecutiveSummary): boolean {
  return summary.recommendation === 'APPROVE';
}

/**
 * Check if recommendation is REJECT
 */
export function isRejected(summary: ExecutiveSummary): boolean {
  return summary.recommendation === 'REJECT';
}

/**
 * Check if recommendation is DEFER
 */
export function isDeferred(summary: ExecutiveSummary): boolean {
  return summary.recommendation === 'DEFER';
}

/**
 * Check if there are blocking issues
 */
export function hasBlockingIssues(summary: ExecutiveSummary): boolean {
  return summary.metrics.blocking_issues.length > 0;
}

/**
 * Check if risk is elevated
 */
export function hasElevatedRisk(summary: ExecutiveSummary): boolean {
  return summary.risk_assessment.elevated;
}

/**
 * Check if environment is production or enterprise
 */
export function isProductionTarget(environment: DeployReference['environment']): boolean {
  return environment === 'production' || environment === 'enterprise';
}

// =============================================================================
// Confidence Interval Types
// =============================================================================

/**
 * Statistical confidence interval for simulation metrics
 */
export interface ConfidenceInterval {
  /**
   * Lower bound of the interval
   */
  readonly lower: number;

  /**
   * Upper bound of the interval
   */
  readonly upper: number;

  /**
   * Confidence level (e.g., 0.95 for 95% confidence)
   */
  readonly confidence_level: number;

  /**
   * Sample size used to calculate the interval
   */
  readonly sample_size: number;
}

/**
 * Confidence intervals for simulation outcomes
 */
export interface OutcomeConfidenceIntervals {
  /**
   * Success rate confidence interval
   */
  readonly success_rate: ConfidenceInterval;

  /**
   * Execution duration confidence interval (in ms)
   */
  readonly duration_ms?: ConfidenceInterval;

  /**
   * Resource utilization confidence interval
   */
  readonly resource_utilization?: ConfidenceInterval;

  /**
   * Token consumption confidence interval
   */
  readonly token_consumption?: ConfidenceInterval;
}

// =============================================================================
// Anomaly Detection Types
// =============================================================================

/**
 * Anomaly severity classification
 */
export type AnomalySeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * Anomaly category classification
 */
export type AnomalyCategory =
  | 'performance'
  | 'resource'
  | 'behavior'
  | 'timing'
  | 'state'
  | 'boundary'
  | 'determinism';

/**
 * Detected anomaly during simulation execution
 */
export interface SimulationAnomaly {
  /**
   * Unique anomaly identifier
   */
  readonly id: string;

  /**
   * Anomaly severity
   */
  readonly severity: AnomalySeverity;

  /**
   * Anomaly category
   */
  readonly category: AnomalyCategory;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Step ID where anomaly was detected (if applicable)
   */
  readonly stepId?: string;

  /**
   * Expected value/behavior
   */
  readonly expected?: string;

  /**
   * Observed value/behavior
   */
  readonly observed?: string;

  /**
   * Deviation from expected (for numeric anomalies)
   */
  readonly deviation?: number;

  /**
   * Statistical z-score (if applicable)
   */
  readonly z_score?: number;

  /**
   * When the anomaly was detected
   */
  readonly detectedAt: ISO8601Timestamp;

  /**
   * Suggested action
   */
  readonly suggested_action?: string;
}

// =============================================================================
// Pre-Run Feasibility Types
// =============================================================================

/**
 * Feasibility assessment result
 */
export type FeasibilityStatus = 'FEASIBLE' | 'CONDITIONAL' | 'INFEASIBLE';

/**
 * Resource projection for pre-run analysis
 */
export interface ResourceProjection {
  /**
   * Resource type
   */
  readonly resource_type: 'cpu' | 'memory' | 'tokens' | 'time' | 'network' | 'storage';

  /**
   * Estimated requirement
   */
  readonly estimated: number;

  /**
   * Available capacity
   */
  readonly available: number;

  /**
   * Unit of measurement
   */
  readonly unit: string;

  /**
   * Utilization percentage (estimated / available)
   */
  readonly utilization_percent: number;

  /**
   * Whether this resource is a constraint
   */
  readonly is_constraint: boolean;

  /**
   * Warning if approaching limits
   */
  readonly warning?: string;
}

/**
 * Pre-run feasibility constraint
 */
export interface FeasibilityConstraint {
  /**
   * Constraint identifier
   */
  readonly id: string;

  /**
   * Constraint type
   */
  readonly type: 'resource' | 'timing' | 'dependency' | 'permission' | 'boundary';

  /**
   * Constraint description
   */
  readonly description: string;

  /**
   * Whether constraint is satisfied
   */
  readonly satisfied: boolean;

  /**
   * Severity if not satisfied
   */
  readonly severity: 'blocking' | 'warning' | 'info';

  /**
   * Remediation if not satisfied
   */
  readonly remediation?: string;
}

/**
 * Pre-run feasibility analysis result
 */
export interface PreRunFeasibility {
  /**
   * Feasibility ID
   */
  readonly feasibility_id: UUID;

  /**
   * Analysis timestamp
   */
  readonly analyzed_at: ISO8601Timestamp;

  /**
   * Overall feasibility status
   */
  readonly status: FeasibilityStatus;

  /**
   * Resource projections
   */
  readonly resource_projections: readonly ResourceProjection[];

  /**
   * Feasibility constraints
   */
  readonly constraints: readonly FeasibilityConstraint[];

  /**
   * Estimated execution duration (ms)
   */
  readonly estimated_duration_ms: number;

  /**
   * Estimated token consumption
   */
  readonly estimated_tokens: number;

  /**
   * Risk factors identified pre-run
   */
  readonly pre_run_risks: readonly RiskFactor[];

  /**
   * Recommendations before execution
   */
  readonly recommendations: readonly string[];
}

// =============================================================================
// Decision Packet Types
// =============================================================================

/**
 * Outcome category for simulation results
 */
export type OutcomeCategory =
  | 'convergence'
  | 'divergence'
  | 'timeout'
  | 'constraint_violation'
  | 'resource_exhaustion'
  | 'success'
  | 'partial_success';

/**
 * Outcome summary for Decision Packet
 */
export interface OutcomeSummary {
  /**
   * Overall outcome category
   */
  readonly category: OutcomeCategory;

  /**
   * Human-readable outcome description
   */
  readonly description: string;

  /**
   * Whether simulation converged
   */
  readonly converged: boolean;

  /**
   * Output validity assessment
   */
  readonly output_valid: boolean;

  /**
   * Resource efficiency score (0.0 - 1.0)
   */
  readonly resource_efficiency: number;

  /**
   * Number of iterations/steps completed
   */
  readonly iterations_completed: number;

  /**
   * Total iterations/steps planned
   */
  readonly iterations_planned: number;

  /**
   * Final state hash for verification
   */
  readonly final_state_hash?: SHA256Hash;
}

/**
 * Decision Packet - Complete synthesis artifact at simulation completion
 *
 * Contains outcome summary, confidence intervals, and flagged anomalies
 * for executive decision-making.
 */
export interface DecisionPacket {
  /**
   * Packet identifier
   */
  readonly packet_id: UUID;

  /**
   * Generated timestamp
   */
  readonly generated_at: ISO8601Timestamp;

  /**
   * Packet version for schema evolution
   */
  readonly packet_version: '1.0.0';

  /**
   * Reference to the execution
   */
  readonly execution_reference: {
    readonly execution_id: UUID;
    readonly plan_id: UUID;
    readonly plan_hash: SHA256Hash;
    readonly plan_version: string;
    readonly scenario_id?: string;
  };

  /**
   * Outcome summary
   */
  readonly outcome: OutcomeSummary;

  /**
   * Confidence intervals for key metrics
   */
  readonly confidence_intervals: OutcomeConfidenceIntervals;

  /**
   * Flagged anomalies
   */
  readonly anomalies: readonly SimulationAnomaly[];

  /**
   * Executive summary (existing synthesis)
   */
  readonly executive_summary: ExecutiveSummary;

  /**
   * Pre-run feasibility (if pre-run analysis was performed)
   */
  readonly pre_run_feasibility?: PreRunFeasibility;

  /**
   * Simulation-specific metadata
   */
  readonly metadata: {
    /**
     * Simulation seed used (for reproducibility)
     */
    readonly seed?: number;

    /**
     * Whether deterministic execution was achieved
     */
    readonly deterministic: boolean;

    /**
     * Environment where simulation ran
     */
    readonly environment: DeployReference['environment'];

    /**
     * Artifacts produced
     */
    readonly artifact_count: number;

    /**
     * Total execution duration (ms)
     */
    readonly total_duration_ms: number;
  };
}

// =============================================================================
// Decision Packet Type Guards
// =============================================================================

/**
 * Check if simulation converged
 */
export function hasConverged(packet: DecisionPacket): boolean {
  return packet.outcome.converged;
}

/**
 * Check if simulation output is valid
 */
export function hasValidOutput(packet: DecisionPacket): boolean {
  return packet.outcome.output_valid;
}

/**
 * Check if there are critical anomalies
 */
export function hasCriticalAnomalies(packet: DecisionPacket): boolean {
  return packet.anomalies.some((a) => a.severity === 'CRITICAL');
}

/**
 * Check if feasibility analysis was performed
 */
export function hasFeasibilityAnalysis(packet: DecisionPacket): boolean {
  return packet.pre_run_feasibility !== undefined;
}

/**
 * Check if execution was deterministic
 */
export function isDeterministicExecution(packet: DecisionPacket): boolean {
  return packet.metadata.deterministic;
}

/**
 * Check if simulation is feasible
 */
export function isFeasible(feasibility: PreRunFeasibility): boolean {
  return feasibility.status === 'FEASIBLE';
}

/**
 * Check if simulation has blocking constraints
 */
export function hasBlockingConstraints(feasibility: PreRunFeasibility): boolean {
  return feasibility.constraints.some((c) => !c.satisfied && c.severity === 'blocking');
}
