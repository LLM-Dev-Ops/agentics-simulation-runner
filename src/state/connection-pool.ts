/**
 * MOD-014 State Repository - Connection Pool
 *
 * PostgreSQL connection pool for ruvvector-postgres state substrate.
 * Implements per-tenant connection pools with SERIALIZABLE isolation
 * for determinism guarantees.
 *
 * References:
 * - Section 4.2 of Refinement (per-tenant pools, SERIALIZABLE isolation)
 * - Section 7.1 of Refinement (tenant isolation)
 */

import { Pool, PoolConfig, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Connection pool configuration options.
 */
export interface ConnectionPoolConfig {
  /** PostgreSQL host */
  host: string;
  /** PostgreSQL port (default: 5432) */
  port: number;
  /** Database name */
  database: string;
  /** Database user */
  user: string;
  /** Database password */
  password: string;
  /** Use SSL connection */
  ssl?: boolean | { rejectUnauthorized: boolean };
  /** Minimum pool size per tenant (default: 5) */
  minPoolSize?: number;
  /** Maximum pool size per tenant (default: 20) */
  maxPoolSize?: number;
  /** Connection idle timeout in ms (default: 30000) */
  idleTimeoutMs?: number;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeoutMs?: number;
  /** Statement timeout in ms (default: 60000) */
  statementTimeoutMs?: number;
  /** Enable query logging (default: false) */
  enableQueryLogging?: boolean;
  /** Application name for connection identification */
  applicationName?: string;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Partial<ConnectionPoolConfig> = {
  port: 5432,
  minPoolSize: 5,
  maxPoolSize: 20,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 10000,
  statementTimeoutMs: 60000,
  enableQueryLogging: false,
  applicationName: 'agentics-simulation-runner',
};

/**
 * Query execution options.
 */
export interface QueryOptions {
  /** Query timeout in ms (overrides default) */
  timeout?: number;
  /** Whether to use SERIALIZABLE isolation (default: true) */
  serializable?: boolean;
}

/**
 * Transaction callback type.
 */
export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

/**
 * Query result with timing information.
 */
export interface TimedQueryResult<R extends QueryResultRow> extends QueryResult<R> {
  /** Query execution time in ms */
  durationMs: number;
}

/**
 * Pool statistics for monitoring.
 */
export interface PoolStats {
  tenantId: string;
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
}

/**
 * Connection pool manager for ruvvector-postgres.
 * Implements per-tenant connection pools with SERIALIZABLE isolation level.
 *
 * Key features:
 * - Per-tenant connection pool isolation (Section 4.2 of Refinement)
 * - SERIALIZABLE isolation for determinism (Section 4.2 of Refinement)
 * - Connection pooling with configurable limits
 * - Automatic retry for transient failures
 * - Query timing and logging
 */
export class ConnectionPool {
  private readonly config: ConnectionPoolConfig;
  private readonly tenantPools: Map<string, Pool> = new Map();
  private readonly globalPool: Pool;
  private isShutdown = false;

  constructor(config: Partial<ConnectionPoolConfig> & { host: string; database: string; user: string; password: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as ConnectionPoolConfig;
    this.globalPool = this.createPool('__global__');
  }

  /**
   * Creates a new connection pool for a tenant.
   */
  private createPool(tenantId: string): Pool {
    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl,
      min: this.config.minPoolSize,
      max: this.config.maxPoolSize,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      statement_timeout: this.config.statementTimeoutMs,
      application_name: `${this.config.applicationName}:${tenantId}`,
    };

    const pool = new Pool(poolConfig);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error(`[ConnectionPool] Unexpected error on pool for tenant ${tenantId}:`, err);
    });

    // Log connection events if enabled
    if (this.config.enableQueryLogging) {
      pool.on('connect', (client) => {
        console.debug(`[ConnectionPool] New connection established for tenant ${tenantId}`);
      });

      pool.on('acquire', () => {
        console.debug(`[ConnectionPool] Connection acquired for tenant ${tenantId}`);
      });

      pool.on('release', () => {
        console.debug(`[ConnectionPool] Connection released for tenant ${tenantId}`);
      });
    }

    return pool;
  }

  /**
   * Gets or creates a connection pool for a tenant.
   * Implements per-tenant pool isolation (Section 7.1 of Refinement).
   */
  public getPoolForTenant(tenantId: string): Pool {
    if (this.isShutdown) {
      throw new Error('Connection pool has been shut down');
    }

    let pool = this.tenantPools.get(tenantId);
    if (!pool) {
      pool = this.createPool(tenantId);
      this.tenantPools.set(tenantId, pool);
    }
    return pool;
  }

  /**
   * Gets the global pool for cross-tenant operations.
   */
  public getGlobalPool(): Pool {
    if (this.isShutdown) {
      throw new Error('Connection pool has been shut down');
    }
    return this.globalPool;
  }

  /**
   * Executes a query on the global pool.
   */
  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<TimedQueryResult<R>> {
    return this.queryOnPool(this.globalPool, text, params, options);
  }

  /**
   * Executes a query on a tenant-specific pool.
   */
  public async queryForTenant<R extends QueryResultRow = QueryResultRow>(
    tenantId: string,
    text: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<TimedQueryResult<R>> {
    const pool = this.getPoolForTenant(tenantId);
    return this.queryOnPool(pool, text, params, options);
  }

  /**
   * Executes a query on a specific pool.
   */
  private async queryOnPool<R extends QueryResultRow = QueryResultRow>(
    pool: Pool,
    text: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<TimedQueryResult<R>> {
    if (this.isShutdown) {
      throw new Error('Connection pool has been shut down');
    }

    const startTime = Date.now();
    const timeout = options?.timeout ?? this.config.statementTimeoutMs;

    try {
      const client = await pool.connect();
      try {
        // Set statement timeout for this query
        if (timeout) {
          await client.query(`SET statement_timeout = ${timeout}`);
        }

        if (this.config.enableQueryLogging) {
          console.debug(`[ConnectionPool] Executing query: ${text.substring(0, 100)}...`);
        }

        const result = await client.query<R>(text, params);
        const durationMs = Date.now() - startTime;

        if (this.config.enableQueryLogging) {
          console.debug(`[ConnectionPool] Query completed in ${durationMs}ms, rows: ${result.rowCount}`);
        }

        return { ...result, durationMs };
      } finally {
        client.release();
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[ConnectionPool] Query failed after ${durationMs}ms:`, error);
      throw error;
    }
  }

  /**
   * Executes a transaction with SERIALIZABLE isolation level.
   * Required for determinism guarantees (Section 4.2 of Refinement).
   */
  public async transaction<T>(
    callback: TransactionCallback<T>,
    tenantId?: string
  ): Promise<T> {
    if (this.isShutdown) {
      throw new Error('Connection pool has been shut down');
    }

    const pool = tenantId ? this.getPoolForTenant(tenantId) : this.globalPool;
    const client = await pool.connect();

    try {
      // Begin transaction with SERIALIZABLE isolation
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      try {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Executes a transaction with retry for serialization failures.
   * Handles PostgreSQL error 40001 (serialization_failure).
   */
  public async transactionWithRetry<T>(
    callback: TransactionCallback<T>,
    tenantId?: string,
    maxRetries = 3,
    baseDelayMs = 100
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.transaction(callback, tenantId);
      } catch (error) {
        const pgError = error as { code?: string };

        // Check for serialization failure (40001) or deadlock (40P01)
        if (pgError.code === '40001' || pgError.code === '40P01') {
          lastError = error as Error;

          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
            console.warn(`[ConnectionPool] Serialization failure, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw error;
      }
    }

    throw lastError ?? new Error('Transaction failed after retries');
  }

  /**
   * Acquires a client from the pool for manual transaction management.
   * The caller is responsible for releasing the client.
   */
  public async acquireClient(tenantId?: string): Promise<PoolClient> {
    if (this.isShutdown) {
      throw new Error('Connection pool has been shut down');
    }

    const pool = tenantId ? this.getPoolForTenant(tenantId) : this.globalPool;
    return pool.connect();
  }

  /**
   * Gets statistics for all pools.
   */
  public getStats(): PoolStats[] {
    const stats: PoolStats[] = [];

    // Global pool stats
    stats.push({
      tenantId: '__global__',
      totalConnections: this.globalPool.totalCount,
      idleConnections: this.globalPool.idleCount,
      waitingRequests: this.globalPool.waitingCount,
    });

    // Per-tenant pool stats
    for (const [tenantId, pool] of this.tenantPools) {
      stats.push({
        tenantId,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      });
    }

    return stats;
  }

  /**
   * Tests the connection to the database.
   */
  public async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as connected');
      return result.rows.length > 0 && (result.rows[0] as { connected: number }).connected === 1;
    } catch (error) {
      console.error('[ConnectionPool] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Shuts down all connection pools gracefully.
   */
  public async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return;
    }

    this.isShutdown = true;
    console.info('[ConnectionPool] Shutting down connection pools...');

    const shutdownPromises: Promise<void>[] = [];

    // Shut down tenant pools
    for (const [tenantId, pool] of this.tenantPools) {
      console.debug(`[ConnectionPool] Closing pool for tenant ${tenantId}`);
      shutdownPromises.push(pool.end());
    }

    // Shut down global pool
    console.debug('[ConnectionPool] Closing global pool');
    shutdownPromises.push(this.globalPool.end());

    await Promise.all(shutdownPromises);
    this.tenantPools.clear();

    console.info('[ConnectionPool] All connection pools closed');
  }

  /**
   * Removes a tenant's connection pool.
   */
  public async removeTenantPool(tenantId: string): Promise<void> {
    const pool = this.tenantPools.get(tenantId);
    if (pool) {
      console.debug(`[ConnectionPool] Removing pool for tenant ${tenantId}`);
      await pool.end();
      this.tenantPools.delete(tenantId);
    }
  }

  /**
   * Creates a connection string from config.
   */
  public getConnectionString(): string {
    const { host, port, database, user } = this.config;
    return `postgresql://${user}@${host}:${port}/${database}`;
  }
}

/**
 * Creates a connection pool from environment variables.
 */
export function createConnectionPoolFromEnv(): ConnectionPool {
  const config: ConnectionPoolConfig = {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: process.env.POSTGRES_DATABASE ?? 'agentics_simulation',
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? '',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    minPoolSize: parseInt(process.env.POSTGRES_POOL_MIN ?? '5', 10),
    maxPoolSize: parseInt(process.env.POSTGRES_POOL_MAX ?? '20', 10),
    idleTimeoutMs: parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS ?? '30000', 10),
    connectionTimeoutMs: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS ?? '10000', 10),
    statementTimeoutMs: parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT_MS ?? '60000', 10),
    enableQueryLogging: process.env.POSTGRES_QUERY_LOGGING === 'true',
    applicationName: process.env.POSTGRES_APP_NAME ?? 'agentics-simulation-runner',
  };

  return new ConnectionPool(config);
}

/**
 * Singleton instance for shared connection pool.
 */
let sharedConnectionPool: ConnectionPool | null = null;

/**
 * Gets or creates the shared connection pool.
 */
export function getSharedConnectionPool(): ConnectionPool {
  if (!sharedConnectionPool) {
    sharedConnectionPool = createConnectionPoolFromEnv();
  }
  return sharedConnectionPool;
}

/**
 * Shuts down the shared connection pool.
 */
export async function shutdownSharedConnectionPool(): Promise<void> {
  if (sharedConnectionPool) {
    await sharedConnectionPool.shutdown();
    sharedConnectionPool = null;
  }
}
