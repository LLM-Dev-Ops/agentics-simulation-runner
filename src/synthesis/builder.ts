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
  // Decision Packet types
  DecisionPacket,
  OutcomeSummary,
  OutcomeCategory,
  OutcomeConfidenceIntervals,
  ConfidenceInterval,
  SimulationAnomaly,
  AnomalySeverity,
  AnomalyCategory,
  // Pre-run feasibility types
  PreRunFeasibility,
  FeasibilityStatus,
  ResourceProjection,
  FeasibilityConstraint,
} from './types.js';

import type { SHA256Hash } from '../types/common.js';

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

// =============================================================================
// Confidence Interval Builder
// =============================================================================

/**
 * Build a confidence interval using normal approximation
 */
export function buildConfidenceInterval(
  point_estimate: number,
  sample_size: number,
  confidence_level: number = 0.95
): ConfidenceInterval {
  // Z-scores for common confidence levels
  const z_scores: Record<number, number> = {
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  };

  const z = z_scores[confidence_level] ?? 1.96;

  // Standard error approximation for proportions
  const se = Math.sqrt((point_estimate * (1 - point_estimate)) / Math.max(sample_size, 1));
  const margin = z * se;

  return {
    lower: Math.max(0, point_estimate - margin),
    upper: Math.min(1, point_estimate + margin),
    confidence_level,
    sample_size,
  };
}

/**
 * Build confidence interval for duration metrics
 */
export function buildDurationConfidenceInterval(
  mean_duration: number,
  sample_size: number,
  std_dev?: number,
  confidence_level: number = 0.95
): ConfidenceInterval {
  const z_scores: Record<number, number> = {
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  };

  const z = z_scores[confidence_level] ?? 1.96;

  // Use coefficient of variation approximation if std_dev not provided
  const estimated_std_dev = std_dev ?? mean_duration * 0.2;
  const se = estimated_std_dev / Math.sqrt(Math.max(sample_size, 1));
  const margin = z * se;

  return {
    lower: Math.max(0, mean_duration - margin),
    upper: mean_duration + margin,
    confidence_level,
    sample_size,
  };
}

// =============================================================================
// Anomaly Detection Builder
// =============================================================================

/**
 * Create a simulation anomaly
 */
export function createSimulationAnomaly(
  severity: AnomalySeverity,
  category: AnomalyCategory,
  description: string,
  options?: {
    stepId?: string;
    expected?: string;
    observed?: string;
    deviation?: number;
    z_score?: number;
    suggested_action?: string;
  }
): SimulationAnomaly {
  return {
    id: uuidv4(),
    severity,
    category,
    description,
    stepId: options?.stepId,
    expected: options?.expected,
    observed: options?.observed,
    deviation: options?.deviation,
    z_score: options?.z_score,
    detectedAt: new Date().toISOString() as ISO8601Timestamp,
    suggested_action: options?.suggested_action,
  };
}

/**
 * Detect anomalies from step results
 */
export function detectAnomalies(
  stepResults: readonly { status: string; durationMs?: number; stepId: string }[],
  expectedDurationMs?: number,
  deterministic?: boolean,
  seed?: number
): SimulationAnomaly[] {
  const anomalies: SimulationAnomaly[] = [];

  // Check for timing anomalies
  if (expectedDurationMs !== undefined) {
    for (const step of stepResults) {
      if (step.durationMs !== undefined) {
        const deviation = (step.durationMs - expectedDurationMs) / expectedDurationMs;
        if (Math.abs(deviation) > 0.5) {
          anomalies.push(
            createSimulationAnomaly(
              deviation > 1 ? 'WARNING' : 'INFO',
              'timing',
              `Step ${step.stepId} duration deviated ${(deviation * 100).toFixed(0)}% from expected`,
              {
                stepId: step.stepId,
                expected: `${expectedDurationMs}ms`,
                observed: `${step.durationMs}ms`,
                deviation,
                suggested_action: deviation > 1 ? 'Investigate performance bottleneck' : undefined,
              }
            )
          );
        }
      }
    }
  }

  // Check for non-determinism when seed is provided
  if (seed !== undefined && deterministic === false) {
    anomalies.push(
      createSimulationAnomaly('WARNING', 'determinism', 'Non-deterministic behavior detected despite seed being set', {
        expected: 'Deterministic execution',
        observed: 'Non-deterministic execution',
        suggested_action: 'Review steps for external dependencies or race conditions',
      })
    );
  }

  // Check for state anomalies (failure patterns)
  const failedSteps = stepResults.filter((s) => s.status === 'failure' || s.status === 'failed');
  if (failedSteps.length > stepResults.length * 0.5) {
    anomalies.push(
      createSimulationAnomaly('ERROR', 'behavior', 'High failure rate detected across steps', {
        expected: 'Majority of steps succeed',
        observed: `${failedSteps.length}/${stepResults.length} steps failed`,
        deviation: failedSteps.length / stepResults.length,
        suggested_action: 'Review simulation configuration and preconditions',
      })
    );
  }

  return anomalies;
}

