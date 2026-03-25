import { loggerService } from '@logger'
import { isDev, isMac } from '@main/constant'
import { app, dialog } from 'electron'

import { LifecycleManager } from '../lifecycle/LifecycleManager'
import { ServiceContainer } from '../lifecycle/ServiceContainer'
import { LifecycleEvents, Phase, type ServiceConstructor, ServiceInitError } from '../lifecycle/types'
import type { ServiceRegistry } from './serviceRegistry'

const logger = loggerService.withContext('Application')

/**
 * Application
 * Main application class that orchestrates the entire application lifecycle
 * Manages services, windows, and Electron app events
 */
export class Application {
  private static instance: Application | null = null
  private container: ServiceContainer
  private lifecycleManager: LifecycleManager
  private isBootstrapped = false
  private isShuttingDown = false

  private constructor() {
    this.container = ServiceContainer.getInstance()
    this.lifecycleManager = LifecycleManager.getInstance()
  }

  /**
   * Get the Application singleton instance
   */
  public static getInstance(): Application {
    if (!Application.instance) {
      Application.instance = new Application()
    }
    return Application.instance
  }

  /**
   * Get the service container
   */
  public getContainer(): ServiceContainer {
    return this.container
  }

  /**
   * Get the lifecycle manager
   */
  public getLifecycleManager(): LifecycleManager {
    return this.lifecycleManager
  }

  /**
   * Register a service with the container
   * @param service - Service class constructor
   */
  public register<T>(service: ServiceConstructor<T>): this {
    this.container.register(service)
    return this
  }

  /**
   * Register multiple services
   * @param services - Array of service class constructors
   */
  public registerAll(services: ServiceConstructor[]): this {
    for (const service of services) {
      this.container.register(service)
    }
    this.container.excludeDependentsOfExcluded()
    return this
  }

  /**
   * Bootstrap the application
   * Initializes services in three phases with maximum parallelization:
   * 1. Background: fire-and-forget, independent services
   * 2. BeforeReady: services that don't need Electron API (parallel with app.whenReady)
   * 3. WhenReady: services that require Electron API
   */
  public async bootstrap(): Promise<void> {
    if (this.isBootstrapped) {
      logger.warn('Already bootstrapped')
      return
    }

    // Register signal handlers FIRST, before anything else,
    // so Ctrl+C is handled even during early bootstrap stages
    this.setupSignalHandlers()

    logger.info('Bootstrapping...')

    // Validate and adjust phases before starting
    this.lifecycleManager.validateAndAdjustPhases()

    try {
      // 1. Background phase - fire-and-forget, does not block BeforeReady/WhenReady
      const backgroundPromise = this.lifecycleManager.startPhase(Phase.Background)

      // 2. BeforeReady phase and app.whenReady() in parallel
      await Promise.all([this.lifecycleManager.startPhase(Phase.BeforeReady), app.whenReady()])

      // Setup Electron event handlers after app is ready
      this.setupElectronHandlers()

      // 3. WhenReady phase - services requiring Electron API
      await this.lifecycleManager.startPhase(Phase.WhenReady)

      this.isBootstrapped = true

      // 4. Wait for Background to finish, then notify all services
      await backgroundPromise.catch((err) => {
        logger.error('Background phase failed:', err)
      })
      await this.lifecycleManager.allReady()
    } catch (error) {
      if (error instanceof ServiceInitError) {
        await this.handleFatalServiceError(error)
        return
      }
      throw error
    }

    logger.info('Bootstrap complete')
  }

