/**
 * Execution Order Types for Workflow Scheduling
 *
 * Represents the computed execution order of workflow steps,
 * including parallel execution opportunities and the critical path.
 *
 * @module core/execution-order
 * @see SPARC_PSEUDOCODE.md Section 3.2 - topologicalSort
 * @see SPARC_ARCHITECTURE.md MOD-006 - Workflow Scheduler
 */

import type { WorkflowStep } from '../types/workflow.js';
import type { SHA256Hash } from '../types/common.js';

// =============================================================================
// Execution Order Types
// =============================================================================

/**
 * Represents the scheduled execution order for a workflow
 *
 * This type captures the topologically sorted steps, parallelization
 * opportunities, and the critical path through the workflow graph.
 *
 * Invariants:
 * - INV-EX-004: All dependencies must be satisfied before step execution
 * - Steps within the same parallel group have no mutual dependencies
 * - Critical path represents the longest execution path
 */
export interface ExecutionOrder {
  /**
   * Workflow ID this execution order belongs to
   */
  readonly workflowId: string;

  /**
   * Steps in topologically sorted order
   * Each step appears after all its dependencies
   */
  readonly steps: readonly WorkflowStep[];

  /**
   * Parallel groups: Map from execution level to step IDs that can run in parallel
   * Level 0: Steps with no dependencies
   * Level N: Steps whose dependencies are all in levels < N
   */
  readonly parallelGroups: ReadonlyMap<number, Set<string>>;

  /**
   * Critical path: The longest path through the dependency graph
   * Used for execution time estimation and optimization
   */
  readonly criticalPath: readonly string[];

  /**
   * Map from step ID to its execution level (parallel group index)
   */
  readonly stepLevels: ReadonlyMap<string, number>;

  /**
   * Map from step ID to its direct dependencies
   */
  readonly dependencyMap: ReadonlyMap<string, readonly string[]>;

  /**
   * Map from step ID to steps that depend on it
   */
  readonly dependentMap: ReadonlyMap<string, readonly string[]>;

  /**
   * Total number of execution levels (maximum parallelism depth)
   */
  readonly maxLevel: number;

  /**
   * Hash of the execution order for caching/comparison
   */
  readonly orderHash: SHA256Hash;
}

// =============================================================================
// Parallel Execution Group
// =============================================================================

/**
 * Represents a group of steps that can be executed in parallel
 */
export interface ParallelExecutionGroup {
  /**
   * Execution level (0-based)
   */
  readonly level: number;

  /**
   * Steps in this parallel group
   */
  readonly steps: readonly WorkflowStep[];

  /**
   * Step IDs in this group
   */
  readonly stepIds: ReadonlySet<string>;

  /**
   * Estimated execution time for this group (max of individual step times)
   */
  readonly estimatedDurationMs?: number;
}

// =============================================================================
// Execution Order Metadata
// =============================================================================

/**
 * Metadata about the execution order computation
 */
export interface ExecutionOrderMetadata {
  /**
   * When the order was computed
   */
  readonly computedAt: Date;

  /**
   * Total number of steps
   */
  readonly totalSteps: number;

  /**
   * Number of parallel groups
   */
  readonly parallelGroupCount: number;

  /**
   * Maximum parallelism (largest parallel group size)
   */
  readonly maxParallelism: number;

  /**
   * Critical path length (number of steps)
   */
  readonly criticalPathLength: number;

  /**
   * Whether the workflow has any cycles (should be false for valid workflows)
   */
  readonly hasCycles: boolean;
}

// =============================================================================
// Execution Order Builder
// =============================================================================

/**
 * Builder for constructing ExecutionOrder instances
 */
export class ExecutionOrderBuilder {
  private workflowId: string = '';
  private steps: WorkflowStep[] = [];
  private parallelGroups: Map<number, Set<string>> = new Map();
  private stepLevels: Map<string, number> = new Map();
  private dependencyMap: Map<string, string[]> = new Map();
  private dependentMap: Map<string, string[]> = new Map();
  private criticalPath: string[] = [];

