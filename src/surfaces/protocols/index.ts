/**
 * Protocol Implementations Module
 *
 * Exports all protocol adapters for the External Integration Surface.
 *
 * @module surfaces/protocols
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

// =============================================================================
// Base Protocol Exports
// =============================================================================

export {
  // Types
  type ProtocolType,
  type ProtocolConnectionStatus,
  type ProtocolCredentials,
  type BaseConnectionSpec,
  type BaseIntegrationRequest,
  type BaseIntegrationResponse,
  type ProtocolConnection,
  type ProtocolMetrics,
  type ProtocolFactory,
  type ProtocolRegistry,
  // Base class
  BaseProtocol,
  // Registry
  DefaultProtocolRegistry,
} from './base-protocol.js';

// =============================================================================
// HTTP Protocol Exports
// =============================================================================

export {
  // Types
  type HttpMethod,
  type HttpConnectionSpec,
  type HttpIntegrationRequest,
  type HttpIntegrationResponse,
  type HttpTiming,
  // Class
  HttpProtocol,
  // Factory
  createHttpProtocol,
  createHttpsProtocol,
} from './http-protocol.js';

// =============================================================================
// Database Protocol Exports
// =============================================================================

export {
  // Types
  type DatabaseType,
  type DatabaseOperation,
  type QueryParameters,
  type DatabaseConnectionSpec,
  type DatabaseIntegrationRequest,
  type DatabaseIntegrationResponse,
  type TransactionOptions,
  type BatchStatement,
  type ColumnMetadata,
  // Class
  DatabaseProtocol,
  // Factory
  createDatabaseProtocol,
} from './database-protocol.js';
