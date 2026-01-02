/**
 * HTTP/HTTPS Protocol Implementation
 *
 * Implements the HTTP/HTTPS protocol adapter for the External Integration Surface.
 * Supports REST APIs with full HTTP method support, headers, query parameters,
 * request body serialization, and response parsing.
 *
 * @module surfaces/protocols/http-protocol
 * @see SPARC_ARCHITECTURE.md MOD-011 - External Integration Surface
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  DurationMs,
  ISO8601Timestamp,
} from '../../types/common.js';

import {
  BaseProtocol,
  type ProtocolType,
  type ProtocolCredentials,
  type ProtocolConnection,
  type BaseConnectionSpec,
  type BaseIntegrationRequest,
  type BaseIntegrationResponse,
} from './base-protocol.js';

// =============================================================================
// HTTP Protocol Types
// =============================================================================

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * HTTP connection specification
 */
export interface HttpConnectionSpec extends BaseConnectionSpec {
  /**
   * Protocol type (http or https)
   */
  readonly protocol: 'http' | 'https';

  /**
   * Default headers for all requests
   */
  readonly defaultHeaders?: Record<string, string>;

  /**
   * Follow redirects (default: true)
   */
  readonly followRedirects?: boolean;

  /**
   * Maximum redirects to follow (default: 5)
   */
  readonly maxRedirects?: number;

  /**
   * HTTP version (1.1 or 2)
   */
  readonly httpVersion?: '1.1' | '2';

  /**
   * Compression settings
   */
  readonly compression?: {
    readonly enabled: boolean;
    readonly types?: string[]; // e.g., ['gzip', 'deflate', 'br']
  };

  /**
   * Keep-alive settings
   */
  readonly keepAlive?: {
    readonly enabled: boolean;
    readonly timeout?: DurationMs;
  };
}

/**
 * HTTP integration request
 */
export interface HttpIntegrationRequest extends BaseIntegrationRequest {
  /**
   * HTTP method
   */
  readonly method: HttpMethod;

  /**
   * Query parameters
   */
  readonly queryParams?: Record<string, string | number | boolean | string[]>;

  /**
   * Content type (default: application/json)
   */
  readonly contentType?: string;

  /**
   * Accept header (default: application/json)
   */
  readonly accept?: string;

  /**
   * Request body (JSON serializable)
   */
  readonly body?: unknown;

  /**
   * Form data (for multipart/form-data)
   */
  readonly formData?: Record<string, string | Blob>;

  /**
   * Follow redirects for this request
   */
  readonly followRedirects?: boolean;
}

/**
 * HTTP integration response
 */
export interface HttpIntegrationResponse extends BaseIntegrationResponse {
  /**
   * HTTP status code
   */
  readonly statusCode: number;

  /**
   * Status text
   */
  readonly statusText?: string;

  /**
   * Response URL (after redirects)
   */
  readonly url?: string;

  /**
   * Whether response was redirected
   */
  readonly redirected?: boolean;

  /**
   * Response timing information
   */
  readonly timing?: HttpTiming;
}

/**
 * HTTP timing information
 */
export interface HttpTiming {
  /**
   * DNS lookup time
   */
  readonly dnsLookupMs?: DurationMs;

  /**
   * TCP connection time
   */
  readonly tcpConnectMs?: DurationMs;

  /**
   * TLS handshake time
   */
  readonly tlsHandshakeMs?: DurationMs;

  /**
   * Time to first byte
   */
  readonly ttfbMs?: DurationMs;

  /**
   * Content download time
   */
  readonly downloadMs?: DurationMs;

  /**
   * Total time
   */
  readonly totalMs: DurationMs;
}

// =============================================================================
// HTTP Protocol Implementation
// =============================================================================

/**
 * HTTP/HTTPS Protocol Implementation
 *
 * Features:
 * - Full HTTP method support (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
 * - Automatic JSON serialization/deserialization
 * - Query parameter handling
 * - Header management including authentication
 * - Idempotency key support
 * - Redirect handling
 * - Compression support
 * - Detailed timing metrics
 */
export class HttpProtocol extends BaseProtocol<
  HttpConnectionSpec,
  HttpIntegrationRequest,
  HttpIntegrationResponse
