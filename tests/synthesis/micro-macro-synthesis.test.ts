/**
 * Micro-to-Macro Synthesis Tests
 *
 * Tests the transformation of micro-level simulation behavior into
 * macro-level enterprise insights and executive narratives.
 */

import { describe, it, expect } from 'vitest';
import {
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
  generateExecutiveNarrative,
  generateKeyTakeaways,
  generateStrategicRecommendation,
  generateRiskSummary,
  // Main synthesis builder
  buildMicroMacroSynthesis,
  formatSynthesisForBoard,
  // Types
  type SimulationTelemetryInput,
  type MicroBehaviorSummary,
  type MacroEnterpriseImpact,
} from '../../src/synthesis/index.js';

describe('Micro Behavior Classification', () => {
  describe('classifyTokenUsage', () => {
    it('classifies efficient token usage when ratio <= 0.7', () => {
      expect(classifyTokenUsage(0.5)).toBe('efficient');
      expect(classifyTokenUsage(0.7)).toBe('efficient');
    });

    it('classifies moderate token usage when ratio <= 1.0', () => {
      expect(classifyTokenUsage(0.8)).toBe('moderate');
      expect(classifyTokenUsage(1.0)).toBe('moderate');
    });

    it('classifies elevated token usage when ratio <= 1.3', () => {
      expect(classifyTokenUsage(1.1)).toBe('elevated');
      expect(classifyTokenUsage(1.3)).toBe('elevated');
    });

    it('classifies intensive token usage when ratio <= 2.0', () => {
      expect(classifyTokenUsage(1.5)).toBe('intensive');
      expect(classifyTokenUsage(2.0)).toBe('intensive');
    });

    it('classifies unsustainable token usage when ratio > 2.0', () => {
      expect(classifyTokenUsage(2.5)).toBe('unsustainable');
      expect(classifyTokenUsage(5.0)).toBe('unsustainable');
    });
  });

  describe('classifyLatency', () => {
    it('classifies optimal latency when ratio <= 0.5', () => {
      expect(classifyLatency(0.3)).toBe('optimal');
      expect(classifyLatency(0.5)).toBe('optimal');
    });

    it('classifies acceptable latency when ratio <= 1.0', () => {
      expect(classifyLatency(0.7)).toBe('acceptable');
      expect(classifyLatency(1.0)).toBe('acceptable');
    });

    it('classifies degraded latency when ratio <= 1.5', () => {
      expect(classifyLatency(1.2)).toBe('degraded');
      expect(classifyLatency(1.5)).toBe('degraded');
    });

    it('classifies concerning latency when ratio <= 2.5', () => {
      expect(classifyLatency(2.0)).toBe('concerning');
      expect(classifyLatency(2.5)).toBe('concerning');
    });

    it('classifies critical latency when ratio > 2.5', () => {
      expect(classifyLatency(3.0)).toBe('critical');
      expect(classifyLatency(10.0)).toBe('critical');
    });
  });

  describe('classifyErrorProbability', () => {
    it('classifies negligible error probability when rate <= 0.001', () => {
      expect(classifyErrorProbability(0.0005)).toBe('negligible');
      expect(classifyErrorProbability(0.001)).toBe('negligible');
    });

    it('classifies low error probability when rate <= 0.01', () => {
      expect(classifyErrorProbability(0.005)).toBe('low');
      expect(classifyErrorProbability(0.01)).toBe('low');
    });

    it('classifies moderate error probability when rate <= 0.05', () => {
      expect(classifyErrorProbability(0.03)).toBe('moderate');
      expect(classifyErrorProbability(0.05)).toBe('moderate');
    });

    it('classifies elevated error probability when rate <= 0.10', () => {
      expect(classifyErrorProbability(0.07)).toBe('elevated');
      expect(classifyErrorProbability(0.10)).toBe('elevated');
    });

    it('classifies high error probability when rate > 0.10', () => {
      expect(classifyErrorProbability(0.15)).toBe('high');
      expect(classifyErrorProbability(0.5)).toBe('high');
    });
  });
});

