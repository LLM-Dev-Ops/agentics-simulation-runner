/**
 * Retry with Exponential Backoff
 *
 * Implements deterministic retry logic with exponential backoff for transient failures.
 * All retry delays are derived from the deterministic random generator and logged.
 *
 * @module src/utils/retry
 * @see SPARC_REFINEMENT.md Section 5.2 - Retry Strategy
 */

import { DeterministicRandom } from './deterministic-random.js';

/**
 * Retry configuration as specified in SPARC_REFINEMENT.md Section 5.2
 */
export interface RetryConfig {
  /** Base delay in milliseconds (default: 100) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Delay multiplier for exponential backoff (default: 2.0) */
  multiplier: number;
  /** Jitter factor for randomized delay (default: 0.1) */
  jitterFactor: number;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
}

/**
 * Default retry configuration from SPARC_REFINEMENT.md Section 5.2
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelayMs: 100,
  maxDelayMs: 30000,
  multiplier: 2.0,
  jitterFactor: 0.1,
  maxRetries: 3,
};

/**
 * Retry context containing the random generator for deterministic jitter
 */
export interface RetryContext {
  /** Deterministic random generator for reproducible jitter */
  randomGenerator: DeterministicRandom;
  /** Optional custom retry configuration */
  retryConfig?: Partial<RetryConfig>;
}

/**
 * Result of a retry delay computation
 */
export interface RetryDelayResult {
  /** The delay in milliseconds */
  delayMs: number;
  /** The base delay before jitter */
  baseDelayMs: number;
  /** The jitter offset applied */
  jitterOffsetMs: number;
  /** Whether this is the final retry attempt */
  isFinalAttempt: boolean;
}

/**
 * Compute the retry delay for a given attempt
 *
 * Implements exponential backoff with deterministic jitter as specified in
 * SPARC_REFINEMENT.md Section 5.2.
 *
 * Formula:
 *   baseDelay = baseDelayMs * (multiplier ^ attempt)
 *   cappedDelay = min(baseDelay, maxDelayMs)
 *   jitter = random value from deterministic generator
 *   jitterRange = cappedDelay * jitterFactor
 *   jitterOffset = (jitter % jitterRange) - (jitterRange / 2)
 *   finalDelay = cappedDelay + jitterOffset
 *
 * @param ctx - Retry context with random generator
 * @param attempt - Current attempt number (0-based)
 * @param operation - Operation identifier for logging
 * @returns Computed retry delay result
 *
 * @example
 * ```typescript
 * const ctx = {
 *   randomGenerator: new DeterministicRandom(seed),
 * };
 * const delay = computeRetryDelay(ctx, 0, 'integration:api_call');
 * await sleep(delay.delayMs);
 * ```
 */
export function computeRetryDelay(
  ctx: RetryContext,
  attempt: number,
  operation: string
): RetryDelayResult {
  const config = { ...DEFAULT_RETRY_CONFIG, ...ctx.retryConfig };

  // Calculate base exponential delay
  const exponentialDelay = config.baseDelayMs * Math.pow(config.multiplier, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Get deterministic jitter value
  // The operation tag ensures reproducibility of this specific retry sequence
  const jitterRaw = ctx.randomGenerator.next(`retry:${operation}:attempt:${attempt}`);

  // Calculate jitter range and offset
  const jitterRange = cappedDelay * config.jitterFactor;

  // Convert BigInt to number for modulo operation
  // Use only lower 32 bits to avoid precision loss
  const jitterValue = Number(jitterRaw & BigInt(0xFFFFFFFF));

  // Jitter offset is in range [-jitterRange/2, jitterRange/2]
  const jitterOffset = (jitterValue % Math.floor(jitterRange)) - (jitterRange / 2);

  // Final delay (ensure non-negative)
  const finalDelay = Math.max(0, Math.round(cappedDelay + jitterOffset));

  return {
    delayMs: finalDelay,
    baseDelayMs: Math.round(cappedDelay),
    jitterOffsetMs: Math.round(jitterOffset),
    isFinalAttempt: attempt >= config.maxRetries - 1,
  };
}

/**
 * Retry attempt information for logging
 */
export interface RetryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  operation: string;
  error?: Error;
}

