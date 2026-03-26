import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'

import { DependencyResolver } from './DependencyResolver'
import { ServiceContainer } from './ServiceContainer'
import {
  isPausable,
  type LifecycleEvent,
  type LifecycleEventPayload,
  LifecycleEvents,
  LifecycleState,
  Phase,
  ServiceInitError
} from './types'

const logger = loggerService.withContext('LifecycleManager')

/**
 * LifecycleManager
 * Manages the lifecycle of all registered services
 * Handles initialization order, state transitions, and events
 */
export class LifecycleManager extends EventEmitter {
  private static instance: LifecycleManager | null = null
  private container: ServiceContainer
  private resolver: DependencyResolver
  private initializationOrder: string[] = []
  private phaseInitializationOrder: Map<Phase, string[][]> = new Map()
  private initialized = false
  private phasesValidated = false

  /** Tracks services that were paused due to cascade from another service */
  private pausedByCascade: Map<string, Set<string>> = new Map()
  /** Tracks services that were stopped due to cascade from another service */
  private stoppedByCascade: Map<string, Set<string>> = new Map()

  private constructor() {
    super()
    this.container = ServiceContainer.getInstance()
    this.resolver = new DependencyResolver()
  }

  /**
   * Get the LifecycleManager singleton instance
   */
  public static getInstance(): LifecycleManager {
    if (!LifecycleManager.instance) {
      LifecycleManager.instance = new LifecycleManager()
    }
    return LifecycleManager.instance
  }

  /**
   * Reset the manager (mainly for testing)
   */
  public static reset(): void {
    LifecycleManager.instance = null
  }

  /**
   * Validate and adjust service phases based on dependencies
   * Should be called before starting any phase
   */
  public validateAndAdjustPhases(): void {
    if (this.phasesValidated) return

    const graph = this.container.buildDependencyGraph()
    const adjustments = this.resolver.validateAndAdjustPhases(graph)

    // Apply adjustments to container
    for (const adj of adjustments) {
      this.container.updatePhase(adj.serviceName, adj.adjustedPhase)
    }

    this.phasesValidated = true
  }

  /**
   * Start services for a specific phase
   * Services within the same layer (no inter-dependencies) are started in parallel
   * @param phase - The bootstrap phase to start
   */
  public async startPhase(phase: Phase): Promise<void> {
    // Ensure phases are validated
    this.validateAndAdjustPhases()

    const graph = this.container.buildDependencyGraph(phase)
    if (graph.length === 0) {
      logger.debug(`No services registered for phase: ${phase}`)
      return
    }

    const layers = this.resolver.resolveLayered(graph)
    this.phaseInitializationOrder.set(phase, layers)

    // Log initialization order for this phase
    const orderStr = layers.map((layer) => `[${layer.join(', ')}]`).join(' -> ')
    logger.info(`[${phase}] Initialization order: ${orderStr}`)

    // Initialize services layer by layer, parallel within each layer
    for (const layer of layers) {
      const results = await Promise.allSettled(layer.map((serviceName) => this.initializeService(serviceName)))
      for (const result of results) {
        if (result.status === 'rejected') {
          // Re-throw to preserve fail-fast semantics.
          // Graceful services won't reject (handleError doesn't throw for them).
          throw result.reason
        }
      }
    }

    // Track overall initialization order
    for (const layer of layers) {
      this.initializationOrder.push(...layer)
    }

    logger.info(`[${phase}] All services started`)

    // Mark as initialized when WhenReady phase completes
    if (phase === Phase.WhenReady) {
      this.initialized = true
    }
  }