describe('Micro to Macro Translation', () => {
  describe('translateToCostVariance', () => {
    it('translates efficient/moderate token usage to within_budget', () => {
      expect(translateToCostVariance('efficient')).toBe('within_budget');
      expect(translateToCostVariance('moderate')).toBe('within_budget');
    });

    it('translates elevated token usage to minor_variance', () => {
      expect(translateToCostVariance('elevated')).toBe('minor_variance');
    });

    it('translates intensive token usage to significant_variance', () => {
      expect(translateToCostVariance('intensive')).toBe('significant_variance');
    });

    it('translates unsustainable token usage to unsustainable', () => {
      expect(translateToCostVariance('unsustainable')).toBe('unsustainable');
    });
  });

  describe('translateToBottleneck', () => {
    it('translates optimal/acceptable latency to no bottleneck', () => {
      expect(translateToBottleneck('optimal')).toBe('none');
      expect(translateToBottleneck('acceptable')).toBe('none');
    });

    it('translates degraded latency to minor bottleneck', () => {
      expect(translateToBottleneck('degraded')).toBe('minor');
    });

    it('translates concerning latency to moderate bottleneck', () => {
      expect(translateToBottleneck('concerning')).toBe('moderate');
    });

    it('translates critical latency to significant bottleneck', () => {
      expect(translateToBottleneck('critical')).toBe('significant');
    });
  });

  describe('translateToPolicyFriction', () => {
    it('translates negligible/low error probability to compliant', () => {
      expect(translateToPolicyFriction('negligible')).toBe('compliant');
      expect(translateToPolicyFriction('low')).toBe('compliant');
    });

    it('translates moderate error probability to minor_friction', () => {
      expect(translateToPolicyFriction('moderate')).toBe('minor_friction');
    });

    it('translates elevated error probability to moderate_friction', () => {
      expect(translateToPolicyFriction('elevated')).toBe('moderate_friction');
    });

    it('translates high error probability to high_friction', () => {
      expect(translateToPolicyFriction('high')).toBe('high_friction');
    });
  });

  describe('getScalingMultiplier', () => {
    it('returns correct multipliers for each scenario', () => {
      expect(getScalingMultiplier('department')).toBe(10);
      expect(getScalingMultiplier('division')).toBe(100);
      expect(getScalingMultiplier('enterprise')).toBe(1000);
      expect(getScalingMultiplier('global')).toBe(10000);
    });
  });
});

