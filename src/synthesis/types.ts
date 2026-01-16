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
