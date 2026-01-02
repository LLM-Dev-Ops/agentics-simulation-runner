/**
 * Validation Orchestrator (MOD-002)
 *
 * Coordinates all validation activities for submitted SimulationPlans.
 * Implements Phase 1 (VALIDATION) of the Master Execution Flow.
 *
 * The ValidationOrchestrator ensures plans are:
 * - Syntactically valid (schema validation)
 * - Semantically complete (reference validation, hash verification)
 * - Executable (resource availability, connectivity)
 * - Ready (pre-conditions satisfied)
 *
 * Validation Phases (from Pseudocode Section 3):
 * 1. Schema Validation (INV-IN-001) - Required fields, types, nested structures
 * 2. Semantic Validation (INV-IN-002, INV-IN-003, INV-IN-005) - Hash, cycles, references
 * 3. Resource Availability (INV-IN-007) - CPU, memory, storage, duration limits
 * 4. Integration Connectivity (INV-IN-006) - Endpoint reachability, credentials
 * 5. Pre-Condition Evaluation - All pre-conditions from plan.validation.preConditions
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3
 * - SPARC_SPECIFICATION.md Section 4.2
 */

import type { SimulationPlan } from '../types/plan.js';
import type { StateRepository } from '../state/state-repository.js';
import { getSharedStateRepository } from '../state/state-repository.js';

import {
  validateSchema,
  validateSemantics,
  validateResourceAvailability,
  validateIntegrationConnectivity,
  evaluatePreConditions,
  queryResourcePool,
  createEvaluationContext,
  DefaultConnectivityTester,
  DefaultConditionEvaluator,
  createEmptyResult,
  type ValidationResult,
  type FullValidationResult,
  type ResourcePool,
  type ConnectivityTester,
  type ConditionEvaluator,
  type SchemaValidatorOptions,
  type SemanticValidatorOptions,
  type ResourceValidatorOptions,
  type ConnectivityValidatorOptions,
  type PreConditionEvaluatorOptions,
} from './validators/index.js';

/**
 * Configuration options for the ValidationOrchestrator
 */
export interface ValidationOrchestratorOptions {
  /**
   * Whether to fail fast on first validation error
   */
  readonly failFast?: boolean;

  /**
   * Whether to run validation phases in parallel where possible
   */
  readonly parallelValidation?: boolean;

  /**
   * Schema validator options
   */
  readonly schemaOptions?: SchemaValidatorOptions;

  /**
   * Semantic validator options
   */
  readonly semanticOptions?: SemanticValidatorOptions;

  /**
   * Resource validator options
   */
  readonly resourceOptions?: ResourceValidatorOptions;

  /**
   * Connectivity validator options
   */
  readonly connectivityOptions?: ConnectivityValidatorOptions;

  /**
   * Pre-condition evaluator options
   */
  readonly preConditionOptions?: PreConditionEvaluatorOptions;

  /**
   * Custom connectivity tester
   */
  readonly connectivityTester?: ConnectivityTester;

  /**
   * Custom condition evaluator
   */
  readonly conditionEvaluator?: ConditionEvaluator;

  /**
   * Custom resource pool (overrides querying)
   */
  readonly resourcePool?: ResourcePool;

  /**
   * Tenant ID for tenant-specific validation
   */
  readonly tenantId?: string;

  /**
   * State repository for resource queries
   */
  readonly stateRepository?: StateRepository;

  /**
   * Evaluation context for pre-conditions
   */
  readonly evaluationContext?: Record<string, unknown>;
}

const DEFAULT_OPTIONS: Required<Omit<ValidationOrchestratorOptions,
  'connectivityTester' | 'conditionEvaluator' | 'resourcePool' |
  'tenantId' | 'stateRepository' | 'evaluationContext' |
  'schemaOptions' | 'semanticOptions' | 'resourceOptions' |
  'connectivityOptions' | 'preConditionOptions'>> = {
  failFast: false,
  parallelValidation: false,
};

