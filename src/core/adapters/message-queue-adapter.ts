/**
 * Message Queue Integration Adapter
 *
 * Implements the integration adapter for message queue systems.
 * Supports RabbitMQ, Kafka, AWS SQS, and other message brokers
 * with publish/subscribe operations.
 *
 * @module core/adapters/message-queue-adapter
 * @see SPARC_ARCHITECTURE.md MOD-008 - Integration Adapter Manager
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  UUID,
  DurationMs,
  ISO8601Timestamp,
  IntegrationId,
} from '../../types/common.js';

import type { IntegrationCallMetrics } from '../integration-call-result.js';

import {
  BaseAdapter,
  type AdapterConnection,
  type AdapterRequest,
  type AdapterResponse,
  type BaseConnectionConfig,
  type ResolvedCredentials,
  type ConnectionStatus,
} from './base-adapter.js';

// =============================================================================
// Message Queue Adapter Types
// =============================================================================

/**
 * Supported message queue types
 */
export type MessageQueueType = 'rabbitmq' | 'kafka' | 'sqs' | 'pubsub' | 'redis' | 'nats';

/**
 * Message queue-specific connection configuration
 */
export interface MessageQueueConnectionConfig extends BaseConnectionConfig {
  /**
   * Message queue type
   */
  readonly queueType: MessageQueueType;

  /**
   * Broker host(s)
   */
  readonly hosts: string[];

  /**
   * Broker port
   */
  readonly port?: number;

  /**
   * Virtual host (for RabbitMQ)
   */
  readonly virtualHost?: string;

  /**
   * Default topic/queue name
   */
  readonly defaultQueue?: string;

  /**
   * Consumer group (for Kafka)
   */
  readonly consumerGroup?: string;

  /**
   * Client ID
   */
  readonly clientId?: string;

  /**
   * SSL/TLS configuration
   */
  readonly ssl?: {
    readonly enabled: boolean;
    readonly rejectUnauthorized?: boolean;
    readonly ca?: string;
    readonly cert?: string;
    readonly key?: string;
  };

  /**
   * Message serialization format
   */
  readonly serialization?: 'json' | 'avro' | 'protobuf' | 'msgpack' | 'raw';

  /**
   * Schema registry URL (for Avro/Protobuf)
   */
  readonly schemaRegistryUrl?: string;

  /**
   * Consumer settings
   */
  readonly consumer?: {
    readonly prefetchCount?: number;
    readonly maxInFlight?: number;
    readonly ackMode?: 'auto' | 'manual';
  };

  /**
   * Producer settings
   */
  readonly producer?: {
    readonly batchSize?: number;
    readonly lingerMs?: DurationMs;
    readonly compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
    readonly acks?: 'none' | 'leader' | 'all';
    readonly retries?: number;
  };

  /**
   * Heartbeat interval
   */
  readonly heartbeatMs?: DurationMs;
}

/**
 * Message queue operation types
 */
export type MessageQueueOperation =
  | 'publish'
  | 'subscribe'
  | 'consume'
  | 'ack'
  | 'nack'
  | 'seek'
  | 'create_queue'
  | 'delete_queue'
  | 'bind'
  | 'unbind';

/**
 * Message headers
 */
export interface MessageHeaders {
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Message to publish
 */
export interface PublishMessage {
  /**
   * Target queue/topic/exchange
   */
  readonly destination: string;

  /**
   * Routing key (for RabbitMQ exchanges)
   */
  readonly routingKey?: string;

  /**
   * Message body
   */
  readonly body: unknown;

  /**
   * Message headers
   */
  readonly headers?: MessageHeaders;

  /**
   * Message properties
   */
  readonly properties?: MessageProperties;

  /**
   * Partition key (for Kafka)
   */
  readonly partitionKey?: string;

  /**
   * Explicit partition (for Kafka)
   */
  readonly partition?: number;
}

/**
 * Message properties
 */
export interface MessageProperties {
  /**
   * Message ID
   */
  readonly messageId?: string;

  /**
   * Correlation ID for request/response patterns
   */
  readonly correlationId?: string;

  /**
   * Reply-to destination
   */
  readonly replyTo?: string;

  /**
   * Content type
   */
  readonly contentType?: string;

  /**
   * Content encoding
   */
  readonly contentEncoding?: string;

  /**
   * Message expiration in milliseconds
   */
  readonly expiration?: DurationMs;

  /**
   * Message timestamp
   */
  readonly timestamp?: ISO8601Timestamp;

  /**
   * Message priority (0-9)
   */
  readonly priority?: number;

  /**
   * Delivery mode (1 = non-persistent, 2 = persistent)
   */
  readonly deliveryMode?: 1 | 2;

  /**
   * Application-specific type
   */
  readonly type?: string;

