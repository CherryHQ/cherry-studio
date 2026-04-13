import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'

import { DependencyResolver, type PhaseAdjustment } from './DependencyResolver'
import { ServiceContainer } from './ServiceContainer'
import {
  isActivatable,
  isPausable,
  type LifecycleEvent,
  type LifecycleEventPayload,
  LifecycleEvents,
  LifecycleState,
  Phase,
  ServiceInitError
} from './types'

const logger = loggerService.withContext('Lifecycle')

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

  /** Per-service initialization timing in milliseconds */
  private serviceTiming: Map<string, number> = new Map()
  /** Per-service phase mapping */
  private servicePhase: Map<string, Phase> = new Map()
  /** Per-phase timing and service count */
  private phaseTiming: Map<Phase, { duration: number; serviceCount: number }> = new Map()
  /** Phase adjustments captured from validateAndAdjustPhases */
  private phaseAdjustments: PhaseAdjustment[] = []

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

    this.phaseAdjustments = adjustments
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

    const serviceCount = layers.flat().length
    const orderStr = layers.map((layer) => `[${layer.join(', ')}]`).join(' -> ')
    logger.info(`─── ${phase} start (${serviceCount} services) ─── ${orderStr}`)

    const phaseStart = performance.now()

    // Initialize services layer by layer, parallel within each layer
    for (const layer of layers) {
      for (const serviceName of layer) {
        this.servicePhase.set(serviceName, phase)
      }
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

    const phaseDuration = performance.now() - phaseStart
    this.phaseTiming.set(phase, { duration: phaseDuration, serviceCount })
    logger.info(`─── ${phase} complete (${phaseDuration.toFixed(3)}ms) ───`)

    // Mark as initialized when WhenReady phase completes
    if (phase === Phase.WhenReady) {
      this.initialized = true
    }
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
    const start = performance.now()

    // Stop in reverse order
    const stopOrder = [...this.initializationOrder].reverse()

    for (const serviceName of stopOrder) {
      await this.stopSingle(serviceName)
    }

    logger.info(`All services stopped (${(performance.now() - start).toFixed(3)}ms)`)
  }

  /**
   * Destroy all services and release resources
   */
  public async destroyAll(): Promise<void> {
    logger.info('Destroying all services...')
    const start = performance.now()

    // Destroy in reverse order
    const destroyOrder = [...this.initializationOrder].reverse()

    for (const serviceName of destroyOrder) {
      await this.destroyService(serviceName)
    }

    this.initialized = false
    this.initializationOrder = []
    this.pausedByCascade.clear()
    this.stoppedByCascade.clear()
    logger.info(`All services destroyed (${(performance.now() - start).toFixed(3)}ms)`)
  }

  /**
   * Initialize a single service
   */
  private async initializeService(serviceName: string): Promise<void> {
    const metadata = this.container.getMetadata(serviceName)
    if (!metadata) return

    try {
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_INITIALIZING, serviceName, LifecycleState.Initializing)

      // Get or create instance — use getOptional() for conditional services
      const instance = metadata.conditions?.length
        ? this.container.getOptional(serviceName)
        : this.container.get(serviceName)

      if (!instance) return

      // Call initialization with timing
      const start = performance.now()
      await instance._doInit()
      const duration = performance.now() - start
      this.serviceTiming.set(serviceName, duration)
      logger.info(`Service '${serviceName}' initialized (${duration.toFixed(3)}ms)`)

      this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, serviceName, LifecycleState.Ready)
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
      const start = performance.now()
      await instance._doStop()
      const duration = performance.now() - start
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_STOPPED, serviceName, LifecycleState.Stopped)
      logger.info(`Service '${serviceName}' stopped (${duration.toFixed(3)}ms)`)
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
      const start = performance.now()
      await instance._doDestroy()
      const duration = performance.now() - start
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_DESTROYED, serviceName, LifecycleState.Destroyed)
      logger.info(`Service '${serviceName}' destroyed (${duration.toFixed(3)}ms)`)
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
   * Generate a formatted bootstrap summary for logging
   * @param totalDuration - Total bootstrap duration in ms
   * @param excludedCount - Number of excluded services
   */
  public getBootstrapSummary(totalDuration: number, excludedCount: number): string {
    const totalServices = this.initializationOrder.length
    const W = 54
    const lines: string[] = []

    const fmt = (ms: number) => ms.toFixed(3) + 'ms'
    const row = (content: string) => `│${content.padEnd(W)}│`
    const sep = (l: string, r: string) => `${l}${'─'.repeat(W)}${r}`

    lines.push(sep('┌', '┐'))
    lines.push(row('                  Bootstrap Summary'.padEnd(W)))
    lines.push(sep('├', '┤'))
    lines.push(row(`  Total: ${totalServices} services in ${fmt(totalDuration)}`))

    // Service list grouped by phase, sorted by duration within each group
    const phaseOrder = [Phase.BeforeReady, Phase.WhenReady, Phase.Background]
    const servicesByPhase = new Map<Phase, [string, number][]>()
    for (const [name, ms] of this.serviceTiming) {
      const phase = this.servicePhase.get(name)
      if (!phase) continue
      let list = servicesByPhase.get(phase)
      if (!list) {
        list = []
        servicesByPhase.set(phase, list)
      }
      list.push([name, ms])
    }

    const excludedByPhase = this.container.getExcludedByPhase()

    for (const phase of phaseOrder) {
      const timing = this.phaseTiming.get(phase)
      const services = servicesByPhase.get(phase)
      const excludedServices = excludedByPhase.get(phase)

      if ((!timing || !services || services.length === 0) && !excludedServices?.length) continue

      lines.push(row(''))
      if (timing && services && services.length > 0) {
        services.sort((a, b) => b[1] - a[1])
        const title = `[${phase}] ${timing.serviceCount} services`
        lines.push(row(`  ${title.padEnd(36)} ${fmt(timing.duration).padStart(12)}`))
        for (const [name, ms] of services) {
          const tags = this.getServiceTags(name)
          lines.push(row(`    ${name.padEnd(32)} ${tags}  ${fmt(ms).padStart(10)}`))
        }
      } else {
        lines.push(row(`  [${phase}]`))
      }

      if (excludedServices && excludedServices.length > 0) {
        for (const name of excludedServices) {
          lines.push(row(`    ${name.padEnd(32)} C   ${'Excluded'.padStart(10)}`))
        }
      }
    }

    // Count tags: initialized services + excluded (which are always Conditional)
    let conditionalCount = excludedCount
    let activatableCount = 0
    for (const name of this.initializationOrder) {
      const tags = this.getServiceTags(name)
      if (tags[0] === 'C') conditionalCount++
      if (tags[1] === 'A') activatableCount++
    }

    lines.push(sep('├', '┤'))
    lines.push(row(`  (C)onditional: ${conditionalCount}  |  (A)ctivatable: ${activatableCount}`))
    lines.push(row(`  Adjustments: ${this.phaseAdjustments.length}  |  Excluded: ${excludedCount}`))
    lines.push(sep('└', '┘'))
    return lines.join('\n')
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
      const start = performance.now()
      await instance._doInit()
      const duration = performance.now() - start
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, name, LifecycleState.Ready)
      logger.info(`Service '${name}' started (${duration.toFixed(3)}ms)`)
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
        const depStart = performance.now()
        await depInstance._doInit()
        const depDuration = performance.now() - depStart
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_READY, depName, LifecycleState.Ready)
        logger.info(`Service '${depName}' started (cascade) (${depDuration.toFixed(3)}ms)`)
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
      const start = performance.now()
      const success = await instance._doPause()
      const duration = performance.now() - start
      if (success) {
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_PAUSED, serviceName, LifecycleState.Paused)
        logger.info(`Service '${serviceName}' paused (${duration.toFixed(3)}ms)`)
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
      const start = performance.now()
      const success = await instance._doResume()
      const duration = performance.now() - start
      if (success) {
        this.emitLifecycleEvent(LifecycleEvents.SERVICE_RESUMED, serviceName, LifecycleState.Ready)
        logger.info(`Service '${serviceName}' resumed (${duration.toFixed(3)}ms)`)
      }
    } catch (error) {
      logger.error(`Error resuming service '${serviceName}':`, error as Error)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, serviceName, instance.state, error as Error)
    }
  }

  /**
   * Build service annotation tags for bootstrap summary display.
   * Fixed 2-char string: position 0 = C (Conditional), position 1 = A (Activatable).
   */
  private getServiceTags(name: string): string {
    const metadata = this.container.getMetadata(name)
    const instance = this.container.getInstance(name)
    const c = metadata?.conditions?.length ? 'C' : ' '
    const a = instance && isActivatable(instance) ? 'A' : ' '
    return c + a
  }

  // ============================================================================
  // Feature Activation Operations
  // ============================================================================

  /**
   * Activate a service's heavy resources.
   * The service must implement Activatable (onActivate/onDeactivate).
   * No cascade — activation is service-specific.
   * @param name - Service name to activate
   */
  public async activate(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot activate: service '${name}' not found`)
      return
    }
    if (instance.state !== LifecycleState.Ready) {
      logger.warn(`Cannot activate: '${name}' not Ready (${instance.state})`)
      return
    }
    if (!isActivatable(instance)) {
      logger.error(`Cannot activate: '${name}' does not implement Activatable`)
      return
    }
    if (instance.isActivated) return

    try {
      await instance._doActivate()
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ACTIVATED, name, LifecycleState.Ready)
    } catch (error) {
      logger.error(`Error activating '${name}':`, error as Error)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, name, LifecycleState.Ready, error as Error)
    }
  }

  /**
   * Deactivate a service, releasing heavy resources.
   * The service must implement Activatable.
   * No cascade — deactivation is service-specific.
   * @param name - Service name to deactivate
   */
  public async deactivate(name: string): Promise<void> {
    const instance = this.container.getInstance(name)
    if (!instance) {
      logger.warn(`Cannot deactivate: service '${name}' not found`)
      return
    }
    if (!isActivatable(instance)) {
      logger.error(`Cannot deactivate: '${name}' does not implement Activatable`)
      return
    }
    if (!instance.isActivated) return
    if (instance.state !== LifecycleState.Ready) {
      logger.warn(`Cannot deactivate: '${name}' not Ready (${instance.state})`)
      return
    }

    try {
      await instance._doDeactivate()
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_DEACTIVATED, name, LifecycleState.Ready)
    } catch (error) {
      logger.error(`Error deactivating '${name}':`, error as Error)
      this.emitLifecycleEvent(LifecycleEvents.SERVICE_ERROR, name, LifecycleState.Ready, error as Error)
    }
  }
}