/**
 * ValidationOrchestrator
 *
 * Main orchestrator class that coordinates all validation activities.
 * Follows the validation pipeline defined in the SPARC pseudocode.
 *
 * Usage:
 * ```typescript
 * const orchestrator = new ValidationOrchestrator();
 * const result = await orchestrator.validatePlan(plan);
 *
 * if (!result.valid) {
 *   console.error('Validation failed:', result.allErrors);
 * }
 * ```
 */
export class ValidationOrchestrator {
  private readonly options: ValidationOrchestratorOptions;
  private readonly connectivityTester: ConnectivityTester;
  private readonly conditionEvaluator: ConditionEvaluator;
  private readonly stateRepository: StateRepository;

  constructor(options: ValidationOrchestratorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.connectivityTester = options.connectivityTester ?? new DefaultConnectivityTester();
    this.conditionEvaluator = options.conditionEvaluator ?? new DefaultConditionEvaluator();
    this.stateRepository = options.stateRepository ?? getSharedStateRepository();
  }

  /**
   * Validates a SimulationPlan through all validation phases
   *
   * From Pseudocode Section 3:
   * ```
   * FUNCTION validatePlan(plan: SimulationPlan): FullValidationResult
   *   // Phase 1: Schema validation
   *   schemaResult = validateSchema(plan)
   *   IF NOT schemaResult.valid AND failFast:
   *     RETURN FullValidationResult(valid=false, ...)
   *
   *   // Phase 2: Semantic validation
   *   semanticResult = validateSemantics(plan)
   *   IF NOT semanticResult.valid AND failFast:
   *     RETURN FullValidationResult(valid=false, ...)
   *
   *   // Phase 3: Resource validation
   *   resourceResult = validateResourceAvailability(plan, resourcePool)
   *   IF NOT resourceResult.valid AND failFast:
   *     RETURN FullValidationResult(valid=false, ...)
   *
   *   // Phase 4: Connectivity validation
   *   connectivityResult = validateIntegrationConnectivity(plan)
   *   IF NOT connectivityResult.valid AND failFast:
   *     RETURN FullValidationResult(valid=false, ...)
   *
   *   // Phase 5: Pre-condition evaluation
   *   preConditionResult = evaluatePreConditions(plan, context)
   *
   *   RETURN FullValidationResult(
   *     valid = all phases valid,
   *     schemaResult, semanticResult, resourceResult,
   *     connectivityResult, preConditionResult
   *   )
   * ```
   *
   * @param plan - The SimulationPlan to validate (can be unknown for schema validation)
   * @returns Promise resolving to FullValidationResult with all phase results
   */
  async validatePlan(plan: unknown): Promise<FullValidationResult> {
    const startTime = Date.now();
    const failFast = this.options.failFast ?? false;

    // Initialize empty results for fail-fast early returns
    const emptySchemaResult = createEmptyResult('SCHEMA_VALIDATION');
    const emptySemanticResult = createEmptyResult('SEMANTIC_VALIDATION');
    const emptyResourceResult = createEmptyResult('RESOURCE_VALIDATION');
    const emptyConnectivityResult = createEmptyResult('CONNECTIVITY_VALIDATION');
    const emptyPreConditionResult = createEmptyResult('PRECONDITION_VALIDATION');

    // =========================================================================
    // Phase 1: Schema Validation (INV-IN-001)
    // =========================================================================
    const schemaResult = validateSchema(plan, this.options.schemaOptions);

    if (!schemaResult.valid && failFast) {
      return this.buildFullResult(
        schemaResult,
        emptySemanticResult,
        emptyResourceResult,
        emptyConnectivityResult,
        emptyPreConditionResult,
        startTime
      );
    }

    // If schema validation failed, we cannot proceed with further validation
    if (!schemaResult.valid) {
      return this.buildFullResult(
        schemaResult,
        emptySemanticResult,
        emptyResourceResult,
        emptyConnectivityResult,
        emptyPreConditionResult,
        startTime
      );
    }

    // Plan is now known to be a valid SimulationPlan
    const validPlan = plan as SimulationPlan;

    // =========================================================================
    // Phase 2: Semantic Validation (INV-IN-002, INV-IN-003, INV-IN-005)
    // =========================================================================
    const semanticResult = validateSemantics(validPlan, this.options.semanticOptions);

    if (!semanticResult.valid && failFast) {
      return this.buildFullResult(
        schemaResult,
        semanticResult,
        emptyResourceResult,
        emptyConnectivityResult,
        emptyPreConditionResult,
        startTime
      );
    }

    // =========================================================================
    // Phase 3: Resource Validation (INV-IN-007)
    // =========================================================================
    const resourcePool = await this.getResourcePool();
    const resourceResult = validateResourceAvailability(
      validPlan,
      resourcePool,
      this.options.resourceOptions
    );

    if (!resourceResult.valid && failFast) {
      return this.buildFullResult(
        schemaResult,
        semanticResult,
        resourceResult,
        emptyConnectivityResult,
        emptyPreConditionResult,
        startTime
      );
    }

    // =========================================================================
    // Phase 4: Connectivity Validation (INV-IN-006)
    // =========================================================================
    const connectivityResult = await validateIntegrationConnectivity(
      validPlan,
      this.connectivityTester,
      this.options.connectivityOptions
    );

    if (!connectivityResult.valid && failFast) {
      return this.buildFullResult(
        schemaResult,
        semanticResult,
        resourceResult,
        connectivityResult,
        emptyPreConditionResult,
        startTime
      );
    }

    // =========================================================================
    // Phase 5: Pre-Condition Evaluation
    // =========================================================================
    const evaluationContext = this.options.evaluationContext ?? createEvaluationContext();
    const preConditionResult = await evaluatePreConditions(
      validPlan,
      this.conditionEvaluator,
      evaluationContext,
      this.options.preConditionOptions
    );

    // =========================================================================
    // Build and return full result
    // =========================================================================
    return this.buildFullResult(
      schemaResult,
      semanticResult,
      resourceResult,
      connectivityResult,
      preConditionResult,
      startTime
    );
  }

