/**
 * Semantic Validator (INV-IN-002, INV-IN-003, INV-IN-005)
 *
 * Validates SimulationPlan semantic completeness and integrity.
 * Ensures all references are valid, dependencies are acyclic,
 * and the plan hash matches computed hash.
 *
 * Implements:
 * - INV-IN-002: SimulationPlan MUST be semantically complete
 * - INV-IN-003: SimulationPlan MUST have valid planHash
 * - INV-IN-005: All referenced agents MUST be resolvable
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3.2
 */

import type { SimulationPlan, WorkflowStep, Dependency } from '../../types/plan.js';
import { computeSHA256, canonicalize } from '../../utils/hash.js';
import {
  hasCycles,
  detectCycle,
  CyclicDependencyError,
} from '../../utils/topological-sort.js';
import type { ValidationResult, ValidationError, ValidationWarning } from './types.js';

/**
 * Semantic validation configuration options
 */
export interface SemanticValidatorOptions {
  /**
   * Whether to verify the plan hash (INV-IN-003)
   */
  readonly verifyHash?: boolean;

  /**
   * Whether to check for dependency cycles
   */
  readonly checkCycles?: boolean;

  /**
   * Whether to validate all references
   */
  readonly validateReferences?: boolean;

  /**
   * Whether to validate agent invocation specs
   */
  readonly validateAgentSpecs?: boolean;

  /**
   * Maximum cycle path length to report
   */
  readonly maxCyclePathLength?: number;
}

const DEFAULT_OPTIONS: Required<SemanticValidatorOptions> = {
  verifyHash: true,
  checkCycles: true,
  validateReferences: true,
  validateAgentSpecs: true,
  maxCyclePathLength: 20,
};

/**
 * Validates semantic completeness and integrity of a SimulationPlan
 *
 * From Pseudocode Section 3.2:
 * ```
 * FUNCTION validateSemantics(plan: SimulationPlan): ValidationResult
 *   errors = []
 *
 *   // INV-IN-003: Hash integrity
 *   computedHash = computeSHA256(plan excluding planHash)
 *   IF computedHash != plan.planHash:
 *     errors.append(ValidationError(code="HASH_MISMATCH"))
 *
 *   // Dependency graph validation
 *   IF hasCycles(plan.workflow.dependencies):
 *     errors.append(ValidationError(code="DEPENDENCY_CYCLE"))
 *
 *   // Reference validation (INV-IN-005)
 *   FOR EACH step IN plan.workflow.steps:
 *     IF step.agentRef NOT IN plan.agents:
 *       errors.append(ValidationError(code="INVALID_AGENT_REF"))
 *
 *   RETURN ValidationResult(valid=errors.isEmpty(), errors=errors)
 * ```
 *
 * @param plan - The validated SimulationPlan to check semantically
 * @param options - Optional validation configuration
 * @returns ValidationResult with semantic validation status
 */
