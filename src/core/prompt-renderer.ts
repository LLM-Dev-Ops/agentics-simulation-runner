/**
 * Prompt Template Renderer (MOD-007)
 *
 * Renders prompt templates with variable substitution for agent invocations.
 * Supports input variables, previous step outputs, and execution context values.
 *
 * References:
 * - SPARC_ARCHITECTURE.md MOD-007 Agent Lifecycle Manager
 * - SPARC_SPECIFICATION.md Section 4.3 Agent Manifest (promptTemplate)
 *
 * Template Syntax:
 * - {{variable}} - Input variables
 * - {{step.output[stepId]}} - Previous step outputs
 * - {{step.output[stepId].field}} - Nested field access
 * - {{context.xxx}} - Execution context values
 * - {{agent.xxx}} - Agent-specific values
 */

import type { UUID } from '../types/common.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Execution context values available for template rendering
 */
export interface RenderContext {
  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Plan ID
   */
  readonly planId: UUID;

  /**
   * Current step ID
   */
  readonly stepId: string;

  /**
   * Current step sequence number
   */
  readonly stepSequence: number;

  /**
   * Execution start time
   */
  readonly startTime: Date;

  /**
   * Current timestamp
   */
  readonly currentTime: Date;

  /**
   * Elapsed time in milliseconds
   */
  readonly elapsedMs: number;

  /**
   * Tenant ID (if multi-tenant)
   */
  readonly tenantId?: string;

  /**
   * Additional context values
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Agent-specific values for template rendering
 */
export interface AgentRenderContext {
  /**
   * Agent ID
   */
  readonly agentId: string;

  /**
   * Agent name/role
   */
  readonly agentName: string;

  /**
   * Agent type
   */
  readonly agentType: string;

  /**
   * Invocation count for this agent
   */
  readonly invocationCount: number;

  /**
   * Agent configuration parameters
   */
  readonly config: Record<string, unknown>;
}

/**
 * Step outputs from previous steps
 */
export type StepOutputs = Record<string, unknown>;

/**
 * Configuration for the prompt renderer
 */
export interface PromptRendererConfig {
  /**
   * Whether to throw on missing variables (default: true)
   */
  readonly throwOnMissing?: boolean;

  /**
   * Default value for missing variables (used when throwOnMissing is false)
   */
  readonly defaultValue?: string;

  /**
   * Maximum template recursion depth (default: 3)
   */
  readonly maxRecursionDepth?: number;

  /**
   * Custom variable resolvers
   */
  readonly customResolvers?: Record<string, VariableResolver>;
}

/**
 * Function to resolve a custom variable
 */
export type VariableResolver = (path: string[], context: FullRenderContext) => string | undefined;

/**
 * Full context passed to the renderer
 */
export interface FullRenderContext {
  readonly inputs: Record<string, unknown>;
  readonly stepOutputs: StepOutputs;
  readonly context: RenderContext;
  readonly agent: AgentRenderContext;
}

/**
 * Result of template rendering
 */
export interface RenderResult {
  /**
   * The rendered prompt
   */
  readonly prompt: string;

  /**
   * Variables that were resolved
   */
  readonly resolvedVariables: readonly string[];

  /**
   * Variables that were missing (if throwOnMissing is false)
   */
  readonly missingVariables: readonly string[];

  /**
   * Warnings generated during rendering
   */
  readonly warnings: readonly string[];
}

// =============================================================================
// Prompt Renderer Implementation
// =============================================================================

/**
 * Regex pattern for matching template variables
 * Matches: {{variable}}, {{step.output[stepId]}}, {{context.xxx}}, etc.
 */
const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Regex pattern for step output access
 * Matches: step.output[stepId] or step.output[stepId].field.subfield
 */
const STEP_OUTPUT_PATTERN = /^step\.output\[([^\]]+)\](?:\.(.+))?$/;

