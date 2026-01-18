/**
 * Micro-to-Macro Synthesis Module
 *
 * Transforms micro-level simulation behavior into macro-level enterprise insights.
 * Designed for board-level readers without technical background.
 *
 * IMPORTANT: This module does NOT expose raw metrics or charts.
 * All outputs are explanatory narratives suitable for executive consumption.
 *
 * @module synthesis/micro-macro-synthesis
 */

import type { ISO8601Timestamp } from '../types/common.js';

// =============================================================================
// Micro Behavior Types (Internal - Not Exposed Directly)
// =============================================================================

/**
 * Token usage behavior classification
 */
export type TokenUsageBehavior =
  | 'efficient'
  | 'moderate'
  | 'elevated'
  | 'intensive'
  | 'unsustainable';

/**
 * Latency distribution classification
 */
export type LatencyBehavior =
  | 'optimal'
  | 'acceptable'
  | 'degraded'
  | 'concerning'
  | 'critical';

/**
 * Error probability classification
 */
export type ErrorProbability =
  | 'negligible'
  | 'low'
  | 'moderate'
  | 'elevated'
  | 'high';

/**
 * Micro-level behavior summary (internal representation)
 * These are derived from simulation telemetry but NOT exposed directly
 */
export interface MicroBehaviorSummary {
  /**
   * Token usage behavior classification
   */
  readonly tokenUsage: TokenUsageBehavior;

  /**
   * Latency distribution behavior
   */
  readonly latencyBehavior: LatencyBehavior;

  /**
   * Error probability classification
   */
  readonly errorProbability: ErrorProbability;

  /**
   * Internal: Token consumption rate relative to baseline
   */
  readonly _tokenRateRatio: number;

  /**
   * Internal: P95 latency relative to target
   */
  readonly _latencyRatio: number;

  /**
   * Internal: Error rate as decimal
   */
  readonly _errorRate: number;
}

// =============================================================================
// Macro Impact Types
// =============================================================================

/**
 * Enterprise cost variance classification
 */
export type CostVarianceLevel =
  | 'within_budget'
  | 'minor_variance'
  | 'significant_variance'
  | 'budget_overrun'
  | 'unsustainable';

/**
 * Throughput bottleneck severity
 */
export type BottleneckSeverity =
  | 'none'
  | 'minor'
  | 'moderate'
  | 'significant'
  | 'blocking';

/**
 * Policy friction classification
 */
export type PolicyFriction =
  | 'compliant'
  | 'minor_friction'
  | 'moderate_friction'
  | 'high_friction'
  | 'non_compliant';

/**
 * Macro-level enterprise impact assessment
 */
export interface MacroEnterpriseImpact {
  /**
   * Cost variance classification
   */
  readonly costVariance: CostVarianceLevel;

  /**
   * Throughput bottleneck assessment
   */
  readonly throughputBottleneck: BottleneckSeverity;

  /**
   * Policy friction level
   */
  readonly policyFriction: PolicyFriction;

  /**
   * Projected monthly cost impact (qualitative)
   */
  readonly costImpactDescription: string;

  /**
   * Throughput impact description
   */
  readonly throughputImpactDescription: string;

  /**
   * Policy compliance description
   */
  readonly policyImpactDescription: string;
}

// =============================================================================
// Executive Narrative Types
// =============================================================================

/**
 * Scaling scenario for narrative context
 */
export type ScalingScenario =
  | 'department'     // 10x scale
  | 'division'       // 100x scale
  | 'enterprise'     // 1000x scale
  | 'global';        // 10000x scale

/**
 * Complete micro-to-macro synthesis output
 */
export interface MicroMacroSynthesis {
  /**
   * Synthesis generation timestamp
   */
  readonly generatedAt: ISO8601Timestamp;

  /**
   * Micro behavior summary (for internal reference only)
   */
  readonly microSummary: MicroBehaviorSummary;

  /**
   * Macro enterprise impact
   */
  readonly macroImpact: MacroEnterpriseImpact;

  /**
   * Executive narrative paragraph
   * This is the PRIMARY output for board-level consumption
   */
  readonly executiveNarrative: string;

  /**
   * Key takeaways (3-5 bullet points in plain language)
   */
  readonly keyTakeaways: readonly string[];

  /**
   * Strategic recommendation in plain language
   */
  readonly strategicRecommendation: string;

  /**
   * Risk summary for non-technical stakeholders
   */
  readonly riskSummary: string;
}

// =============================================================================
// Input Types for Synthesis
// =============================================================================

/**
 * Input from simulation telemetry for micro-macro synthesis
 */