export function validateSemantics(
  plan: SimulationPlan,
  options: SemanticValidatorOptions = {}
): ValidationResult {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // INV-IN-003: Verify plan hash integrity
  if (config.verifyHash) {
    const hashResult = verifyPlanHash(plan);
    errors.push(...hashResult.errors);
    warnings.push(...hashResult.warnings);
  }

  // Check for dependency cycles
  if (config.checkCycles) {
    const cycleResult = checkDependencyCycles(plan, config.maxCyclePathLength);
    errors.push(...cycleResult.errors);
    warnings.push(...cycleResult.warnings);
  }

  // Validate all references
  if (config.validateReferences) {
    const refResult = validateAllReferences(plan);
    errors.push(...refResult.errors);
    warnings.push(...refResult.warnings);
  }

  // Validate agent invocation specs
  if (config.validateAgentSpecs) {
    const specResult = validateAgentInvocationSpecs(plan);
    errors.push(...specResult.errors);
    warnings.push(...specResult.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Verifies the plan hash matches the computed hash
 *
 * INV-IN-003: SimulationPlan MUST have valid planHash
 *
 * @param plan - The plan to verify
 * @returns ValidationResult with hash verification status
 */
export function verifyPlanHash(plan: SimulationPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    // Create a copy without the planHash field for computation
    const planWithoutHash = excludeField(plan, 'planHash');

    // Compute SHA256 hash of the plan content
    const computedHash = computeSHA256(planWithoutHash);

    // Compare hashes (case-insensitive)
    if (computedHash.toLowerCase() !== plan.planHash.toLowerCase()) {
      errors.push({
        code: 'HASH_MISMATCH',
        severity: 'FATAL',
        message: `Plan hash verification failed: expected '${plan.planHash}', computed '${computedHash}'`,
        path: 'planHash',
        context: {
          expectedHash: plan.planHash,
          computedHash,
        },
      });
    }
  } catch (error) {
    errors.push({
      code: 'HASH_COMPUTATION_ERROR',
      severity: 'ERROR',
      message: `Failed to compute plan hash: ${error instanceof Error ? error.message : String(error)}`,
      path: 'planHash',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Checks for cycles in the dependency graph
 *
 * @param plan - The plan to check
 * @param maxPathLength - Maximum cycle path length to report
 * @returns ValidationResult with cycle detection status
 */
export function checkDependencyCycles(
  plan: SimulationPlan,
  maxPathLength: number = 20
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    // Convert plan dependencies to the format expected by topological sort
    const dependencies = plan.workflow.dependencies.edges.map((dep) => ({
      from: dep.from,
      to: dep.to,
    }));

    // Check for cycles
    if (hasCycles(dependencies)) {
      try {
        const cyclePath = detectCycle(dependencies);
        const displayPath = cyclePath
          ? cyclePath.slice(0, maxPathLength).join(' -> ')
          : 'unknown cycle path';
        const truncated = cyclePath && cyclePath.length > maxPathLength;

        errors.push({
          code: 'DEPENDENCY_CYCLE',
          severity: 'FATAL',
          message: `Workflow dependency graph contains a cycle: ${displayPath}${truncated ? '...' : ''}`,
          path: 'workflow.dependencies',
          context: {
            cyclePath: cyclePath?.slice(0, maxPathLength),
            truncated,
          },
        });
      } catch {
        errors.push({
          code: 'DEPENDENCY_CYCLE',
          severity: 'FATAL',
          message: 'Workflow dependency graph contains cycles',
          path: 'workflow.dependencies',
        });
      }
    }
  } catch (error) {
    if (error instanceof CyclicDependencyError) {
      const displayPath = error.cycle.slice(0, maxPathLength).join(' -> ');
      const truncated = error.cycle.length > maxPathLength;

      errors.push({
        code: 'DEPENDENCY_CYCLE',
        severity: 'FATAL',
        message: `Dependency cycle detected: ${displayPath}${truncated ? '...' : ''}`,
        path: 'workflow.dependencies',
        context: {
          cyclePath: error.cycle.slice(0, maxPathLength),
          truncated,
        },
      });
    } else {
      errors.push({
        code: 'CYCLE_DETECTION_ERROR',
        severity: 'ERROR',
        message: `Failed to check for dependency cycles: ${error instanceof Error ? error.message : String(error)}`,
        path: 'workflow.dependencies',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates all references in the plan
 *
 * INV-IN-005: All referenced agents MUST be resolvable
 *
 * @param plan - The plan to validate
 * @returns ValidationResult with reference validation status
 */
export function validateAllReferences(plan: SimulationPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Build lookup sets for valid IDs
  const stepIds = new Set(plan.workflow.steps.map((s) => s.stepId));
  const agentIds = new Set(plan.agents.map((a) => a.agentId));
  const integrationIds = new Set(plan.integrations.map((i) => i.integrationId));
  const checkpointStepRefs = new Set(
    plan.workflow.checkpoints.map((c) => c.stepRef)
  );

  // Validate dependency references
  for (const dep of plan.workflow.dependencies.edges) {
    if (!stepIds.has(dep.from)) {
      errors.push({
        code: 'INVALID_DEPENDENCY_REF',
        severity: 'ERROR',
        message: `Dependency 'from' references non-existent step: '${dep.from}'`,
        path: 'workflow.dependencies.edges',
        context: { from: dep.from, to: dep.to },
      });
    }
    if (!stepIds.has(dep.to)) {
      errors.push({
        code: 'INVALID_DEPENDENCY_REF',
        severity: 'ERROR',
        message: `Dependency 'to' references non-existent step: '${dep.to}'`,
        path: 'workflow.dependencies.edges',
        context: { from: dep.from, to: dep.to },
      });
    }
  }

  // Validate step references (agent and integration refs)
  for (let i = 0; i < plan.workflow.steps.length; i++) {
    const step = plan.workflow.steps[i];
    const stepPath = `workflow.steps[${i}]`;

    // Validate agent references (INV-IN-005)
    if (step.stepType === 'AGENT_INVOCATION' && step.agentRef) {
      if (!agentIds.has(step.agentRef)) {
        errors.push({
          code: 'INVALID_AGENT_REF',
          severity: 'ERROR',
          message: `Step '${step.stepId}' references non-existent agent: '${step.agentRef}'`,
          path: `${stepPath}.agentRef`,
          context: { stepId: step.stepId, agentRef: step.agentRef },
        });
      }
    }

    // Validate integration references
    if (step.stepType === 'INTEGRATION_CALL' && step.integrationRef) {
      if (!integrationIds.has(step.integrationRef)) {
        errors.push({
          code: 'INVALID_INTEGRATION_REF',
          severity: 'ERROR',
          message: `Step '${step.stepId}' references non-existent integration: '${step.integrationRef}'`,
          path: `${stepPath}.integrationRef`,
          context: { stepId: step.stepId, integrationRef: step.integrationRef },
        });
      }
    }

    // Validate fallback step references
    if (step.fallbackStep && !stepIds.has(step.fallbackStep)) {
      errors.push({
        code: 'INVALID_FALLBACK_REF',
        severity: 'ERROR',
        message: `Step '${step.stepId}' references non-existent fallback step: '${step.fallbackStep}'`,
        path: `${stepPath}.fallbackStep`,
        context: { stepId: step.stepId, fallbackStep: step.fallbackStep },
      });
    }

    // Recursively validate sub-steps
    if (step.subSteps && step.subSteps.length > 0) {
      const subResult = validateSubStepReferences(
        step.subSteps,
        agentIds,
        integrationIds,
        stepIds,
        `${stepPath}.subSteps`
      );
      errors.push(...subResult.errors);
      warnings.push(...subResult.warnings);
    }
  }

  // Validate checkpoint references
  for (let i = 0; i < plan.workflow.checkpoints.length; i++) {
    const checkpoint = plan.workflow.checkpoints[i];
    if (!stepIds.has(checkpoint.stepRef)) {
      errors.push({
        code: 'INVALID_CHECKPOINT_REF',
        severity: 'ERROR',
        message: `Checkpoint '${checkpoint.checkpointId}' references non-existent step: '${checkpoint.stepRef}'`,
        path: `workflow.checkpoints[${i}].stepRef`,
        context: { checkpointId: checkpoint.checkpointId, stepRef: checkpoint.stepRef },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Recursively validates references in sub-steps
 */
function validateSubStepReferences(
  subSteps: WorkflowStep[],
  agentIds: Set<string>,
  integrationIds: Set<string>,
  stepIds: Set<string>,
  basePath: string
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (let i = 0; i < subSteps.length; i++) {
    const step = subSteps[i];
    const stepPath = `${basePath}[${i}]`;

    if (step.stepType === 'AGENT_INVOCATION' && step.agentRef) {
      if (!agentIds.has(step.agentRef)) {
        errors.push({
          code: 'INVALID_AGENT_REF',
          severity: 'ERROR',
          message: `Sub-step '${step.stepId}' references non-existent agent: '${step.agentRef}'`,
          path: `${stepPath}.agentRef`,
          context: { stepId: step.stepId, agentRef: step.agentRef },
        });
      }
    }

    if (step.stepType === 'INTEGRATION_CALL' && step.integrationRef) {
      if (!integrationIds.has(step.integrationRef)) {
        errors.push({
          code: 'INVALID_INTEGRATION_REF',
          severity: 'ERROR',
          message: `Sub-step '${step.stepId}' references non-existent integration: '${step.integrationRef}'`,
          path: `${stepPath}.integrationRef`,
          context: { stepId: step.stepId, integrationRef: step.integrationRef },
        });
      }
    }

    if (step.subSteps && step.subSteps.length > 0) {
      const subResult = validateSubStepReferences(
        step.subSteps,
        agentIds,
        integrationIds,
        stepIds,
        `${stepPath}.subSteps`
      );
      errors.push(...subResult.errors);
      warnings.push(...subResult.warnings);
    }
  }

  return { errors, warnings };
}

/**
 * Validates agent invocation specifications are complete
 *
 * @param plan - The plan to validate
 * @returns ValidationResult with agent spec validation status
 */
export function validateAgentInvocationSpecs(
  plan: SimulationPlan
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (let i = 0; i < plan.agents.length; i++) {
    const agent = plan.agents[i];
    const agentPath = `agents[${i}]`;

    // Check required invocation spec fields
    if (!agent.invocationSpec) {
      errors.push({
        code: 'MISSING_INVOCATION_SPEC',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' is missing invocationSpec`,
        path: `${agentPath}.invocationSpec`,
        context: { agentId: agent.agentId },
      });
      continue;
    }

    if (!agent.invocationSpec.modelId) {
      errors.push({
        code: 'MISSING_MODEL_ID',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' is missing modelId in invocationSpec`,
        path: `${agentPath}.invocationSpec.modelId`,
        context: { agentId: agent.agentId },
      });
    }

    if (!agent.invocationSpec.promptTemplate) {
      errors.push({
        code: 'MISSING_PROMPT_TEMPLATE',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' is missing promptTemplate in invocationSpec`,
        path: `${agentPath}.invocationSpec.promptTemplate`,
        context: { agentId: agent.agentId },
      });
    }

    // Validate temperature range
    if (
      agent.invocationSpec.temperature !== undefined &&
      (agent.invocationSpec.temperature < 0 ||
        agent.invocationSpec.temperature > 2)
    ) {
      errors.push({
        code: 'INVALID_TEMPERATURE',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' has invalid temperature: ${agent.invocationSpec.temperature} (must be 0-2)`,
        path: `${agentPath}.invocationSpec.temperature`,
        context: { agentId: agent.agentId, temperature: agent.invocationSpec.temperature },
      });
    }

    // Validate maxTokens
    if (
      agent.invocationSpec.maxTokens !== undefined &&
      agent.invocationSpec.maxTokens <= 0
    ) {
      errors.push({
        code: 'INVALID_MAX_TOKENS',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' has invalid maxTokens: ${agent.invocationSpec.maxTokens} (must be positive)`,
        path: `${agentPath}.invocationSpec.maxTokens`,
        context: { agentId: agent.agentId, maxTokens: agent.invocationSpec.maxTokens },
      });
    }

    // Validate topP range if present
    if (
      agent.invocationSpec.topP !== undefined &&
      (agent.invocationSpec.topP < 0 || agent.invocationSpec.topP > 1)
    ) {
      errors.push({
        code: 'INVALID_TOP_P',
        severity: 'ERROR',
        message: `Agent '${agent.agentId}' has invalid topP: ${agent.invocationSpec.topP} (must be 0-1)`,
        path: `${agentPath}.invocationSpec.topP`,
        context: { agentId: agent.agentId, topP: agent.invocationSpec.topP },
      });
    }

    // Warn about empty stop sequences
    if (
      agent.invocationSpec.stopSequences &&
      agent.invocationSpec.stopSequences.length === 0
    ) {
      warnings.push({
        code: 'EMPTY_STOP_SEQUENCES',
        message: `Agent '${agent.agentId}' has empty stopSequences array`,
        path: `${agentPath}.invocationSpec.stopSequences`,
        context: { agentId: agent.agentId },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates step uniqueness (no duplicate stepIds)
 *
 * @param plan - The plan to validate
 * @returns ValidationResult with step uniqueness status
 */
export function validateStepUniqueness(plan: SimulationPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const seenIds = new Map<string, number>();

  // Collect all step IDs including sub-steps
  collectStepIds(plan.workflow.steps, seenIds, 'workflow.steps');

  // Report duplicates
  for (const [stepId, count] of seenIds) {
    if (count > 1) {
      errors.push({
        code: 'DUPLICATE_STEP_ID',
        severity: 'ERROR',
        message: `Step ID '${stepId}' appears ${count} times (must be unique)`,
        path: 'workflow.steps',
        context: { stepId, occurrences: count },
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SEMANTIC_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Recursively collects step IDs from steps and sub-steps
 */
function collectStepIds(
  steps: WorkflowStep[],
  seenIds: Map<string, number>,
  path: string
): void {
  for (const step of steps) {
    const currentCount = seenIds.get(step.stepId) ?? 0;
    seenIds.set(step.stepId, currentCount + 1);

    if (step.subSteps && step.subSteps.length > 0) {
      collectStepIds(step.subSteps, seenIds, `${path}.subSteps`);
    }
  }
}

/**
 * Helper function to exclude a field from an object for hash computation
 */
function excludeField<T extends object, K extends keyof T>(
  obj: T,
  field: K
): Omit<T, K> {
  // Create a shallow copy excluding the specified field
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== field) {
      result[key] = (obj as Record<string, unknown>)[key];
    }
  }
  return result as Omit<T, K>;
}
