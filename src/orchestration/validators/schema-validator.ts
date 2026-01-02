/**
 * Schema Validator (INV-IN-001)
 *
 * Validates SimulationPlan syntactic structure using Zod schemas.
 * Ensures the plan conforms to the expected JSON schema before
 * further semantic validation can proceed.
 *
 * Implements INV-IN-001: SimulationPlan MUST be syntactically valid
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-002
 * - SPARC_PSEUDOCODE.md Section 3.1
 * - SPARC_SPECIFICATION.md Section 4.2
 */

import { z } from 'zod';
import { SimulationPlanSchema } from '../../types/plan.js';
import type { ValidationResult, ValidationError, ValidationWarning } from './types.js';

/**
 * Schema validation configuration options
 */
export interface SchemaValidatorOptions {
  /**
   * Whether to collect all errors or stop at first error
   */
  readonly collectAllErrors?: boolean;

  /**
   * Custom schema to use instead of default SimulationPlanSchema
   */
  readonly customSchema?: z.ZodType<unknown>;

  /**
   * Maximum error count before stopping collection
   */
  readonly maxErrors?: number;
}

const DEFAULT_OPTIONS: Required<SchemaValidatorOptions> = {
  collectAllErrors: true,
  customSchema: SimulationPlanSchema,
  maxErrors: 100,
};

/**
 * Validates a SimulationPlan against its JSON schema
 *
 * Enforces INV-IN-001: SimulationPlan MUST be syntactically valid
 *
 * From Pseudocode Section 3.1:
 * ```
 * FUNCTION validateSchema(plan: SimulationPlan): ValidationResult
 *   errors = []
 *   FOR EACH requiredField IN SCHEMA.requiredFields:
 *     IF plan[requiredField] IS MISSING:
 *       errors.append(ValidationError(code="MISSING_FIELD", path=requiredField))
 *   FOR EACH field, expectedType IN SCHEMA.fieldTypes:
 *     IF typeof(plan[field]) != expectedType:
 *       errors.append(ValidationError(code="TYPE_MISMATCH", path=field))
 *   // ... nested structure validation
 *   RETURN ValidationResult(valid=errors.isEmpty(), errors=errors)
 * ```
 *
 * @param plan - The plan object to validate (unknown type for safety)
 * @param options - Optional validation configuration
 * @returns ValidationResult with validation status and any errors/warnings
 */