  /**
   * Shutdown the application
   * Stops and destroys all services gracefully
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Already shutting down')
      return
    }

    this.isShuttingDown = true
    logger.info('Shutting down...')

    // Stop all services
    await this.lifecycleManager.stopAll()

    // Destroy all services
    await this.lifecycleManager.destroyAll()

    logger.info('Shutdown complete')
  }

  /**
   * Handle fatal service initialization error by showing a dialog.
   * Called when a fail-fast service fails to initialize.
   */
  private async handleFatalServiceError(error: ServiceInitError): Promise<void> {
    logger.error(`Fatal service initialization error: ${error.serviceName}`, error.cause)

    // Ensure Electron dialog API is available (BeforeReady phase may fail before app is ready)
    await app.whenReady()

    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Unable to Start',
      message: `Cherry Studio could not start because ${error.serviceName} failed to initialize.`,
      detail:
        'Try restarting the application. If the problem persists, check the application logs for detailed error information.',
      buttons: ['Exit', 'Restart'],
      defaultId: 1,
      cancelId: 0
    })

    if (result.response === 0) {
      logger.info(`User chose to exit due to ${error.serviceName} initialization failure`)
      app.exit(1)
      return
    }

    logger.info(`User chose to restart after ${error.serviceName} initialization failure`)
    this.relaunchApp()
  }

  /**
   * Relaunch the app, with dev mode warning
   */
  private relaunchApp(): void {
    if (isDev) {
      logger.warn('Relaunch is not supported in dev mode. Please restart manually.')
      app.exit(0)
      return
    }
    app.relaunch()
    app.exit(0)
  }

  /**
   * Setup process signal handlers for graceful shutdown.
   * Must be called at the very start of bootstrap() so Ctrl+C is handled
   * even before app.whenReady() resolves.
   */
  private setupSignalHandlers(): void {
    const forceExit = (): void => {
      logger.warn('Forced exit after shutdown timeout')
      process.exit(1)
    }

    process.on('SIGINT', async () => {
      const timer = setTimeout(forceExit, 5000)
      try {
        await this.shutdown()
      } catch (error) {
        logger.error('Error during shutdown:', error as Error)
      } finally {
        clearTimeout(timer)
        app.exit(0)
      }
    })

    process.on('SIGTERM', async () => {
      const timer = setTimeout(forceExit, 5000)
      try {
        await this.shutdown()
      } catch (error) {
        logger.error('Error during shutdown:', error as Error)
      } finally {
        clearTimeout(timer)
        app.exit(0)
      }
    })
  }

  /**
   * Setup Electron app event handlers
   */
  private setupElectronHandlers(): void {
    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      this.lifecycleManager.emit(LifecycleEvents.APP_ACTIVATE)
    })

    // All windows closed
    app.on('window-all-closed', () => {
      if (!isMac) {
        void this.shutdown().then(() => app.quit())
      }
    })

    // Before quit - use app.exit() to force quit and avoid re-triggering before-quit event
    app.on('before-quit', (event) => {
      if (!this.isShuttingDown) {
        event.preventDefault()
        this.shutdown()
          .catch((error) => logger.error('Error during shutdown:', error as Error))
          .finally(() => app.exit(0))
      }
    })
  }

  /**
   * Get a service instance by registry key (type-safe)
   * @param name - Service name from ServiceRegistry
   */
  public get<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K] {
    return this.container.get(name)
  }

  /**
   * Check if application is bootstrapped
   */
  public isReady(): boolean {
    return this.isBootstrapped
  }

  // ============================================================================
  // Service Lifecycle Control API
  // ============================================================================

  /**
   * Pause a service and all services that depend on it.
   * The service must implement the Pausable interface (onPause/onResume methods).
   * @param name - Service name from ServiceRegistry
   */
  public async pauseService<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.pause(name)
  }

  /**
   * Resume a paused service and all services that were cascade-paused.
   * The service must implement the Pausable interface.
   * @param name - Service name from ServiceRegistry
   */
  public async resumeService<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.resume(name)
  }

  /**
   * Stop a service and all services that depend on it.
   * All services support stop (no special interface needed).
   * @param name - Service name from ServiceRegistry
   */
  public async stopService<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.stop(name)
  }

  /**
   * Start a stopped service by re-initializing it.
   * Also starts any services that were cascade-stopped.
   * @param name - Service name from ServiceRegistry
   */
  public async startService<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.start(name)
  }

  /**
   * Restart a service (stop + start).
   * Convenience method that combines stop and start operations.
   * @param name - Service name from ServiceRegistry
   */
  public async restartService<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.restart(name)
  }
}

/**
 * Lazily-initialized Application singleton.
 * Safe to import before bootstrap - the instance is created on first access.
 */
export const application: Application = new Proxy({} as Application, {
  get(_target, prop: keyof Application) {
    const instance = Application.getInstance()
    const value = instance[prop]
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(instance)
    }
    return value
  }
})