/**
 * Renders a prompt template with variable substitution
 *
 * @param template - The prompt template string
 * @param inputs - Input variables from the step
 * @param stepOutputs - Outputs from previous steps
 * @param context - Execution context
 * @param agent - Agent context
 * @param config - Renderer configuration
 * @returns RenderResult with the rendered prompt
 */
export function renderPromptTemplate(
  template: string,
  inputs: Record<string, unknown>,
  stepOutputs: StepOutputs,
  context: RenderContext,
  agent: AgentRenderContext,
  config: PromptRendererConfig = {}
): RenderResult {
  const {
    throwOnMissing = true,
    defaultValue = '',
    maxRecursionDepth = 3,
    customResolvers = {},
  } = config;

  const resolvedVariables: string[] = [];
  const missingVariables: string[] = [];
  const warnings: string[] = [];

  const fullContext: FullRenderContext = {
    inputs,
    stepOutputs,
    context,
    agent,
  };

  // Render the template with recursion support
  const prompt = renderWithRecursion(
    template,
    fullContext,
    {
      throwOnMissing,
      defaultValue,
      customResolvers,
    },
    resolvedVariables,
    missingVariables,
    warnings,
    0,
    maxRecursionDepth
  );

  return {
    prompt,
    resolvedVariables,
    missingVariables,
    warnings,
  };
}

/**
 * Recursively renders a template string
 */
function renderWithRecursion(
  template: string,
  context: FullRenderContext,
  config: {
    throwOnMissing: boolean;
    defaultValue: string;
    customResolvers: Record<string, VariableResolver>;
  },
  resolvedVariables: string[],
  missingVariables: string[],
  warnings: string[],
  depth: number,
  maxDepth: number
): string {
  if (depth >= maxDepth) {
    warnings.push(`Maximum recursion depth (${maxDepth}) reached during template rendering`);
    return template;
  }

  let result = template;
  let hasChanges = false;

  result = result.replace(VARIABLE_PATTERN, (match, variablePath: string) => {
    const trimmedPath = variablePath.trim();
    const value = resolveVariable(trimmedPath, context, config.customResolvers);

    if (value !== undefined) {
      resolvedVariables.push(trimmedPath);
      hasChanges = true;
      return stringifyValue(value);
    }

    if (config.throwOnMissing) {
      throw new PromptRenderError(
        `Missing variable in template: ${trimmedPath}`,
        trimmedPath,
        template
      );
    }

    missingVariables.push(trimmedPath);
    return config.defaultValue;
  });

  // Recursively render if we made changes (for nested variables)
  if (hasChanges && VARIABLE_PATTERN.test(result)) {
    return renderWithRecursion(
      result,
      context,
      config,
      resolvedVariables,
      missingVariables,
      warnings,
      depth + 1,
      maxDepth
    );
  }

  return result;
}

/**
 * Resolves a variable path to its value
 */
function resolveVariable(
  path: string,
  context: FullRenderContext,
  customResolvers: Record<string, VariableResolver>
): unknown {
  const parts = path.split('.');
  const namespace = parts[0];

  // Check custom resolvers first
  if (customResolvers[namespace]) {
    return customResolvers[namespace](parts.slice(1), context);
  }

  // Handle different variable namespaces
  switch (namespace) {
    case 'step':
      return resolveStepVariable(path, context.stepOutputs);

    case 'context':
      return resolveObjectPath(context.context, parts.slice(1));

    case 'agent':
      return resolveAgentVariable(parts.slice(1), context.agent);

    case 'input':
    case 'inputs':
      return resolveObjectPath(context.inputs, parts.slice(1));

    default:
      // Try direct input lookup for unnamespaced variables
      return resolveObjectPath(context.inputs, parts);
  }
}

/**
 * Resolves step output variables
 * Format: step.output[stepId] or step.output[stepId].field
 */