  /**
   * User ID
   */
  readonly userId?: string;

  /**
   * Application ID
   */
  readonly appId?: string;
}

/**
 * Consumed message
 */
export interface ConsumedMessage {
  /**
   * Message ID
   */
  readonly messageId: string;

  /**
   * Source queue/topic
   */
  readonly source: string;

  /**
   * Message body (parsed)
   */
  readonly body: unknown;

  /**
   * Raw message body
   */
  readonly rawBody: Buffer | string;

  /**
   * Message headers
   */
  readonly headers: MessageHeaders;

  /**
   * Message properties
   */
  readonly properties: MessageProperties;

  /**
   * Delivery tag (for acknowledgment)
   */
  readonly deliveryTag: string;

  /**
   * Partition (for Kafka)
   */
  readonly partition?: number;

  /**
   * Offset (for Kafka)
   */
  readonly offset?: number;

  /**
   * Consumer timestamp
   */
  readonly consumedAt: ISO8601Timestamp;

  /**
   * Whether this is a redelivery
   */
  readonly redelivered?: boolean;
}

/**
 * Publish result
 */
export interface PublishResult {
  /**
   * Whether the publish was successful
   */
  readonly success: boolean;

  /**
   * Generated message ID
   */
  readonly messageId: string;

  /**
   * Destination the message was published to
   */
  readonly destination: string;

  /**
   * Partition the message was written to (for Kafka)
   */
  readonly partition?: number;

  /**
   * Offset of the message (for Kafka)
   */
  readonly offset?: number;

  /**
   * Confirmation timestamp
   */
  readonly confirmedAt?: ISO8601Timestamp;
}

/**
 * Subscribe options
 */
export interface SubscribeOptions {
  /**
   * Queue/topic to subscribe to
   */
  readonly source: string;

  /**
   * Consumer tag
   */
  readonly consumerTag?: string;

  /**
   * Whether to auto-acknowledge messages
   */
  readonly autoAck?: boolean;

  /**
   * Whether to receive exclusive access
   */
  readonly exclusive?: boolean;

  /**
   * Message handler callback
   */
  readonly handler: (message: ConsumedMessage) => Promise<void>;

  /**
   * Error handler callback
   */
  readonly onError?: (error: Error) => void;
}

/**
 * Subscription handle
 */
export interface Subscription {
  /**
   * Subscription ID
   */
  readonly subscriptionId: UUID;

  /**
   * Consumer tag
   */
  readonly consumerTag: string;

  /**
   * Source queue/topic
   */
  readonly source: string;

  /**
   * Cancel the subscription
   */
  cancel(): Promise<void>;

  /**
   * Pause message delivery
   */
  pause(): Promise<void>;

