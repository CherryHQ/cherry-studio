import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isPortable, isWin } from '@main/constant'
import { bootConfigService } from '@main/data/bootConfig'
import { IpcChannel } from '@shared/IpcChannel'
import { app, dialog, ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import type { Disposable } from '../lifecycle/event'
import { LifecycleManager } from '../lifecycle/LifecycleManager'
import { ServiceContainer } from '../lifecycle/ServiceContainer'
import { Phase, type ServiceConstructor, ServiceInitError } from '../lifecycle/types'
import type { ServiceRegistry } from './serviceRegistry'

const logger = loggerService.withContext('Lifecycle')

/** Hold with opaque ID for cross-process identification */
interface QuitPreventionHold extends Disposable {
  readonly id: string
}

/**
 * Application
 * Main application class that orchestrates the entire application lifecycle
 * Manages services, windows, and Electron app events
 */
export class Application {
  private static readonly SHUTDOWN_TIMEOUT_MS = 5000

  private static instance: Application | null = null
  private container: ServiceContainer
  private lifecycleManager: LifecycleManager
  private isBootstrapped = false
  private isShuttingDown = false
  private _isQuitting = false
  private quitPreventionHolds = new Map<string, string>()
  private ipcQuitHolds = new Map<string, QuitPreventionHold>()

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

    // Register signal and quit handlers FIRST, before anything else,
    // so Ctrl+C and app quit are handled even during early bootstrap stages
    this.setupSignalHandlers()
    this.setupQuitHandlers()

    logger.info('Bootstrapping...')

    // Log registration summary
    const regSummary = this.container.getRegistrationSummary()
    logger.info(`Registered ${regSummary.total} services (${regSummary.excluded} excluded)`)

    // Check for boot config corruption BEFORE starting any services
    if (bootConfigService.hasLoadError()) {
      await this.handleBootConfigError()
      // If we reach here, user chose "Continue with Defaults"
    }

    const bootstrapStart = performance.now()

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

    const totalDuration = performance.now() - bootstrapStart
    logger.info(`Bootstrap complete (${totalDuration.toFixed(3)}ms)`)
    logger.debug(`\n${this.lifecycleManager.getBootstrapSummary(totalDuration, regSummary.excluded)}`)
  }

  /**
   * Shutdown the application.
   * Stops and destroys all lifecycle-managed services gracefully.
   * Also handles legacy service cleanup (bootConfig, logger).
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Already shutting down')
      return
    }

    this.isShuttingDown = true
    this._isQuitting = true
    logger.info('Shutting down...')

    const start = performance.now()

    // Flush boot config first (save pending debounced writes)
    try {
      bootConfigService.flush()
    } catch (e) {
      logger.warn('bootConfig flush error:', e as Error)
    }

    // Stop all lifecycle-managed services (reverse init order)
    await this.lifecycleManager.stopAll()

    // Destroy all lifecycle-managed services
    await this.lifecycleManager.destroyAll()

    logger.info(`Shutdown complete (${(performance.now() - start).toFixed(3)}ms)`)

    // Close logger LAST — after this point, no more logging
    loggerService.finish()
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
      this.forceExit(1)
      return
    }

    logger.info(`User chose to restart after ${error.serviceName} initialization failure`)
    this.relaunch()
  }

  /**
   * Handle boot config load error by showing a dialog before any services start.
   * For parse errors: offer reset (delete corrupted file) + restart.
   * For read errors: offer restart (file may be temporarily inaccessible).
   */
  private async handleBootConfigError(): Promise<void> {
    const loadError = bootConfigService.getLoadError()!
    logger.warn(`Boot config load error: ${loadError.type} - ${loadError.message}`)

    await app.whenReady()

    const isParseError = loadError.type === 'parse_error'

    const result = await dialog.showMessageBox({
      type: 'warning',
      title: isParseError ? 'Configuration File Corrupted' : 'Configuration File Read Error',
      message: isParseError
        ? 'The configuration file (boot-config.json) contains invalid data.'
        : 'The configuration file (boot-config.json) could not be read.',
      detail: `Error: ${loadError.message}\n\nThe application can continue with default settings, or you can ${isParseError ? 'reset the file and restart' : 'restart to try again'}.\n\n${isParseError ? `"Reset and Restart" will delete the corrupted file. Other options preserve it for manual inspection at:\n${loadError.filePath}` : `The file will be preserved for manual inspection at:\n${loadError.filePath}`}`,
      buttons: ['Continue with Defaults', isParseError ? 'Reset and Restart' : 'Restart', 'Exit'],
      defaultId: 0,
      cancelId: 2
    })

    if (result.response === 1) {
      if (isParseError) {
        bootConfigService.reset()
      }
      logger.info(`User chose to ${isParseError ? 'reset and restart' : 'restart'} after boot config error`)
      this.relaunch()
      return
    }

    if (result.response === 2) {
      logger.info('User chose to exit after boot config error')
      this.forceExit(1)
      return
    }

    logger.info('User chose to continue with defaults after boot config error')
    bootConfigService.clearLoadError()
  }

  /**
   * Relaunch the app, with dev mode warning
   */
  public relaunch(options?: Electron.RelaunchOptions): void {
    if (isDev || !app.isPackaged) {
      logger.warn('Relaunch is not supported in dev mode. Please restart manually.')
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Manual Restart Required',
        message: 'Auto-relaunch is not available in development mode.',
        detail: 'The app will now exit. Please run `pnpm dev` again to restart.',
        buttons: ['OK']
      })
      app.exit(0)
      return
    }

    // Platform-specific fixes
    if (isLinux && process.env.APPIMAGE) {
      options = options || {}
      options.execPath = process.env.APPIMAGE
      options.args = options.args || []
      options.args.unshift('--appimage-extract-and-run')
    }

    if (isWin && isPortable) {
      options = options || {}
      options.execPath = process.env.PORTABLE_EXECUTABLE_FILE
      options.args = options.args || []
    }

    app.relaunch(options)
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
      const timer = setTimeout(forceExit, Application.SHUTDOWN_TIMEOUT_MS)
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
      const timer = setTimeout(forceExit, Application.SHUTDOWN_TIMEOUT_MS)
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
   * Setup quit event handlers (before-quit + will-quit).
   * Called at the start of bootstrap(), alongside setupSignalHandlers(),
   * so quit is handled correctly even during early bootstrap stages.
   */
  private setupQuitHandlers(): void {
    // before-quit: gate check + mark quitting. Does NOT preventDefault unless blocking.
    app.on('before-quit', (event) => {
      if (!this.canQuit()) {
        event.preventDefault()
        this._isQuitting = false // Reset — quit was blocked, not actually quitting
        const reasons = [...this.quitPreventionHolds.values()].join(', ')
        logger.info(`Quit prevented: ${reasons}`)
        return
      }
      this._isQuitting = true
    })

    // will-quit: all windows closed, perform actual cleanup
    app.on('will-quit', (event) => {
      if (this.isShuttingDown) return // Already shutting down (SIGINT/SIGTERM path), let it exit

      event.preventDefault()

      const timer = setTimeout(() => {
        logger.warn('Forced exit after shutdown timeout (will-quit)')
        process.exit(1)
      }, Application.SHUTDOWN_TIMEOUT_MS)

      this.shutdown()
        .catch((err) => logger.error('Error during shutdown:', err as Error))
        .finally(() => {
          clearTimeout(timer)
          app.exit(0)
        })
    })
  }

  /**
   * Setup Electron app event handlers that require app.whenReady().
   */
  private setupElectronHandlers(): void {
    // Non-macOS: quit through standard before-quit → will-quit flow when all windows close
    app.on('window-all-closed', () => {
      if (!isMac) {
        this.quit()
      }
    })

    // Register Application-scoped IPC handlers (quit, relaunch, preventQuit)
    this.registerApplicationIpc()
  }

  /**
   * Register IPC handlers for the Application_* scope.
   * All application lifecycle operations exposed to renderer live here.
   */
  private registerApplicationIpc(): void {
    ipcMain.handle(IpcChannel.Application_Quit, () => this.quit())

    ipcMain.handle(IpcChannel.Application_Relaunch, (_, options?: Electron.RelaunchOptions) => {
      this.relaunch(options)
    })

    ipcMain.handle(IpcChannel.Application_PreventQuit, (_, reason: string): string => {
      const hold = this.preventQuit(reason)
      this.ipcQuitHolds.set(hold.id, hold)
      return hold.id
    })

    ipcMain.handle(IpcChannel.Application_AllowQuit, (_, holdId: string) => {
      const hold = this.ipcQuitHolds.get(holdId)
      if (hold) {
        hold.dispose()
        this.ipcQuitHolds.delete(holdId)
      }
    })
  }

  /**
   * Get a service instance by registry key (type-safe).
   * Throws if the service is conditional — use getOptional() for conditional services.
   * @param name - Service name from ServiceRegistry
   */
  public get<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K] {
    return this.container.get(name)
  }

  /**
   * Get an optional (conditional) service instance by registry key.
   * Returns undefined if the service was excluded by @Conditional conditions.
   * Throws if the service is NOT conditional — use get() for unconditional services.
   * @param name - Service name from ServiceRegistry
   */
  public getOptional<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K] | undefined {
    return this.container.getOptional(name)
  }

  /**
   * Check if application is bootstrapped
   */
  public isReady(): boolean {
    return this.isBootstrapped
  }

  /**
   * Whether the app is in the process of quitting
   */
  public get isQuitting(): boolean {
    return this._isQuitting
  }

  /**
   * Mark the app as quitting without triggering the quit sequence.
   * Used by autoUpdater.quitAndInstall() which has its own quit flow.
   */
  public markQuitting(): void {
    this._isQuitting = true
  }

  /**
   * Register a quit prevention hold. Returns a hold with opaque UUID id and dispose().
   * While any hold is active, app.quit() will be blocked in before-quit.
   * Used for critical operations (e.g. data migration) where quitting would cause corruption.
   */
  public preventQuit(reason: string): QuitPreventionHold {
    const id = uuidv4()
    this.quitPreventionHolds.set(id, reason)
    logger.info(`Quit prevention hold added: "${reason}" (id: ${id})`)
    return {
      id,
      dispose: () => {
        this.quitPreventionHolds.delete(id)
        logger.info(`Quit prevention hold removed (id: ${id})`)
      }
    }
  }

  private canQuit(): boolean {
    return this.quitPreventionHolds.size === 0
  }

  /**
   * Graceful quit: set flag then trigger the Electron quit event chain.
   * before-quit checks preventQuit holds, then will-quit runs shutdown().
   */
  public quit(): void {
    if (this._isQuitting) {
      logger.warn('Already quitting')
      return
    }
    logger.info('Quitting application...')
    this._isQuitting = true
    app.quit()
  }

  /**
   * Force exit: skip the Electron event chain entirely.
   * For fatal/unrecoverable errors (service init failure, repeated renderer crash).
   */
  public forceExit(code: number): void {
    this._isQuitting = true
    logger.warn(`Force exiting application with code ${code}`)
    app.exit(code)
  }

  // ============================================================================
  // Service Lifecycle Control API
  // ============================================================================

  /**
   * Pause a service and all services that depend on it.
   * The service must implement the Pausable interface (onPause/onResume methods).
   * @param name - Service name from ServiceRegistry
   */
  public async pause<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.pause(name)
  }

  /**
   * Resume a paused service and all services that were cascade-paused.
   * The service must implement the Pausable interface.
   * @param name - Service name from ServiceRegistry
   */
  public async resume<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.resume(name)
  }

  /**
   * Stop a service and all services that depend on it.
   * All services support stop (no special interface needed).
   * @param name - Service name from ServiceRegistry
   */
  public async stop<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.stop(name)
  }

  /**
   * Start a stopped service by re-initializing it.
   * Also starts any services that were cascade-stopped.
   * @param name - Service name from ServiceRegistry
   */
  public async start<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.start(name)
  }

  /**
   * Restart a service (stop + start).
   * Convenience method that combines stop and start operations.
   * @param name - Service name from ServiceRegistry
   */
  public async restart<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.restart(name)
  }

  /**
   * Activate a service's heavy resources.
   * The service must implement Activatable (onActivate/onDeactivate).
   * No cascade — activation is service-specific.
   * @param name - Service name from ServiceRegistry
   */
  public async activate<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.activate(name)
  }

  /**
   * Deactivate a service, releasing heavy resources.
   * The service must implement Activatable.
   * No cascade — deactivation is service-specific.
   * @param name - Service name from ServiceRegistry
   */
  public async deactivate<K extends keyof ServiceRegistry>(name: K): Promise<void> {
    return this.lifecycleManager.deactivate(name)
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
