/**
 * Engine Module
 *
 * Provides the core execution engine components for the simulation runner.
 *
 * @module engine
 */

// Structured Result Emitter - transforms results for export
export {
  StructuredResultEmitter,
  createStructuredResultEmitter,
  emitResult,
  formatResultForExport,
  formatResultForROIEngine,
  type ExportFormat,
  type EngineExecutionResult,
  type EmittedResult,
  type EmittedResultMetadata,
  type TimelineEvent,
  type TimelineEventType,
  type ExecutionSummaryData,
  type AgentExecutionData,
  type IntegrationExecutionData,
  type ArtifactReference,
  type DeterminismData,
  type StateHashEntry,
  type ExportableResult,
  type ExportMetadata,
  type ROIEngineInput,
  type ROIExecutionMetrics,
  type ROIAgentMetrics,
  type ROIIntegrationMetrics,
  type ROITimelineEntry,
  type ROIValidationSummary,
} from './structured-result-emitter.js';

// Simulation Engine Invoker - connects to agentics-simulation-engine
export {
  SimulationEngineInvoker,
  createSimulationEngineInvoker,
  EngineConnectionError,
  EngineInvocationError,
  EngineTimeoutError,
  DEFAULT_ENGINE_CONFIG,
  type EngineConnectionConfig,
  type EngineTimeline,
  type EngineTimelineEventType,
  type EngineArtifact,
  type EngineArtifactType,
  type EngineHealthStatus,
  type EngineComponentHealth,
  type EngineResourceStatus,
  type InvokerExecutionResult,
  type EngineStepResult,
  type EngineExecutionError,
  type EngineReproducibilityData,
} from './simulation-engine-invoker.js';