  /**
   * Validates only the schema of a plan (quick validation)
   *
   * @param plan - The plan to validate
   * @returns ValidationResult with schema validation status
   */
  validateSchemaOnly(plan: unknown): ValidationResult {
    return validateSchema(plan, this.options.schemaOptions);
  }

  /**
   * Validates only the semantics of a plan (assumes schema is valid)
   *
   * @param plan - The validated plan to check semantically
   * @returns ValidationResult with semantic validation status
   */
  validateSemanticsOnly(plan: SimulationPlan): ValidationResult {
    return validateSemantics(plan, this.options.semanticOptions);
  }

  /**
   * Validates only resource availability (assumes schema is valid)
   *
   * @param plan - The validated plan to check resources for
   * @returns Promise resolving to ValidationResult with resource status
   */
  async validateResourcesOnly(plan: SimulationPlan): Promise<ValidationResult> {
    const resourcePool = await this.getResourcePool();
    return validateResourceAvailability(plan, resourcePool, this.options.resourceOptions);
  }

  /**
   * Validates only connectivity (assumes schema is valid)
   *
   * @param plan - The validated plan to check connectivity for
   * @returns Promise resolving to ValidationResult with connectivity status
   */
  async validateConnectivityOnly(plan: SimulationPlan): Promise<ValidationResult> {
    return validateIntegrationConnectivity(
      plan,
      this.connectivityTester,
      this.options.connectivityOptions
    );
  }

  /**
   * Evaluates only pre-conditions (assumes schema is valid)
   *
   * @param plan - The validated plan to evaluate pre-conditions for
   * @param context - Evaluation context
   * @returns Promise resolving to ValidationResult with pre-condition status
   */
  async evaluatePreConditionsOnly(
    plan: SimulationPlan,
    context?: Record<string, unknown>
  ): Promise<ValidationResult> {
    const evaluationContext = context ?? this.options.evaluationContext ?? createEvaluationContext();
    return evaluatePreConditions(
      plan,
      this.conditionEvaluator,
      evaluationContext,
      this.options.preConditionOptions
    );
  }