  /**
   * Start all registered services in dependency order
   * @deprecated Use startPhase() for phased initialization
   */
  public async startAll(): Promise<void> {
    if (this.initialized) {
      logger.warn('Services already initialized')
      return
    }

    logger.info('Starting all services...')

    // Validate phases first
    this.validateAndAdjustPhases()

    // Build dependency graph and resolve order
    const graph = this.container.buildDependencyGraph()
    const layers = this.resolver.resolveLayered(graph)

    // Log initialization order
    const orderStr = layers.map((layer) => `[${layer.join(', ')}]`).join(' -> ')
    logger.info(`Initialization order: ${orderStr}`)

    // Initialize services layer by layer, parallel within each layer
    for (const layer of layers) {
      const results = await Promise.allSettled(layer.map((serviceName) => this.initializeService(serviceName)))
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason
        }
      }
      this.initializationOrder.push(...layer)
    }

    this.initialized = true
    logger.info('All services started successfully')
  }

  /**
   * Stop all services in reverse initialization order
   */
  public async stopAll(): Promise<void> {
    if (!this.initialized) {
      logger.warn('Services not initialized')
      return
    }

    logger.info('Stopping all services...')

    // Stop in reverse order
    const stopOrder = [...this.initializationOrder].reverse()

    for (const serviceName of stopOrder) {
      await this.stopSingle(serviceName)
    }

    logger.info('All services stopped')
  }

  /**
   * Destroy all services and release resources
   */
  public async destroyAll(): Promise<void> {
    logger.info('Destroying all services...')

    // Destroy in reverse order
    const destroyOrder = [...this.initializationOrder].reverse()

    for (const serviceName of destroyOrder) {
      await this.destroyService(serviceName)
    }

    this.initialized = false
    this.initializationOrder = []
    this.pausedByCascade.clear()
    this.stoppedByCascade.clear()
    logger.info('All services destroyed')
  }

  /**
   * Initialize a single service
   */
  private async initializeService(serviceName: string): Promise<void> {
    const metadata = this.container.getMetadata(serviceName)
    if (!metadata) return

    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_INITIALIZING, serviceName, LifecycleState.Initializing)

      // Get or create instance
      const instance = this.container.get(serviceName)

      // Call initialization
      await instance._doInit()

      this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, serviceName, LifecycleState.Ready)
      logger.debug(`Service '${serviceName}' is ready`)
    } catch (error) {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, serviceName, LifecycleState.Stopped, error as Error)
      this.handleError(serviceName, error as Error, metadata.errorStrategy)
    }
  }

  /**
   * Stop a single service (no cascade).
   * Internal method used by stopAll and stop.
   * @param serviceName - Service name to stop
   */
  private async stopSingle(serviceName: string): Promise<void> {
    const instance = this.container.getInstance(serviceName)
    if (!instance || instance.state === LifecycleState.Stopped) return

    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_STOPPING, serviceName, LifecycleState.Stopping)
      await instance._doStop()
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_STOPPED, serviceName, LifecycleState.Stopped)
      logger.debug(`Service '${serviceName}' stopped`)
    } catch (error) {
      logger.error(`Error stopping service '${serviceName}':`, error as Error)
    }
  }

  /**
   * Destroy a single service
   */
  private async destroyService(serviceName: string): Promise<void> {
    const instance = this.container.getInstance(serviceName)
    if (!instance || instance.state === LifecycleState.Destroyed) return

    try {
      await instance._doDestroy()
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_DESTROYED, serviceName, LifecycleState.Destroyed)
      logger.debug(`Service '${serviceName}' destroyed`)
    } catch (error) {
      logger.error(`Error destroying service '${serviceName}':`, error as Error)
    }

    // Clean cascade tracking maps
    this.pausedByCascade.delete(serviceName)
    this.stoppedByCascade.delete(serviceName)
    for (const [, set] of this.pausedByCascade) {
      set.delete(serviceName)
    }
    for (const [, set] of this.stoppedByCascade) {
      set.delete(serviceName)
    }
  }

  /**
   * Handle service initialization error based on strategy
   */
  private handleError(serviceName: string, error: Error, strategy: 'fail-fast' | 'graceful' | 'custom'): void {
    logger.error(`Service '${serviceName}' initialization failed:`, error)

    switch (strategy) {
      case 'fail-fast':
        throw new ServiceInitError(serviceName, error)
      case 'graceful':
        logger.warn(`Continuing despite error in '${serviceName}'`)
        break
      case 'custom':
        // Custom handling delegated to error event listeners
        break
    }
  }

  /**
   * Emit a lifecycle event
   */
  private emitLifecycleEvent(event: LifecycleEvent, name: string, state: LifecycleState, error?: Error): void {
    const payload: LifecycleEventPayload = { name, state, error }
    this.emit(event, payload)
  }

  /**
   * Get service initialization order
   */
  public getInitializationOrder(): string[] {
    return [...this.initializationOrder]
  }

  /**
   * Check if services are initialized
   */
  public isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Notify all initialized services that the entire system is ready.
   * Calls _doAllReady() on every service in initializationOrder in parallel.
   * Errors are logged and emitted as SERVICE_ERROR but never propagate —
   * onAllReady is a post-bootstrap supplement, not a critical initialization gate.
   * Emits ALL_SERVICES_READY after all hooks complete.
   */
  public async allReady(): Promise<void> {
    const results = await Promise.allSettled(
      this.initializationOrder.map(async (serviceName) => {
        const instance = this.container.getInstance(serviceName)
        if (!instance) return
        await instance._doAllReady()
      })
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const serviceName = this.initializationOrder[i]
        const error = result.reason as Error
        logger.error(`Service '${serviceName}' onAllReady failed:`, error)
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, serviceName, LifecycleState.Ready, error)
      }
    }

    this.emit(LifecycleEvents.ALL_SERVICES_READY)
  }

  // ============================================================================
  // Pause/Resume/Stop/Start/Restart Operations
  // ============================================================================

  /**
   * Pause a service and all services that depend on it (cascade).
   * Before pausing, validates that all services in the cascade chain implement Pausable.
   * If any service doesn't support pause, logs error and aborts the operation.
   * @param name - Service name to pause
   */
  public async pause(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot pause: service '${name}' not found`)
      return
    }

    // Check if service is in a valid state for pausing
    if (instance.state !== LifecycleState.Ready) {
      logger.warn(`Cannot pause: service '${name}' is not in Ready state (current: ${instance.state})`)
      return
    }

    // Get all dependents that need to be paused first
    const graph = this.container.buildDependencyGraph()
    const dependents = this.resolver.getDependents(name, graph)
    const allServices = [...dependents, name]

    // Validation phase: check all services in cascade support pause
    for (const serviceName of allServices) {
      const svc = this.container.getInstance(serviceName)
      if (!svc) continue

      // Skip services that are already paused or stopped
      if (svc.state === LifecycleState.Paused || svc.state === LifecycleState.Stopped) {
        continue
      }

      if (!isPausable(svc)) {
        logger.error(
          `Cannot pause '${name}': dependent service '${serviceName}' does not implement Pausable. ` +
            `This is a design error - ensure all services in the dependency chain support pause/resume.`
        )
        return
      }
    }

    // Initialize cascade tracking
    this.pausedByCascade.set(name, new Set())

    // Execution phase: pause dependents first (reverse order)
    for (const depName of dependents.reverse()) {
      const depInstance = this.container.getInstance(depName)
      if (!depInstance) continue

      // Skip if already paused or stopped
      if (depInstance.state === LifecycleState.Paused || depInstance.state === LifecycleState.Stopped) {
        continue
      }

      await this.pauseSingle(depName)
      this.pausedByCascade.get(name)!.add(depName)
    }

    // Finally pause the target service
    await this.pauseSingle(name)
    logger.info(`Service '${name}' paused (cascaded: ${dependents.length} dependents)`)
  }

  /**
   * Resume a service and all services that were cascaded paused.
   * @param name - Service name to resume
   */
  public async resume(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot resume: service '${name}' not found`)
      return
    }

    // Check if service is in a valid state for resuming
    if (instance.state !== LifecycleState.Paused) {
      logger.warn(`Cannot resume: service '${name}' is not in Paused state (current: ${instance.state})`)
      return
    }

    const cascadedServices = this.pausedByCascade.get(name) ?? new Set()
    const allServices = [name, ...cascadedServices]

    // Validation phase: check all services support resume
    for (const serviceName of allServices) {
      const svc = this.container.getInstance(serviceName)
      if (!svc) continue

      // Only check services that are paused
      if (svc.state !== LifecycleState.Paused) {
        continue
      }

      if (!isPausable(svc)) {
        logger.error(`Cannot resume '${serviceName}': service does not implement Pausable.`)
        return
      }
    }

    // Resume the target service first
    await this.resumeSingle(name)

    // Then resume cascaded services in reverse order
    for (const depName of [...cascadedServices].reverse()) {
      const depInstance = this.container.getInstance(depName)
      if (!depInstance || depInstance.state !== LifecycleState.Paused) continue

      await this.resumeSingle(depName)
    }

    this.pausedByCascade.delete(name)
    logger.info(`Service '${name}' resumed (cascaded: ${cascadedServices.size} dependents)`)
  }

  /**
   * Stop a service and all services that depend on it (cascade).
   * All services support stop by default (no Pausable check needed).
   * @param name - Service name to stop
   */
  public async stop(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot stop: service '${name}' not found`)
      return
    }

    // Check if service is in a valid state for stopping
    if (instance.state !== LifecycleState.Ready && instance.state !== LifecycleState.Paused) {
      logger.warn(`Cannot stop: service '${name}' is not in Ready or Paused state (current: ${instance.state})`)
      return
    }

    // Get all dependents that need to be stopped first
    const graph = this.container.buildDependencyGraph()
    const dependents = this.resolver.getDependents(name, graph)

    // Initialize cascade tracking
    this.stoppedByCascade.set(name, new Set())

    // Stop dependents first (reverse order)
    for (const depName of dependents.reverse()) {
      const depInstance = this.container.getInstance(depName)
      if (!depInstance) continue

      // Skip if already stopped
      if (depInstance.state === LifecycleState.Stopped || depInstance.state === LifecycleState.Destroyed) {
        continue
      }

      await this.stopSingle(depName)
      this.stoppedByCascade.get(name)!.add(depName)
    }

    // Finally stop the target service
    await this.stopSingle(name)
    logger.info(`Service '${name}' stopped (cascaded: ${dependents.length} dependents)`)
  }

  /**
   * Start a service from Stopped state by re-initializing it.
   * Also starts any services that were cascade-stopped and their dependencies.
   * @param name - Service name to start
   */
  public async start(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot start: service '${name}' not found`)
      return
    }

    // Check if service is in Stopped state
    if (instance.state !== LifecycleState.Stopped) {
      logger.warn(`Cannot start: service '${name}' is not in Stopped state (current: ${instance.state})`)
      return
    }

    // First, ensure all dependencies are ready
    const graph = this.container.buildDependencyGraph()
    const dependencies = this.resolver.getDependencies(name, graph)

    for (const depName of dependencies) {
      const depInstance = this.container.getInstance(depName)
      if (!depInstance) continue

      // If dependency is stopped, start it first
      if (depInstance.state === LifecycleState.Stopped) {
        await this.start(depName) // Recursive start
      }
    }

    // Re-initialize the service (calls _doInit)
    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_INITIALIZING, name, LifecycleState.Initializing)
      await instance._doInit()
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, name, LifecycleState.Ready)
      logger.debug(`Service '${name}' started`)
    } catch (error) {
      const metadata = this.container.getMetadata(name)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, name, LifecycleState.Stopped, error as Error)
      if (metadata) {
        this.handleError(name, error as Error, metadata.errorStrategy)
      }
      return
    }

    // Now start any services that were cascade-stopped
    const cascadedServices = this.stoppedByCascade.get(name) ?? new Set()
    for (const depName of [...cascadedServices].reverse()) {
      const depInstance = this.container.getInstance(depName)
      if (!depInstance || depInstance.state !== LifecycleState.Stopped) continue

      try {
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_INITIALIZING, depName, LifecycleState.Initializing)
        await depInstance._doInit()
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, depName, LifecycleState.Ready)
        logger.debug(`Service '${depName}' started (cascade)`)
      } catch (error) {
        const metadata = this.container.getMetadata(depName)
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, depName, LifecycleState.Stopped, error as Error)
        if (metadata) {
          this.handleError(depName, error as Error, metadata.errorStrategy)
        }
      }
    }

    this.stoppedByCascade.delete(name)
    logger.info(`Service '${name}' started (cascaded: ${cascadedServices.size} dependents)`)
  }

  /**
   * Restart a service (stop + start).
   * @param name - Service name to restart
   */
  public async restart(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot restart: service '${name}' not found`)
      return
    }

    // If already stopped, just start
    if (instance.state === LifecycleState.Stopped) {
      await this.start(name)
      return
    }

    // Check if in a restartable state
    if (instance.state !== LifecycleState.Ready && instance.state !== LifecycleState.Paused) {
      logger.warn(`Cannot restart: service '${name}' is not in Ready or Paused state (current: ${instance.state})`)
      return
    }

    logger.info(`Restarting service '${name}'...`)
    await this.stop(name)
    await this.start(name)
    logger.info(`Service '${name}' restarted`)
  }

  /**
   * Pause a single service (no cascade).
   * Internal method used by pause.
   * @param serviceName - Service name to pause
   */
  private async pauseSingle(serviceName: string): Promise<void> {
    const instance = this.container.getInstance(serviceName)
    if (!instance || instance.state === LifecycleState.Paused) return

    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_PAUSING, serviceName, LifecycleState.Pausing)
      const success = await instance._doPause()
      if (success) {
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_PAUSED, serviceName, LifecycleState.Paused)
        logger.debug(`Service '${serviceName}' paused`)
      }
    } catch (error) {
      logger.error(`Error pausing service '${serviceName}':`, error as Error)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, serviceName, instance.state, error as Error)
    }
  }

  /**
   * Resume a single service (no cascade).
   * Internal method used by resume.
   * @param serviceName - Service name to resume
   */
  private async resumeSingle(serviceName: string): Promise<void> {
    const instance = this.container.getInstance(serviceName)
    if (!instance || instance.state !== LifecycleState.Paused) return

    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_RESUMING, serviceName, LifecycleState.Resuming)
      const success = await instance._doResume()
      if (success) {
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_RESUMED, serviceName, LifecycleState.Ready)
        logger.debug(`Service '${serviceName}' resumed`)
      }
    } catch (error) {
      logger.error(`Error resuming service '${serviceName}':`, error as Error)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, serviceName, instance.state, error as Error)
    }
  }
}