  /**
   * Resume message delivery
   */
  resume(): Promise<void>;
}

// =============================================================================
// Mock Message Queue Client (for simulation)
// =============================================================================

/**
 * Mock message queue client for simulation purposes
 *
 * In production, this would be replaced with actual queue client libraries
 * (amqplib, kafkajs, @aws-sdk/client-sqs, etc.)
 */
interface MockQueueClient {
  connected: boolean;
  publish(message: PublishMessage): Promise<PublishResult>;
  subscribe(options: SubscribeOptions): Promise<Subscription>;
  acknowledge(deliveryTag: string): Promise<void>;
  negativeAcknowledge(deliveryTag: string, requeue: boolean): Promise<void>;
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  deleteQueue(name: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Create a mock queue client for simulation
 */
function createMockQueueClient(config: MessageQueueConnectionConfig): MockQueueClient {
  const subscriptions = new Map<UUID, Subscription>();
  let messageCounter = 0;

  return {
    connected: true,

    async publish(message: PublishMessage): Promise<PublishResult> {
      const messageId = uuidv4();
      messageCounter++;

      return {
        success: true,
        messageId,
        destination: message.destination,
        partition: message.partition ?? 0,
        offset: messageCounter,
        confirmedAt: new Date().toISOString() as ISO8601Timestamp,
      };
    },

    async subscribe(options: SubscribeOptions): Promise<Subscription> {
      const subscriptionId = uuidv4() as UUID;
      const consumerTag = options.consumerTag ?? `consumer-${subscriptionId}`;
      let paused = false;

      const subscription: Subscription = {
        subscriptionId,
        consumerTag,
        source: options.source,

        async cancel(): Promise<void> {
          subscriptions.delete(subscriptionId);
        },

        async pause(): Promise<void> {
          paused = true;
        },

        async resume(): Promise<void> {
          paused = false;
        },
      };

      subscriptions.set(subscriptionId, subscription);
      return subscription;
    },

    async acknowledge(deliveryTag: string): Promise<void> {
      // Simulate acknowledgment
    },

    async negativeAcknowledge(deliveryTag: string, requeue: boolean): Promise<void> {
      // Simulate negative acknowledgment
    },

    async createQueue(name: string, options?: Record<string, unknown>): Promise<void> {
      // Simulate queue creation
    },

    async deleteQueue(name: string): Promise<void> {
      // Simulate queue deletion
    },

    async close(): Promise<void> {
      this.connected = false;
      // Cancel all subscriptions
      for (const [id, sub] of subscriptions) {
        await sub.cancel();
      }
      subscriptions.clear();
    },
  };
}

// =============================================================================
// Message Queue Adapter Implementation
// =============================================================================

/**
 * Message Queue Integration Adapter
 *
 * Features:
 * - Publish messages to queues/topics
 * - Subscribe to queues/topics with handlers
 * - Manual and automatic acknowledgment
 * - Message properties and headers
 * - Dead letter queue support
 * - Consumer groups (Kafka)
 * - Queue/exchange management
 * - Retry with exponential backoff
 */
export class MessageQueueAdapter extends BaseAdapter {
  private readonly mqConfig: MessageQueueConnectionConfig;
  private client?: MockQueueClient;
  private activeSubscriptions: Map<UUID, Subscription> = new Map();

  constructor(integrationId: IntegrationId, config: MessageQueueConnectionConfig) {
    super('MESSAGE_QUEUE', integrationId, config);
    this.mqConfig = config;
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  /**
   * Test connection to the message queue broker
   */
  async testConnection(): Promise<boolean> {
    try {
      if (!this.client?.connected) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Establish connection to the message queue broker
   */
  async connect(credentials: ResolvedCredentials): Promise<AdapterConnection> {
    this._credentials = credentials;

    // Create queue client
    // In production, this would use the actual queue client library
    this.client = createMockQueueClient(this.mqConfig);

    // Test the connection
    const isHealthy = await this.testConnection();
    if (!isHealthy) {
      throw new Error(
        `Failed to connect to ${this.mqConfig.queueType} broker: ${this.mqConfig.hosts.join(',')}`
      );
    }

    // Create connection object
    this.connection = this.createConnection('CONNECTED', {
      queueType: this.mqConfig.queueType,
      hosts: this.mqConfig.hosts,
      consumerGroup: this.mqConfig.consumerGroup,
    });

    return this.connection;
  }

  /**
   * Execute a message queue request
   */
  protected async executeRequest(request: AdapterRequest): Promise<AdapterResponse> {
    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    const operation = this.parseOperation(request.operation);

    switch (operation) {
      case 'publish':
        return this.handlePublish(request);

      case 'consume':
        return this.handleConsume(request);

      case 'ack':
        return this.handleAcknowledge(request);

      case 'nack':
        return this.handleNegativeAcknowledge(request);

      case 'create_queue':
        return this.handleCreateQueue(request);

      case 'delete_queue':
        return this.handleDeleteQueue(request);

      default:
        throw new Error(`Unknown message queue operation: ${operation}`);
    }
  }

  /**
   * Close the message queue connection
   */
  async close(): Promise<void> {
    // Cancel all active subscriptions
    for (const [id, sub] of this.activeSubscriptions) {
      try {
        await sub.cancel();
      } catch {
        // Ignore cancellation errors on close
      }
    }
    this.activeSubscriptions.clear();

    // Close the client connection
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }

    if (this.connection) {
      this.connection.status = 'DISCONNECTED';
      this.connection = undefined;
    }

    this._credentials = undefined;
  }

  // ===========================================================================
  // Message Queue-Specific Methods
  // ===========================================================================

  /**
   * Publish a message to a queue/topic
   */
  async publish(message: PublishMessage): Promise<PublishResult> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    return this.client.publish(message);
  }

  /**
   * Publish multiple messages in a batch
   */
  async publishBatch(messages: PublishMessage[]): Promise<PublishResult[]> {
    this.validateConnection();

    const results: PublishResult[] = [];
    for (const message of messages) {
      const result = await this.publish(message);
      results.push(result);
    }

    return results;
  }

  /**
   * Subscribe to a queue/topic
   */
  async subscribe(options: SubscribeOptions): Promise<Subscription> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    const subscription = await this.client.subscribe(options);
    this.activeSubscriptions.set(subscription.subscriptionId, subscription);

    return subscription;
  }

  /**
   * Acknowledge a message
   */
  async acknowledge(deliveryTag: string): Promise<void> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    await this.client.acknowledge(deliveryTag);
  }

  /**
   * Negative acknowledge a message
   */
  async negativeAcknowledge(deliveryTag: string, requeue = true): Promise<void> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    await this.client.negativeAcknowledge(deliveryTag, requeue);
  }

  /**
   * Create a queue
   */
  async createQueue(name: string, options?: Record<string, unknown>): Promise<void> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    await this.client.createQueue(name, options);
  }

