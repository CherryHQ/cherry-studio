import { loggerService } from '@logger'

import { type DependencyNode, Phase } from './types'

const logger = loggerService.withContext('Lifecycle')

/**
 * Circular dependency error
 */
export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`)
    this.name = 'CircularDependencyError'
  }
}

/**
 * Phase adjustment result
 */
export interface PhaseAdjustment {
  serviceName: string
  originalPhase: Phase
  adjustedPhase: Phase
  reason: string
}

/**
 * DependencyResolver
 * Resolves service initialization order using topological sorting
 */
export class DependencyResolver {
  /**
   * Resolve initialization order using Kahn's algorithm (topological sort)
   * @param nodes - Dependency graph nodes
   * @returns Sorted service names in initialization order
   * @throws CircularDependencyError if circular dependency detected
   */
  public resolve(nodes: DependencyNode[]): string[] {
    const nodeMap = new Map<string, DependencyNode>()
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize maps
    for (const node of nodes) {
      nodeMap.set(node.name, node)
      inDegree.set(node.name, 0)
      adjacency.set(node.name, [])
    }

    // Build graph
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        if (nodeMap.has(dep)) {
          adjacency.get(dep)!.push(node.name)
          inDegree.set(node.name, inDegree.get(node.name)! + 1)
        }
      }
    }

    // Find nodes with no dependencies, sorted by priority
    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name)
      }
    }
    this.sortByPriority(queue, nodeMap)

    const result: string[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      // Collect newly available nodes
      const newlyAvailable: string[] = []
      for (const neighbor of adjacency.get(current)!) {
        const newDegree = inDegree.get(neighbor)! - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          newlyAvailable.push(neighbor)
        }
      }

      // Sort by priority and add to queue
      this.sortByPriority(newlyAvailable, nodeMap)
      queue.push(...newlyAvailable)
    }

    // Check for cycles
    if (result.length !== nodes.length) {
      const cycle = this.findCycle(nodes)
      throw new CircularDependencyError(cycle)
    }

    return result
  }

  /**
   * Sort names by priority (lower = earlier)
   */
  private sortByPriority(names: string[], nodeMap: Map<string, DependencyNode>): void {
    names.sort((a, b) => {
      const priorityA = nodeMap.get(a)?.priority ?? 100
      const priorityB = nodeMap.get(b)?.priority ?? 100
      return priorityA - priorityB
    })
  }

  /**
   * Find a cycle in the dependency graph for error reporting
   */
  private findCycle(nodes: DependencyNode[]): string[] {
    const visited = new Set<string>()
    const stack = new Set<string>()
    const nodeMap = new Map(nodes.map((n) => [n.name, n]))

    const dfs = (name: string, path: string[]): string[] | null => {
      if (stack.has(name)) {
        const cycleStart = path.indexOf(name)
        return [...path.slice(cycleStart), name]
      }
      if (visited.has(name)) return null

      visited.add(name)
      stack.add(name)
      path.push(name)

      const node = nodeMap.get(name)
      if (node) {
        for (const dep of node.dependencies) {
          if (nodeMap.has(dep)) {
            const cycle = dfs(dep, path)
            if (cycle) return cycle
          }
        }
      }

      stack.delete(name)
      path.pop()
      return null
    }

    for (const node of nodes) {
      const cycle = dfs(node.name, [])
      if (cycle) return cycle
    }

    return ['unknown cycle']
  }

  /**
   * Resolve initialization order as layered structure for parallel execution
   * Services in the same layer have no dependencies on each other and can run in parallel
   * @param nodes - Dependency graph nodes
   * @returns Array of layers, each layer contains service names that can run in parallel
   */
  public resolveLayered(nodes: DependencyNode[]): string[][] {
    const nodeMap = new Map<string, DependencyNode>()
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize maps
    for (const node of nodes) {
      nodeMap.set(node.name, node)
      inDegree.set(node.name, 0)
      adjacency.set(node.name, [])
    }

    // Build graph
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        if (nodeMap.has(dep)) {
          adjacency.get(dep)!.push(node.name)
          inDegree.set(node.name, inDegree.get(node.name)! + 1)
        }
      }
    }

    const layers: string[][] = []
    let remaining = nodes.length

    while (remaining > 0) {
      // Find all nodes with no remaining dependencies
      const currentLayer: string[] = []
      for (const [name, degree] of inDegree) {
        if (degree === 0) {
          currentLayer.push(name)
        }
      }

      if (currentLayer.length === 0 && remaining > 0) {
        const cycle = this.findCycle(nodes)
        throw new CircularDependencyError(cycle)
      }

      // Sort by priority within layer
      this.sortByPriority(currentLayer, nodeMap)
      layers.push(currentLayer)

      // Remove processed nodes and update degrees
      for (const name of currentLayer) {
        inDegree.set(name, -1) // Mark as processed
        for (const neighbor of adjacency.get(name)!) {
          const newDegree = inDegree.get(neighbor)! - 1
          inDegree.set(neighbor, newDegree)
        }
      }

      remaining -= currentLayer.length
    }

    return layers
  }

  /**
   * Validate and adjust service phases based on dependencies
   * Returns adjustments made and logs warnings
   * @param nodes - Dependency graph nodes (will be mutated)
   * @returns List of phase adjustments made
   */
  public validateAndAdjustPhases(nodes: DependencyNode[]): PhaseAdjustment[] {
    const nodeMap = new Map<string, DependencyNode>()
    for (const node of nodes) {
      nodeMap.set(node.name, node)
    }

    const adjustments: PhaseAdjustment[] = []

    // Iterate until no more adjustments needed
    let changed = true
    while (changed) {
      changed = false
      for (const node of nodes) {
        for (const depName of node.dependencies) {
          const depNode = nodeMap.get(depName)
          if (!depNode) continue

          // Check for invalid dependency patterns
          if (this.isInvalidDependency(node.phase, depNode.phase)) {
            const newPhase = this.getAdjustedPhase(node.phase, depNode.phase)
            if (newPhase !== node.phase) {
              adjustments.push({
                serviceName: node.name,
                originalPhase: node.phase,
                adjustedPhase: newPhase,
                reason: `depends on ${depNode.phase} service '${depName}'`
              })
              node.phase = newPhase
              changed = true
            }
          }
        }
      }
    }

    // Log warnings for adjustments
    for (const adj of adjustments) {
      logger.warn(
        `Service '${adj.serviceName}' declared as ${adj.originalPhase} but ${adj.reason}, adjusted to ${adj.adjustedPhase}`
      )
    }

    return adjustments
  }

  /**
   * Check if a dependency relationship is invalid based on phases
   */
  private isInvalidDependency(servicePhase: Phase, dependencyPhase: Phase): boolean {
    // BeforeReady can only depend on BeforeReady
    if (servicePhase === Phase.BeforeReady && dependencyPhase !== Phase.BeforeReady) {
      return true
    }
    // Background can only depend on Background
    if (servicePhase === Phase.Background && dependencyPhase !== Phase.Background) {
      return true
    }
    // WhenReady can depend on BeforeReady or WhenReady, but not Background
    if (servicePhase === Phase.WhenReady && dependencyPhase === Phase.Background) {
      return true
    }
    return false
  }

  /**
   * Get the adjusted phase based on service and dependency phases
   */
  private getAdjustedPhase(servicePhase: Phase, dependencyPhase: Phase): Phase {
    // BeforeReady depending on WhenReady → adjust to WhenReady
    if (servicePhase === Phase.BeforeReady && dependencyPhase === Phase.WhenReady) {
      return Phase.WhenReady
    }
    // BeforeReady depending on Background → adjust to Background (then may cascade)
    if (servicePhase === Phase.BeforeReady && dependencyPhase === Phase.Background) {
      return Phase.Background
    }
    // Background depending on BeforeReady → adjust to BeforeReady
    if (servicePhase === Phase.Background && dependencyPhase === Phase.BeforeReady) {
      return Phase.BeforeReady
    }
    // Background depending on WhenReady → adjust to WhenReady
    if (servicePhase === Phase.Background && dependencyPhase === Phase.WhenReady) {
      return Phase.WhenReady
    }
    // WhenReady depending on Background → adjust Background service to WhenReady
    // Note: This case is handled differently - we adjust the dependency, not the service
    // For now, we don't adjust WhenReady services
    return servicePhase
  }

  /**
   * Get all services that depend on the specified service (dependents).
   * Used for cascade pause/stop: when stopping service A, all services that depend on A
   * must be stopped first.
   * @param serviceName - The service name to find dependents for
   * @param nodes - Dependency graph nodes
   * @returns Array of service names that depend on the specified service (in order of dependency depth)
   */
  public getDependents(serviceName: string, nodes: DependencyNode[]): string[] {
    const dependents: Set<string> = new Set()
    const visited: Set<string> = new Set()

    const collectDependents = (name: string) => {
      for (const node of nodes) {
        if (node.dependencies.includes(name) && !visited.has(node.name)) {
          visited.add(node.name)
          dependents.add(node.name)
          collectDependents(node.name)
        }
      }
    }

    collectDependents(serviceName)
    return Array.from(dependents)
  }

  /**
   * Get all dependencies of the specified service (transitive closure).
   * Used for cascade resume/start: when starting service A, all services that A depends on
   * must be started first.
   * @param serviceName - The service name to find dependencies for
   * @param nodes - Dependency graph nodes
   * @returns Array of service names that the specified service depends on (in order of dependency depth)
   */
  public getDependencies(serviceName: string, nodes: DependencyNode[]): string[] {
    const dependencies: Set<string> = new Set()
    const visited: Set<string> = new Set()
    const nodeMap = new Map(nodes.map((n) => [n.name, n]))

    const collectDependencies = (name: string) => {
      const node = nodeMap.get(name)
      if (!node) return

      for (const depName of node.dependencies) {
        if (!visited.has(depName)) {
          visited.add(depName)
          dependencies.add(depName)
          collectDependencies(depName)
        }
      }
    }

    collectDependencies(serviceName)
    return Array.from(dependencies)
  }
}
