/**
 * MOD-014 State Repository - Module Exports
 *
 * This module provides the state substrate layer for the agentics-simulation-runner.
 * ALL execution state MUST be persisted through the StateRepository.
 *
 * Key exports:
 * - StateRepository: Main class for state operations
 * - ConnectionPool: PostgreSQL connection pool management
 * - Table definitions: SQL schemas and type definitions
 */

// Connection pool exports
export {
  ConnectionPool,
  ConnectionPoolConfig,
  QueryOptions,
  TransactionCallback,
  TimedQueryResult,
  PoolStats,
  createConnectionPoolFromEnv,
  getSharedConnectionPool,
  shutdownSharedConnectionPool,
} from './connection-pool.js';

// Table definitions exports
export {
  NamespaceConfig,
  getNamespacePrefix,
  GLOBAL_TABLES,
  NAMESPACED_TABLE_TEMPLATES,
  getDropNamespacedTablesSql,
  getCreateNamespacedTablesSql,
  getCreateGlobalTablesSql,
  getCreateTenantPartitionSql,
  // Row type exports
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
} from './table-definitions.js';

// State repository exports
export {
  StateRepository,
  getSharedStateRepository,
  // Interface exports
  ExecutionContext,
  SimulationPlanRef,
  StepDefinition,
  StepStateUpdate,
  AgentInvocation,
  IntegrationCall,
  MetricRecord,
  EventRecord,
  StateCheckpoint,
  SimulationResult,
} from './state-repository.js';
