/**
 * Simulate Command Implementation
 *
 * Executes simulation plans and produces results with executive synthesis
 * for readiness reporting.
 *
 * @module commands/simulate
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  SHA256Hash,
  ISO8601Timestamp,
  ExecutionStatus,
} from '../types/common.js';

import type { SimulationPlan } from '../types/simulation-plan.js';
import type { StepResult } from '../types/simulation-result.js';

import {
  SimulationEngineInvoker,
  createSimulationEngineInvoker,
} from '../engine/simulation-engine-invoker.js';

import {
  buildExecutiveSummary,
  elevateRiskForProduction,
  determineEnvironmentFromCategory,
  calculateSuccessRate,
  countFailedSteps,
  shouldElevateRisk,
  createValidationBlockingIssue,
  createTimeoutBlockingIssue,
  createPreconditionBlockingIssue,
  createExecutionBlockingIssue,
  type BlockingIssue,
  type ExecutiveSummary,
} from '../synthesis/index.js';

import type {
  SimulateCommandInput,
  SimulateCommandResult,
  SimulateRunInput,
  SimulateRunResult,
  SimulationScenario,
  ScenarioValidationResult,
  CommandStatus,
} from './types.js';

import { scenarioRequiresElevation } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Standard steps executed during simulation
 */
const SIMULATION_STEPS = [
  'scenario parsing',
  'simulation engine invocation',
  'results validation',
] as const;

// =============================================================================
// Scenario Validation
// =============================================================================

/**
 * Validate scenario configuration
 */
