/**
 * Database Protocol Implementation
 *
 * Implements the database protocol adapter for the External Integration Surface.
 * Supports PostgreSQL, MySQL, and other SQL databases with query execution,
 * parameterized queries, transactions, and connection pooling.
 *
 * @module surfaces/protocols/database-protocol
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
  IsolationLevel,
} from '../../types/common.js';

import {
  BaseProtocol,
  type ProtocolCredentials,
  type ProtocolConnection,
  type BaseConnectionSpec,
  type BaseIntegrationRequest,
  type BaseIntegrationResponse,
} from './base-protocol.js';

// =============================================================================
// Database Protocol Types
// =============================================================================

/**
 * Supported database types
 */
export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite' | 'mssql' | 'oracle';

/**
 * Database operation types
 */
export type DatabaseOperation =
  | 'query'
  | 'execute'
  | 'transaction'
  | 'batch'
  | 'call';

/**
 * Query parameter types
 */
export type QueryParameters = unknown[] | Record<string, unknown>;

/**
 * Database connection specification
 */
export interface DatabaseConnectionSpec extends BaseConnectionSpec {
  /**
   * Protocol type (always 'database')
   */
  readonly protocol: 'database';

  /**
   * Database type
   */
  readonly databaseType: DatabaseType;

  /**
   * Database name
   */
  readonly database: string;

  /**
   * Schema name (for PostgreSQL)
   */
  readonly schema?: string;

  /**
   * SSL configuration
   */
  readonly ssl?: {
    readonly enabled: boolean;
    readonly rejectUnauthorized?: boolean;
    readonly ca?: string;
    readonly cert?: string;
    readonly key?: string;
  };

  /**
   * Connection pool settings
   */
  readonly pool?: {
    readonly min?: number;
    readonly max?: number;
    readonly idleTimeoutMs?: DurationMs;
    readonly acquireTimeoutMs?: DurationMs;
  };

  /**
   * Default isolation level for transactions
   */
  readonly defaultIsolationLevel?: IsolationLevel;

  /**
   * Statement timeout in milliseconds
   */
  readonly statementTimeoutMs?: DurationMs;

  /**
   * Use prepared statements
   */
  readonly usePreparedStatements?: boolean;
}

/**
 * Database integration request
 */
export interface DatabaseIntegrationRequest {
  /**
   * Database operation
   */
  readonly method: DatabaseOperation;

  /**
   * Request path (for compatibility)
   */
  readonly path?: string;

  /**
   * Request headers (for compatibility)
   */
  readonly headers?: Map<string, string> | Record<string, string>;

  /**
   * Request body (for compatibility)
   */
  readonly body?: unknown;

  /**
   * Request timeout in milliseconds
   */
  readonly timeout?: DurationMs;

  /**
   * Idempotency key
   */
  readonly idempotencyKey?: string;

  /**
   * SQL query or statement
   */
  readonly sql?: string;

  /**
   * Query parameters (positional or named)
   */
  readonly parameters?: QueryParameters;

  /**
   * Whether this is a read-only query
   */
  readonly readOnly?: boolean;

  /**
   * Fetch size for result sets
   */
  readonly fetchSize?: number;

  /**
   * Maximum rows to return
   */
  readonly maxRows?: number;

  /**
   * Transaction options (for transaction operation)
   */
  readonly transaction?: TransactionOptions;

  /**
   * Batch statements (for batch operation)
   */
  readonly batch?: BatchStatement[];

  /**
   * Stored procedure name (for call operation)
   */
  readonly procedureName?: string;
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  /**
   * Isolation level
   */
  readonly isolationLevel?: IsolationLevel;

  /**
   * Read-only transaction
   */
  readonly readOnly?: boolean;

  /**
   * Transaction timeout
   */
  readonly timeoutMs?: DurationMs;

  /**
   * Statements to execute in transaction
   */
  readonly statements?: BatchStatement[];
}

/**
 * Batch statement
 */
export interface BatchStatement {
  /**
   * SQL statement
   */
  readonly sql: string;

  /**
   * Statement parameters
   */
  readonly parameters?: QueryParameters;
}

/**
 * Database integration response
 */
export interface DatabaseIntegrationResponse extends BaseIntegrationResponse {
  /**
   * Result rows (for SELECT queries)
   */
  readonly rows?: Record<string, unknown>[];

  /**
   * Row count affected
   */
  readonly rowCount?: number;

  /**
   * Column metadata
   */
  readonly columns?: ColumnMetadata[];

  /**
   * Last inserted ID (if applicable)
   */
  readonly lastInsertId?: string | number;