/**
 * Retry result indicating success or failure
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: RetryAttemptInfo[];
  totalDelayMs: number;
}

/**
 * Retry logger interface for recording retry attempts
 */
export interface RetryLogger {
  logAttempt(info: RetryAttemptInfo): void;
  logSuccess(info: RetryAttemptInfo): void;
  logFailure(info: RetryAttemptInfo): void;
}

/**
 * Default no-op retry logger
 */
export const noopRetryLogger: RetryLogger = {
  logAttempt: () => {},
  logSuccess: () => {},
  logFailure: () => {},
};

/**
 * Check if an error is retryable (transient failure)
 *
 * @param error - The error to check
 * @returns true if the error is likely transient and worth retrying
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('network') ||
      message.includes('socket') ||
      name.includes('timeout')
    ) {
      return true;
    }

    // Rate limiting
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      return true;
    }

    // Temporary service unavailability
    if (
      message.includes('503') ||
      message.includes('service unavailable') ||
      message.includes('temporarily unavailable')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a function with retry logic
 *
 * Automatically retries the operation on transient failures with exponential backoff.
 * All retry behavior is deterministic and logged for reproducibility.
 *
 * @param ctx - Retry context with random generator
 * @param operation - Operation identifier for logging
 * @param fn - Async function to execute
 * @param options - Optional configuration
 * @returns Result of the operation or error after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await executeWithRetry(
 *   ctx,
 *   'api:fetch_data',
 *   async () => {
 *     const response = await fetch(url);
 *     return response.json();
 *   }
 * );
 *
 * if (result.success) {
 *   console.log(result.result);
 * } else {
 *   console.error('Failed after retries:', result.error);
 * }
 * ```
 */
export async function executeWithRetry<T>(
  ctx: RetryContext,
  operation: string,
  fn: () => Promise<T>,
  options: {
    logger?: RetryLogger;
    isRetryable?: (error: unknown) => boolean;
  } = {}
): Promise<RetryResult<T>> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...ctx.retryConfig };
  const logger = options.logger ?? noopRetryLogger;
  const shouldRetry = options.isRetryable ?? isRetryableError;

  const attempts: RetryAttemptInfo[] = [];
  let totalDelayMs = 0;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const attemptInfo: RetryAttemptInfo = {
      attempt,
      maxAttempts: config.maxRetries + 1,
      delayMs: 0,
      operation,
    };

    try {
      logger.logAttempt(attemptInfo);
      const result = await fn();

      logger.logSuccess(attemptInfo);
      attempts.push(attemptInfo);

      return {
        success: true,
        result,
        attempts,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attemptInfo.error = lastError;

      logger.logFailure(attemptInfo);

      // Check if we should retry
      if (attempt < config.maxRetries && shouldRetry(error)) {
        const delay = computeRetryDelay(ctx, attempt, operation);
        attemptInfo.delayMs = delay.delayMs;
        attempts.push(attemptInfo);
        totalDelayMs += delay.delayMs;

        // Wait before retry
        await sleep(delay.delayMs);
      } else {
        // No more retries
        attempts.push(attemptInfo);
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalDelayMs,
  };
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry context from execution context seed
 *
 * @param deterministicSeed - The seed from execution context
 * @param config - Optional custom retry configuration
 * @returns Configured retry context
 */
export function createRetryContext(
  deterministicSeed: string | number,
  config?: Partial<RetryConfig>
): RetryContext {
  // Create a dedicated random generator for retry operations
  // Using a derived seed to not interfere with main random sequence
  const retryRandom = new DeterministicRandom(`${deterministicSeed}:retry`);

  return {
    randomGenerator: retryRandom,
    retryConfig: config,
  };
}

/**
 * Compute all retry delays for an operation upfront
 *
 * Useful for logging or UI display of expected retry behavior.
 *
 * @param ctx - Retry context
 * @param operation - Operation identifier
 * @returns Array of all possible retry delays
 */
export function computeAllRetryDelays(
  ctx: RetryContext,
  operation: string
): RetryDelayResult[] {
  const config = { ...DEFAULT_RETRY_CONFIG, ...ctx.retryConfig };
  const delays: RetryDelayResult[] = [];

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    delays.push(computeRetryDelay(ctx, attempt, operation));
  }

  return delays;
}
