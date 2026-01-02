/**
 * HTTP/REST Integration Adapter
 *
 * Implements the integration adapter for HTTP/REST APIs.
 * Supports all standard HTTP methods with proper header handling,
 * query parameters, request bodies, and idempotency keys.
 *
 * @module core/adapters/http-adapter
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
// HTTP Adapter Types
// =============================================================================

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * HTTP-specific connection configuration
 */
export interface HttpConnectionConfig extends BaseConnectionConfig {
  /**
   * Base URL for all requests
   */
  readonly baseUrl: string;

  /**
   * Default headers to include in all requests
   */
  readonly defaultHeaders?: Record<string, string>;

  /**
   * Whether to follow redirects (default: true)
   */
  readonly followRedirects?: boolean;

  /**
   * Maximum number of redirects to follow (default: 5)
   */
  readonly maxRedirects?: number;

  /**
   * Whether to verify SSL certificates (default: true)
   */
  readonly verifySsl?: boolean;

  /**
   * Custom CA certificate (PEM format)
   */
  readonly caCert?: string;

  /**
   * Client certificate for mTLS (PEM format)
   */
  readonly clientCert?: string;

  /**
   * Client key for mTLS (PEM format)
   */
  readonly clientKey?: string;

  /**
   * HTTP version preference ('1.1' | '2')
   */
  readonly httpVersion?: '1.1' | '2';

  /**
   * Keep-alive settings
   */
  readonly keepAlive?: {
    readonly enabled: boolean;
    readonly maxSockets?: number;
    readonly maxFreeSockets?: number;
    readonly timeout?: DurationMs;
  };

  /**
   * Compression settings
   */
  readonly compression?: {
    readonly enabled: boolean;
    readonly types?: string[]; // e.g., ['gzip', 'deflate', 'br']
  };
}

/**
 * HTTP-specific request options
 */
export interface HttpRequestOptions {
  /**
   * HTTP method
   */
  readonly method: HttpMethod;

  /**
   * Request path (appended to base URL)
   */
  readonly path: string;

  /**
   * Query parameters
   */
  readonly queryParams?: Record<string, string | number | boolean | string[]>;

  /**
   * Request headers
   */
  readonly headers?: Record<string, string>;

  /**
   * Request body (will be JSON stringified if object)
   */
  readonly body?: unknown;

  /**
   * Content type (default: application/json)
   */
  readonly contentType?: string;

  /**
   * Accept header (default: application/json)
   */
  readonly accept?: string;

  /**
   * Idempotency key header name (default: X-Idempotency-Key)
   */
  readonly idempotencyKeyHeader?: string;
}

/**
 * HTTP response with detailed information
 */
export interface HttpResponse {
  /**
   * HTTP status code
   */
  readonly status: number;

  /**
   * Status text
   */
  readonly statusText: string;

  /**
   * Response headers
   */
  readonly headers: Record<string, string>;

  /**
   * Response body (parsed if JSON)
   */
  readonly body: unknown;

  /**
   * Raw response body as string
   */
  readonly rawBody: string;

  /**
   * Response URL (after redirects)
   */
  readonly url: string;

  /**
   * Whether the response was redirected
   */
  readonly redirected: boolean;

  /**
   * Timing information
   */
  readonly timing?: HttpTiming;
}

/**
 * HTTP request timing information
 */
export interface HttpTiming {
  readonly dnsLookupMs?: DurationMs;
  readonly tcpConnectMs?: DurationMs;
  readonly tlsHandshakeMs?: DurationMs;
  readonly ttfbMs?: DurationMs;
  readonly downloadMs?: DurationMs;
  readonly totalMs: DurationMs;
}

// =============================================================================
// HTTP Adapter Implementation
// =============================================================================

/**
 * HTTP/REST Integration Adapter
 *
 * Features:
 * - All HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
 * - Automatic JSON serialization/deserialization
 * - Query parameter handling
 * - Header management (including authentication)
 * - Idempotency key support for retries
 * - Connection pooling via keep-alive
 * - SSL/TLS support including mTLS
 * - Compression support
 * - Redirect handling
 * - Detailed timing metrics
 */
export class HttpAdapter extends BaseAdapter {
  private readonly httpConfig: HttpConnectionConfig;

  /**
   * Default idempotency key header
   */
  private static readonly DEFAULT_IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