export function validateSchema(
  plan: unknown,
  options: SchemaValidatorOptions = {}
): ValidationResult {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for null/undefined first
  if (plan === null || plan === undefined) {
    errors.push({
      code: 'PLAN_NULL',
      severity: 'FATAL',
      message: 'SimulationPlan cannot be null or undefined',
      path: '',
    });
    return {
      valid: false,
      errors,
      warnings,
      phase: 'SCHEMA_VALIDATION',
      validatedAt: new Date().toISOString(),
    };
  }

  // Check for basic object type
  if (typeof plan !== 'object' || Array.isArray(plan)) {
    errors.push({
      code: 'PLAN_NOT_OBJECT',
      severity: 'FATAL',
      message: 'SimulationPlan must be an object',
      path: '',
      context: { actualType: Array.isArray(plan) ? 'array' : typeof plan },
    });
    return {
      valid: false,
      errors,
      warnings,
      phase: 'SCHEMA_VALIDATION',
      validatedAt: new Date().toISOString(),
    };
  }

  try {
    // Use Zod for schema validation with error collection
    const schema = config.customSchema ?? SimulationPlanSchema;
    const result = schema.safeParse(plan);

    if (!result.success) {
      // Convert Zod errors to our ValidationError format
      for (const issue of result.error.issues) {
        if (errors.length >= config.maxErrors) {
          warnings.push({
            code: 'MAX_ERRORS_REACHED',
            message: `Maximum error count (${config.maxErrors}) reached, additional errors may exist`,
            path: '',
          });
          break;
        }

        const error = convertZodIssue(issue);
        errors.push(error);

        // Early exit if not collecting all errors
        if (!config.collectAllErrors) {
          break;
        }
      }
    }
  } catch (error) {
    // Handle unexpected schema validation errors
    errors.push({
      code: 'SCHEMA_VALIDATION_ERROR',
      severity: 'FATAL',
      message: `Unexpected schema validation error: ${error instanceof Error ? error.message : String(error)}`,
      path: '',
      context: { error: String(error) },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SCHEMA_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Converts a Zod issue to our ValidationError format
 */
function convertZodIssue(issue: z.ZodIssue): ValidationError {
  const path = issue.path.join('.');
  const baseError: ValidationError = {
    code: mapZodCodeToErrorCode(issue.code),
    severity: 'ERROR',
    message: formatZodMessage(issue),
    path,
    context: {
      zodCode: issue.code,
    },
  };

  // Add additional context based on issue type
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          expected: issue.expected,
          received: issue.received,
        },
      };

    case z.ZodIssueCode.invalid_literal:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          expected: issue.expected,
          received: issue.received,
        },
      };

    case z.ZodIssueCode.unrecognized_keys:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          keys: issue.keys,
        },
      };

    case z.ZodIssueCode.invalid_union:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          unionErrors: issue.unionErrors.map((e) => e.message),
        },
      };

    case z.ZodIssueCode.invalid_enum_value:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          options: issue.options,
          received: issue.received,
        },
      };

    case z.ZodIssueCode.too_small:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          minimum: issue.minimum,
          type: issue.type,
          inclusive: issue.inclusive,
        },
      };

    case z.ZodIssueCode.too_big:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          maximum: issue.maximum,
          type: issue.type,
          inclusive: issue.inclusive,
        },
      };

    case z.ZodIssueCode.invalid_string:
      return {
        ...baseError,
        context: {
          ...baseError.context,
          validation: issue.validation,
        },
      };

    default:
      return baseError;
  }
}

/**
 * Maps Zod error codes to our error codes
 */
function mapZodCodeToErrorCode(zodCode: z.ZodIssueCode): string {
  const codeMap: Record<z.ZodIssueCode, string> = {
    [z.ZodIssueCode.invalid_type]: 'TYPE_MISMATCH',
    [z.ZodIssueCode.invalid_literal]: 'INVALID_LITERAL',
    [z.ZodIssueCode.custom]: 'CUSTOM_VALIDATION',
    [z.ZodIssueCode.invalid_union]: 'INVALID_UNION',
    [z.ZodIssueCode.invalid_union_discriminator]: 'INVALID_DISCRIMINATOR',
    [z.ZodIssueCode.invalid_enum_value]: 'INVALID_ENUM',
    [z.ZodIssueCode.unrecognized_keys]: 'UNRECOGNIZED_KEYS',
    [z.ZodIssueCode.invalid_arguments]: 'INVALID_ARGUMENTS',
    [z.ZodIssueCode.invalid_return_type]: 'INVALID_RETURN_TYPE',
    [z.ZodIssueCode.invalid_date]: 'INVALID_DATE',
    [z.ZodIssueCode.invalid_string]: 'INVALID_STRING',
    [z.ZodIssueCode.too_small]: 'VALUE_TOO_SMALL',
    [z.ZodIssueCode.too_big]: 'VALUE_TOO_BIG',
    [z.ZodIssueCode.invalid_intersection_types]: 'INVALID_INTERSECTION',
    [z.ZodIssueCode.not_multiple_of]: 'NOT_MULTIPLE_OF',
    [z.ZodIssueCode.not_finite]: 'NOT_FINITE',
  };

  return codeMap[zodCode] ?? 'SCHEMA_ERROR';
}

/**
 * Formats a Zod issue message for user display
 */