export interface SimulationTelemetryInput {
  /**
   * Total tokens consumed
   */
  readonly totalTokensConsumed: number;

  /**
   * Baseline token budget (expected consumption)
   */
  readonly tokenBudget: number;

  /**
   * Average latency in milliseconds
   */
  readonly averageLatencyMs: number;

  /**
   * P95 latency in milliseconds
   */
  readonly p95LatencyMs: number;

  /**
   * Target latency threshold
   */
  readonly targetLatencyMs: number;

  /**
   * Total request count
   */
  readonly totalRequests: number;

  /**
   * Failed request count
   */
  readonly failedRequests: number;

  /**
   * Total execution duration in milliseconds
   */
  readonly executionDurationMs: number;

  /**
   * Scaling scenario for projection
   */
  readonly scalingScenario: ScalingScenario;

  /**
   * Monthly cost per token (optional, for cost projections)
   */
  readonly costPerToken?: number;
}

// =============================================================================
// Classification Functions
// =============================================================================

/**
 * Classify token usage behavior from consumption ratio
 */
export function classifyTokenUsage(tokenRatio: number): TokenUsageBehavior {
  if (tokenRatio <= 0.7) return 'efficient';
  if (tokenRatio <= 1.0) return 'moderate';
  if (tokenRatio <= 1.3) return 'elevated';
  if (tokenRatio <= 2.0) return 'intensive';
  return 'unsustainable';
}

/**
 * Classify latency behavior from P95 ratio
 */
export function classifyLatency(latencyRatio: number): LatencyBehavior {
  if (latencyRatio <= 0.5) return 'optimal';
  if (latencyRatio <= 1.0) return 'acceptable';
  if (latencyRatio <= 1.5) return 'degraded';
  if (latencyRatio <= 2.5) return 'concerning';
  return 'critical';
}

/**
 * Classify error probability from error rate
 */
export function classifyErrorProbability(errorRate: number): ErrorProbability {
  if (errorRate <= 0.001) return 'negligible';
  if (errorRate <= 0.01) return 'low';
  if (errorRate <= 0.05) return 'moderate';
  if (errorRate <= 0.10) return 'elevated';
  return 'high';
}

// =============================================================================
// Micro → Macro Translation Functions
// =============================================================================

/**
 * Translate token usage to cost variance
 */
export function translateToCostVariance(tokenBehavior: TokenUsageBehavior): CostVarianceLevel {
  const mapping: Record<TokenUsageBehavior, CostVarianceLevel> = {
    efficient: 'within_budget',
    moderate: 'within_budget',
    elevated: 'minor_variance',
    intensive: 'significant_variance',
    unsustainable: 'unsustainable',
  };
  return mapping[tokenBehavior];
}

/**
 * Translate latency behavior to throughput bottleneck
 */
export function translateToBottleneck(latencyBehavior: LatencyBehavior): BottleneckSeverity {
  const mapping: Record<LatencyBehavior, BottleneckSeverity> = {
    optimal: 'none',
    acceptable: 'none',
    degraded: 'minor',
    concerning: 'moderate',
    critical: 'significant',
  };
  return mapping[latencyBehavior];
}

/**
 * Translate error probability to policy friction
 */
export function translateToPolicyFriction(errorProb: ErrorProbability): PolicyFriction {
  const mapping: Record<ErrorProbability, PolicyFriction> = {
    negligible: 'compliant',
    low: 'compliant',
    moderate: 'minor_friction',
    elevated: 'moderate_friction',
    high: 'high_friction',
  };
  return mapping[errorProb];
}

/**
 * Get scaling multiplier for scenario
 */
export function getScalingMultiplier(scenario: ScalingScenario): number {
  const multipliers: Record<ScalingScenario, number> = {
    department: 10,
    division: 100,
    enterprise: 1000,
    global: 10000,
  };
  return multipliers[scenario];
}

// =============================================================================
// Narrative Generation Functions
// =============================================================================

/**
 * Generate cost impact description
 */
export function generateCostDescription(
  costVariance: CostVarianceLevel,
  tokenBehavior: TokenUsageBehavior,
  scenario: ScalingScenario
): string {
  const scenarioLabel = {
    department: 'department-wide',
    division: 'division-wide',
    enterprise: 'enterprise-wide',
    global: 'global',
  }[scenario];

  const descriptions: Record<CostVarianceLevel, string> = {
    within_budget: `At ${scenarioLabel} scale, operational costs remain predictable and within established budgets.`,
    minor_variance: `At ${scenarioLabel} scale, expect modest cost increases that can be absorbed within quarterly adjustments.`,
    significant_variance: `At ${scenarioLabel} scale, material cost overruns are likely, requiring budget reallocation discussions.`,
    budget_overrun: `At ${scenarioLabel} scale, substantial budget overruns are projected, necessitating executive review of resource allocation.`,
    unsustainable: `At ${scenarioLabel} scale, current consumption patterns would result in costs that exceed sustainable operational thresholds.`,
  };

  return descriptions[costVariance];
}

