/**
 * Type Definitions for Agentics Simulation Runner
 *
 * This module exports all type definitions used throughout the system.
 * Types are organized according to the SPARC specification structure.
 *
 * @module types
 */

// =============================================================================
// Common Types
// =============================================================================

export * from './common.js';

// =============================================================================
// Workflow Types
// =============================================================================

export type {
  // Step types
  WorkflowStepType,
  WorkflowTrigger,
  ImmediateTrigger,
  ScheduledTrigger,
  EventDrivenTrigger,

  // Step input/output
  StepInputSpec,
  StepOutputSpec,

  // Step definitions
  BaseWorkflowStep,
  AgentInvocationStep,
  IntegrationCallStep,
  ConditionalStep,
  ParallelGroupStep,
  LoopStep,
  CheckpointStep,
  DelayStep,
  StateMutationStep,
  EventEmitStep,
  WorkflowStep,

  // Workflow definition
  WorkflowErrorHandling,
  WorkflowDefinition,

  // Step results
  WorkflowStepResult,

  // Dependency types
  WorkflowDependencyNode,
  WorkflowDependencyGraph,
} from './workflow.js';

// Type guards from workflow
export {
  isAgentInvocationStep,
  isIntegrationCallStep,
  isConditionalStep,
  isParallelGroupStep,
  isLoopStep,
  isCheckpointStep,
  isDelayStep,
  isStateMutationStep,
  isEventEmitStep,
} from './workflow.js';

// =============================================================================
// Simulation Plan Types
// =============================================================================

export type {
  // Metadata
  SimulationPlanMetadata,

  // Configuration
  ExecutionConfig,
  StateConfig,

  // Agent configuration
  AgentLLMBinding,
  AgentMemoryBinding,
  AgentCapability,
  AgentConstraints,
  AgentDefinition,

  // Integration configuration
  IntegrationAuthentication,
  IntegrationEndpoint,

  // Observability configuration
  TracingConfig,
  MetricsConfig,
  LoggingConfig,
  ObservabilityConfig,

  // Validation configuration
  Invariant,
  ValidationConfig,

  // Workflow configuration
  WorkflowConfig,

  // Main plan type
  SimulationPlan,

  // Validation result
  PlanValidationResult,
} from './simulation-plan.js';

// Type guards from simulation-plan
export {
  isHttpIntegrationConfig,
  isGrpcIntegrationConfig,
  isWebSocketIntegrationConfig,
  isMessageQueueIntegrationConfig,
} from './simulation-plan.js';

// =============================================================================
// Simulation Result Types
// =============================================================================

export type {
  // Execution metadata
  ExecutionMetadata,
  ExecutionSummary,

  // State
  FinalState,

  // Agent summary
  AgentSummary,

  // Step results
  StepResult,

  // Integration observations
  IntegrationObservation,

  // Telemetry
  ExecutionTelemetry,

  // Validation
  ValidationOutcomes,

  // Artifacts
  ExecutionArtifact,

  // Reproducibility
  ReproducibilityProof,

  // Audit
  ExecutionAuditTrail,

  // Main result type
  SimulationResult,

  // Partial result
  PartialSimulationResult,

  // Query params
  ResultQueryParams,
} from './simulation-result.js';

// Type guards from simulation-result
export {
  isCompleteResult,
  isSuccessfulResult,
  isReproducibleResult,
} from './simulation-result.js';

// =============================================================================
// Execution Context Types
// =============================================================================

export type {
  // Random generator
  SeededRandomGenerator,

  // State namespace
  StateNamespace,
  StateTransaction,
  VectorCollection,
  VectorSearchResult,

  // Agent context
  AgentContext,
  LLMInvokeOptions,
  LLMResponse,
  AgentMetrics,

  // Rate limiter
  RateLimiter,

  // Resource manager
  ResourceManager,
  ResourceType,
  ResourceUsage,
  ResourceSnapshot,

  // Telemetry
  TelemetryCollector,
  SpanHandle,

  // Checkpoint manager
  CheckpointManager,
  Checkpoint,
  CheckpointInfo,

  // Main context type
  ExecutionContext,
  AgentSpawnConfig,

  // Factory
  ExecutionContextConfig,
  ExecutionContextFactory,
} from './execution-context.js';

// =============================================================================
// Legacy Exports (backward compatibility)
// =============================================================================

// Note: The legacy modules (plan.js, result.js, execution.js) contain types
// that may conflict with the newer types in common.js. Import them directly
// from their respective modules if needed:
// - import { ... } from './types/plan.js'
// - import { ... } from './types/result.js'
// - import { ... } from './types/execution.js'

// =============================================================================
// Engine Integration Types
// =============================================================================

export type {
  // Engine configuration
  EngineTransport,
  EngineConnectionMode,
  EngineTLSConfig,
  EnginePoolConfig,
  SimulationEngineConfig,

  // Engine invocation
  EngineExecutionMode,
  EngineStreamingConfig,
  EngineCheckpointConfig,
  EngineInvocationRequest,

  // Timeline types
  TimelineEntryType,
  EngineTimelineEntry,
  TimelineEntryData,
  ExecutionStartData,
  ExecutionEndData,
  StepStartData,
  StepEndData,
  AgentInvokeData,
  AgentResponseData,
  LLMRequestData,
  LLMResponseData,
  StateReadData,
  StateWriteData,
  IntegrationCallData,
  IntegrationResponseData,
  CheckpointData,
  ErrorData,
  WarningData,
  CustomData,
  EngineTimeline,

  // Artifact types
  EngineArtifactType,
  ArtifactStorageType,
  ArtifactEncoding,
  ArtifactStorageLocation,
  EngineArtifact,

  // Execution result types
  DeterministicOutputs,
  EngineMetrics,
  EngineExecutionResult,

  // Adapter and callback types
  TimelineStreamCallback,
  LogStreamCallback,
  ExecutionProgress,
  ProgressCallback,
  EngineAdapter,

  // Conversion types
  ResultConversionOptions,
  EngineResultConverter,
} from './engine-types.js';

// Type guards from engine-types
export {
  isEngineExecutionResult,
  isErrorTimelineEntry,
  isStepTimelineEntry,
  isCheckpointArtifact,
  isDeterministicResult,
} from './engine-types.js';