function formatZodMessage(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `at '${issue.path.join('.')}'` : 'at root';

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return `Expected ${issue.expected} but received ${issue.received} ${path}`;

    case z.ZodIssueCode.invalid_literal:
      return `Expected literal ${JSON.stringify(issue.expected)} ${path}`;

    case z.ZodIssueCode.unrecognized_keys:
      return `Unrecognized keys: ${issue.keys.join(', ')} ${path}`;

    case z.ZodIssueCode.invalid_enum_value:
      return `Invalid enum value. Expected one of: ${issue.options.join(', ')} ${path}`;

    case z.ZodIssueCode.too_small:
      return `Value too small ${path}: minimum is ${issue.minimum}`;

    case z.ZodIssueCode.too_big:
      return `Value too big ${path}: maximum is ${issue.maximum}`;

    case z.ZodIssueCode.invalid_string:
      if (typeof issue.validation === 'object') {
        return `Invalid string format ${path}`;
      }
      return `Invalid string: ${issue.validation} ${path}`;

    default:
      return `${issue.message} ${path}`;
  }
}

/**
 * Validates only the required fields exist in the plan
 * This is a lighter-weight check for quick pre-validation
 *
 * @param plan - The plan object to check
 * @returns ValidationResult with missing field errors
 */
export function validateRequiredFields(plan: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (typeof plan !== 'object' || plan === null) {
    errors.push({
      code: 'PLAN_NOT_OBJECT',
      severity: 'FATAL',
      message: 'SimulationPlan must be an object',
      path: '',
    });
    return {
      valid: false,
      errors,
      warnings,
      phase: 'SCHEMA_VALIDATION',
      validatedAt: new Date().toISOString(),
    };
  }

  const requiredFields = [
    'planId',
    'planVersion',
    'planHash',
    'createdAt',
    'createdBy',
    'sourceIntent',
    'executionConfig',
    'workflow',
    'agents',
    'integrations',
    'observability',
    'validation',
  ];

  const planObj = plan as Record<string, unknown>;

  for (const field of requiredFields) {
    if (!(field in planObj)) {
      errors.push({
        code: 'MISSING_FIELD',
        severity: 'ERROR',
        message: `Required field '${field}' is missing`,
        path: field,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SCHEMA_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates the nested structure of workflow steps
 *
 * @param steps - Array of workflow steps to validate
 * @param basePath - Base path for error reporting
 * @returns ValidationResult with nested structure errors
 */
export function validateWorkflowStepsStructure(
  steps: unknown[],
  basePath: string = 'workflow.steps'
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!Array.isArray(steps)) {
    errors.push({
      code: 'STEPS_NOT_ARRAY',
      severity: 'ERROR',
      message: 'Workflow steps must be an array',
      path: basePath,
    });
    return {
      valid: false,
      errors,
      warnings,
      phase: 'SCHEMA_VALIDATION',
      validatedAt: new Date().toISOString(),
    };
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath = `${basePath}[${i}]`;

    if (typeof step !== 'object' || step === null) {
      errors.push({
        code: 'STEP_NOT_OBJECT',
        severity: 'ERROR',
        message: `Step at index ${i} must be an object`,
        path: stepPath,
      });
      continue;
    }

    const stepObj = step as Record<string, unknown>;

    // Check required step fields
    if (!stepObj.stepId) {
      errors.push({
        code: 'MISSING_STEP_ID',
        severity: 'ERROR',
        message: 'Step is missing required stepId field',
        path: `${stepPath}.stepId`,
      });
    }

    if (!stepObj.stepType) {
      errors.push({
        code: 'MISSING_STEP_TYPE',
        severity: 'ERROR',
        message: 'Step is missing required stepType field',
        path: `${stepPath}.stepType`,
      });
    }

    // Recursively validate sub-steps if present
    if (stepObj.subSteps && Array.isArray(stepObj.subSteps)) {
      const subResult = validateWorkflowStepsStructure(
        stepObj.subSteps,
        `${stepPath}.subSteps`
      );
      errors.push(...subResult.errors);
      warnings.push(...subResult.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phase: 'SCHEMA_VALIDATION',
    validatedAt: new Date().toISOString(),
  };
}