/**
 * Generate throughput impact description
 */
export function generateThroughputDescription(
  bottleneck: BottleneckSeverity,
  latencyBehavior: LatencyBehavior,
  scenario: ScalingScenario
): string {
  const scenarioLabel = {
    department: 'departmental',
    division: 'divisional',
    enterprise: 'enterprise',
    global: 'global',
  }[scenario];

  const descriptions: Record<BottleneckSeverity, string> = {
    none: `System throughput scales linearly with ${scenarioLabel} demand without degradation.`,
    minor: `Minor processing delays may occur during peak ${scenarioLabel} usage, but remain within acceptable bounds.`,
    moderate: `Processing bottlenecks would create noticeable delays at ${scenarioLabel} scale, potentially affecting user satisfaction.`,
    significant: `Significant throughput constraints at ${scenarioLabel} scale would impact business operations and require architectural review.`,
    blocking: `Critical throughput limitations would prevent reliable ${scenarioLabel} operation without immediate infrastructure investment.`,
  };

  return descriptions[bottleneck];
}

/**
 * Generate policy impact description
 */
export function generatePolicyDescription(
  friction: PolicyFriction,
  errorProb: ErrorProbability,
  scenario: ScalingScenario
): string {
  const descriptions: Record<PolicyFriction, string> = {
    compliant: 'Error rates remain well within acceptable governance thresholds, supporting audit and compliance requirements.',
    minor_friction: 'Occasional exceptions may require manual review, but overall compliance posture remains strong.',
    moderate_friction: 'Elevated exception rates would trigger additional compliance scrutiny and may require process adjustments.',
    high_friction: 'Error patterns could create material compliance concerns, requiring remediation before broader deployment.',
    non_compliant: 'Current error profiles would not meet enterprise governance standards and require immediate attention.',
  };

  return descriptions[friction];
}

/**
 * Generate the main executive narrative paragraph
 */
export function generateExecutiveNarrative(
  micro: MicroBehaviorSummary,
  macro: MacroEnterpriseImpact,
  scenario: ScalingScenario
): string {
  const scenarioLabel = {
    department: 'department-wide',
    division: 'division-wide',
    enterprise: 'enterprise-wide',
    global: 'global',
  }[scenario];

  const multiplier = getScalingMultiplier(scenario);

  // Build narrative components based on severity
  const costNarrative = buildCostNarrative(macro.costVariance, multiplier);
  const throughputNarrative = buildThroughputNarrative(macro.throughputBottleneck, multiplier);
  const complianceNarrative = buildComplianceNarrative(macro.policyFriction);

  return `At ${scenarioLabel} scale, this micro behavior results in ${costNarrative}. ${throughputNarrative} ${complianceNarrative}`;
}

function buildCostNarrative(variance: CostVarianceLevel, multiplier: number): string {
  const narratives: Record<CostVarianceLevel, string> = {
    within_budget: 'predictable operational expenditure that aligns with financial planning assumptions',
    minor_variance: 'manageable cost variations that fall within standard contingency allocations',
    significant_variance: `cost escalations that, when projected across ${multiplier.toLocaleString()}x volume, require executive budget review`,
    budget_overrun: `substantial budget pressure that compounds at scale, potentially affecting ${multiplier >= 1000 ? 'quarterly' : 'monthly'} financial targets`,
    unsustainable: 'cost trajectories that would exceed approved operational thresholds without intervention',
  };
  return narratives[variance];
}

function buildThroughputNarrative(bottleneck: BottleneckSeverity, multiplier: number): string {
  const narratives: Record<BottleneckSeverity, string> = {
    none: 'Processing capacity scales proportionally with demand, maintaining consistent service levels.',
    minor: 'Response time consistency remains strong, with only occasional delays during demand spikes.',
    moderate: `At ${multiplier}x volume, processing delays become operationally noticeable, potentially affecting user experience metrics.`,
    significant: `Throughput constraints at ${multiplier}x scale would create cascading delays across dependent workflows, requiring capacity investment.`,
    blocking: 'Current architecture cannot sustain projected demand without fundamental infrastructure changes.',
  };
  return narratives[bottleneck];
}