function resolveStepVariable(path: string, stepOutputs: StepOutputs): unknown {
  const match = path.match(STEP_OUTPUT_PATTERN);
  if (!match) {
    return undefined;
  }

  const [, stepId, fieldPath] = match;
  const stepOutput = stepOutputs[stepId];

  if (stepOutput === undefined) {
    return undefined;
  }

  if (!fieldPath) {
    return stepOutput;
  }

  return resolveObjectPath(stepOutput, fieldPath.split('.'));
}

/**
 * Resolves agent-specific variables
 */
function resolveAgentVariable(
  parts: string[],
  agent: AgentRenderContext
): unknown {
  if (parts.length === 0) {
    return undefined;
  }

  const key = parts[0];

  switch (key) {
    case 'id':
      return agent.agentId;
    case 'name':
      return agent.agentName;
    case 'type':
      return agent.agentType;
    case 'invocationCount':
      return agent.invocationCount;
    case 'config':
      return resolveObjectPath(agent.config, parts.slice(1));
    default:
      return undefined;
  }
}

/**
 * Resolves a nested object path
 */
function resolveObjectPath(obj: unknown, path: string[]): unknown {
  if (path.length === 0) {
    return obj;
  }

  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (typeof obj !== 'object') {
    return undefined;
  }

  const [key, ...rest] = path;
  const value = (obj as Record<string, unknown>)[key];

  if (rest.length === 0) {
    return value;
  }

  return resolveObjectPath(value, rest);
}

/**
 * Converts a value to a string for template substitution
 */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown during prompt rendering
 */
export class PromptRenderError extends Error {
  constructor(
    message: string,
    public readonly variablePath: string,
    public readonly template: string
  ) {
    super(message);
    this.name = 'PromptRenderError';
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Simple template rendering without full context
 * For cases where only input variables are needed
 */
export function renderSimpleTemplate(
  template: string,
  variables: Record<string, unknown>,
  throwOnMissing: boolean = true
): string {
  const dummyContext: RenderContext = {
    executionId: '00000000-0000-0000-0000-000000000000',
    planId: '00000000-0000-0000-0000-000000000000',
    stepId: 'unknown',
    stepSequence: 0,
    startTime: new Date(),
    currentTime: new Date(),
    elapsedMs: 0,
  };

  const dummyAgent: AgentRenderContext = {
    agentId: 'unknown',
    agentName: 'Unknown',
    agentType: 'unknown',
    invocationCount: 0,
    config: {},
  };

  const result = renderPromptTemplate(
    template,
    variables,
    {},
    dummyContext,
    dummyAgent,
    { throwOnMissing }
  );

  return result.prompt;
}

/**
 * Validates a template string without rendering
 * Returns the list of variables found in the template
 */
export function extractVariables(template: string): string[] {
  const variables: string[] = [];
  let match;

  const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');
  while ((match = pattern.exec(template)) !== null) {
    variables.push(match[1].trim());
  }

  return variables;
}

/**
 * Checks if a template string is valid
 * Returns true if all braces are balanced
 */
export function validateTemplateSyntax(template: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for unmatched opening braces
  const openBraces = template.match(/\{\{/g)?.length ?? 0;
  const closeBraces = template.match(/\}\}/g)?.length ?? 0;

  if (openBraces !== closeBraces) {
    errors.push(`Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
  }

  // Check for empty variable names
  if (/\{\{\s*\}\}/.test(template)) {
    errors.push('Empty variable name found: {{}}');
  }

  // Check for nested braces (not supported)
  if (/\{\{[^}]*\{\{/.test(template)) {
    errors.push('Nested braces are not supported');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Escapes template syntax in a string
 * Use when you want literal {{ and }} in the output
 */
export function escapeTemplate(text: string): string {
  return text.replace(/\{\{/g, '\\{\\{').replace(/\}\}/g, '\\}\\}');
}

/**
 * Unescapes template syntax in a string
 */
export function unescapeTemplate(text: string): string {
  return text.replace(/\\\{\\\{/g, '{{').replace(/\\\}\\\}/g, '}}');
}
