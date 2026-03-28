import { loggerService } from '@logger'

import type { BaseService } from './BaseService'
import { createConditionContext } from './conditions'
import { getConditions, getDependencies, getErrorStrategy, getPhase, getPriority, getServiceName } from './decorators'
import type {
  ConditionContext,
  DependencyNode,
  Phase,
  ServiceConstructor,
  ServiceEntry,
  ServiceMetadata,
  ServiceToken
} from './types'

const logger = loggerService.withContext('Lifecycle')

/**
 * ServiceContainer
 * IoC container for managing service registration and instantiation
 */
export class ServiceContainer {
  private static instance: ServiceContainer | null = null
  private services: Map<string, ServiceEntry> = new Map()
  private excluded: Map<string, Phase> = new Map()
  private conditionContext: ConditionContext

  private constructor() {
    this.conditionContext = createConditionContext()
  }

  /**
   * Get the ServiceContainer singleton instance
   */
  public static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer()
    }
    return ServiceContainer.instance
  }

  /**
   * Reset the container (mainly for testing)
   */
  public static reset(): void {
    ServiceContainer.instance = null
  }

  /**
   * Set condition context (for testing — inject a mock context)
   * @param ctx - Condition context to use for condition evaluation
   */
  public setConditionContext(ctx: ConditionContext): void {
    this.conditionContext = ctx
  }

  /**
   * Register a service
   * @param target - Service class constructor
   */
  public register<T>(target: ServiceConstructor<T>): void {
    const name = getServiceName(target)

    if (this.services.has(name)) {
      logger.warn(`Service '${name}' is already registered, skipping`)
      return
    }

    // Check activation conditions before registering
    const conditions = getConditions(target)
    if (conditions && conditions.length > 0) {
      const phase = getPhase(target)
      for (const condition of conditions) {
        try {
          if (!condition.matches(this.conditionContext)) {
            this.excluded.set(name, phase)
            logger.info(`Service '${name}' excluded: ${condition.description}`)
            return
          }
        } catch (error) {
          this.excluded.set(name, phase)
          logger.warn(
            `Service '${name}' excluded: condition '${condition.description}' threw during evaluation`,
            error as Error
          )
          return
        }
      }
    }

    const metadata: ServiceMetadata = {
      name,
      dependencies: getDependencies(target),
      priority: getPriority(target),
      errorStrategy: getErrorStrategy(target),
      phase: getPhase(target),
      conditions
    }

    const entry: ServiceEntry<T> = {
      token: name,
      provider: {
        useClass: target,
        metadata
      }
    }

    this.services.set(name, entry)
  }

  /**
   * Get or create a service instance (all services are singletons).
   * Throws if the service is conditional — use getOptional() for conditional services.
   * @param token - Service token (name or constructor)
   * @returns Service instance
   */
  public get<T = BaseService>(token: ServiceToken<T>): T {
    const name = typeof token === 'string' ? token : getServiceName(token)
    const entry = this.services.get(name)

    if (!entry) {
      if (this.excluded.has(name)) {
        throw new Error(`[ServiceContainer] Service '${name}' was conditionally excluded — use getOptional('${name}').`)
      }
      throw new Error(`[ServiceContainer] Service '${name}' not found`)
    }

    if (entry.provider.metadata.conditions?.length) {
      throw new Error(`[ServiceContainer] Service '${name}' is conditional — use getOptional('${name}').`)
    }

    // Return existing instance if available
    if (entry.instance) {
      return entry.instance as T
    }

    // Create and store instance
    const instance = this.createInstance<T>(entry)
    entry.instance = instance

    return instance
  }

  /**
   * Get or create an optional (conditional) service instance.
   * Returns undefined if the service was excluded by conditions.
   * Throws if the service is NOT conditional — use get() for unconditional services.
   * @param token - Service token (name or constructor)
   * @returns Service instance or undefined
   */
  public getOptional<T = BaseService>(token: ServiceToken<T>): T | undefined {
    const name = typeof token === 'string' ? token : getServiceName(token)

    // Excluded by conditions → return undefined
    if (this.excluded.has(name)) {
      return undefined
    }

    const entry = this.services.get(name)
    if (!entry) {
      return undefined
    }

    if (!entry.provider.metadata.conditions?.length) {
      throw new Error(`[ServiceContainer] Service '${name}' is not conditional — use get('${name}').`)
    }

    // Return existing instance if available
    if (entry.instance) {
      return entry.instance as T
    }

    // Create and store instance
    const instance = this.createInstance<T>(entry)
    entry.instance = instance

    return instance
  }

  /**
   * Check if a service is registered
   * @param token - Service token
   */
  public has(token: ServiceToken): boolean {
    const name = typeof token === 'string' ? token : getServiceName(token)
    return this.services.has(name)
  }

  /**
   * Get service metadata
   * @param token - Service token
   */
  public getMetadata(token: ServiceToken): ServiceMetadata | undefined {
    const name = typeof token === 'string' ? token : getServiceName(token)
    return this.services.get(name)?.provider.metadata
  }

  /**
   * Get all registered service entries
   */
  public getAll(): ServiceEntry[] {
    return Array.from(this.services.values())
  }

  /**
   * Get all service names
   */
  public getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Build dependency graph for topological sorting
   * @param phase - Optional phase filter, if provided only returns nodes for that phase
   */
  public buildDependencyGraph(phase?: Phase): DependencyNode[] {
    const nodes: DependencyNode[] = []

    for (const entry of this.services.values()) {
      const metadata = entry.provider.metadata
      if (phase !== undefined && metadata.phase !== phase) {
        continue
      }
      nodes.push({
        name: metadata.name,
        dependencies: metadata.dependencies,
        priority: metadata.priority,
        phase: metadata.phase
      })
    }

    return nodes
  }

  /**
   * Update the phase of a service (used after validation/adjustment)
   * @param serviceName - Service name
   * @param phase - New phase
   */
  public updatePhase(serviceName: string, phase: Phase): void {
    const entry = this.services.get(serviceName)
    if (entry) {
      entry.provider.metadata.phase = phase
    }
  }

  /**
   * Get existing instance without creating
   * @param token - Service token
   */
  public getInstance<T = BaseService>(token: ServiceToken<T>): T | undefined {
    const name = typeof token === 'string' ? token : getServiceName(token)
    return this.services.get(name)?.instance as T | undefined
  }

  /**
   * Set instance for a service (used by lifecycle manager)
   * @param token - Service token
   * @param instance - Service instance
   */
  public setInstance<T>(token: ServiceToken<T>, instance: T): void {
    const name = typeof token === 'string' ? token : getServiceName(token)
    const entry = this.services.get(name)
    if (entry) {
      entry.instance = instance
    }
  }

  /**
   * Check if a service was excluded due to conditions
   * @param name - Service name
   */
  public isExcluded(name: string): boolean {
    return this.excluded.has(name)
  }

  /**
   * Get excluded services grouped by phase
   */
  public getExcludedByPhase(): Map<Phase, string[]> {
    const result = new Map<Phase, string[]>()
    for (const [name, phase] of this.excluded) {
      let list = result.get(phase)
      if (!list) {
        list = []
        result.set(phase, list)
      }
      list.push(name)
    }
    return result
  }

  /**
   * Remove services whose dependencies were excluded (transitive exclusion).
   * Iterates until no new exclusions are found to handle multi-layer dependency chains.
   */
  public excludeDependentsOfExcluded(): void {
    let changed = true
    while (changed) {
      changed = false
      for (const [name, entry] of this.services) {
        const excludedDep = entry.provider.metadata.dependencies.find((dep) => this.excluded.has(dep))
        if (excludedDep) {
          this.excluded.set(name, entry.provider.metadata.phase)
          this.services.delete(name)
          logger.warn(`Service '${name}' transitively excluded: depends on excluded '${excludedDep}'`)
          changed = true
        }
      }
    }
  }

  /**
   * Get a summary of registered services for logging
   */
  public getRegistrationSummary(): { total: number; excluded: number; byPhase: Record<string, number> } {
    const byPhase: Record<string, number> = {}
    for (const entry of this.services.values()) {
      const phase = entry.provider.metadata.phase
      byPhase[phase] = (byPhase[phase] || 0) + 1
    }
    return {
      total: this.services.size,
      excluded: this.excluded.size,
      byPhase
    }
  }

  /**
   * Create a service instance with dependency injection
   */
  private createInstance<T>(entry: ServiceEntry): T {
    const { metadata, useClass } = entry.provider
    const deps: unknown[] = []

    // Resolve dependencies
    for (const depName of metadata.dependencies) {
      if (!this.services.has(depName)) {
        throw new Error(`[ServiceContainer] Dependency '${depName}' not found for service '${metadata.name}'`)
      }
      deps.push(this.get(depName))
    }

    // Create instance with dependencies
    return new useClass(...deps) as T
  }
}