export function validateScenario(
  scenario: SimulationScenario | undefined,
  plan: SimulationPlan
): ScenarioValidationResult {
  const errors: Array<{
    readonly type: 'validation' | 'precondition' | 'resource';
    readonly message: string;
    readonly field?: string;
  }> = [];
  const warnings: string[] = [];
  const missingPreconditions: string[] = [];

  if (!scenario) {
    return {
      valid: true,
      errors: [],
      warnings: ['No scenario provided, using default configuration'],
      missingPreconditions: [],
    };
  }

  // Check required scenario fields
  if (!scenario.id) {
    errors.push({
      type: 'validation',
      message: 'Scenario ID is required',
      field: 'id',
    });
  }

  if (!scenario.name) {
    errors.push({
      type: 'validation',
      message: 'Scenario name is required',
      field: 'name',
    });
  }

  // Check preconditions against plan
  if (scenario.preconditions && scenario.preconditions.length > 0) {
    const planConditions = plan.validation?.preConditions?.map((c) => c.id) ?? [];

    for (const precondition of scenario.preconditions) {
      if (!planConditions.includes(precondition)) {
        missingPreconditions.push(precondition);
      }
    }

    if (missingPreconditions.length > 0) {
      errors.push({
        type: 'precondition',
        message: `Missing preconditions: ${missingPreconditions.join(', ')}`,
      });
    }
  }

  // Add warnings for production/enterprise scenarios
  if (scenarioRequiresElevation(scenario)) {
    warnings.push(
      `Scenario category '${scenario.category}' will trigger risk elevation`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingPreconditions,
  };
}

// =============================================================================
// Blocking Issue Detection
// =============================================================================

/**
 * Extract blocking issues from simulation execution
 */
export function extractBlockingIssues(
  stepResults: readonly StepResult[],
  validationResult: ScenarioValidationResult,
  executionStatus: ExecutionStatus,
  timeoutOccurred: boolean
): BlockingIssue[] {
  const issues: BlockingIssue[] = [];

  // Check for validation errors
  for (const error of validationResult.errors) {
    if (error.type === 'validation') {
      issues.push(
        createValidationBlockingIssue(
          error.message,
          undefined,
          'Fix the validation error in the scenario configuration'
        )
      );
    }
  }

  // Check for missing preconditions
  if (validationResult.missingPreconditions.length > 0) {
    issues.push(
      createPreconditionBlockingIssue(
        `Missing preconditions: ${validationResult.missingPreconditions.join(', ')}`,
        undefined,
        'Add the required preconditions to the simulation plan'
      )
    );
  }

  // Check for timeout conditions
  if (timeoutOccurred || executionStatus === 'timeout') {
    issues.push(
      createTimeoutBlockingIssue(
        'Simulation execution timed out',
        undefined,
        'Increase timeout configuration or optimize simulation steps'
      )
    );
  }

  // Check for execution errors in steps
  for (const step of stepResults) {
    if (step.status === 'failure') {
      issues.push(
        createExecutionBlockingIssue(
          step.error?.message ?? `Step ${step.stepId} failed`,
          'MAJOR',
          step.stepId,
          'Investigate and fix the failing step'
        )
      );
    }

    if (step.status === 'timeout') {
      issues.push(
        createTimeoutBlockingIssue(
          `Step ${step.stepId} timed out`,
          step.stepId,
          'Increase step timeout or optimize step execution'
        )
      );
    }
  }

  return issues;
}

// =============================================================================
// Execute Simulate Command
// =============================================================================

/**
 * Execute a simulate command with synthesis generation
 *
 * @param input - Simulate command input
 * @returns Simulate command result with executive synthesis
 */
export async function executeSimulateCommand(
  input: SimulateCommandInput
): Promise<SimulateCommandResult> {
  const commandId = uuidv4() as UUID;
  const startedAt = new Date();
  const startTimestamp = startedAt.toISOString() as ISO8601Timestamp;

  let status: CommandStatus = 'running';
  let timeoutOccurred = false;

  try {
    // Validate scenario
    const validationResult = validateScenario(input.scenario, input.plan);

    if (!validationResult.valid && !input.options?.force) {
      const completedAt = new Date();

      // Build synthesis for failed validation
      const blockingIssues = extractBlockingIssues(
        [],
        validationResult,
        'failed',
        false
      );

      const environment = determineEnvironmentFromCategory(input.scenario?.category);

      let synthesis = buildExecutiveSummary(
        {
          environment,
          timestamp: completedAt.toISOString() as ISO8601Timestamp,
          version: input.plan.planVersion,
          commit_sha: process.env['GIT_SHA'],
          execution_id: commandId,
          plan_hash: input.plan.planHash,
          scenario_category: input.scenario?.category,
        },
        {
          success_rate: 0,
          failed_iterations: validationResult.errors.length,
          blocking_issues: blockingIssues,
        },
        ['scenario parsing'],
      );

      // Elevate risk for production scenarios
      if (shouldElevateRisk(input.scenario?.category)) {
        synthesis = elevateRiskForProduction(synthesis);
      }

      return {
        commandId,
        status: 'failed',
        startedAt: startTimestamp,
        completedAt: completedAt.toISOString() as ISO8601Timestamp,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        planReference: {
          planId: input.plan.planId,
          planHash: input.plan.planHash,
          planVersion: input.plan.planVersion,
        },
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Scenario validation failed',
          details: {
            errors: validationResult.errors,
            missingPreconditions: validationResult.missingPreconditions,
          },
        },
        synthesis,
      };
    }

    // Create engine invoker
    const invoker = createSimulationEngineInvoker();

    // Set up timeout handling
    const timeoutMs = input.timeoutMs ?? input.plan.executionConfig.timeoutSeconds * 1000;
    let executionPromise = invoker.invoke(input.plan, input.seed);

    // Wrap with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timeoutOccurred = true;
        reject(new Error('Simulation execution timed out'));
      }, timeoutMs);
    });

    // Execute simulation
    const engineResult = await Promise.race([executionPromise, timeoutPromise]);

    const completedAt = new Date();

    // Extract step results for synthesis
    const stepResults: StepResult[] = engineResult.stepResults.map((step) => ({
      stepId: step.stepId,
      workflowId: step.workflowId,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs: step.durationMs,
      inputsSnapshot: step.inputsSnapshot,
      outputs: step.outputs,
      sequenceNumber: step.sequenceNumber,
      error: step.error,
    }));

    // Build blocking issues
    const blockingIssues = extractBlockingIssues(
      stepResults,
      validationResult,
      engineResult.status,
      timeoutOccurred
    );

    // Calculate metrics
    const successRate = engineResult.status === 'completed' && engineResult.errors.length === 0 ? 1.0 : calculateSuccessRate(stepResults);
    const failedIterations = countFailedSteps(stepResults);

    // Determine environment
    const environment = determineEnvironmentFromCategory(input.scenario?.category);

    // Build executive synthesis
    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: process.env['GIT_SHA'],
        execution_id: engineResult.executionId,
        plan_hash: input.plan.planHash,
        scenario_category: input.scenario?.category,
      },
      {
        success_rate: successRate,
        failed_iterations: failedIterations,
        blocking_issues: blockingIssues,
        execution_duration_ms: engineResult.durationMs,
        total_tokens_consumed: engineResult.summary.totalTokensConsumed,
      },
      [...SIMULATION_STEPS],
      validationResult.warnings.length > 0 ? validationResult.warnings : undefined
    );

    // Elevate risk for production/enterprise scenarios
    if (shouldElevateRisk(input.scenario?.category)) {
      synthesis = elevateRiskForProduction(synthesis);
    }

    status = engineResult.status === 'completed' ? 'completed' : 'failed';

    // Build simulation result (simplified, would use full result builder in production)
    const simulationResult = {
      version: '1.0.0' as const,
      resultId: uuidv4() as UUID,
      resultVersion: '1.0.0' as const,
      resultHash: engineResult.resultHash,
      executedAt: completedAt.toISOString() as ISO8601Timestamp,
      executedBy: 'simulation-runner',
      sourcePlan: {
        planId: input.plan.planId,
        planVersion: input.plan.planVersion,
        planHash: input.plan.planHash,
      },
      execution: {
        resultId: engineResult.executionId,
        planId: input.plan.planId,
        planVersion: input.plan.planVersion,
        startedAt: startTimestamp,
        completedAt: completedAt.toISOString() as ISO8601Timestamp,
        durationMs: engineResult.durationMs,
        status: engineResult.status,
      },
      summary: engineResult.summary,
      finalState: engineResult.finalState,
      stepResults,
      agentObservations: engineResult.agentSummaries,
      integrationObservations: engineResult.integrationObservations,
      telemetry: engineResult.telemetry,
      validationOutcomes: {
        preConditions: [],
        postConditions: [],
        invariantViolations: [],
        allPassed: true,
      },
      errors: engineResult.errors.map((e) => ({
        errorId: e.errorId,
        errorCode: e.errorCode,
        errorMessage: e.message,
        timestamp: e.timestamp,
        recoveryAttempted: e.recoveryAttempted,
        recoveryResult: e.recoveryResult,
        stepId: e.stepId,
      })),
      artifacts: engineResult.artifacts.map((a) => ({
        artifactId: a.artifactId,
        type: a.type,
        name: a.name,
        location: a.location,
        sizeBytes: a.sizeBytes,
        hash: a.contentHash,
        createdAt: a.createdAt,
        contentType: a.contentType,
        metadata: a.metadata,
      })),
      auditTrail: {
        trailId: uuidv4() as UUID,
        entryCount: engineResult.timeline.length,
        merkleRoot: engineResult.resultHash,
        firstEntryAt: engineResult.startedAt,
        lastEntryAt: engineResult.completedAt,
      },
      checksum: engineResult.resultHash,
    };

    return {
      commandId,
      status,
      startedAt: startTimestamp,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      planReference: {
        planId: input.plan.planId,
        planHash: input.plan.planHash,
        planVersion: input.plan.planVersion,
      },
      result: simulationResult as any, // Type assertion due to simplified result
      synthesis,
    };
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Build synthesis for failed execution
    const validationResult = validateScenario(input.scenario, input.plan);
    const blockingIssues = extractBlockingIssues(
      [],
      validationResult,
      'failed',
      timeoutOccurred
    );

    // Add the execution error as blocking issue
    blockingIssues.push(
      createExecutionBlockingIssue(
        errorMessage,
        'BLOCKER',
        undefined,
        'Investigate and resolve the execution error'
      )
    );

    const environment = determineEnvironmentFromCategory(input.scenario?.category);

    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: process.env['GIT_SHA'],
        execution_id: commandId,
        plan_hash: input.plan.planHash,
        scenario_category: input.scenario?.category,
      },
      {
        success_rate: 0,
        failed_iterations: 1,
        blocking_issues: blockingIssues,
        execution_duration_ms: completedAt.getTime() - startedAt.getTime(),
      },
      [...SIMULATION_STEPS],
    );

    if (shouldElevateRisk(input.scenario?.category)) {
      synthesis = elevateRiskForProduction(synthesis);
    }

    return {
      commandId,
      status: 'failed',
      startedAt: startTimestamp,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      planReference: {
        planId: input.plan.planId,
        planHash: input.plan.planHash,
        planVersion: input.plan.planVersion,
      },
      error: {
        code: timeoutOccurred ? 'TIMEOUT' : 'EXECUTION_ERROR',
        message: errorMessage,
      },
      synthesis,
    };
  }
}