  /**
   * Gets the resource pool for validation
   */
  private async getResourcePool(): Promise<ResourcePool> {
    if (this.options.resourcePool) {
      return this.options.resourcePool;
    }

    return queryResourcePool(
      this.options.tenantId,
      this.stateRepository
    );
  }

  /**
   * Builds the full validation result from all phase results
   */
  private buildFullResult(
    schemaResult: ValidationResult,
    semanticResult: ValidationResult,
    resourceResult: ValidationResult,
    connectivityResult: ValidationResult,
    preConditionResult: ValidationResult,
    startTime: number
  ): FullValidationResult {
    const allErrors = [
      ...schemaResult.errors,
      ...semanticResult.errors,
      ...resourceResult.errors,
      ...connectivityResult.errors,
      ...preConditionResult.errors,
    ];

    const allWarnings = [
      ...schemaResult.warnings,
      ...semanticResult.warnings,
      ...resourceResult.warnings,
      ...connectivityResult.warnings,
      ...preConditionResult.warnings,
    ];

    const valid =
      schemaResult.valid &&
      semanticResult.valid &&
      resourceResult.valid &&
      connectivityResult.valid &&
      preConditionResult.valid;

    return {
      valid,
      schemaResult,
      semanticResult,
      resourceResult,
      connectivityResult,
      preConditionResult,
      allErrors,
      allWarnings,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Creates a new orchestrator with updated options
   *
   * @param options - Options to merge with existing options
   * @returns New ValidationOrchestrator instance
   */
  withOptions(options: Partial<ValidationOrchestratorOptions>): ValidationOrchestrator {
    return new ValidationOrchestrator({
      ...this.options,
      ...options,
    });
  }

  /**
   * Creates a fail-fast orchestrator that stops on first error
   *
   * @returns New ValidationOrchestrator configured for fail-fast
   */
  failFast(): ValidationOrchestrator {
    return this.withOptions({ failFast: true });
  }

  /**
   * Creates an orchestrator for a specific tenant
   *
   * @param tenantId - The tenant ID
   * @returns New ValidationOrchestrator configured for tenant
   */
  forTenant(tenantId: string): ValidationOrchestrator {
    return this.withOptions({ tenantId });
  }

  /**
   * Creates an orchestrator with custom resource pool
   *
   * @param resourcePool - The resource pool to use
   * @returns New ValidationOrchestrator with custom resource pool
   */
  withResourcePool(resourcePool: ResourcePool): ValidationOrchestrator {
    return this.withOptions({ resourcePool });
  }

  /**
   * Creates an orchestrator with custom evaluation context
   *
   * @param context - The evaluation context
   * @returns New ValidationOrchestrator with custom context
   */
  withEvaluationContext(context: Record<string, unknown>): ValidationOrchestrator {
    return this.withOptions({ evaluationContext: context });
  }
}

/**
 * Factory function to create a ValidationOrchestrator
 *
 * @param options - Optional configuration
 * @returns New ValidationOrchestrator instance
 */
export function createValidationOrchestrator(
  options?: ValidationOrchestratorOptions
): ValidationOrchestrator {
  return new ValidationOrchestrator(options);
}

/**
 * Default shared orchestrator instance
 */
let sharedOrchestrator: ValidationOrchestrator | null = null;

/**
 * Gets or creates the shared ValidationOrchestrator
 *
 * @returns The shared orchestrator instance
 */
export function getSharedValidationOrchestrator(): ValidationOrchestrator {
  if (!sharedOrchestrator) {
    sharedOrchestrator = new ValidationOrchestrator();
  }
  return sharedOrchestrator;
}

/**
 * Convenience function to validate a plan using the shared orchestrator
 *
 * @param plan - The plan to validate
 * @param options - Optional configuration overrides
 * @returns Promise resolving to FullValidationResult
 */
export async function validatePlan(
  plan: unknown,
  options?: ValidationOrchestratorOptions
): Promise<FullValidationResult> {
  const orchestrator = options
    ? new ValidationOrchestrator(options)
    : getSharedValidationOrchestrator();

  return orchestrator.validatePlan(plan);
}