// =============================================================================
// Outcome Summary Builder
// =============================================================================

/**
 * Determine outcome category from execution results
 */
export function determineOutcomeCategory(
  completed: boolean,
  success: boolean,
  timedOut: boolean,
  resourceExhausted: boolean,
  constraintViolation: boolean,
  successRate: number
): OutcomeCategory {
  if (timedOut) return 'timeout';
  if (resourceExhausted) return 'resource_exhaustion';
  if (constraintViolation) return 'constraint_violation';
  if (!completed) return 'divergence';
  if (success && successRate === 1.0) return 'success';
  if (successRate > 0) return 'partial_success';
  return 'convergence';
}

/**
 * Build outcome summary from execution results
 */
export function buildOutcomeSummary(
  stepResults: readonly { status: string }[],
  completed: boolean,
  timedOut: boolean,
  resourceExhausted: boolean,
  constraintViolation: boolean,
  plannedIterations: number,
  finalStateHash?: SHA256Hash
): OutcomeSummary {
  const completedIterations = stepResults.filter(
    (s) => s.status === 'success' || s.status === 'completed'
  ).length;
  const successRate = plannedIterations > 0 ? completedIterations / plannedIterations : 0;
  const success = successRate === 1.0 && completed;

  const category = determineOutcomeCategory(
    completed,
    success,
    timedOut,
    resourceExhausted,
    constraintViolation,
    successRate
  );

  // Determine convergence
  const converged = category === 'success' || category === 'partial_success' || category === 'convergence';

  // Determine output validity
  const output_valid = completed && !constraintViolation && successRate >= 0.5;

  // Calculate resource efficiency (simplified)
  const resource_efficiency = Math.min(1.0, successRate * (completed ? 1.0 : 0.5));

  // Generate description
  const descriptions: Record<OutcomeCategory, string> = {
    success: 'Simulation completed successfully with all steps passing.',
    partial_success: `Simulation completed with ${(successRate * 100).toFixed(0)}% success rate.`,
    convergence: 'Simulation converged to a stable state.',
    divergence: 'Simulation failed to converge to a stable state.',
    timeout: 'Simulation timed out before completion.',
    resource_exhaustion: 'Simulation terminated due to resource exhaustion.',
    constraint_violation: 'Simulation terminated due to constraint violation.',
  };

  return {
    category,
    description: descriptions[category],
    converged,
    output_valid,
    resource_efficiency,
    iterations_completed: completedIterations,
    iterations_planned: plannedIterations,
    final_state_hash: finalStateHash,
  };
}

// =============================================================================
// Pre-Run Feasibility Builder
// =============================================================================

/**
 * Input for building pre-run feasibility
 */
export interface PreRunFeasibilityInput {
  /**
   * Planned step count
   */
  readonly plannedSteps: number;

  /**
   * Expected duration per step (ms)
   */
  readonly expectedDurationPerStepMs: number;

  /**
   * Timeout configuration (ms)
   */
  readonly timeoutMs: number;

  /**
   * Token limit
   */
  readonly tokenLimit?: number;

  /**
   * Estimated tokens per step
   */
  readonly estimatedTokensPerStep?: number;

  /**
   * Memory limit (bytes)
   */
  readonly memoryLimitBytes?: number;

  /**
   * Estimated memory per step (bytes)
   */
  readonly estimatedMemoryPerStepBytes?: number;

  /**
   * Required preconditions
   */
  readonly requiredPreconditions?: readonly string[];

  /**
   * Available preconditions
   */
  readonly availablePreconditions?: readonly string[];

  /**
   * Target environment
   */
  readonly environment: DeployReference['environment'];
}

/**
 * Build pre-run feasibility analysis
 */