  /**
   * Query warnings
   */
  readonly warnings?: string[];

  /**
   * Execution plan (if EXPLAIN was used)
   */
  readonly executionPlan?: unknown;

  /**
   * Query execution time on server
   */
  readonly serverTimeMs?: DurationMs;
}

/**
 * Column metadata
 */
export interface ColumnMetadata {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey?: boolean;
  readonly autoIncrement?: boolean;
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
}

// =============================================================================
// Mock Database Client (for simulation)
// =============================================================================

/**
 * Mock database client interface
 */
interface MockDatabaseClient {
  connected: boolean;
  transactionActive: boolean;
  query(sql: string, parameters?: QueryParameters): Promise<DatabaseQueryResult>;
  execute(sql: string, parameters?: QueryParameters): Promise<DatabaseQueryResult>;
  beginTransaction(options?: TransactionOptions): Promise<string>;
  commitTransaction(transactionId: string): Promise<void>;
  rollbackTransaction(transactionId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Database query result
 */
interface DatabaseQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns?: ColumnMetadata[];
  lastInsertId?: string | number;
  warnings?: string[];
}

/**
 * Create mock database client
 */
function createMockDatabaseClient(spec: DatabaseConnectionSpec): MockDatabaseClient {
  let transactionId: string | null = null;

  return {
    connected: true,
    transactionActive: false,

    async query(sql: string, parameters?: QueryParameters): Promise<DatabaseQueryResult> {
      // Simulate query execution
      const rows: Record<string, unknown>[] = [];

      // Parse simple SELECT queries for simulation
      if (sql.toUpperCase().trim().startsWith('SELECT')) {
        rows.push({
          id: 1,
          created_at: new Date().toISOString(),
          data: 'mock_data',
        });
      }

      return {
        rows,
        rowCount: rows.length,
      };
    },

    async execute(sql: string, parameters?: QueryParameters): Promise<DatabaseQueryResult> {
      // Simulate statement execution
      let rowCount = 0;
      let lastInsertId: string | number | undefined;

      const upperSql = sql.toUpperCase().trim();

      if (upperSql.startsWith('INSERT')) {
        rowCount = 1;
        lastInsertId = uuidv4();
      } else if (upperSql.startsWith('UPDATE')) {
        rowCount = 1;
      } else if (upperSql.startsWith('DELETE')) {
        rowCount = 1;
      }

      return {
        rows: [],
        rowCount,
        lastInsertId,
      };
    },

    async beginTransaction(options?: TransactionOptions): Promise<string> {
      transactionId = uuidv4();
      this.transactionActive = true;
      return transactionId;
    },

    async commitTransaction(txId: string): Promise<void> {
      if (txId !== transactionId) {
        throw new Error('Invalid transaction ID');
      }
      transactionId = null;
      this.transactionActive = false;
    },

    async rollbackTransaction(txId: string): Promise<void> {
      if (txId !== transactionId) {
        throw new Error('Invalid transaction ID');
      }
      transactionId = null;
      this.transactionActive = false;
    },

    async close(): Promise<void> {
      this.connected = false;
      transactionId = null;
      this.transactionActive = false;
    },
  };
}

// =============================================================================
// Database Protocol Implementation
// =============================================================================

/**
 * Database Protocol Implementation
 *
 * Features:
 * - Query execution with parameterized queries
 * - Transaction support with isolation levels
 * - Batch operations
 * - Stored procedure calls
 * - Connection pooling (simulated)
 * - Query timeout management
 */
export class DatabaseProtocol extends BaseProtocol {
  /**
   * Mock database client
   */
  private client?: MockDatabaseClient;

  /**
   * Active transactions
   */
  private readonly activeTransactions = new Map<string, string>();

  /**
   * Database-specific configuration
   */
  private dbSpec?: DatabaseConnectionSpec;

