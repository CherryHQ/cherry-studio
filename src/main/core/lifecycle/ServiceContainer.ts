import { loggerService } from '@logger'

import {
  getDependencies,
  getErrorStrategy,
  getExcludePlatforms,
  getPhase,
  getPriority,
  getServiceName
} from './decorators'
import type { DependencyNode, Phase, ServiceConstructor, ServiceEntry, ServiceMetadata, ServiceToken } from './types'
import { matchesPlatformTarget } from './types'

const logger = loggerService.withContext('ServiceContainer')

/**
 * ServiceContainer
 * IoC container for managing service registration and instantiation
 */
export class ServiceContainer {
  private static instance: ServiceContainer | null = null
  private services: Map<string, ServiceEntry> = new Map()
  private platformExcluded: Set<string> = new Set()

  private constructor() {}

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
   * Register a service
   * @param target - Service class constructor
   */
  public register<T>(target: ServiceConstructor<T>): void {
    const name = getServiceName(target)

    if (this.services.has(name)) {
      logger.warn(`Service '${name}' is already registered, skipping`)
      return
    }

    // Check platform exclusion before registering
    const excludePlatforms = getExcludePlatforms(target)
    if (excludePlatforms && matchesPlatformTarget(excludePlatforms)) {
      this.platformExcluded.add(name)
      logger.info(`Service '${name}' excluded on platform ${process.platform}/${process.arch}`)
      return
    }

    const metadata: ServiceMetadata = {
      name,
      dependencies: getDependencies(target),
      priority: getPriority(target),
      errorStrategy: getErrorStrategy(target),
      phase: getPhase(target),
      excludePlatforms
    }

    const entry: ServiceEntry<T> = {
      token: name,
      provider: {
        useClass: target,
        metadata
      }
    }

    this.services.set(name, entry)
    logger.debug(`Registered service: ${name}`)
  }

  /**
   * Get or create a service instance (all services are singletons)
   * @param token - Service token (name or constructor)
   * @returns Service instance
   */
  public get<T>(token: ServiceToken<T>): T {
    const name = typeof token === 'string' ? token : getServiceName(token)
    const entry = this.services.get(name)

    if (!entry) {
      throw new Error(`[ServiceContainer] Service '${name}' not found`)
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
  public getInstance<T>(token: ServiceToken<T>): T | undefined {
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
   * Check if a service was excluded due to platform constraints
   * @param name - Service name
   */
  public isPlatformExcluded(name: string): boolean {
    return this.platformExcluded.has(name)
  }

  /**
   * Remove services whose dependencies were platform-excluded (transitive exclusion).
   * Iterates until no new exclusions are found to handle multi-layer dependency chains.
   */
  public excludeDependentsOfExcluded(): void {
    let changed = true
    while (changed) {
      changed = false
      for (const [name, entry] of this.services) {
        const excludedDep = entry.provider.metadata.dependencies.find((dep) => this.platformExcluded.has(dep))
        if (excludedDep) {
          this.services.delete(name)
          this.platformExcluded.add(name)
          logger.warn(`Service '${name}' transitively excluded: depends on platform-excluded '${excludedDep}'`)
          changed = true
        }
      }
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