  /**
   * Set the workflow ID
   */
  setWorkflowId(id: string): this {
    this.workflowId = id;
    return this;
  }

  /**
   * Set the sorted steps
   */
  setSteps(steps: WorkflowStep[]): this {
    this.steps = steps;
    return this;
  }

  /**
   * Add a step to a parallel group
   */
  addToParallelGroup(level: number, stepId: string): this {
    if (!this.parallelGroups.has(level)) {
      this.parallelGroups.set(level, new Set());
    }
    this.parallelGroups.get(level)!.add(stepId);
    this.stepLevels.set(stepId, level);
    return this;
  }

  /**
   * Set the critical path
   */
  setCriticalPath(path: string[]): this {
    this.criticalPath = path;
    return this;
  }

  /**
   * Set dependencies for a step
   */
  setDependencies(stepId: string, dependencies: string[]): this {
    this.dependencyMap.set(stepId, dependencies);
    return this;
  }

  /**
   * Set dependents for a step
   */
  setDependents(stepId: string, dependents: string[]): this {
    this.dependentMap.set(stepId, dependents);
    return this;
  }

  /**
   * Build the ExecutionOrder instance
   */
  build(orderHash: SHA256Hash): ExecutionOrder {
    let maxLevel = 0;
    for (const level of this.parallelGroups.keys()) {
      if (level > maxLevel) {
        maxLevel = level;
      }
    }

    return {
      workflowId: this.workflowId,
      steps: Object.freeze([...this.steps]),
      parallelGroups: new Map(this.parallelGroups),
      criticalPath: Object.freeze([...this.criticalPath]),
      stepLevels: new Map(this.stepLevels),
      dependencyMap: new Map(
        Array.from(this.dependencyMap.entries()).map(([k, v]) => [k, Object.freeze([...v])])
      ),
      dependentMap: new Map(
        Array.from(this.dependentMap.entries()).map(([k, v]) => [k, Object.freeze([...v])])
      ),
      maxLevel,
      orderHash,
    };
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a step's dependencies are all satisfied
 */
export function areDependenciesSatisfied(
  stepId: string,
  order: ExecutionOrder,
  completedSteps: ReadonlySet<string>
): boolean {
  const dependencies = order.dependencyMap.get(stepId) ?? [];
  return dependencies.every((dep) => completedSteps.has(dep));
}

/**
 * Get the next steps that can be executed
 */
export function getReadySteps(
  order: ExecutionOrder,
  completedSteps: ReadonlySet<string>,
  inProgressSteps: ReadonlySet<string>
): WorkflowStep[] {
  return order.steps.filter((step) => {
    // Skip if already completed or in progress
    if (completedSteps.has(step.id) || inProgressSteps.has(step.id)) {
      return false;
    }
    // Check if all dependencies are satisfied
    return areDependenciesSatisfied(step.id, order, completedSteps);
  });
}

/**
 * Get steps at a specific execution level
 */
export function getStepsAtLevel(
  order: ExecutionOrder,
  level: number
): WorkflowStep[] {
  const stepIds = order.parallelGroups.get(level);
  if (!stepIds) {
    return [];
  }
  return order.steps.filter((step) => stepIds.has(step.id));
}

/**
 * Compute execution order metadata
 */
export function computeOrderMetadata(
  order: ExecutionOrder,
  hasCycles: boolean = false
): ExecutionOrderMetadata {
  let maxParallelism = 0;
  for (const group of order.parallelGroups.values()) {
    if (group.size > maxParallelism) {
      maxParallelism = group.size;
    }
  }

  return {
    computedAt: new Date(),
    totalSteps: order.steps.length,
    parallelGroupCount: order.parallelGroups.size,
    maxParallelism,
    criticalPathLength: order.criticalPath.length,
    hasCycles,
  };
}