> {
  /**
   * Default content type
   */
  private static readonly DEFAULT_CONTENT_TYPE = 'application/json';

  /**
   * Default accept header
   */
  private static readonly DEFAULT_ACCEPT = 'application/json';

  /**
   * Default idempotency key header
   */
  private static readonly IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

  constructor() {
    super('http');
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  /**
   * Validate HTTP connection specification
   */
  validateSpec(spec: HttpConnectionSpec): void {
    if (!spec.host) {
      throw new Error('HTTP connection spec requires host');
    }

    if (!spec.port) {
      throw new Error('HTTP connection spec requires port');
    }

    if (spec.protocol !== 'http' && spec.protocol !== 'https') {
      throw new Error(`Invalid protocol: ${spec.protocol}. Must be http or https`);
    }

    if (spec.port < 1 || spec.port > 65535) {
      throw new Error(`Invalid port: ${spec.port}. Must be between 1 and 65535`);
    }
  }

  /**
   * Establish HTTP connection
   *
   * For HTTP, this validates connectivity and stores configuration.
   */
  async connect(
    spec: HttpConnectionSpec,
    credentials: ProtocolCredentials
  ): Promise<ProtocolConnection> {
    // Validate spec
    this.validateSpec(spec);

    // Store configuration
    this.spec = spec;
    this.credentials = credentials;

    // Test connectivity
    const isHealthy = await this.testConnection();

    if (!isHealthy) {
      throw new Error(`Failed to connect to ${this.buildBaseUrl(spec)}`);
    }

    // Create connection handle
    this.connection = this.createConnection('connected', {
      baseUrl: this.buildBaseUrl(spec),
      protocol: spec.protocol,
    });

    return this.connection;
  }

  /**
   * Execute HTTP request
   */
  async execute(
    connection: ProtocolConnection,
    request: HttpIntegrationRequest
  ): Promise<HttpIntegrationResponse> {
    if (!this.spec) {
      throw new Error('Protocol not connected');
    }

    if (connection.status !== 'connected') {
      throw new Error(`Connection is ${connection.status}, not connected`);
    }

    const startTime = Date.now();
    const url = this.buildRequestUrl(request);
    const headers = this.buildRequestHeaders(request);
    const body = this.serializeBody(request);
    const idempotencyKey = request.idempotencyKey ?? this.generateIdempotencyKey();

    try {
      // Add idempotency key header
      headers[HttpProtocol.IDEMPOTENCY_HEADER] = idempotencyKey;

      // Build fetch options
      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
        body,
        redirect: (request.followRedirects ?? this.spec.followRedirects ?? true)
          ? 'follow'
          : 'manual',
      };

      // Execute request with timeout
      const response = await this.executeWithTimeout(
        fetch(url, fetchOptions),
        this.getTimeout(request.timeout, this.spec.requestTimeoutMs)
      );

      // Parse response
      const latencyMs = Date.now() - startTime;
      const httpResponse = await this.parseResponse(response, latencyMs);

      // Update metrics
      this.recordRequest(latencyMs, httpResponse.success);
      this.updateConnectionActivity();

      return httpResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.recordRequest(latencyMs, false);

      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        statusCode: 0,
        headers: new Map(),
        body: null,
        latencyMs,
        success: false,
        error: errorMessage,
        timing: {
          totalMs: latencyMs,
        },
      };
    }
  }

  /**
   * Close HTTP connection
   */
  close(connection: ProtocolConnection): void {
    if (this.connection?.connectionId === connection.connectionId) {
      this.updateConnectionStatus('disconnected');
      this.connection = undefined;
      this.spec = undefined;
      this.credentials = undefined;
    }
  }

  /**
   * Test HTTP connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.spec) {
      return false;
    }

    try {
      const testUrl = this.buildBaseUrl(this.spec);
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.getConnectionTimeout(this.spec.connectionTimeoutMs)
      );

      try {
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: controller.signal,
          headers: this.buildDefaultHeaders(),
        });

        // Consider connection successful if we get any response (even errors)
        return response.ok || response.status < 500;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // HTTP-Specific Methods
  // ===========================================================================

  /**
   * Perform a GET request
   */
  async get(
    path: string,
    options?: Partial<Omit<HttpIntegrationRequest, 'method'>>
  ): Promise<HttpIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return this.execute(this.connection, {
      method: 'GET',
      path,
      ...options,
    });
  }

  /**
   * Perform a POST request
   */
  async post(
    path: string,
    body?: unknown,
    options?: Partial<Omit<HttpIntegrationRequest, 'method' | 'body'>>
  ): Promise<HttpIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return this.execute(this.connection, {
      method: 'POST',
      path,
      body,
      ...options,
    });
  }

  /**
   * Perform a PUT request
   */
  async put(
    path: string,
    body?: unknown,
    options?: Partial<Omit<HttpIntegrationRequest, 'method' | 'body'>>
  ): Promise<HttpIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return this.execute(this.connection, {
      method: 'PUT',
      path,
      body,
      ...options,
    });
  }

  /**
   * Perform a PATCH request
   */
  async patch(
    path: string,
    body?: unknown,
    options?: Partial<Omit<HttpIntegrationRequest, 'method' | 'body'>>
  ): Promise<HttpIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return this.execute(this.connection, {
      method: 'PATCH',
      path,
      body,
      ...options,
    });
  }

  /**
   * Perform a DELETE request
   */
  async delete(
    path: string,
    options?: Partial<Omit<HttpIntegrationRequest, 'method'>>
  ): Promise<HttpIntegrationResponse> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return this.execute(this.connection, {
      method: 'DELETE',
      path,
      ...options,
    });
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Build base URL from connection spec
   */
  private buildBaseUrl(spec: HttpConnectionSpec): string {
    let url = `${spec.protocol}://${spec.host}`;

    // Add port if not default
    const isDefaultPort =
      (spec.protocol === 'http' && spec.port === 80) ||
      (spec.protocol === 'https' && spec.port === 443);

    if (!isDefaultPort) {
      url += `:${spec.port}`;
    }

    // Add path prefix
    if (spec.path) {
      const path = spec.path.startsWith('/') ? spec.path : `/${spec.path}`;
      url += path;
    }

    return url;
  }

  /**
   * Build full request URL
   */
  private buildRequestUrl(request: HttpIntegrationRequest): string {
    if (!this.spec) {
      throw new Error('Protocol not connected');
    }

    let url = this.buildBaseUrl(this.spec);

    // Add request path
    if (request.path) {
      const path = request.path.startsWith('/') ? request.path : `/${request.path}`;

      // Avoid double slashes
      if (url.endsWith('/') && path.startsWith('/')) {
        url = url.slice(0, -1);
      }

      url += path;
    }

    // Add query parameters
    if (request.queryParams && Object.keys(request.queryParams).length > 0) {
      const searchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(request.queryParams)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, String(item));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }

      const queryString = searchParams.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    return url;
  }

  /**
   * Build default headers
   */
  private buildDefaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': HttpProtocol.DEFAULT_ACCEPT,
      ...this.spec?.defaultHeaders,
    };

    // Add authentication header
    if (this.credentials) {
      const authHeader = this.buildAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
    }

    // Add compression header
    if (this.spec?.compression?.enabled) {
      const types = this.spec.compression.types ?? ['gzip', 'deflate'];
      headers['Accept-Encoding'] = types.join(', ');
    }

    return headers;
  }

  /**
   * Build request headers
   */
  private buildRequestHeaders(request: HttpIntegrationRequest): Record<string, string> {
    const headers = this.buildDefaultHeaders();

    // Add content type for methods that have body
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      headers['Content-Type'] = request.contentType ?? HttpProtocol.DEFAULT_CONTENT_TYPE;
    }

    // Override accept if specified
    if (request.accept) {
      headers['Accept'] = request.accept;
    }

    // Merge request-specific headers
    if (request.headers) {
      const reqHeaders = this.mapToRecord(request.headers);
      Object.assign(headers, reqHeaders);
    }

    return headers;
  }

  /**
   * Build authorization header
   */
  private buildAuthHeader(): string | undefined {
    if (!this.credentials) return undefined;

    switch (this.credentials.type) {
      case 'bearer':
        return `Bearer ${this.credentials.value}`;

      case 'api_key':
        return this.credentials.value;

      case 'basic': {
        const username = this.credentials.secondary ?? '';
        const password = this.credentials.value ?? '';
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${encoded}`;
      }

      case 'oauth2':
        return `Bearer ${this.credentials.value}`;

      case 'none':
        return undefined;

      default:
        return undefined;
    }
  }

  /**
   * Serialize request body
   */
  private serializeBody(request: HttpIntegrationRequest): string | undefined {
    // GET and HEAD requests shouldn't have a body
    if (request.method === 'GET' || request.method === 'HEAD') {
      return undefined;
    }

    if (request.body === undefined || request.body === null) {
      return undefined;
    }

    if (typeof request.body === 'string') {
      return request.body;
    }

    // Serialize as JSON
    return JSON.stringify(request.body);
  }

  /**
   * Parse HTTP response
   */
  private async parseResponse(
    response: Response,
    latencyMs: DurationMs
  ): Promise<HttpIntegrationResponse> {
    const rawBody = await response.text();

    // Try to parse as JSON
    let parsedBody: unknown = rawBody;
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json') && rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        // Keep raw body if JSON parsing fails
        parsedBody = rawBody;
      }
    }

    // Convert headers to Map
    const headers = new Map<string, string>();
    response.headers.forEach((value, key) => {
      headers.set(key.toLowerCase(), value);
    });

    const success = response.ok;

    return {
      statusCode: response.status,
      statusText: response.statusText,
      headers,
      body: parsedBody,
      latencyMs,
      success,
      url: response.url,
      redirected: response.redirected,
      error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      timing: {
        totalMs: latencyMs,
      },
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an HTTP protocol instance
 */
export function createHttpProtocol(): HttpProtocol {
  return new HttpProtocol();
}

/**
 * Create an HTTPS protocol instance (same as HTTP with protocol set)
 */
export function createHttpsProtocol(): HttpProtocol {
  return new HttpProtocol();
}