// =============================================================================
// Execute Simulate Run Command
// =============================================================================

/**
 * Execute a simulate run command with synthesis generation
 *
 * @param input - Simulate run input
 * @returns Simulate run result with executive synthesis
 */
export async function executeSimulateRunCommand(
  input: SimulateRunInput
): Promise<SimulateRunResult> {
  const executionId = uuidv4() as UUID;
  const startedAt = new Date();
  const startTimestamp = startedAt.toISOString() as ISO8601Timestamp;

  let timeoutOccurred = false;

  try {
    // Validate scenario
    const validationResult = validateScenario(input.scenario, input.plan);

    if (!validationResult.valid) {
      const completedAt = new Date();

      // Build synthesis for failed validation
      const blockingIssues = extractBlockingIssues(
        [],
        validationResult,
        'failed',
        false
      );

      const environment = input.environment?.name ??
        determineEnvironmentFromCategory(input.scenario?.category);

      let synthesis = buildExecutiveSummary(
        {
          environment,
          timestamp: completedAt.toISOString() as ISO8601Timestamp,
          version: input.plan.planVersion,
          commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
          execution_id: executionId,
          plan_hash: input.plan.planHash,
          scenario_category: input.scenario?.category,
        },
        {
          success_rate: 0,
          failed_iterations: validationResult.errors.length,
          blocking_issues: blockingIssues,
        },
        ['scenario parsing'],
      );

      if (shouldElevateRisk(input.scenario?.category)) {
        synthesis = elevateRiskForProduction(synthesis);
      }

      return {
        executionId,
        status: 'failed',
        success: false,
        startedAt: startTimestamp,
        completedAt: completedAt.toISOString() as ISO8601Timestamp,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        planReference: {
          planId: input.plan.planId,
          planHash: input.plan.planHash,
        },
        stepResults: [],
        errors: validationResult.errors.map((e) => ({
          code: 'VALIDATION_ERROR',
          message: e.message,
        })),
        warnings: validationResult.warnings,
        synthesis,
      };
    }

    // Create engine invoker
    const invoker = createSimulationEngineInvoker();

    // Execute simulation
    const timeoutMs = input.plan.executionConfig.timeoutSeconds * 1000;
    let executionPromise = invoker.invoke(input.plan, input.seed);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timeoutOccurred = true;
        reject(new Error('Simulation execution timed out'));
      }, timeoutMs);
    });

    const engineResult = await Promise.race([executionPromise, timeoutPromise]);

    const completedAt = new Date();

    // Extract step results
    const stepResults: StepResult[] = engineResult.stepResults.map((step) => ({
      stepId: step.stepId,
      workflowId: step.workflowId,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs: step.durationMs,
      inputsSnapshot: step.inputsSnapshot,
      outputs: step.outputs,
      sequenceNumber: step.sequenceNumber,
      error: step.error,
    }));

    // Build blocking issues
    const blockingIssues = extractBlockingIssues(
      stepResults,
      validationResult,
      engineResult.status,
      timeoutOccurred
    );

    // Calculate metrics
    const success = engineResult.status === 'completed' && engineResult.errors.length === 0;
    const successRate = success ? 1.0 : calculateSuccessRate(stepResults);
    const failedIterations = countFailedSteps(stepResults);

    // Determine environment
    const environment = input.environment?.name ??
      determineEnvironmentFromCategory(input.scenario?.category);

    // Build executive synthesis
    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
        execution_id: engineResult.executionId,
        plan_hash: input.plan.planHash,
        scenario_category: input.scenario?.category,
      },
      {
        success_rate: successRate,
        failed_iterations: failedIterations,
        blocking_issues: blockingIssues,
        execution_duration_ms: engineResult.durationMs,
        total_tokens_consumed: engineResult.summary.totalTokensConsumed,
      },
      [...SIMULATION_STEPS],
      validationResult.warnings.length > 0 ? validationResult.warnings : undefined
    );

    // Elevate risk for production/enterprise scenarios
    if (shouldElevateRisk(input.scenario?.category)) {
      synthesis = elevateRiskForProduction(synthesis);
    }

    return {
      executionId: engineResult.executionId,
      status: engineResult.status,
      success,
      startedAt: startTimestamp,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      planReference: {
        planId: input.plan.planId,
        planHash: input.plan.planHash,
      },
      stepResults,
      finalStateHash: engineResult.finalState.stateHash,
      errors: engineResult.errors.map((e) => ({
        code: e.errorCode,
        message: e.message,
        stepId: e.stepId,
      })),
      warnings: validationResult.warnings,
      synthesis,
    };
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Build synthesis for failed execution
    const validationResult = validateScenario(input.scenario, input.plan);
    const blockingIssues = extractBlockingIssues(
      [],
      validationResult,
      'failed',
      timeoutOccurred
    );

    blockingIssues.push(
      createExecutionBlockingIssue(
        errorMessage,
        'BLOCKER',
        undefined,
        'Investigate and resolve the execution error'
      )
    );

    const environment = input.environment?.name ??
      determineEnvironmentFromCategory(input.scenario?.category);

    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
        execution_id: executionId,
        plan_hash: input.plan.planHash,
        scenario_category: input.scenario?.category,
      },
      {
        success_rate: 0,
        failed_iterations: 1,
        blocking_issues: blockingIssues,
        execution_duration_ms: completedAt.getTime() - startedAt.getTime(),
      },
      [...SIMULATION_STEPS],
    );

    if (shouldElevateRisk(input.scenario?.category)) {
      synthesis = elevateRiskForProduction(synthesis);
    }

    return {
      executionId,
      status: timeoutOccurred ? 'timeout' : 'failed',
      success: false,
      startedAt: startTimestamp,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      planReference: {
        planId: input.plan.planId,
        planHash: input.plan.planHash,
      },
      stepResults: [],
      errors: [
        {
          code: timeoutOccurred ? 'TIMEOUT' : 'EXECUTION_ERROR',
          message: errorMessage,
        },
      ],
      warnings: [],
      synthesis,
    };
  }
}
