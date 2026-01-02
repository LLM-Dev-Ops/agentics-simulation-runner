/**
 * Topological Sort for Workflow Dependency Ordering
 *
 * Implements topological sorting of workflow steps based on their dependencies.
 * Used by the Workflow Scheduler (MOD-006) to determine execution order.
 *
 * @module src/utils/topological-sort
 * @see SPARC_PSEUDOCODE.md Section 3.2 - hasCycles and topologicalSort
 * @see SPARC_REFINEMENT.md Section 4 - INV-EX-004: dependency ordering
 */

/**
 * Represents a dependency edge between two steps
 */
export interface Dependency {
  from: string;
  to: string;
}

/**
 * Minimal step interface required for sorting
 */
export interface Step {
  stepId: string;
  [key: string]: unknown;
}

/**
 * Error thrown when a cycle is detected in the dependency graph
 */
export class CyclicDependencyError extends Error {
  public readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'CyclicDependencyError';
    this.cycle = cycle;
  }
}

/**
 * Error thrown when dependencies reference non-existent steps
 */
export class InvalidDependencyError extends Error {
  public readonly invalidStepId: string;
  public readonly dependencyDirection: 'from' | 'to';

  constructor(stepId: string, direction: 'from' | 'to') {
    super(`Dependency references non-existent step: ${stepId} (in '${direction}' field)`);
    this.name = 'InvalidDependencyError';
    this.invalidStepId = stepId;
    this.dependencyDirection = direction;
  }
}

/**
 * Check if the dependency graph contains cycles
 *
 * Uses depth-first search with path tracking to detect cycles.
 *
 * @param dependencies - Array of dependency edges
 * @returns true if cycles exist, false otherwise
 *
 * @see SPARC_PSEUDOCODE.md Section 3.2 - hasCycles function
 */
export function hasCycles(dependencies: Dependency[]): boolean {
  try {
    detectCycle(dependencies);
    return false;
  } catch (error) {
    if (error instanceof CyclicDependencyError) {
      return true;
    }
    throw error;
  }
}

/**
 * Detect and return the cycle path if one exists
 *
 * @param dependencies - Array of dependency edges
 * @returns The cycle path if one exists
 * @throws CyclicDependencyError if a cycle is detected
 */