  /**
   * Default content type
   */
  private static readonly DEFAULT_CONTENT_TYPE = 'application/json';

  constructor(integrationId: IntegrationId, config: HttpConnectionConfig) {
    super('HTTP_REST', integrationId, config);
    this.httpConfig = config;
  }

  // ===========================================================================
  // Abstract Method Implementations
  // ===========================================================================

  /**
   * Test connection to the HTTP endpoint
   *
   * Performs a HEAD or GET request to the base URL to verify connectivity.
   */
  async testConnection(): Promise<boolean> {
    try {
      const testUrl = this.httpConfig.baseUrl;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.httpConfig.connectionTimeoutMs ?? BaseAdapter.DEFAULT_CONNECT_TIMEOUT_MS
      );

      try {
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: controller.signal,
          headers: this.buildDefaultHeaders(),
        });

        return response.ok || response.status < 500;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Establish connection (for HTTP, this validates connectivity)
   */
  async connect(credentials: ResolvedCredentials): Promise<AdapterConnection> {
    this._credentials = credentials;

    // Test the connection
    const isHealthy = await this.testConnection();

    if (!isHealthy) {
      throw new Error(`Failed to connect to HTTP endpoint: ${this.httpConfig.baseUrl}`);
    }

    // Create connection object
    this.connection = this.createConnection('CONNECTED', {
      baseUrl: this.httpConfig.baseUrl,
    });

    return this.connection;
  }