function buildComplianceNarrative(friction: PolicyFriction): string {
  const narratives: Record<PolicyFriction, string> = {
    compliant: 'Governance metrics remain within established tolerances, supporting risk management objectives.',
    minor_friction: 'Minor policy exceptions may require periodic manual oversight but do not impede operations.',
    moderate_friction: 'Compliance monitoring would need enhancement to manage elevated exception handling requirements.',
    high_friction: 'Policy adherence concerns would require remediation planning before expanding operational scope.',
    non_compliant: 'Immediate attention to governance gaps is required before proceeding with broader deployment.',
  };
  return narratives[friction];
}

// =============================================================================
// Key Takeaways Generation
// =============================================================================

/**
 * Generate key takeaways for executive consumption
 */
export function generateKeyTakeaways(
  micro: MicroBehaviorSummary,
  macro: MacroEnterpriseImpact,
  scenario: ScalingScenario
): readonly string[] {
  const takeaways: string[] = [];
  const multiplier = getScalingMultiplier(scenario);

  // Cost takeaway
  if (macro.costVariance === 'within_budget' || macro.costVariance === 'minor_variance') {
    takeaways.push('Operational costs remain predictable and manageable at scale.');
  } else if (macro.costVariance === 'significant_variance') {
    takeaways.push('Budget planning should account for elevated resource consumption patterns.');
  } else {
    takeaways.push('Cost containment measures should be implemented before scaling further.');
  }

  // Throughput takeaway
  if (macro.throughputBottleneck === 'none' || macro.throughputBottleneck === 'minor') {
    takeaways.push('System performance supports business growth objectives without infrastructure changes.');
  } else if (macro.throughputBottleneck === 'moderate') {
    takeaways.push(`At ${multiplier}x volume, performance monitoring should be enhanced to identify emerging constraints.`);
  } else {
    takeaways.push('Capacity planning should precede any significant volume increase.');
  }

  // Compliance takeaway
  if (macro.policyFriction === 'compliant' || macro.policyFriction === 'minor_friction') {
    takeaways.push('Risk and compliance posture supports enterprise deployment.');
  } else {
    takeaways.push('Governance review recommended to address exception handling at scale.');
  }

  // Scaling confidence
  const overallHealth = assessOverallHealth(macro);
  if (overallHealth === 'healthy') {
    takeaways.push('Simulation results support proceeding with confidence.');
  } else if (overallHealth === 'cautious') {
    takeaways.push('Phased rollout recommended to validate behavior at intermediate scale.');
  } else {
    takeaways.push('Addressing identified concerns before scaling is strongly recommended.');
  }

  return takeaways;
}

type OverallHealth = 'healthy' | 'cautious' | 'concerning';

function assessOverallHealth(macro: MacroEnterpriseImpact): OverallHealth {
  const costScore = ['within_budget', 'minor_variance'].includes(macro.costVariance) ? 0 : 1;
  const throughputScore = ['none', 'minor'].includes(macro.throughputBottleneck) ? 0 : 1;
  const policyScore = ['compliant', 'minor_friction'].includes(macro.policyFriction) ? 0 : 1;

  const total = costScore + throughputScore + policyScore;
  if (total === 0) return 'healthy';
  if (total <= 1) return 'cautious';
  return 'concerning';
}

// =============================================================================
// Strategic Recommendation Generation
// =============================================================================

/**
 * Generate strategic recommendation
 */
export function generateStrategicRecommendation(
  macro: MacroEnterpriseImpact,
  scenario: ScalingScenario
): string {
  const health = assessOverallHealth(macro);
  const scenarioLabel = {
    department: 'department-level',
    division: 'division-level',
    enterprise: 'enterprise-wide',
    global: 'global',
  }[scenario];

  if (health === 'healthy') {
    return `Based on simulation results, ${scenarioLabel} deployment can proceed with standard monitoring protocols. No blocking concerns identified.`;
  }

  if (health === 'cautious') {
    const concerns: string[] = [];
    if (!['within_budget', 'minor_variance'].includes(macro.costVariance)) {
      concerns.push('cost optimization');
    }
    if (!['none', 'minor'].includes(macro.throughputBottleneck)) {
      concerns.push('capacity planning');
    }
    if (!['compliant', 'minor_friction'].includes(macro.policyFriction)) {
      concerns.push('compliance review');
    }

    return `Consider a phased approach to ${scenarioLabel} deployment, with enhanced attention to ${concerns.join(' and ')}. Intermediate validation checkpoints are recommended.`;
  }

  return `${scenarioLabel.charAt(0).toUpperCase() + scenarioLabel.slice(1)} deployment should be deferred pending resolution of identified concerns. A focused remediation plan addressing cost, performance, and compliance factors is recommended before re-evaluation.`;
}