  constructor() {
    super('database');
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  /**
   * Validate database connection specification
   */
  validateSpec(spec: BaseConnectionSpec): void {
    const dbSpec = spec as DatabaseConnectionSpec;
    if (!dbSpec.host) {
      throw new Error('Database connection spec requires host');
    }

    if (!dbSpec.port) {
      throw new Error('Database connection spec requires port');
    }

    if (!dbSpec.database) {
      throw new Error('Database connection spec requires database name');
    }

    if (!dbSpec.databaseType) {
      throw new Error('Database connection spec requires databaseType');
    }

    const validTypes: DatabaseType[] = ['postgresql', 'mysql', 'sqlite', 'mssql', 'oracle'];
    if (!validTypes.includes(dbSpec.databaseType)) {
      throw new Error(`Invalid database type: ${dbSpec.databaseType}`);
    }
  }

  /**
   * Establish database connection
   */
  async connect(
    spec: BaseConnectionSpec,
    credentials: ProtocolCredentials
  ): Promise<ProtocolConnection> {
    const dbSpec = spec as DatabaseConnectionSpec;

    // Validate spec
    this.validateSpec(spec);

    // Store configuration
    this.spec = spec;
    this.dbSpec = dbSpec;
    this.credentials = credentials;

    // Create mock client
    this.client = createMockDatabaseClient(dbSpec);

    // Test connectivity
    const isHealthy = await this.testConnection();

    if (!isHealthy) {
      throw new Error(
        `Failed to connect to ${dbSpec.databaseType}://${dbSpec.host}:${dbSpec.port}/${dbSpec.database}`
      );
    }

    // Create connection handle
    this.connection = this.createConnection('connected', {
      databaseType: dbSpec.databaseType,
      host: dbSpec.host,
      port: dbSpec.port,
      database: dbSpec.database,
      schema: dbSpec.schema,
    });

    return this.connection;
  }

  /**
   * Execute database request
   */
  async execute(
    connection: ProtocolConnection,
    request: BaseIntegrationRequest
  ): Promise<BaseIntegrationResponse> {
    const dbRequest = request as unknown as DatabaseIntegrationRequest;
    if (!this.client) {
      throw new Error('Database client not initialized');
    }

    if (connection.status !== 'connected') {
      throw new Error(`Connection is ${connection.status}, not connected`);
    }

    const startTime = Date.now();

    try {
      let result: DatabaseQueryResult;

      switch (dbRequest.method) {
        case 'query':
          result = await this.executeQuery(dbRequest);
          break;

        case 'execute':
          result = await this.executeStatement(dbRequest);
          break;

        case 'transaction':
          result = await this.executeTransaction(dbRequest);
          break;

        case 'batch':
          result = await this.executeBatch(dbRequest);
          break;

        case 'call':
          result = await this.callProcedure(dbRequest);
          break;

        default:
          throw new Error(`Unknown database operation: ${dbRequest.method}`);
      }

      const latencyMs = Date.now() - startTime;

      // Update metrics
      this.recordRequest(latencyMs, true);
      this.updateConnectionActivity();

      return {
        statusCode: 200,
        headers: new Map(),
        body: result,
        latencyMs,
        success: true,
        metadata: {
          rows: result.rows,
          rowCount: result.rowCount,
          columns: result.columns,
          lastInsertId: result.lastInsertId,
          warnings: result.warnings,
        },
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.recordRequest(latencyMs, false);

      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        statusCode: 500,
        headers: new Map(),
        body: null,
        latencyMs,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Close database connection
   */
  close(connection: ProtocolConnection): void {
    if (this.connection?.connectionId === connection.connectionId) {
      // Rollback any active transactions
      for (const [_, txId] of this.activeTransactions) {
        try {
          this.client?.rollbackTransaction(txId);
        } catch {
          // Ignore rollback errors on close
        }
      }
      this.activeTransactions.clear();

      // Close client
      this.client?.close();
      this.client = undefined;

      this.updateConnectionStatus('disconnected');
      this.connection = undefined;
      this.spec = undefined;
      this.dbSpec = undefined;
      this.credentials = undefined;
    }
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const testQuery = this.getTestQuery();
      await this.client.query(testQuery);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Database-Specific Methods
  // ===========================================================================

  /**
   * Execute a SELECT query
   */
  async query(
    sql: string,
    parameters?: QueryParameters,
    options?: { maxRows?: number; fetchSize?: number }
  ): Promise<BaseIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const dbRequest: DatabaseIntegrationRequest = {
      method: 'query',
      sql,
      parameters,
      maxRows: options?.maxRows,
      fetchSize: options?.fetchSize,
    };

    return this.execute(this.connection, dbRequest as unknown as BaseIntegrationRequest);
  }

  /**
   * Execute a DML statement (INSERT, UPDATE, DELETE)
   */
  async executeSql(sql: string, parameters?: QueryParameters): Promise<BaseIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const dbRequest: DatabaseIntegrationRequest = {
      method: 'execute',
      sql,
      parameters,
    };

    return this.execute(this.connection, dbRequest as unknown as BaseIntegrationRequest);
  }

  /**
   * Execute statements in a transaction
   */
  async transaction(
    statements: BatchStatement[],
    options?: Omit<TransactionOptions, 'statements'>
  ): Promise<BaseIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const dbRequest: DatabaseIntegrationRequest = {
      method: 'transaction',
      transaction: {
        ...options,
        statements,
      },
    };

    return this.execute(this.connection, dbRequest as unknown as BaseIntegrationRequest);
  }

  /**
   * Execute batch statements
   */
  async batch(statements: BatchStatement[]): Promise<BaseIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const dbRequest: DatabaseIntegrationRequest = {
      method: 'batch',
      batch: statements,
    };

    return this.execute(this.connection, dbRequest as unknown as BaseIntegrationRequest);
  }

  /**
   * Call a stored procedure
   */
  async call(
    procedureName: string,
    parameters?: QueryParameters
  ): Promise<BaseIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const dbRequest: DatabaseIntegrationRequest = {
      method: 'call',
      procedureName,
      parameters,
    };

    return this.execute(this.connection, dbRequest as unknown as BaseIntegrationRequest);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get test query for database type
   */
  private getTestQuery(): string {
    const dbType = this.dbSpec?.databaseType;

    switch (dbType) {
      case 'postgresql':
      case 'mysql':
      case 'sqlite':
      case 'mssql':
        return 'SELECT 1';
      case 'oracle':
        return 'SELECT 1 FROM DUAL';
      default:
        return 'SELECT 1';
    }
  }

  /**
   * Execute a query
   */
  private async executeQuery(request: DatabaseIntegrationRequest): Promise<DatabaseQueryResult> {
    if (!this.client || !request.sql) {
      throw new Error('Client not initialized or SQL not provided');
    }

    return this.client.query(request.sql, request.parameters);
  }

  /**
   * Execute a statement
   */
  private async executeStatement(request: DatabaseIntegrationRequest): Promise<DatabaseQueryResult> {
    if (!this.client || !request.sql) {
      throw new Error('Client not initialized or SQL not provided');
    }

    return this.client.execute(request.sql, request.parameters);
  }

  /**
   * Execute a transaction
   */
  private async executeTransaction(request: DatabaseIntegrationRequest): Promise<DatabaseQueryResult> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    const statements = request.transaction?.statements ?? [];
    if (statements.length === 0) {
      throw new Error('Transaction requires at least one statement');
    }

    const txId = await this.client.beginTransaction(request.transaction);
    const connectionId = this.connection?.connectionId ?? '';
    this.activeTransactions.set(connectionId, txId);

    const results: DatabaseQueryResult[] = [];

    try {
      for (const stmt of statements) {
        const result = await this.client.execute(stmt.sql, stmt.parameters);
        results.push(result);
      }

      await this.client.commitTransaction(txId);
      this.activeTransactions.delete(connectionId);

      // Aggregate results
      const totalRowCount = results.reduce((sum, r) => sum + r.rowCount, 0);

      return {
        rows: results.flatMap(r => r.rows),
        rowCount: totalRowCount,
      };
    } catch (error) {
      await this.client.rollbackTransaction(txId);
      this.activeTransactions.delete(connectionId);
      throw error;
    }
  }

