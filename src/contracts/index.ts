/**
 * Contract Enforcement Module
 *
 * Provides JSON Schema validation at the HTTP boundary using Ajv.
 * This is the SINGLE validation boundary for all incoming simulation requests.
 *
 * Contract: simulation/v1/request.schema.json
 *
 * This module enforces:
 * - INV-IN-001: SimulationPlan MUST be syntactically valid
 * - Strict JSON Schema validation before any execution logic
 * - Single validation boundary (no duplicate downstream validation)
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use createRequire for CommonJS modules with complex default exports
const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Define types for Ajv validation
interface AjvErrorObject {
  instancePath: string;
  message?: string;
  keyword: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

interface AjvValidateFunction {
  (data: unknown): boolean;
  errors?: AjvErrorObject[] | null;
}

interface AjvInstance {
  compile(schema: object): AjvValidateFunction;
}

// ============================================================================
// Contract Schema Loading
// ============================================================================

/**
 * Load the simulation request schema from the contracts directory
 */
function loadRequestSchema(): object {
  const schemaPath = join(__dirname, '../../contracts/simulation/v1/request.schema.json');
  const schemaContent = readFileSync(schemaPath, 'utf-8');
  return JSON.parse(schemaContent);
}

// ============================================================================
// Ajv Instance Configuration
// ============================================================================

/**
 * Create and configure Ajv instance with strict validation
 */
function createAjvInstance(): AjvInstance {
  const ajv = new Ajv({
    strict: true,
    allErrors: true, // Collect all errors, not just the first
    verbose: true, // Include schema and data in errors
    validateFormats: true,
    coerceTypes: false, // Don't coerce types - strict validation
    useDefaults: false, // Don't fill in defaults - require explicit values
    removeAdditional: false, // Don't remove additional properties
  });

  // Add format validators (date-time, uri, etc.)
  addFormats(ajv);

  return ajv as AjvInstance;
}

// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Validation error detail
 */
export interface ContractValidationError {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  readonly params: Record<string, unknown>;
  readonly schemaPath: string;
}

/**
 * Result of contract validation
 */
export interface ContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ContractValidationError[];
  readonly validatedAt: string;
  readonly schemaId: string;
  readonly schemaVersion: string;
}

/**
 * Error thrown when contract validation fails
 */
export class ContractValidationException extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED';

  constructor(
    public readonly result: ContractValidationResult
  ) {
    const errorMessages = result.errors
      .slice(0, 5) // Limit to first 5 errors in message
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');
    const suffix = result.errors.length > 5 ? ` (+${result.errors.length - 5} more errors)` : '';
    super(`Contract validation failed: ${errorMessages}${suffix}`);
    this.name = 'ContractValidationException';
    Error.captureStackTrace?.(this, ContractValidationException);
  }
}

// ============================================================================
// Contract Validator
// ============================================================================

/**
 * ContractValidator - Validates requests against JSON Schema contracts
 *
 * This is the authoritative validation layer. All incoming HTTP requests
 * MUST pass through this validator before any execution logic.
 */
export class ContractValidator {
  private readonly ajv: AjvInstance;
  private readonly validateRequest: AjvValidateFunction;
  private readonly schemaId: string;
  private readonly schemaVersion: string = 'v1';

  constructor() {
    this.ajv = createAjvInstance();
    const schema = loadRequestSchema();
    this.schemaId = (schema as { $id?: string }).$id || 'simulation/v1/request.schema.json';
    this.validateRequest = this.ajv.compile(schema);
  }

  /**
   * Validate a simulation request against the contract schema
   *
   * This is the SINGLE validation boundary. All requests must pass this
   * validation before any execution, scheduling, or dispatch logic runs.
   *
   * @param request - The request body to validate
   * @returns ContractValidationResult with validation status and errors
   */
  validate(request: unknown): ContractValidationResult {
    const valid = this.validateRequest(request);

    const errors: ContractValidationError[] = (this.validateRequest.errors || []).map((error) => ({
      path: error.instancePath || '/',
      message: error.message || 'Validation error',
      keyword: error.keyword,
      params: error.params as Record<string, unknown>,
      schemaPath: error.schemaPath,
    }));

    return {
      valid,
      errors,
      validatedAt: new Date().toISOString(),
      schemaId: this.schemaId,
      schemaVersion: this.schemaVersion,
    };
  }