export function detectCycle(dependencies: Dependency[]): string[] | null {
  // Build adjacency list
  const graph = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const dep of dependencies) {
    allNodes.add(dep.from);
    allNodes.add(dep.to);

    if (!graph.has(dep.from)) {
      graph.set(dep.from, []);
    }
    graph.get(dep.from)!.push(dep.to);
  }

  // Track node states: 0 = unvisited, 1 = in current path, 2 = fully visited
  const state = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const node of allNodes) {
    state.set(node, 0);
  }

  /**
   * DFS to detect cycles
   */
  function dfs(node: string, path: string[]): string[] | null {
    state.set(node, 1); // Mark as in current path
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (state.get(neighbor) === 1) {
        // Found a cycle - extract the cycle path
        const cycleStart = path.indexOf(neighbor);
        const cycle = [...path.slice(cycleStart), neighbor];
        throw new CyclicDependencyError(cycle);
      }

      if (state.get(neighbor) === 0) {
        const result = dfs(neighbor, path);
        if (result) {
          return result;
        }
      }
    }

    path.pop();
    state.set(node, 2); // Mark as fully visited
    return null;
  }

  // Start DFS from each unvisited node
  for (const node of allNodes) {
    if (state.get(node) === 0) {
      const result = dfs(node, []);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/**
 * Validate that all dependency references exist in the steps
 *
 * @param dependencies - Array of dependency edges
 * @param steps - Array of steps with stepId
 * @throws InvalidDependencyError if a dependency references a non-existent step
 */
export function validateDependencies<T extends Step>(
  dependencies: Dependency[],
  steps: T[]
): void {
  const stepIds = new Set(steps.map(s => s.stepId));

  for (const dep of dependencies) {
    if (!stepIds.has(dep.from)) {
      throw new InvalidDependencyError(dep.from, 'from');
    }
    if (!stepIds.has(dep.to)) {
      throw new InvalidDependencyError(dep.to, 'to');
    }
  }
}

/**
 * Topologically sort steps based on dependencies
 *
 * Returns steps in an order where all dependencies are satisfied before
 * a step is executed. Uses Kahn's algorithm for stable, deterministic ordering.
 *
 * When multiple steps have no dependencies (or all dependencies satisfied),
 * they are ordered by stepId lexicographically to ensure determinism.
 *
 * @param dependencies - Array of dependency edges (from -> to means 'from' must complete before 'to')
 * @param steps - Array of steps to sort
 * @returns Steps in topologically sorted order
 * @throws CyclicDependencyError if the graph contains cycles
 * @throws InvalidDependencyError if dependencies reference non-existent steps
 *
 * @example
 * ```typescript
 * const steps = [
 *   { stepId: 'A' },
 *   { stepId: 'B' },
 *   { stepId: 'C' },
 * ];
 * const deps = [
 *   { from: 'A', to: 'B' },  // A must complete before B
 *   { from: 'B', to: 'C' },  // B must complete before C
 * ];
 * topologicalSort(deps, steps);
 * // => [{ stepId: 'A' }, { stepId: 'B' }, { stepId: 'C' }]
 * ```
 *
 * @see SPARC_PSEUDOCODE.md - topologicalSort(plan.workflow.dependencies, plan.workflow.steps)
 * @see SPARC_REFINEMENT.md Section 4 - INV-EX-004: dependency ordering
 */
export function topologicalSort<T extends Step>(
  dependencies: Dependency[],
  steps: T[]
): T[] {
  // Validate dependencies reference existing steps
  validateDependencies(dependencies, steps);

  // Check for cycles first
  const cycle = detectCycle(dependencies);
  if (cycle) {
    throw new CyclicDependencyError(cycle);
  }

  // Build step lookup map
  const stepMap = new Map<string, T>();
  for (const step of steps) {
    stepMap.set(step.stepId, step);
  }

  // Build adjacency list and in-degree count
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.stepId, 0);
    outEdges.set(step.stepId, []);
  }

  for (const dep of dependencies) {
    inDegree.set(dep.to, (inDegree.get(dep.to) || 0) + 1);
    outEdges.get(dep.from)!.push(dep.to);
  }

  // Kahn's algorithm with deterministic ordering
  // Use sorted array instead of queue for determinism
  const result: T[] = [];
  let available = steps
    .filter(s => inDegree.get(s.stepId) === 0)
    .map(s => s.stepId)
    .sort(); // Sort for deterministic ordering

  while (available.length > 0) {
    // Always take the lexicographically smallest available step
    const current = available.shift()!;
    result.push(stepMap.get(current)!);

    // Reduce in-degree for dependent steps
    const dependents = outEdges.get(current) || [];
    for (const dependent of dependents) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        // Insert in sorted position for determinism
        const insertPos = available.findIndex(id => id > dependent);
        if (insertPos === -1) {
          available.push(dependent);
        } else {
          available.splice(insertPos, 0, dependent);
        }
      }
    }
  }

  // If not all steps are in result, there was a cycle (shouldn't happen due to earlier check)
  if (result.length !== steps.length) {
    throw new Error('Internal error: topological sort incomplete');
  }

  return result;
}

/**
 * Get the immediate dependencies for a step
 *
 * @param stepId - The step to get dependencies for
 * @param dependencies - All dependencies
 * @returns Array of stepIds that must complete before this step
 */
export function getDependencies(
  stepId: string,
  dependencies: Dependency[]
): string[] {
  return dependencies
    .filter(dep => dep.to === stepId)
    .map(dep => dep.from)
    .sort(); // Sort for deterministic ordering
}

/**
 * Get the immediate dependents for a step (steps that depend on this one)
 *
 * @param stepId - The step to get dependents for
 * @param dependencies - All dependencies
 * @returns Array of stepIds that depend on this step
 */
export function getDependents(
  stepId: string,
  dependencies: Dependency[]
): string[] {
  return dependencies
    .filter(dep => dep.from === stepId)
    .map(dep => dep.to)
    .sort(); // Sort for deterministic ordering
}

/**
 * Find steps that can be executed in parallel (no mutual dependencies)
 *
 * Given a set of steps with all dependencies satisfied, returns groups
 * that can potentially run in parallel.
 *
 * @param steps - Steps to analyze
 * @param dependencies - All dependencies
 * @returns Array of step groups that can run in parallel
 */
export function findParallelGroups<T extends Step>(
  steps: T[],
  dependencies: Dependency[]
): T[][] {
  const sorted = topologicalSort(dependencies, steps);
  const groups: T[][] = [];
  let currentGroup: T[] = [];
  const completed = new Set<string>();

  for (const step of sorted) {
    const deps = getDependencies(step.stepId, dependencies);
    const allDepsCompleted = deps.every(d => completed.has(d));

    if (!allDepsCompleted) {
      // This step depends on something not yet completed
      // Start a new group with all previous steps marked as completed
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        for (const s of currentGroup) {
          completed.add(s.stepId);
        }
      }
      currentGroup = [step];
    } else {
      // Can potentially run in parallel with current group
      currentGroup.push(step);
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}