export function buildPreRunFeasibility(input: PreRunFeasibilityInput): PreRunFeasibility {
  const feasibilityId = uuidv4() as UUID;
  const analyzedAt = new Date().toISOString() as ISO8601Timestamp;

  const resourceProjections: ResourceProjection[] = [];
  const constraints: FeasibilityConstraint[] = [];
  const preRunRisks: RiskFactor[] = [];
  const recommendations: string[] = [];

  // Estimate duration
  const estimatedDurationMs = input.plannedSteps * input.expectedDurationPerStepMs;
  const timeUtilization = estimatedDurationMs / input.timeoutMs;

  resourceProjections.push({
    resource_type: 'time',
    estimated: estimatedDurationMs,
    available: input.timeoutMs,
    unit: 'ms',
    utilization_percent: timeUtilization * 100,
    is_constraint: timeUtilization > 0.9,
    warning: timeUtilization > 0.8 ? 'Execution time approaching timeout limit' : undefined,
  });

  if (timeUtilization > 1.0) {
    constraints.push({
      id: 'time-constraint',
      type: 'timing',
      description: 'Estimated duration exceeds timeout configuration',
      satisfied: false,
      severity: 'blocking',
      remediation: 'Increase timeout or reduce number of steps',
    });
  }

  // Estimate tokens
  const estimatedTokens = input.estimatedTokensPerStep
    ? input.plannedSteps * input.estimatedTokensPerStep
    : input.plannedSteps * 1000; // Default estimate

  if (input.tokenLimit) {
    const tokenUtilization = estimatedTokens / input.tokenLimit;
    resourceProjections.push({
      resource_type: 'tokens',
      estimated: estimatedTokens,
      available: input.tokenLimit,
      unit: 'tokens',
      utilization_percent: tokenUtilization * 100,
      is_constraint: tokenUtilization > 0.9,
      warning: tokenUtilization > 0.8 ? 'Token usage approaching limit' : undefined,
    });

    if (tokenUtilization > 1.0) {
      constraints.push({
        id: 'token-constraint',
        type: 'resource',
        description: 'Estimated token usage exceeds limit',
        satisfied: false,
        severity: 'blocking',
        remediation: 'Increase token limit or reduce step complexity',
      });
    }
  }

  // Check memory
  if (input.memoryLimitBytes && input.estimatedMemoryPerStepBytes) {
    const estimatedMemory = input.plannedSteps * input.estimatedMemoryPerStepBytes;
    const memoryUtilization = estimatedMemory / input.memoryLimitBytes;
    resourceProjections.push({
      resource_type: 'memory',
      estimated: estimatedMemory,
      available: input.memoryLimitBytes,
      unit: 'bytes',
      utilization_percent: memoryUtilization * 100,
      is_constraint: memoryUtilization > 0.9,
      warning: memoryUtilization > 0.8 ? 'Memory usage approaching limit' : undefined,
    });
  }

  // Check preconditions
  if (input.requiredPreconditions && input.requiredPreconditions.length > 0) {
    const available = new Set(input.availablePreconditions ?? []);
    const missing = input.requiredPreconditions.filter((p) => !available.has(p));

    if (missing.length > 0) {
      constraints.push({
        id: 'precondition-constraint',
        type: 'dependency',
        description: `Missing preconditions: ${missing.join(', ')}`,
        satisfied: false,
        severity: 'blocking',
        remediation: 'Ensure all required preconditions are available',
      });
    } else {
      constraints.push({
        id: 'precondition-constraint',
        type: 'dependency',
        description: 'All preconditions satisfied',
        satisfied: true,
        severity: 'info',
      });
    }
  }

  // Add production risk
  if (isProductionTarget(input.environment)) {
    preRunRisks.push({
      id: 'production-target',
      category: 'deployment',
      impact: 'Simulation targeting production environment',
      likelihood: 1.0,
      mitigation: 'Ensure thorough testing in staging first',
    });
    recommendations.push('Consider running simulation in staging environment first');
  }

  // Add resource utilization risk
  if (resourceProjections.some((r) => r.utilization_percent > 80)) {
    preRunRisks.push({
      id: 'high-resource-utilization',
      category: 'resource',
      impact: 'High resource utilization may cause performance issues',
      likelihood: 0.7,
      mitigation: 'Monitor resource usage during execution',
    });
  }

  // Determine overall status
  const blockingConstraints = constraints.filter((c) => !c.satisfied && c.severity === 'blocking');
  const warningConstraints = constraints.filter((c) => !c.satisfied && c.severity === 'warning');

  let status: FeasibilityStatus;
  if (blockingConstraints.length > 0) {
    status = 'INFEASIBLE';
  } else if (warningConstraints.length > 0 || preRunRisks.length > 0) {
    status = 'CONDITIONAL';
  } else {
    status = 'FEASIBLE';
  }

  // Add recommendations based on status
  if (status === 'INFEASIBLE') {
    recommendations.push('Resolve blocking constraints before execution');
  } else if (status === 'CONDITIONAL') {
    recommendations.push('Review warnings and risks before proceeding');
  }

  return {
    feasibility_id: feasibilityId,
    analyzed_at: analyzedAt,
    status,
    resource_projections: resourceProjections,
    constraints,
    estimated_duration_ms: estimatedDurationMs,
    estimated_tokens: estimatedTokens,
    pre_run_risks: preRunRisks,
    recommendations,
  };
}

