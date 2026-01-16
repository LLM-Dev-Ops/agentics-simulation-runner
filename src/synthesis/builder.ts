/**
 * Executive Synthesis Builder
 *
 * Provides builder functions for constructing ExecutiveSummary and related types.
 * Implements recommendation mapping and risk elevation logic.
 *
 * @module synthesis/builder
 */

import { v4 as uuidv4 } from 'uuid';

import type { UUID, ISO8601Timestamp } from '../types/common.js';

import type {
  ExecutiveSummary,
  DeployReference,
  DeployReferenceInput,
  SynthesisMetrics,
  MetricsInput,
  RiskAssessment,
  RiskLevel,
  DeploymentRecommendation,
  BlockingIssue,
  BlockingSeverity,
  RiskFactor,
} from './types.js';

import { isProductionTarget } from './types.js';

// =============================================================================
// Blocking Issue Detection
// =============================================================================

/**
 * Create a blocking issue for validation errors
 */
export function createValidationBlockingIssue(
  description: string,
  stepId?: string,
  remediation?: string
): BlockingIssue {
  return {
    id: uuidv4(),
    severity: 'BLOCKER',
    category: 'validation',
    description,
    stepId,
    remediation,
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Create a blocking issue for timeout conditions
 */
export function createTimeoutBlockingIssue(
  description: string,
  stepId?: string,
  remediation?: string
): BlockingIssue {
  return {
    id: uuidv4(),
    severity: 'CRITICAL',
    category: 'timeout',
    description,
    stepId,
    remediation: remediation ?? 'Increase timeout configuration or optimize step execution',
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Create a blocking issue for missing preconditions
 */
export function createPreconditionBlockingIssue(
  description: string,
  stepId?: string,
  remediation?: string
): BlockingIssue {
  return {
    id: uuidv4(),
    severity: 'BLOCKER',
    category: 'precondition',
    description,
    stepId,
    remediation: remediation ?? 'Ensure all preconditions are met before execution',
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Create a blocking issue for execution errors
 */
export function createExecutionBlockingIssue(
  description: string,
  severity: BlockingSeverity = 'MAJOR',
  stepId?: string,
  remediation?: string
): BlockingIssue {
  return {
    id: uuidv4(),
    severity,
    category: 'execution',
    description,
    stepId,
    remediation,
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Create a blocking issue for resource exhaustion
 */
export function createResourceBlockingIssue(
  description: string,
  remediation?: string
): BlockingIssue {
  return {
    id: uuidv4(),
    severity: 'CRITICAL',
    category: 'resource',
    description,
    remediation: remediation ?? 'Increase resource limits or optimize resource usage',
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

// =============================================================================
// Risk Assessment
// =============================================================================

/**
 * Calculate risk level based on metrics and blocking issues
 */
export function calculateRiskLevel(metrics: SynthesisMetrics): RiskLevel {
  // Critical if any blocker severity issues
  const hasBlockers = metrics.blocking_issues.some((issue) => issue.severity === 'BLOCKER');
  if (hasBlockers) {
    return 'CRITICAL';
  }

  // High if success rate is below 50% or has critical issues
  const hasCritical = metrics.blocking_issues.some((issue) => issue.severity === 'CRITICAL');
  if (metrics.success_rate < 0.5 || hasCritical) {
    return 'HIGH';
  }

  // Medium if success rate is below 90% or has major issues
  const hasMajor = metrics.blocking_issues.some((issue) => issue.severity === 'MAJOR');
  if (metrics.success_rate < 0.9 || hasMajor || metrics.failed_iterations > 0) {
    return 'MEDIUM';
  }

  // Low if everything looks good
  return 'LOW';
}

/**
 * Build risk assessment from metrics
 */
export function buildRiskAssessment(
  metrics: SynthesisMetrics,
  environment: DeployReference['environment']
): RiskAssessment {
  const baseLevel = calculateRiskLevel(metrics);
  const factors: RiskFactor[] = [];

  // Add risk factors based on metrics
  if (metrics.success_rate < 1.0) {
    factors.push({
      id: 'partial-success',
      category: 'execution',
      impact: `Success rate is ${(metrics.success_rate * 100).toFixed(1)}%`,
      likelihood: 1 - metrics.success_rate,
      mitigation: 'Review and fix failing scenarios',
    });
  }

  if (metrics.failed_iterations > 0) {
    factors.push({
      id: 'failed-iterations',
      category: 'execution',
      impact: `${metrics.failed_iterations} iteration(s) failed`,
      likelihood: metrics.failed_iterations / (metrics.failed_iterations + 1),
      mitigation: 'Investigate and resolve failing steps',
    });
  }

  if (metrics.blocking_issues.length > 0) {
    factors.push({
      id: 'blocking-issues',
      category: 'deployment',
      impact: `${metrics.blocking_issues.length} blocking issue(s) detected`,
      likelihood: 1.0,
      mitigation: 'Resolve all blocking issues before deployment',
    });
  }

  // Check for production/enterprise elevation
  const elevated = isProductionTarget(environment);
  let finalLevel = baseLevel;
  let elevation_reason: string | undefined;

  if (elevated && baseLevel !== 'CRITICAL') {
    // Elevate risk for production/enterprise
    const levelMap: Record<RiskLevel, RiskLevel> = {
      LOW: 'MEDIUM',
      MEDIUM: 'HIGH',
      HIGH: 'CRITICAL',
      CRITICAL: 'CRITICAL',
    };
    finalLevel = levelMap[baseLevel];
    elevation_reason = `Risk elevated from ${baseLevel} to ${finalLevel} due to ${environment} environment target`;
  }

  return {
    level: finalLevel,
    factors,
    elevated,
    elevation_reason,
  };
}

/**
 * Elevate risk assessment for production environments
 * Modifies the summary in place
 */
export function elevateRiskForProduction(summary: ExecutiveSummary): ExecutiveSummary {
  if (summary.risk_assessment.elevated) {
    return summary; // Already elevated
  }

  const currentLevel = summary.risk_assessment.level;
  const levelMap: Record<RiskLevel, RiskLevel> = {
    LOW: 'MEDIUM',
    MEDIUM: 'HIGH',
    HIGH: 'CRITICAL',
    CRITICAL: 'CRITICAL',
  };

  const newLevel = levelMap[currentLevel];

  return {
    ...summary,
    risk_assessment: {
      ...summary.risk_assessment,
      level: newLevel,
      elevated: true,
      elevation_reason: `Risk elevated from ${currentLevel} to ${newLevel} for production deployment`,
    },
  };
}

// =============================================================================
// Recommendation Mapping
// =============================================================================

/**
 * Determine deployment recommendation based on execution status and success
 *
 * Mapping:
 * - Completed + success → APPROVE
 * - Completed + partial success → DEFER
 * - Failed → REJECT
 */
export function determineRecommendation(
  completed: boolean,
  success: boolean,
  partialSuccess: boolean,
  blockingIssues: readonly BlockingIssue[]
): DeploymentRecommendation {
  // Any blocker-severity issues → REJECT
  if (blockingIssues.some((issue) => issue.severity === 'BLOCKER')) {
    return 'REJECT';
  }

  // Not completed → REJECT
  if (!completed) {
    return 'REJECT';
  }

  // Completed with full success → APPROVE
  if (success && blockingIssues.length === 0) {
    return 'APPROVE';
  }

  // Completed with partial success → DEFER
  if (partialSuccess) {
    return 'DEFER';
  }

  // Default to REJECT for safety
  return 'REJECT';
}

/**
 * Generate rationale for the recommendation
 */
export function generateRationale(
  recommendation: DeploymentRecommendation,
  metrics: SynthesisMetrics,
  riskAssessment: RiskAssessment
): string {
  switch (recommendation) {
    case 'APPROVE':
      return `Simulation completed successfully with ${(metrics.success_rate * 100).toFixed(0)}% success rate. ` +
        `No blocking issues detected. Risk level: ${riskAssessment.level}.`;

    case 'DEFER':
      return `Simulation completed with partial success (${(metrics.success_rate * 100).toFixed(0)}% success rate). ` +
        `${metrics.failed_iterations} failed iteration(s). ` +
        `Review recommended before deployment. Risk level: ${riskAssessment.level}.`;

    case 'REJECT':
      const issueCount = metrics.blocking_issues.length;
      const blockerCount = metrics.blocking_issues.filter((i) => i.severity === 'BLOCKER').length;
      return `Deployment not recommended. ` +
        `${issueCount} blocking issue(s) detected (${blockerCount} blocker(s)). ` +
        `Success rate: ${(metrics.success_rate * 100).toFixed(0)}%. ` +
        `Risk level: ${riskAssessment.level}.`;
  }
}

// =============================================================================
// Executive Summary Builder
// =============================================================================

/**
 * Build an ExecutiveSummary from deployment reference, metrics, and steps
 */
export function buildExecutiveSummary(
  deployReference: DeployReferenceInput,
  metricsInput: MetricsInput,
  stepsExecuted: readonly string[],
  notes?: readonly string[]
): ExecutiveSummary {
  const summaryId = uuidv4() as UUID;
  const generatedAt = new Date().toISOString() as ISO8601Timestamp;

  // Build deploy reference
  const deploy_reference: DeployReference = {
    environment: deployReference.environment,
    timestamp: deployReference.timestamp,
    version: deployReference.version,
    commit_sha: deployReference.commit_sha,
    execution_id: deployReference.execution_id,
    plan_hash: deployReference.plan_hash,
    scenario_category: deployReference.scenario_category,
  };

  // Build metrics
  const metrics: SynthesisMetrics = {
    success_rate: metricsInput.success_rate,
    failed_iterations: metricsInput.failed_iterations,
    blocking_issues: metricsInput.blocking_issues,
    execution_duration_ms: metricsInput.execution_duration_ms,
    resource_utilization: metricsInput.resource_utilization,
    total_tokens_consumed: metricsInput.total_tokens_consumed,
  };

  // Build risk assessment
  const risk_assessment = buildRiskAssessment(metrics, deploy_reference.environment);

  // Determine recommendation
  const completed = true; // Assume completed if we're building synthesis
  const success = metrics.success_rate === 1.0;
  const partialSuccess = metrics.success_rate > 0 && metrics.success_rate < 1.0;
  const recommendation = determineRecommendation(
    completed,
    success,
    partialSuccess,
    metrics.blocking_issues
  );

  // Generate rationale
  const rationale = generateRationale(recommendation, metrics, risk_assessment);

  return {
    summary_id: summaryId,
    generated_at: generatedAt,
    deploy_reference,
    metrics,
    steps_executed: stepsExecuted,
    risk_assessment,
    recommendation,
    rationale,
    notes,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine environment from scenario category
 */
export function determineEnvironmentFromCategory(
  category?: string
): DeployReference['environment'] {
  if (!category) {
    return 'development';
  }

  const lowerCategory = category.toLowerCase();

  if (lowerCategory.includes('production') || lowerCategory.includes('prod')) {
    return 'production';
  }

  if (lowerCategory.includes('enterprise') || lowerCategory.includes('ent')) {
    return 'enterprise';
  }

  if (lowerCategory.includes('staging') || lowerCategory.includes('stage')) {
    return 'staging';
  }

  return 'development';
}

/**
 * Count failed steps from step results
 */
export function countFailedSteps(
  stepResults: readonly { status: string }[]
): number {
  return stepResults.filter(
    (step) => step.status === 'failure' || step.status === 'failed'
  ).length;
}

/**
 * Calculate success rate from step results
 */
export function calculateSuccessRate(
  stepResults: readonly { status: string }[]
): number {
  if (stepResults.length === 0) {
    return 1.0; // No steps = success
  }

  const successful = stepResults.filter(
    (step) => step.status === 'success' || step.status === 'completed'
  ).length;

  return successful / stepResults.length;
}

/**
 * Check if scenario category requires risk elevation
 */
export function shouldElevateRisk(category?: string): boolean {
  if (!category) {
    return false;
  }

  const lowerCategory = category.toLowerCase();
  return (
    lowerCategory.includes('enterprise') ||
    lowerCategory.includes('production') ||
    lowerCategory.includes('prod') ||
    lowerCategory.includes('critical')
  );
}
