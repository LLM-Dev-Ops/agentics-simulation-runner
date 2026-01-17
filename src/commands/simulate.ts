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
  createResourceBlockingIssue,
  buildPreRunFeasibility,
  buildDecisionPacket,
  type BlockingIssue,
  type ExecutiveSummary,
  type PreRunFeasibility,
  type DecisionPacket,
} from '../synthesis/index.js';

import type {
  SimulateCommandInput,
  SimulateCommandResult,
  SimulateRunInput,
  SimulateRunResult,
  SimulationScenario,
  ScenarioValidationResult,
  CommandStatus,
  SimulateCreateInput,
  SimulateCreateResult,
  SimulationContext,
  ResourceAllocation,
  SimulateCommandResultWithPacket,
  SimulateRunResultWithPacket,
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

// =============================================================================
// Execute Simulate Create Command
// =============================================================================

/**
 * Default context expiration time (1 hour)
 */
const DEFAULT_CONTEXT_EXPIRATION_MS = 60 * 60 * 1000;

/**
 * Default resource allocations
 */
const DEFAULT_RESOURCES: ResourceAllocation = {
  maxMemoryBytes: 512 * 1024 * 1024, // 512MB
  maxTokens: 100000,
  cpuCores: 1,
};

/**
 * Steps executed during simulation creation
 */
const CREATE_STEPS = [
  'validation',
  'resource_allocation',
  'context_creation',
] as const;

/**
 * Execute a simulate create command with synthesis and feasibility analysis
 *
 * Creates a simulation context with resource allocation and optionally
 * performs pre-run feasibility analysis.
 *
 * @param input - Simulate create command input
 * @returns Simulate create result with context and feasibility
 */
export async function executeSimulateCreateCommand(
  input: SimulateCreateInput
): Promise<SimulateCreateResult> {
  const commandId = uuidv4() as UUID;
  const startedAt = new Date();
  const startTimestamp = startedAt.toISOString() as ISO8601Timestamp;

  const warnings: string[] = [];

  try {
    // Validate scenario
    const validationResult = validateScenario(input.scenario, input.plan);

    if (!validationResult.valid) {
      const completedAt = new Date();

      // Build blocking issues for validation failure
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
          execution_id: commandId,
          plan_hash: input.plan.planHash,
          scenario_category: input.scenario?.category,
        },
        {
          success_rate: 0,
          failed_iterations: validationResult.errors.length,
          blocking_issues: blockingIssues,
        },
        ['validation'],
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
        warnings: validationResult.warnings,
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

    // Add validation warnings
    warnings.push(...validationResult.warnings);

    // Determine environment
    const environment = input.environment?.name ??
      determineEnvironmentFromCategory(input.scenario?.category);

    // Calculate estimated steps
    const estimatedSteps = input.plan.workflow?.steps?.length ??
      input.plan.workflows?.reduce((sum, w) => sum + (w.steps?.length ?? 0), 0) ??
      10;

    // Perform pre-run feasibility analysis if requested
    let feasibility: PreRunFeasibility | undefined;
    if (input.analyzeFeasibility) {
      const timeoutMs = input.plan.executionConfig.timeoutSeconds * 1000;
      const expectedDurationPerStepMs = input.expectedDurationPerStepMs ?? 1000;

      feasibility = buildPreRunFeasibility({
        plannedSteps: estimatedSteps,
        expectedDurationPerStepMs,
        timeoutMs,
        tokenLimit: input.resources?.maxTokens ?? DEFAULT_RESOURCES.maxTokens,
        estimatedTokensPerStep: 1000,
        memoryLimitBytes: input.resources?.maxMemoryBytes ?? DEFAULT_RESOURCES.maxMemoryBytes,
        estimatedMemoryPerStepBytes: 10 * 1024 * 1024, // 10MB per step estimate
        requiredPreconditions: input.scenario?.preconditions as string[] | undefined,
        availablePreconditions: input.plan.validation?.preConditions?.map((c) => c.id),
        environment,
      });

      // Add feasibility warnings
      if (feasibility.status === 'CONDITIONAL') {
        warnings.push('Pre-run analysis indicates conditional feasibility - review recommendations');
        for (const rec of feasibility.recommendations) {
          warnings.push(`Recommendation: ${rec}`);
        }
      }

      // Check for infeasible
      if (feasibility.status === 'INFEASIBLE') {
        const completedAt = new Date();

        const blockingIssues: BlockingIssue[] = feasibility.constraints
          .filter((c) => !c.satisfied && c.severity === 'blocking')
          .map((c) => createResourceBlockingIssue(c.description, c.remediation));

        let synthesis = buildExecutiveSummary(
          {
            environment,
            timestamp: completedAt.toISOString() as ISO8601Timestamp,
            version: input.plan.planVersion,
            commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
            execution_id: commandId,
            plan_hash: input.plan.planHash,
            scenario_category: input.scenario?.category,
          },
          {
            success_rate: 0,
            failed_iterations: blockingIssues.length,
            blocking_issues: blockingIssues,
          },
          ['validation', 'resource_allocation'],
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
          feasibility,
          warnings,
          error: {
            code: 'INFEASIBLE',
            message: 'Pre-run feasibility analysis determined simulation is not feasible',
            details: {
              blockingConstraints: feasibility.constraints.filter((c) => !c.satisfied),
            },
          },
          synthesis,
        };
      }
    }

    // Allocate resources
    const allocatedResources: ResourceAllocation = {
      maxMemoryBytes: input.resources?.maxMemoryBytes ?? DEFAULT_RESOURCES.maxMemoryBytes,
      maxTokens: input.resources?.maxTokens ?? DEFAULT_RESOURCES.maxTokens,
      cpuCores: input.resources?.cpuCores ?? DEFAULT_RESOURCES.cpuCores,
      networkBandwidthBps: input.resources?.networkBandwidthBps,
      storageBytes: input.resources?.storageBytes,
    };

    // Create simulation context
    const contextId = uuidv4() as UUID;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + DEFAULT_CONTEXT_EXPIRATION_MS);

    const context: SimulationContext = {
      contextId,
      planReference: {
        planId: input.plan.planId,
        planHash: input.plan.planHash,
        planVersion: input.plan.planVersion,
      },
      scenarioReference: input.scenario ? {
        scenarioId: input.scenario.id,
        scenarioName: input.scenario.name,
        category: input.scenario.category,
      } : undefined,
      allocatedResources,
      createdAt: createdAt.toISOString() as ISO8601Timestamp,
      expiresAt: expiresAt.toISOString() as ISO8601Timestamp,
      environment,
      estimatedSteps,
      ready: true,
    };

    const completedAt = new Date();

    // Build success synthesis
    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
        execution_id: commandId,
        plan_hash: input.plan.planHash,
        scenario_category: input.scenario?.category,
      },
      {
        success_rate: 1.0,
        failed_iterations: 0,
        blocking_issues: [],
        execution_duration_ms: completedAt.getTime() - startedAt.getTime(),
      },
      [...CREATE_STEPS],
      warnings.length > 0 ? warnings : undefined
    );

    if (shouldElevateRisk(input.scenario?.category)) {
      synthesis = elevateRiskForProduction(synthesis);
    }

    return {
      commandId,
      status: 'completed',
      startedAt: startTimestamp,
      completedAt: completedAt.toISOString() as ISO8601Timestamp,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      context,
      feasibility,
      warnings,
      synthesis,
    };
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    const environment = input.environment?.name ??
      determineEnvironmentFromCategory(input.scenario?.category);

    const blockingIssues: BlockingIssue[] = [
      createExecutionBlockingIssue(
        errorMessage,
        'BLOCKER',
        undefined,
        'Investigate and resolve the error'
      ),
    ];

    let synthesis = buildExecutiveSummary(
      {
        environment,
        timestamp: completedAt.toISOString() as ISO8601Timestamp,
        version: input.plan.planVersion,
        commit_sha: input.gitContext?.commitSha ?? process.env['GIT_SHA'],
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
      [...CREATE_STEPS],
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
      warnings,
      error: {
        code: 'CREATE_ERROR',
        message: errorMessage,
      },
      synthesis,
    };
  }
}