// =============================================================================
// Decision Packet Builder
// =============================================================================

/**
 * Input for building a Decision Packet
 */
export interface DecisionPacketInput {
  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Plan ID
   */
  readonly planId: UUID;

  /**
   * Plan hash
   */
  readonly planHash: SHA256Hash;

  /**
   * Plan version
   */
  readonly planVersion: string;

  /**
   * Scenario ID (if applicable)
   */
  readonly scenarioId?: string;

  /**
   * Step results from execution
   */
  readonly stepResults: readonly { status: string; durationMs?: number; stepId: string }[];

  /**
   * Planned step count
   */
  readonly plannedSteps: number;

  /**
   * Whether execution completed
   */
  readonly completed: boolean;

  /**
   * Whether execution timed out
   */
  readonly timedOut: boolean;

  /**
   * Whether resources were exhausted
   */
  readonly resourceExhausted: boolean;

  /**
   * Whether constraints were violated
   */
  readonly constraintViolation: boolean;

  /**
   * Final state hash
   */
  readonly finalStateHash?: SHA256Hash;

  /**
   * Simulation seed
   */
  readonly seed?: number;

  /**
   * Whether execution was deterministic
   */
  readonly deterministic: boolean;

  /**
   * Target environment
   */
  readonly environment: DeployReference['environment'];

  /**
   * Artifact count
   */
  readonly artifactCount: number;

  /**
   * Total duration in ms
   */
  readonly totalDurationMs: number;

  /**
   * Executive summary (existing synthesis)
   */
  readonly executiveSummary: ExecutiveSummary;

  /**
   * Pre-run feasibility (if analysis was performed)
   */
  readonly preRunFeasibility?: PreRunFeasibility;

  /**
   * Expected duration per step (for anomaly detection)
   */
  readonly expectedDurationPerStepMs?: number;
}

/**
 * Build a Decision Packet from execution results
 */
export function buildDecisionPacket(input: DecisionPacketInput): DecisionPacket {
  const packetId = uuidv4() as UUID;
  const generatedAt = new Date().toISOString() as ISO8601Timestamp;

  // Build outcome summary
  const outcome = buildOutcomeSummary(
    input.stepResults,
    input.completed,
    input.timedOut,
    input.resourceExhausted,
    input.constraintViolation,
    input.plannedSteps,
    input.finalStateHash
  );

  // Calculate success rate for confidence intervals
  const successRate = input.plannedSteps > 0
    ? input.stepResults.filter((s) => s.status === 'success' || s.status === 'completed').length / input.plannedSteps
    : 0;

  // Build confidence intervals
  const confidence_intervals: OutcomeConfidenceIntervals = {
    success_rate: buildConfidenceInterval(successRate, input.stepResults.length),
    duration_ms: input.totalDurationMs > 0
      ? buildDurationConfidenceInterval(
          input.totalDurationMs / Math.max(input.stepResults.length, 1),
          input.stepResults.length
        )
      : undefined,
  };

  // Detect anomalies
  const anomalies = detectAnomalies(
    input.stepResults,
    input.expectedDurationPerStepMs,
    input.deterministic,
    input.seed
  );

  return {
    packet_id: packetId,
    generated_at: generatedAt,
    packet_version: '1.0.0',
    execution_reference: {
      execution_id: input.executionId,
      plan_id: input.planId,
      plan_hash: input.planHash,
      plan_version: input.planVersion,
      scenario_id: input.scenarioId,
    },
    outcome,
    confidence_intervals,
    anomalies,
    executive_summary: input.executiveSummary,
    pre_run_feasibility: input.preRunFeasibility,
    metadata: {
      seed: input.seed,
      deterministic: input.deterministic,
      environment: input.environment,
      artifact_count: input.artifactCount,
      total_duration_ms: input.totalDurationMs,
    },
  };
}