describe('buildMicroMacroSynthesis', () => {
  it('builds complete synthesis from healthy simulation telemetry', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 5000,
      tokenBudget: 10000,
      averageLatencyMs: 100,
      p95LatencyMs: 150,
      targetLatencyMs: 300,
      totalRequests: 1000,
      failedRequests: 1,
      executionDurationMs: 60000,
      scalingScenario: 'enterprise',
    };

    const synthesis = buildMicroMacroSynthesis(input);

    // Verify micro summary
    expect(synthesis.microSummary.tokenUsage).toBe('efficient');
    expect(synthesis.microSummary.latencyBehavior).toBe('optimal');
    // 1/1000 = 0.001 which is at boundary, classifies as negligible
    expect(synthesis.microSummary.errorProbability).toBe('negligible');

    // Verify macro impact
    expect(synthesis.macroImpact.costVariance).toBe('within_budget');
    expect(synthesis.macroImpact.throughputBottleneck).toBe('none');
    expect(synthesis.macroImpact.policyFriction).toBe('compliant');

    // Verify narrative contains expected content
    expect(synthesis.executiveNarrative).toContain('enterprise-wide scale');
    expect(synthesis.executiveNarrative).toContain('predictable');

    // Verify key takeaways are generated
    expect(synthesis.keyTakeaways.length).toBeGreaterThanOrEqual(3);

    // Verify strategic recommendation
    expect(synthesis.strategicRecommendation).toContain('enterprise-wide deployment');

    // Verify risk summary indicates low risk
    expect(synthesis.riskSummary).toContain('Low risk');
  });

  it('builds synthesis with concerns for stressed simulation', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 25000,
      tokenBudget: 10000,
      averageLatencyMs: 500,
      p95LatencyMs: 800,
      targetLatencyMs: 300,
      totalRequests: 1000,
      failedRequests: 80,
      executionDurationMs: 120000,
      scalingScenario: 'global',
    };

    const synthesis = buildMicroMacroSynthesis(input);

    // Verify micro summary indicates problems
    expect(synthesis.microSummary.tokenUsage).toBe('unsustainable');
    // 800/300 = 2.67 which is > 2.5, classifies as critical
    expect(synthesis.microSummary.latencyBehavior).toBe('critical');
    expect(synthesis.microSummary.errorProbability).toBe('elevated');

    // Verify macro impact reflects concerns
    expect(synthesis.macroImpact.costVariance).toBe('unsustainable');
    // critical latency translates to significant bottleneck
    expect(synthesis.macroImpact.throughputBottleneck).toBe('significant');
    expect(synthesis.macroImpact.policyFriction).toBe('moderate_friction');

    // Verify risk summary indicates elevated risk
    expect(synthesis.riskSummary).toContain('Elevated risk');
  });

  it('builds synthesis for department-level scaling', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 8000,
      tokenBudget: 10000,
      averageLatencyMs: 200,
      p95LatencyMs: 350,
      targetLatencyMs: 300,
      totalRequests: 500,
      failedRequests: 10,
      executionDurationMs: 30000,
      scalingScenario: 'department',
    };

    const synthesis = buildMicroMacroSynthesis(input);

    expect(synthesis.executiveNarrative).toContain('department-wide');
    expect(synthesis.microSummary.tokenUsage).toBe('moderate');
    expect(synthesis.microSummary.latencyBehavior).toBe('degraded');
  });
});

describe('Narrative Generation', () => {
  const healthyMicro: MicroBehaviorSummary = {
    tokenUsage: 'efficient',
    latencyBehavior: 'optimal',
    errorProbability: 'negligible',
    _tokenRateRatio: 0.5,
    _latencyRatio: 0.4,
    _errorRate: 0.0005,
  };

  const healthyMacro: MacroEnterpriseImpact = {
    costVariance: 'within_budget',
    throughputBottleneck: 'none',
    policyFriction: 'compliant',
    costImpactDescription: 'Costs are predictable.',
    throughputImpactDescription: 'No bottlenecks.',
    policyImpactDescription: 'Fully compliant.',
  };

  describe('generateExecutiveNarrative', () => {
    it('generates narrative starting with "At enterprise scale"', () => {
      const narrative = generateExecutiveNarrative(healthyMicro, healthyMacro, 'enterprise');
      expect(narrative).toMatch(/^At enterprise-wide scale, this micro behavior results in/);
    });

    it('includes appropriate content for healthy simulation', () => {
      const narrative = generateExecutiveNarrative(healthyMicro, healthyMacro, 'enterprise');
      expect(narrative).toContain('predictable');
      expect(narrative).toContain('Governance');
    });
  });

  describe('generateKeyTakeaways', () => {
    it('generates 3-5 key takeaways', () => {
      const takeaways = generateKeyTakeaways(healthyMicro, healthyMacro, 'enterprise');
      expect(takeaways.length).toBeGreaterThanOrEqual(3);
      expect(takeaways.length).toBeLessThanOrEqual(5);
    });

    it('generates takeaways in plain language without technical jargon', () => {
      const takeaways = generateKeyTakeaways(healthyMicro, healthyMacro, 'enterprise');
      takeaways.forEach((t) => {
        // Should not contain raw numbers or technical terms
        expect(t).not.toMatch(/\d+ms/);
        expect(t).not.toMatch(/p95|p99/i);
        expect(t).not.toMatch(/tokens?\/s/i);
      });
    });
  });

  describe('generateStrategicRecommendation', () => {
    it('recommends proceeding for healthy simulation', () => {
      const recommendation = generateStrategicRecommendation(healthyMacro, 'enterprise');
      expect(recommendation).toContain('proceed');
      expect(recommendation).toContain('No blocking concerns');
    });

    it('recommends deferral for concerning simulation', () => {
      const concerningMacro: MacroEnterpriseImpact = {
        ...healthyMacro,
        costVariance: 'significant_variance',
        throughputBottleneck: 'significant',
        policyFriction: 'high_friction',
      };
      const recommendation = generateStrategicRecommendation(concerningMacro, 'enterprise');
      expect(recommendation).toContain('deferred');
    });
  });

  describe('generateRiskSummary', () => {
    it('indicates low risk for healthy simulation', () => {
      const summary = generateRiskSummary(healthyMacro, 'enterprise');
      expect(summary).toContain('Low risk');
    });

    it('indicates elevated risk for concerning simulation', () => {
      const concerningMacro: MacroEnterpriseImpact = {
        ...healthyMacro,
        costVariance: 'unsustainable',
        throughputBottleneck: 'blocking',
      };
      const summary = generateRiskSummary(concerningMacro, 'enterprise');
      expect(summary).toContain('Elevated risk');
    });
  });
});