  /**
   * Validate and throw if invalid
   *
   * Convenience method that throws ContractValidationException if validation fails.
   * Use this at the HTTP boundary to reject invalid requests immediately.
   *
   * @param request - The request body to validate
   * @throws ContractValidationException if validation fails
   */
  validateOrThrow(request: unknown): void {
    const result = this.validate(request);
    if (!result.valid) {
      throw new ContractValidationException(result);
    }
  }

  /**
   * Get schema information
   */
  getSchemaInfo(): { id: string; version: string } {
    return {
      id: this.schemaId,
      version: this.schemaVersion,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sharedValidator: ContractValidator | null = null;

/**
 * Get the shared ContractValidator instance
 *
 * Use this for all HTTP boundary validation to ensure consistent
 * schema usage and avoid recompiling the schema.
 */
export function getContractValidator(): ContractValidator {
  if (!sharedValidator) {
    sharedValidator = new ContractValidator();
  }
  return sharedValidator;
}

/**
 * Validate a simulation request using the shared validator
 *
 * Convenience function for quick validation.
 *
 * @param request - The request body to validate
 * @returns ContractValidationResult
 */
export function validateSimulationRequest(request: unknown): ContractValidationResult {
  return getContractValidator().validate(request);
}

/**
 * Validate a simulation request and throw if invalid
 *
 * @param request - The request body to validate
 * @throws ContractValidationException if validation fails
 */
export function validateSimulationRequestOrThrow(request: unknown): void {
  getContractValidator().validateOrThrow(request);
}

// ============================================================================
// Execution Proof Types
// ============================================================================

/**
 * Layer execution record for multi-layer participation proof
 */
export interface LayerExecuted {
  readonly layerId: string;
  readonly layerType: 'validation' | 'scheduling' | 'dispatch' | 'execution' | 'finalization';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: 'success' | 'error' | 'skipped';
  readonly details?: Record<string, unknown>;
}

/**
 * Execution graph node
 */
export interface ExecutionGraphNode {
  readonly nodeId: string;
  readonly nodeType: 'step' | 'agent' | 'integration' | 'checkpoint';
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly parentNodes: readonly string[];
  readonly childNodes: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Execution proof demonstrating multi-layer participation
 *
 * This is REQUIRED in all responses to prove that the execution
 * went through multiple processing layers (not just validation).
 */
export interface ExecutionProof {
  /**
   * Proof identifier
   */
  readonly proofId: string;

  /**
   * Layers that participated in execution
   * MUST contain at least: validation, execution
   */
  readonly layers_executed: readonly LayerExecuted[];

  /**
   * Execution graph showing step relationships
   */
  readonly execution_graph: {
    readonly nodes: readonly ExecutionGraphNode[];
    readonly edges: readonly {
      readonly from: string;
      readonly to: string;
      readonly type: 'dependency' | 'sequence' | 'parallel';
    }[];
  };

  /**
   * Total layers that participated
   */
  readonly layerCount: number;

  /**
   * Whether execution proof is complete
   */
  readonly complete: boolean;

  /**
   * Timestamp when proof was generated
   */
  readonly generatedAt: string;
}

/**
 * Create an execution proof from layer execution records
 */
export function createExecutionProof(
  proofId: string,
  layersExecuted: readonly LayerExecuted[],
  graphNodes: readonly ExecutionGraphNode[],
  graphEdges: readonly { from: string; to: string; type: 'dependency' | 'sequence' | 'parallel' }[]
): ExecutionProof {
  return {
    proofId,
    layers_executed: layersExecuted,
    execution_graph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
    layerCount: layersExecuted.length,
    complete: layersExecuted.some((l) => l.layerType === 'execution' && l.status === 'success'),
    generatedAt: new Date().toISOString(),
  };
}