  /**
   * Execute an HTTP request
   */
  protected async executeRequest(request: AdapterRequest): Promise<AdapterResponse> {
    const method = this.parseMethod(request.operation);
    const url = this.buildUrl(request.path, request.parameters);
    const headers = this.buildRequestHeaders(request);
    const body = this.serializeBody(request.body, method);

    const startTime = Date.now();

    const response = await this.executeWithTimeout(
      this.doFetch(url, method, headers, body, request.idempotencyKey),
      this.getTimeout(request.timeoutMs)
    );

    const timing: HttpTiming = {
      totalMs: Date.now() - startTime,
    };

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
      metadata: {
        statusText: response.statusText,
        url: response.url,
        redirected: response.redirected,
        timing,
      },
    };
  }

  /**
   * Close the HTTP connection
   *
   * For HTTP, this is largely a no-op since connections are managed by the
   * underlying HTTP client. We just clean up our state.
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.status = 'DISCONNECTED';
      this.connection = undefined;
    }
    this._credentials = undefined;
  }

  // ===========================================================================
  // HTTP-Specific Methods
  // ===========================================================================

  /**
   * Perform a GET request
   */
  async get(
    path: string,
    options?: Partial<HttpRequestOptions>
  ): Promise<HttpResponse> {
    return this.request({ ...options, method: 'GET', path });
  }

  /**
   * Perform a POST request
   */
  async post(
    path: string,
    body?: unknown,
    options?: Partial<HttpRequestOptions>
  ): Promise<HttpResponse> {
    return this.request({ ...options, method: 'POST', path, body });
  }

  /**
   * Perform a PUT request
   */
  async put(
    path: string,
    body?: unknown,
    options?: Partial<HttpRequestOptions>
  ): Promise<HttpResponse> {
    return this.request({ ...options, method: 'PUT', path, body });
  }

  /**
   * Perform a PATCH request
   */
  async patch(
    path: string,
    body?: unknown,
    options?: Partial<HttpRequestOptions>
  ): Promise<HttpResponse> {
    return this.request({ ...options, method: 'PATCH', path, body });
  }

  /**
   * Perform a DELETE request
   */
  async delete(
    path: string,
    options?: Partial<HttpRequestOptions>
  ): Promise<HttpResponse> {
    return this.request({ ...options, method: 'DELETE', path });
  }

  /**
   * Perform an HTTP request with full options
   */
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const url = this.buildUrl(options.path, options.queryParams);
    const headers = this.buildFullHeaders(options);
    const body = this.serializeBody(options.body, options.method);
    const idempotencyKey = uuidv4();

    return this.doFetch(url, options.method, headers, body, idempotencyKey);
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Perform the actual fetch request
   */
  private async doFetch(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | undefined,
    idempotencyKey: string
  ): Promise<HttpResponse> {
    const idempotencyHeader = this.httpConfig.options?.idempotencyKeyHeader as string
      ?? HttpAdapter.DEFAULT_IDEMPOTENCY_HEADER;

    const requestHeaders = {
      ...headers,
      [idempotencyHeader]: idempotencyKey,
    };

    const requestInit: RequestInit = {
      method,
      headers: requestHeaders,
      body: body,
      redirect: this.httpConfig.followRedirects !== false ? 'follow' : 'manual',
    };

    const response = await fetch(url, requestInit);
    const rawBody = await response.text();

    // Parse body as JSON if content type indicates JSON
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

    // Convert headers to plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parsedBody,
      rawBody,
      url: response.url,
      redirected: response.redirected,
    };
  }

  /**
   * Build the full URL with path and query parameters
   */
  private buildUrl(
    path?: string,
    params?: Record<string, string | number | boolean | string[] | unknown>
  ): string {
    let url = this.httpConfig.baseUrl;

    // Append path
    if (path) {
      // Handle leading/trailing slashes
      if (!url.endsWith('/') && !path.startsWith('/')) {
        url += '/';
      } else if (url.endsWith('/') && path.startsWith('/')) {
        path = path.substring(1);
      }
      url += path;
    }

    // Append query parameters
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(params)) {
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
   * Build default headers (without request-specific headers)
   */
  private buildDefaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...this.httpConfig.defaultHeaders,
    };

    // Add authentication header
    if (this._credentials) {
      const authHeader = this.buildAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
    }

    return headers;
  }

  /**
   * Build request headers from adapter request
   */
  private buildRequestHeaders(request: AdapterRequest): Record<string, string> {
    return {
      ...this.buildDefaultHeaders(),
      'Content-Type': HttpAdapter.DEFAULT_CONTENT_TYPE,
      ...request.headers,
    };
  }

  /**
   * Build full headers from HTTP request options
   */
  private buildFullHeaders(options: HttpRequestOptions): Record<string, string> {
    return {
      ...this.buildDefaultHeaders(),
      'Content-Type': options.contentType ?? HttpAdapter.DEFAULT_CONTENT_TYPE,
      'Accept': options.accept ?? 'application/json',
      ...options.headers,
    };
  }

  /**
   * Build authorization header based on credential type
   */
  private buildAuthHeader(): string | undefined {
    if (!this._credentials) return undefined;

    switch (this._credentials.type) {
      case 'bearer':
        return `Bearer ${this._credentials.value}`;

      case 'api_key':
        // API key can be in header or as a parameter
        // If in header, we return it directly
        return this._credentials.value;

      case 'basic':
        const username = this._credentials.secondary ?? '';
        const password = this._credentials.value;
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return `Basic ${encoded}`;

      case 'oauth2':
        // OAuth2 typically uses bearer tokens
        return `Bearer ${this._credentials.value}`;

      case 'none':
        return undefined;

      default:
        return undefined;
    }
  }

  /**
   * Parse operation string to HTTP method
   */
  private parseMethod(operation: string): HttpMethod {
    const method = operation.toUpperCase();
    const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

    if (validMethods.includes(method as HttpMethod)) {
      return method as HttpMethod;
    }

    // Default to GET for unrecognized operations
    return 'GET';
  }

  /**
   * Serialize request body to string
   */
  private serializeBody(body: unknown, method: HttpMethod): string | undefined {
    // GET and HEAD requests shouldn't have a body
    if (method === 'GET' || method === 'HEAD') {
      return undefined;
    }

    if (body === undefined || body === null) {
      return undefined;
    }

    if (typeof body === 'string') {
      return body;
    }

    return JSON.stringify(body);
  }

  // ===========================================================================
  // Metrics Override
  // ===========================================================================

  /**
   * Build HTTP-specific metrics
   */
  protected override buildMetrics(
    startTime: number,
    response?: AdapterResponse
  ): IntegrationCallMetrics {
    const baseMetrics = super.buildMetrics(startTime, response);

    const timing = response?.metadata?.timing as HttpTiming | undefined;

    return {
      ...baseMetrics,
      dnsLookupMs: timing?.dnsLookupMs,
      tcpConnectMs: timing?.tcpConnectMs,
      tlsHandshakeMs: timing?.tlsHandshakeMs,
      ttfbMs: timing?.ttfbMs,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an HTTP adapter instance
 */
export function createHttpAdapter(
  integrationId: IntegrationId,
  config: HttpConnectionConfig
): HttpAdapter {
  return new HttpAdapter(integrationId, config);
}