describe('formatSynthesisForBoard', () => {
  it('formats synthesis as readable text without raw metrics', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 5000,
      tokenBudget: 10000,
      averageLatencyMs: 100,
      p95LatencyMs: 150,
      targetLatencyMs: 300,
      totalRequests: 1000,
      failedRequests: 1,
      executionDurationMs: 60000,
      scalingScenario: 'enterprise',
    };

    const synthesis = buildMicroMacroSynthesis(input);
    const formatted = formatSynthesisForBoard(synthesis);

    // Should have clear section headers
    expect(formatted).toContain('EXECUTIVE SUMMARY');
    expect(formatted).toContain('KEY TAKEAWAYS');
    expect(formatted).toContain('STRATEGIC RECOMMENDATION');
    expect(formatted).toContain('RISK PROFILE');

    // Should NOT contain raw metrics
    expect(formatted).not.toContain('5000');
    expect(formatted).not.toContain('10000');
    expect(formatted).not.toContain('150ms');
    expect(formatted).not.toContain('0.001');
  });

  it('includes the executive narrative paragraph', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 5000,
      tokenBudget: 10000,
      averageLatencyMs: 100,
      p95LatencyMs: 150,
      targetLatencyMs: 300,
      totalRequests: 1000,
      failedRequests: 1,
      executionDurationMs: 60000,
      scalingScenario: 'enterprise',
    };

    const synthesis = buildMicroMacroSynthesis(input);
    const formatted = formatSynthesisForBoard(synthesis);

    expect(formatted).toContain(synthesis.executiveNarrative);
    expect(formatted).toContain(synthesis.strategicRecommendation);
    expect(formatted).toContain(synthesis.riskSummary);
  });
});

describe('No Raw Metrics Exposure', () => {
  it('does not expose internal ratio values in any output', () => {
    const input: SimulationTelemetryInput = {
      totalTokensConsumed: 12345,
      tokenBudget: 10000,
      averageLatencyMs: 234,
      p95LatencyMs: 456,
      targetLatencyMs: 300,
      totalRequests: 9876,
      failedRequests: 543,
      executionDurationMs: 87654,
      scalingScenario: 'enterprise',
    };

    const synthesis = buildMicroMacroSynthesis(input);
    const formatted = formatSynthesisForBoard(synthesis);

    // None of the raw input values should appear in the formatted output
    expect(formatted).not.toContain('12345');
    expect(formatted).not.toContain('10000');
    expect(formatted).not.toContain('234');
    expect(formatted).not.toContain('456');
    expect(formatted).not.toContain('9876');
    expect(formatted).not.toContain('543');
    expect(formatted).not.toContain('87654');

    // Internal ratios should not appear
    expect(formatted).not.toMatch(/1\.23|0\.55|0\.05/);
  });
});