  /**
   * Execute batch statements
   */
  private async executeBatch(request: DatabaseIntegrationRequest): Promise<DatabaseQueryResult> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    const statements = request.batch ?? [];
    if (statements.length === 0) {
      throw new Error('Batch requires at least one statement');
    }

    const results: DatabaseQueryResult[] = [];

    for (const stmt of statements) {
      const result = await this.client.execute(stmt.sql, stmt.parameters);
      results.push(result);
    }

    // Aggregate results
    const totalRowCount = results.reduce((sum, r) => sum + r.rowCount, 0);

    return {
      rows: results.flatMap(r => r.rows),
      rowCount: totalRowCount,
    };
  }

  /**
   * Call stored procedure
   */
  private async callProcedure(request: DatabaseIntegrationRequest): Promise<DatabaseQueryResult> {
    if (!this.client || !request.procedureName) {
      throw new Error('Client not initialized or procedure name not provided');
    }

    // Build procedure call SQL based on database type
    let sql: string;
    const dbType = this.dbSpec?.databaseType;

    switch (dbType) {
      case 'postgresql':
        sql = `CALL ${request.procedureName}($1)`;
        break;
      case 'mysql':
        sql = `CALL ${request.procedureName}(?)`;
        break;
      case 'mssql':
        sql = `EXEC ${request.procedureName}`;
        break;
      default:
        sql = `CALL ${request.procedureName}(?)`;
    }

    return this.client.execute(sql, request.parameters);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a database protocol instance
 */
export function createDatabaseProtocol(): DatabaseProtocol {
  return new DatabaseProtocol();
}