// =============================================================================
// Enhanced Commands with Decision Packet
// =============================================================================

/**
 * Execute simulate command with Decision Packet generation
 *
 * @param input - Simulate command input
 * @returns Result with Decision Packet
 */
export async function executeSimulateCommandWithPacket(
  input: SimulateCommandInput
): Promise<SimulateCommandResultWithPacket> {
  const result = await executeSimulateCommand(input);

  // Only generate Decision Packet for completed simulations
  if (result.status !== 'completed' || !result.result || !result.synthesis) {
    return result;
  }

  const stepResults = result.result.stepResults.map((s) => ({
    status: s.status,
    durationMs: s.durationMs,
    stepId: s.stepId,
  }));

  const decisionPacket = buildDecisionPacket({
    executionId: result.result.execution.resultId,
    planId: result.planReference.planId,
    planHash: result.planReference.planHash,
    planVersion: result.planReference.planVersion,
    scenarioId: input.scenario?.id,
    stepResults,
    plannedSteps: stepResults.length,
    completed: result.status === 'completed',
    timedOut: false,
    resourceExhausted: false,
    constraintViolation: false,
    finalStateHash: result.result.finalState?.stateHash,
    seed: input.seed,
    deterministic: input.seed !== undefined,
    environment: result.synthesis.deploy_reference.environment,
    artifactCount: result.result.artifacts?.length ?? 0,
    totalDurationMs: result.durationMs,
    executiveSummary: result.synthesis,
  });

  return {
    ...result,
    decisionPacket,
  };
}

/**
 * Execute simulate run command with Decision Packet generation
 *
 * @param input - Simulate run input
 * @returns Result with Decision Packet
 */
export async function executeSimulateRunCommandWithPacket(
  input: SimulateRunInput
): Promise<SimulateRunResultWithPacket> {
  const result = await executeSimulateRunCommand(input);

  // Only generate Decision Packet for completed simulations
  if (!result.synthesis) {
    return result;
  }

  const stepResults = result.stepResults.map((s) => ({
    status: s.status,
    durationMs: s.durationMs,
    stepId: s.stepId,
  }));

  const decisionPacket = buildDecisionPacket({
    executionId: result.executionId,
    planId: result.planReference.planId,
    planHash: result.planReference.planHash,
    planVersion: input.plan.planVersion,
    scenarioId: input.scenario?.id,
    stepResults,
    plannedSteps: stepResults.length || input.plan.workflow?.steps?.length || 10,
    completed: result.status === 'completed',
    timedOut: result.status === 'timeout',
    resourceExhausted: false,
    constraintViolation: false,
    finalStateHash: result.finalStateHash,
    seed: input.seed,
    deterministic: input.seed !== undefined,
    environment: result.synthesis.deploy_reference.environment,
    artifactCount: 0,
    totalDurationMs: result.durationMs,
    executiveSummary: result.synthesis,
  });

  return {
    ...result,
    decisionPacket,
  };
}
