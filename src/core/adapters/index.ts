/**
 * Integration Adapters Module
 *
 * Exports all adapter types and provides the AdapterFactory for creating
 * adapter instances based on integration type.
 *
 * @module core/adapters
 * @see SPARC_ARCHITECTURE.md MOD-008 - Integration Adapter Manager
 */

import type { IntegrationId } from '../../types/common.js';

// =============================================================================
// Re-export Base Adapter Types
// =============================================================================

export {
  // Types
  type AdapterType,
  type ConnectionStatus,
  type AdapterCredentials,
  type ResolvedCredentials,
  type BaseConnectionConfig,
  type AdapterConnection,
  type AdapterRequest,
  type AdapterResponse,
  type AdapterFactory as AdapterFactoryFn,
  // Base class
  BaseAdapter,
} from './base-adapter.js';

// =============================================================================
// Re-export HTTP Adapter
// =============================================================================

export {
  // Types
  type HttpMethod,
  type HttpConnectionConfig,
  type HttpRequestOptions,
  type HttpResponse,
  type HttpTiming,
  // Class and factory
  HttpAdapter,
  createHttpAdapter,
} from './http-adapter.js';

// =============================================================================
// Re-export Database Adapter
// =============================================================================

export {
  // Types
  type DatabaseType,
  type DatabaseConnectionConfig,
  type DatabaseOperation,
  type QueryParameters,
  type DatabaseQueryRequest,
  type TransactionOptions,
  type DatabaseQueryResult,
  type ColumnMetadata,
  type DatabaseTransaction,
  // Class and factory
  DatabaseAdapter,
  createDatabaseAdapter,
} from './database-adapter.js';

// =============================================================================
// Re-export Message Queue Adapter
// =============================================================================

export {
  // Types
  type MessageQueueType,
  type MessageQueueConnectionConfig,
  type MessageQueueOperation,
  type MessageHeaders,
  type PublishMessage,
  type MessageProperties,
  type ConsumedMessage,
  type PublishResult,
  type SubscribeOptions,
  type Subscription,
  // Class and factory
  MessageQueueAdapter,
  createMessageQueueAdapter,
} from './message-queue-adapter.js';

// =============================================================================
// Adapter Factory
// =============================================================================

import type { AdapterType, BaseConnectionConfig } from './base-adapter.js';
import { BaseAdapter } from './base-adapter.js';
import { HttpAdapter, type HttpConnectionConfig } from './http-adapter.js';
import { DatabaseAdapter, type DatabaseConnectionConfig } from './database-adapter.js';
import { MessageQueueAdapter, type MessageQueueConnectionConfig } from './message-queue-adapter.js';

/**
 * Union type for all adapter configuration types
 */
export type AdapterConfig =
  | HttpConnectionConfig
  | DatabaseConnectionConfig
  | MessageQueueConnectionConfig
  | BaseConnectionConfig;

/**
 * Adapter creation options
 */
export interface AdapterCreationOptions {
  /**
   * Adapter type
   */
  readonly type: AdapterType;

  /**
   * Integration ID
   */
  readonly integrationId: IntegrationId;

  /**
   * Adapter-specific configuration
   */
  readonly config: AdapterConfig;
}

/**
 * Adapter Factory
 *
 * Factory class for creating integration adapters based on type.
 * Supports all adapter types defined in the SPARC Architecture:
 * - HTTP/REST
 * - GraphQL (via HTTP adapter)
 * - gRPC (placeholder)
 * - Database
 * - Message Queue
 * - File System (placeholder)
 * - Agentics Ecosystem (placeholder)
 * - Custom (placeholder)
 */
export class AdapterFactory {
  private static instance: AdapterFactory;

  private constructor() {}

  /**
   * Get the singleton factory instance
   */
  static getInstance(): AdapterFactory {
    if (!AdapterFactory.instance) {
      AdapterFactory.instance = new AdapterFactory();
    }
    return AdapterFactory.instance;
  }