  /**
   * Delete a queue
   */
  async deleteQueue(name: string): Promise<void> {
    this.validateConnection();

    if (!this.client) {
      throw new Error('Message queue client not initialized');
    }

    await this.client.deleteQueue(name);
  }

  /**
   * Get active subscriptions
   */
  getActiveSubscriptions(): Subscription[] {
    return Array.from(this.activeSubscriptions.values());
  }

  // ===========================================================================
  // Request Handlers
  // ===========================================================================

  /**
   * Handle publish operation
   */
  private async handlePublish(request: AdapterRequest): Promise<AdapterResponse> {
    const message = request.body as PublishMessage;

    if (!message || !message.destination) {
      throw new Error('Publish request requires a message with destination');
    }

    const result = await this.publish(message);

    return {
      status: result.success ? 200 : 500,
      body: result,
    };
  }

  /**
   * Handle consume operation (returns next available message)
   */
  private async handleConsume(request: AdapterRequest): Promise<AdapterResponse> {
    const source = request.path ?? this.mqConfig.defaultQueue;

    if (!source) {
      throw new Error('Consume request requires a source queue/topic');
    }

    // For simulation, return a mock consumed message
    const message: ConsumedMessage = {
      messageId: uuidv4(),
      source,
      body: request.body ?? null,
      rawBody: JSON.stringify(request.body ?? null),
      headers: {},
      properties: {},
      deliveryTag: uuidv4(),
      consumedAt: new Date().toISOString() as ISO8601Timestamp,
    };

    return {
      status: 200,
      body: message,
    };
  }

  /**
   * Handle acknowledge operation
   */
  private async handleAcknowledge(request: AdapterRequest): Promise<AdapterResponse> {
    const deliveryTag = request.parameters?.deliveryTag as string;

    if (!deliveryTag) {
      throw new Error('Acknowledge request requires a delivery tag');
    }

    await this.acknowledge(deliveryTag);

    return {
      status: 200,
      body: { acknowledged: true, deliveryTag },
    };
  }

  /**
   * Handle negative acknowledge operation
   */
  private async handleNegativeAcknowledge(request: AdapterRequest): Promise<AdapterResponse> {
    const deliveryTag = request.parameters?.deliveryTag as string;
    const requeue = request.parameters?.requeue !== false;

    if (!deliveryTag) {
      throw new Error('Negative acknowledge request requires a delivery tag');
    }

    await this.negativeAcknowledge(deliveryTag, requeue);

    return {
      status: 200,
      body: { rejected: true, deliveryTag, requeued: requeue },
    };
  }

  /**
   * Handle create queue operation
   */
  private async handleCreateQueue(request: AdapterRequest): Promise<AdapterResponse> {
    const name = request.path;
    const options = request.parameters as Record<string, unknown>;

    if (!name) {
      throw new Error('Create queue request requires a queue name');
    }

    await this.createQueue(name, options);

    return {
      status: 201,
      body: { created: true, queue: name },
    };
  }

  /**
   * Handle delete queue operation
   */
  private async handleDeleteQueue(request: AdapterRequest): Promise<AdapterResponse> {
    const name = request.path;

    if (!name) {
      throw new Error('Delete queue request requires a queue name');
    }

    await this.deleteQueue(name);

    return {
      status: 200,
      body: { deleted: true, queue: name },
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Parse operation string to message queue operation type
   */
  private parseOperation(operation: string): MessageQueueOperation {
    const op = operation.toLowerCase();

    switch (op) {
      case 'publish':
      case 'send':
      case 'produce':
        return 'publish';

      case 'subscribe':
        return 'subscribe';

      case 'consume':
      case 'receive':
      case 'get':
        return 'consume';

      case 'ack':
      case 'acknowledge':
        return 'ack';

      case 'nack':
      case 'reject':
        return 'nack';

      case 'seek':
        return 'seek';

      case 'create':
      case 'create_queue':
      case 'declare':
        return 'create_queue';

      case 'delete':
      case 'delete_queue':
        return 'delete_queue';

      case 'bind':
        return 'bind';

      case 'unbind':
        return 'unbind';

      default:
        return 'publish';
    }
  }

  // ===========================================================================
  // Metrics Override
  // ===========================================================================

  /**
   * Build message queue-specific metrics
   */
  protected override buildMetrics(
    startTime: number,
    response?: AdapterResponse
  ): IntegrationCallMetrics {
    const baseMetrics = super.buildMetrics(startTime, response);

    return {
      ...baseMetrics,
      // Add message queue-specific metrics
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a message queue adapter instance
 */
export function createMessageQueueAdapter(
  integrationId: IntegrationId,
  config: MessageQueueConnectionConfig
): MessageQueueAdapter {
  return new MessageQueueAdapter(integrationId, config);
}
