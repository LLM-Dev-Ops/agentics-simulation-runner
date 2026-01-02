/**
 * Metric Types for MOD-009 Telemetry Collector
 *
 * Defines metric-related types for the telemetry system including
 * captured metrics, aggregation types, and metric requirements.
 *
 * References:
 * - SPARC_ARCHITECTURE.md Section 7: Telemetry Capture Module
 * - SPARC_PSEUDOCODE.md Section 6.1: Metric Aggregation
 *
 * @module core/metric-types
 */

import type { UUID, ISO8601Timestamp, DurationMs } from '../types/common.js';

// =============================================================================
// Aggregation Types
// =============================================================================

/**
 * Supported metric aggregation types
 * From Pseudocode 6.1: aggregateMetrics supports these aggregation types
 */
export type MetricAggregationType =
  | 'SUM'
  | 'AVG'
  | 'MAX'
  | 'MIN'
  | 'COUNT'
  | 'P50'
  | 'P95'
  | 'P99'
  | 'HISTOGRAM';

/**
 * Metric value type - single value or histogram buckets
 */
export type MetricValue = number | HistogramValue;

/**
 * Histogram value with bucket counts
 */
export interface HistogramValue {
  readonly buckets: ReadonlyArray<HistogramBucket>;
  readonly sum: number;
  readonly count: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Single histogram bucket
 */
export interface HistogramBucket {
  readonly upperBound: number;
  readonly count: number;
}

// =============================================================================
// Time Range Types
// =============================================================================

/**
 * Time range for metric aggregation
 */
export interface MetricTimeRange {
  readonly start: ISO8601Timestamp;
  readonly end: ISO8601Timestamp;
}

// =============================================================================
// Captured Metric Types
// =============================================================================

/**
 * CapturedMetric type from Pseudocode 6.1
 *
 * Represents an aggregated metric with its computed value,
 * sample count, and time range.
 */
export interface CapturedMetric {
  /**
   * Unique metric identifier
   */
  readonly metricId: UUID;

  /**
   * Name of the metric (e.g., "simulation.step.duration")
   */
  readonly metricName: string;

  /**
   * Type of aggregation applied
   */
  readonly aggregationType: MetricAggregationType;

  /**
   * Aggregated value (number for most types, array for histogram)
   */
  readonly value: MetricValue;

  /**
   * Number of samples included in aggregation
   */
  readonly sampleCount: number;

  /**
   * Time range covered by this aggregation
   */
  readonly timeRange: MetricTimeRange;

  /**
   * Labels associated with this metric
   */
  readonly labels: ReadonlyMap<string, string>;

  /**
   * Unit of measurement (optional)
   */
  readonly unit?: string;

  /**
   * When the metric was captured/aggregated
   */
  readonly capturedAt: ISO8601Timestamp;
}

// =============================================================================
// Metric Requirements Types
// =============================================================================

/**
 * Requirements for metric aggregation
 * Specifies which metrics to aggregate and how
 */
export interface MetricRequirements {
  /**
   * List of metric names to aggregate
   */
  readonly metricNames: readonly string[];

  /**
   * Aggregation types to apply
   */
  readonly aggregationTypes: readonly MetricAggregationType[];

  /**
   * Time range for aggregation
   */
  readonly timeRange?: MetricTimeRange;

  /**
   * Label filters to apply
   */
  readonly labelFilters?: ReadonlyMap<string, string>;

  /**
   * Histogram bucket boundaries (for HISTOGRAM type)
   */
  readonly histogramBuckets?: readonly number[];

  /**
   * Whether to include empty buckets in histogram
   */
  readonly includeEmptyBuckets?: boolean;
}

/**
 * Collection of captured metrics
 */
export interface CapturedMetrics {
  /**
   * Execution ID these metrics belong to
   */
  readonly executionId: UUID;

  /**
   * List of captured metrics
   */
  readonly metrics: readonly CapturedMetric[];

  /**
   * Total number of raw samples processed
   */
  readonly totalSamples: number;

  /**
   * Time range covered by all metrics
   */
  readonly timeRange: MetricTimeRange;

  /**
   * When the metrics were aggregated
   */
  readonly aggregatedAt: ISO8601Timestamp;
}

// =============================================================================
// Raw Metric Types
// =============================================================================

/**
 * Raw metric sample before aggregation
 */
export interface RawMetricSample {
  /**
   * Metric name
   */
  readonly name: string;