  /**
   * Create an adapter based on type
   *
   * @param type - The adapter type
   * @param integrationId - Unique integration identifier
   * @param config - Adapter-specific configuration
   * @returns The created adapter instance
   * @throws Error if adapter type is not supported
   */
  create(
    type: AdapterType,
    integrationId: IntegrationId,
    config: AdapterConfig
  ): BaseAdapter {
    switch (type) {
      case 'HTTP_REST':
        return new HttpAdapter(
          integrationId,
          config as HttpConnectionConfig
        );

      case 'GRAPHQL':
        // GraphQL uses HTTP adapter with different content handling
        return new HttpAdapter(
          integrationId,
          {
            ...config,
            defaultHeaders: {
              ...((config as HttpConnectionConfig).defaultHeaders ?? {}),
              'Content-Type': 'application/json',
            },
          } as HttpConnectionConfig
        );

      case 'DATABASE':
        return new DatabaseAdapter(
          integrationId,
          config as DatabaseConnectionConfig
        );

      case 'MESSAGE_QUEUE':
        return new MessageQueueAdapter(
          integrationId,
          config as MessageQueueConnectionConfig
        );

      case 'GRPC':
        // gRPC adapter - placeholder for now
        throw new Error('gRPC adapter not yet implemented');

      case 'FILE_SYSTEM':
        // File system adapter - placeholder for now
        throw new Error('File system adapter not yet implemented');

      case 'AGENTICS_ECOSYSTEM':
        // Agentics ecosystem adapter - delegates to MOD-012
        throw new Error('Agentics ecosystem adapter not yet implemented');

      case 'CUSTOM':
        throw new Error('Custom adapters must be registered explicitly');

      default:
        throw new Error(`Unknown adapter type: ${type}`);
    }
  }

  /**
   * Create an adapter from options object
   */
  createFromOptions(options: AdapterCreationOptions): BaseAdapter {
    return this.create(options.type, options.integrationId, options.config);
  }

  /**
   * Check if an adapter type is supported
   */
  isSupported(type: AdapterType): boolean {
    const supported: AdapterType[] = [
      'HTTP_REST',
      'GRAPHQL',
      'DATABASE',
      'MESSAGE_QUEUE',
    ];
    return supported.includes(type);
  }

  /**
   * Get list of supported adapter types
   */
  getSupportedTypes(): AdapterType[] {
    return [
      'HTTP_REST',
      'GRAPHQL',
      'DATABASE',
      'MESSAGE_QUEUE',
    ];
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create an adapter using the factory
 */
export function createAdapter(
  type: AdapterType,
  integrationId: IntegrationId,
  config: AdapterConfig
): BaseAdapter {
  return AdapterFactory.getInstance().create(type, integrationId, config);
}

/**
 * Check if an adapter type is supported
 */
export function isAdapterSupported(type: AdapterType): boolean {
  return AdapterFactory.getInstance().isSupported(type);
}

/**
 * Get supported adapter types
 */
export function getSupportedAdapterTypes(): AdapterType[] {
  return AdapterFactory.getInstance().getSupportedTypes();
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for HTTP connection config
 */
export function isHttpConfig(config: AdapterConfig): config is HttpConnectionConfig {
  return 'baseUrl' in config && typeof (config as HttpConnectionConfig).baseUrl === 'string';
}

/**
 * Type guard for Database connection config
 */
export function isDatabaseConfig(config: AdapterConfig): config is DatabaseConnectionConfig {
  return 'databaseType' in config && 'database' in config;
}

/**
 * Type guard for Message Queue connection config
 */
export function isMessageQueueConfig(config: AdapterConfig): config is MessageQueueConnectionConfig {
  return 'queueType' in config && 'hosts' in config;
}

/**
 * Infer adapter type from configuration
 */
export function inferAdapterType(config: AdapterConfig): AdapterType | null {
  if (isHttpConfig(config)) {
    return 'HTTP_REST';
  }
  if (isDatabaseConfig(config)) {
    return 'DATABASE';
  }
  if (isMessageQueueConfig(config)) {
    return 'MESSAGE_QUEUE';
  }
  return null;
}
