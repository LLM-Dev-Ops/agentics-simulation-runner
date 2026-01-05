/**
 * agentics-simulation-runner
 *
 * Deterministic execution engine for the Agentics ecosystem.
 * Executes SimulationPlan artifacts and produces immutable SimulationResult artifacts.
 *
 * Architecture:
 * - MOD-001: Execution Gateway (API Boundary)
 * - MOD-002: Validation Orchestrator
 * - MOD-003: Instantiation Orchestrator
 * - MOD-004: Execution Orchestrator
 * - MOD-005: Finalization Orchestrator
 * - MOD-006: Workflow Scheduler
 * - MOD-007: Agent Lifecycle Manager
 * - MOD-008: Integration Adapter Manager
 * - MOD-009: Telemetry Collector
 * - MOD-010: LLM Invocation Surface
 * - MOD-011: External Integration Surface
 * - MOD-012: Agentics Ecosystem Surface
 * - MOD-013: Telemetry Export Surface
 * - MOD-014: State Repository
 *
 * References:
 * - SPARC_SPECIFICATION.md
 * - SPARC_ARCHITECTURE.md
 * - SPARC_PSEUDOCODE.md
 */

// ============================================================================
// Type Exports
// ============================================================================

export * from './types/index.js';

// ============================================================================
// API Gateway (MOD-001)
// ============================================================================

// Primary Gateway Exports
export {
  createExecutionGateway,
  ExecutionGatewayImpl,
  DEFAULT_GATEWAY_CONFIG,
  // Errors
  GatewayError,
  PlanValidationError,
  PlanIntegrityError,
  InvalidHandleError,
  ExecutionNotFoundError,
  ResultNotAvailableError,
  ExecutionFailedError,
  ExecutionAbortedError,
  ExecutionTimeoutError,
  TimeoutError,
  ExecutionAlreadyCompletedError,
  ResourceExhaustedError,
} from './api/execution-gateway.js';

export type {
  ExecutionGateway,
  GatewayConfig,
  ExecutionStatusResult,
  ExecutionProgress,
  AbortResult,
  GetResultOptions,
  HealthStatus,
  ComponentHealth,
} from './api/execution-gateway.js';

// Execution Handle
export type { ExecutionHandle } from './api/execution-handle.js';

export {
  createExecutionHandle,
  isValidExecutionHandle,
  serializeHandle,
  deserializeHandle,
  handlesAreEqual,
  handleMatchesExecution,
} from './api/execution-handle.js';

// Legacy Gateway (deprecated - for backward compatibility)
export {
  createExecutionGateway as createLegacyExecutionGateway,
  ExecutionGatewayImpl as LegacyExecutionGatewayImpl,
} from './api/gateway.js';

export type {
  ExecutionGateway as LegacyExecutionGateway,
  GatewayConfig as LegacyGatewayConfig,
} from './api/gateway.js';

// ============================================================================
// Orchestration Layer (MOD-002 to MOD-005)
// ============================================================================

export {
  validateSchema,
  validateSemantics,
  validateResourceAvailability,
  validateConnectivity,
  evaluatePreConditions,
  validatePlan,
} from './orchestration/validation.js';

export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  FullValidationResult,
  ResourcePool,
  ConnectivityTester,
  ConditionEvaluator,
} from './orchestration/validation.js';

// ============================================================================
// Core Utilities (MOD-006 to MOD-009)
// ============================================================================

export {
  createDeterministicRandom,
  restoreDeterministicRandom,
} from './core/deterministic-random.js';

export {
  computeSHA256,
  computeObjectHash,
  canonicalize,
  verifyHash,
  verifyObjectHash,
  createMerkleTree,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  computeExecutionFingerprint,
  bytesToHex,
  hexToBytes,
} from './core/hash-utils.js';

// ============================================================================
// State Repository (MOD-014)
// ============================================================================

export {
  ConnectionPool,
  createConnectionPoolFromEnv,
  getSharedConnectionPool,
  shutdownSharedConnectionPool,
} from './state/connection-pool.js';

export type {
  ConnectionPoolConfig,
  QueryOptions,
  TransactionCallback,
  TimedQueryResult,
  PoolStats,
} from './state/connection-pool.js';

export {
  getNamespacePrefix,
  GLOBAL_TABLES,
  NAMESPACED_TABLE_TEMPLATES,
  getDropNamespacedTablesSql,
  getCreateNamespacedTablesSql,
  getCreateGlobalTablesSql,
  getCreateTenantPartitionSql,
} from './state/table-definitions.js';

export type {
  NamespaceConfig,
  ExecutionContextRow,
  SimulationResultRow,
  StepStateRow,
  AgentInvocationRow,
  IntegrationCallRow,
  MetricRow,
  EventRow,
  RandomnessLogRow,
  StateSnapshotRow,
  ResultImmutabilityLockRow,
} from './state/table-definitions.js';

export {
  StateRepository,
  getSharedStateRepository,
} from './state/state-repository.js';

export type {
  ExecutionContext as StateExecutionContext,
  SimulationPlanRef,
  StepDefinition,
  StepStateUpdate,
  AgentInvocation,
  IntegrationCall,
  MetricRecord,
  EventRecord,
  StateCheckpoint,
  SimulationResult as StateSimulationResult,
} from './state/state-repository.js';

// ============================================================================
// Engine Module (Integration with agentics-simulation-engine)
// ============================================================================

export {
  // Simulation Engine Invoker
  SimulationEngineInvoker,
  createSimulationEngineInvoker,
  EngineConnectionError,
  EngineInvocationError,
  EngineTimeoutError,
  DEFAULT_ENGINE_CONFIG,
  // Structured Result Emitter
  StructuredResultEmitter,
  createStructuredResultEmitter,
  emitResult,
  formatResultForExport,
  formatResultForROIEngine,
} from './engine/index.js';

export type {
  // Engine Connection Types
  EngineConnectionConfig,
  EngineTimeline,
  EngineTimelineEventType,
  EngineArtifact,
  EngineArtifactType,
  EngineHealthStatus,
  EngineComponentHealth,
  EngineResourceStatus,
  InvokerExecutionResult,
  EngineStepResult,
  EngineExecutionError,
  EngineReproducibilityData,
  // Emitter Types
  ExportFormat,
  EngineExecutionResult,
  EmittedResult,
  EmittedResultMetadata,
  TimelineEvent,
  TimelineEventType,
  ExecutionSummaryData,
  AgentExecutionData,
  IntegrationExecutionData,
  ArtifactReference,
  DeterminismData,
  StateHashEntry,
  ExportableResult,
  ExportMetadata,
  ROIEngineInput,
  ROIExecutionMetrics,
  ROIAgentMetrics,
  ROIIntegrationMetrics,
  ROITimelineEntry,
  ROIValidationSummary,
} from './engine/index.js';

// ============================================================================
// Version Information
// ============================================================================

export const VERSION = '1.0.0';
export const RUNNER_NAME = 'agentics-simulation-runner';