  /**
   * Metric value
   */
  readonly value: number;

  /**
   * Labels for this sample
   */
  readonly labels: ReadonlyMap<string, string>;

  /**
   * When the sample was recorded
   */
  readonly timestamp: ISO8601Timestamp;

  /**
   * Execution ID
   */
  readonly executionId: UUID;

  /**
   * Optional step ID
   */
  readonly stepId?: string;

  /**
   * Optional agent ID
   */
  readonly agentId?: string;
}

/**
 * Metric storage interface for persisting raw samples
 */
export interface MetricStorage {
  /**
   * Store a raw metric sample
   */
  store(sample: RawMetricSample): Promise<void>;

  /**
   * Store multiple raw metric samples
   */
  storeBatch(samples: readonly RawMetricSample[]): Promise<void>;

  /**
   * Query raw samples for aggregation
   */
  query(
    executionId: UUID,
    requirements: MetricRequirements
  ): Promise<readonly RawMetricSample[]>;

  /**
   * Delete samples for an execution
   */
  delete(executionId: UUID): Promise<number>;
}

// =============================================================================
// Metric Aggregator Interface
// =============================================================================

/**
 * Interface for metric aggregation operations
 */
export interface MetricAggregator {
  /**
   * Compute SUM aggregation
   */
  sum(values: readonly number[]): number;

  /**
   * Compute AVG aggregation
   */
  avg(values: readonly number[]): number;

  /**
   * Compute MAX aggregation
   */
  max(values: readonly number[]): number;

  /**
   * Compute MIN aggregation
   */
  min(values: readonly number[]): number;

  /**
   * Compute COUNT aggregation
   */
  count(values: readonly number[]): number;

  /**
   * Compute percentile (P50, P95, P99)
   */
  percentile(values: readonly number[], p: number): number;

  /**
   * Compute histogram
   */
  histogram(
    values: readonly number[],
    buckets: readonly number[]
  ): HistogramValue;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new CapturedMetric
 */
export function createCapturedMetric(params: {
  metricId: UUID;
  metricName: string;
  aggregationType: MetricAggregationType;
  value: MetricValue;
  sampleCount: number;
  timeRange: MetricTimeRange;
  labels: ReadonlyMap<string, string>;
  unit?: string;
}): CapturedMetric {
  return {
    metricId: params.metricId,
    metricName: params.metricName,
    aggregationType: params.aggregationType,
    value: params.value,
    sampleCount: params.sampleCount,
    timeRange: params.timeRange,
    labels: params.labels,
    unit: params.unit,
    capturedAt: new Date().toISOString() as ISO8601Timestamp,
  };
}

/**
 * Create a new RawMetricSample
 */
export function createRawMetricSample(params: {
  name: string;
  value: number;
  executionId: UUID;
  labels?: ReadonlyMap<string, string>;
  stepId?: string;
  agentId?: string;
}): RawMetricSample {
  return {
    name: params.name,
    value: params.value,
    labels: params.labels ?? new Map(),
    timestamp: new Date().toISOString() as ISO8601Timestamp,
    executionId: params.executionId,
    stepId: params.stepId,
    agentId: params.agentId,
  };
}

/**
 * Create metric requirements
 */
export function createMetricRequirements(params: {
  metricNames: readonly string[];
  aggregationTypes?: readonly MetricAggregationType[];
  timeRange?: MetricTimeRange;
  labelFilters?: ReadonlyMap<string, string>;
  histogramBuckets?: readonly number[];
}): MetricRequirements {
  return {
    metricNames: params.metricNames,
    aggregationTypes: params.aggregationTypes ?? ['AVG', 'MAX', 'MIN', 'COUNT'],
    timeRange: params.timeRange,
    labelFilters: params.labelFilters,
    histogramBuckets: params.histogramBuckets,
    includeEmptyBuckets: false,
  };
}

/**
 * Check if a metric value is a histogram
 */
export function isHistogramValue(value: MetricValue): value is HistogramValue {
  return typeof value === 'object' && 'buckets' in value;
}

/**
 * Default histogram bucket boundaries for latency metrics (in ms)
 */
export const DEFAULT_LATENCY_BUCKETS: readonly number[] = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/**
 * Default histogram bucket boundaries for token counts
 */
export const DEFAULT_TOKEN_BUCKETS: readonly number[] = [
  10, 50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000,
];