// =============================================================================
// Risk Summary Generation
// =============================================================================

/**
 * Generate risk summary for non-technical stakeholders
 */
export function generateRiskSummary(
  macro: MacroEnterpriseImpact,
  scenario: ScalingScenario
): string {
  const health = assessOverallHealth(macro);
  const multiplier = getScalingMultiplier(scenario);

  if (health === 'healthy') {
    return `Low risk profile. Simulation behavior at ${multiplier}x scale indicates reliable, cost-effective, and compliant operation.`;
  }

  if (health === 'cautious') {
    const riskAreas: string[] = [];
    if (!['within_budget', 'minor_variance'].includes(macro.costVariance)) {
      riskAreas.push('budget variance');
    }
    if (!['none', 'minor'].includes(macro.throughputBottleneck)) {
      riskAreas.push('processing delays');
    }
    if (!['compliant', 'minor_friction'].includes(macro.policyFriction)) {
      riskAreas.push('policy exceptions');
    }

    return `Moderate risk profile with manageable concerns in ${riskAreas.join(' and ')}. Mitigation is straightforward with appropriate planning.`;
  }

  return `Elevated risk profile. Multiple factors require attention before scaling. Proceeding without remediation could impact operational reliability, cost predictability, or compliance standing.`;
}

// =============================================================================
// Main Synthesis Builder
// =============================================================================

/**
 * Build complete micro-to-macro synthesis from simulation telemetry
 */
export function buildMicroMacroSynthesis(
  input: SimulationTelemetryInput
): MicroMacroSynthesis {
  // Calculate ratios
  const tokenRatio = input.totalTokensConsumed / Math.max(input.tokenBudget, 1);
  const latencyRatio = input.p95LatencyMs / Math.max(input.targetLatencyMs, 1);
  const errorRate = input.failedRequests / Math.max(input.totalRequests, 1);

  // Classify micro behavior
  const microSummary: MicroBehaviorSummary = {
    tokenUsage: classifyTokenUsage(tokenRatio),
    latencyBehavior: classifyLatency(latencyRatio),
    errorProbability: classifyErrorProbability(errorRate),
    _tokenRateRatio: tokenRatio,
    _latencyRatio: latencyRatio,
    _errorRate: errorRate,
  };

  // Translate to macro impact
  const costVariance = translateToCostVariance(microSummary.tokenUsage);
  const throughputBottleneck = translateToBottleneck(microSummary.latencyBehavior);
  const policyFriction = translateToPolicyFriction(microSummary.errorProbability);

  const macroImpact: MacroEnterpriseImpact = {
    costVariance,
    throughputBottleneck,
    policyFriction,
    costImpactDescription: generateCostDescription(costVariance, microSummary.tokenUsage, input.scalingScenario),
    throughputImpactDescription: generateThroughputDescription(throughputBottleneck, microSummary.latencyBehavior, input.scalingScenario),
    policyImpactDescription: generatePolicyDescription(policyFriction, microSummary.errorProbability, input.scalingScenario),
  };

  // Generate executive outputs
  const executiveNarrative = generateExecutiveNarrative(microSummary, macroImpact, input.scalingScenario);
  const keyTakeaways = generateKeyTakeaways(microSummary, macroImpact, input.scalingScenario);
  const strategicRecommendation = generateStrategicRecommendation(macroImpact, input.scalingScenario);
  const riskSummary = generateRiskSummary(macroImpact, input.scalingScenario);

  return {
    generatedAt: new Date().toISOString() as ISO8601Timestamp,
    microSummary,
    macroImpact,
    executiveNarrative,
    keyTakeaways,
    strategicRecommendation,
    riskSummary,
  };
}

/**
 * Format synthesis as plain text for board presentation
 * This is the recommended output format for executive consumption
 */
export function formatSynthesisForBoard(synthesis: MicroMacroSynthesis): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════════',
    '                    SIMULATION READINESS ASSESSMENT',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'EXECUTIVE SUMMARY',
    '─────────────────',
    synthesis.executiveNarrative,
    '',
    'KEY TAKEAWAYS',
    '─────────────',
    ...synthesis.keyTakeaways.map((t, i) => `  ${i + 1}. ${t}`),
    '',
    'STRATEGIC RECOMMENDATION',
    '────────────────────────',
    synthesis.strategicRecommendation,
    '',
    'RISK PROFILE',
    '────────────',
    synthesis.riskSummary,
    '',
    '═══════════════════════════════════════════════════════════════════',
  ];

  return lines.join('\n');
}
