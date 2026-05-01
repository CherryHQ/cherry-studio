import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isPortable, isWin } from '@main/constant'
import type { PathKey, PathMap } from '@main/core/paths'
import { buildPathRegistry, shouldAutoEnsure } from '@main/core/paths/pathRegistry'
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

  /**
   * Frozen path registry. `null` until `bootstrap()` is invoked, after
   * which it persists for the entire process lifetime — `shutdown()` does
   * NOT clear it, so `getPath()` remains callable from `onStop()` /
   * `onDestroy()` cleanup paths and from logger/dialog code that runs
   * during shutdown.
   */
  private pathMap: PathMap | null = null

  /**
   * Cache of PathKeys whose directory has already been auto-ensured.
   * Each Cherry-owned key is `mkdirSync`'d at most once per process —
   * subsequent `getPath()` calls hit this Set and return immediately.
   *
   * NOT cleared on shutdown (paths remain valid for cleanup code that
   * runs after `stopAll()`). Cleared by `__setPathMapForTesting()` to
   * allow test isolation.
   */
  private ensuredKeys = new Set<PathKey>()

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
   * Initialize the path registry by building it from current Electron path
   * state and storing it as a frozen snapshot in this Application instance.
   *
   * Timing contract:
   *   - MUST be called AFTER `resolveUserDataLocation()` so that all
   *     `app.setPath('userData', ...)` calls have completed.
   *   - MUST be called BEFORE `bootstrap()` — `bootstrap()` asserts the
   *     registry is initialized and refuses to start otherwise.
   *
   * Naming note: the underlying `buildPathRegistry()` is the constructor
   * that does the actual `Object.freeze()`. This method is the *installer*
   * that places the built registry into the Application instance.
   *
   * Single-call enforced — repeated invocation throws to surface misuse
   * (e.g. accidentally calling it from both main/index.ts and a test).
   * Tests that need a fresh registry should use `__setPathMapForTesting()`
   * instead, which bypasses this guard for test isolation.
   *
   * LoggerService and BootConfigService bypass this registry and read
   * paths directly via `paths/constants.ts` (`LOGS_DIR`, `BOOT_CONFIG_PATH`);
   * one-shot startup pipelines (migration, legacy backup restore) carry
   * their own ad-hoc path logic and do not consume the registry either.
   */
  public initPathRegistry(): void {
    if (this.pathMap !== null) {
      throw new Error('initPathRegistry() called twice — path registry is already initialized')
    }
    this.pathMap = buildPathRegistry()
    logger.debug(`Path registry initialized with ${Object.keys(this.pathMap).length} entries`)
  }

  /**
   * Bootstrap the application
   * Initializes services in three phases with maximum parallelization:
   * 1. Background: fire-and-forget, independent services
   * 2. BeforeReady: services that don't need Electron API (parallel with app.whenReady)
   * 3. WhenReady: services that require Electron API
   *
   * Precondition: `initPathRegistry()` must have been called from the
   * preboot phase in `main/index.ts`. This is enforced by an entry-point
   * assertion below — there is no silent fallback initialization, so any
   * code path that reaches `bootstrap()` without first calling
   * `initPathRegistry()` fails fast with a clear error pointing at the
   * fix location.
   */
  public async bootstrap(): Promise<void> {
    if (this.isBootstrapped) {
      logger.warn('Already bootstrapped')
      return
    }

    // Path registry must be initialized by preboot — see initPathRegistry()
    // for the timing contract. We do not auto-initialize here on purpose:
    // a silent fallback would mask the case where main/index.ts forgot to
    // call initPathRegistry() and would push the failure to the first
    // getPath() call deep inside service startup, where the diagnostic
    // is much harder to read.
    if (this.pathMap === null) {
      throw new Error(
        'Path registry not initialized. Call application.initPathRegistry() ' +
          'after resolveUserDataLocation() in main/index.ts before invoking bootstrap().'
      )
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

      // 4. Wait for Background to finish, then notify all services.
      // ServiceInitError = fail-fast service failure → must propagate to
      // handleFatalServiceError() via the outer catch block.
      // Non-ServiceInitError = graceful/unexpected failure in a background
      // service — log and continue, as background services are non-critical.
      await backgroundPromise.catch((err) => {
        if (err instanceof ServiceInitError) {
          throw err
        }
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
      // Re-kick app.quit(): if a prior quit stalled (e.g. a BrowserWindow close
      // handler preventDefault'd and broke the chain), this gives the user a
      // second chance to exit via the menu without resorting to `kill -9`.
      logger.warn('Already quitting — re-triggering app.quit() in case a previous attempt stalled')
      app.quit()
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

  /**
   * Get a registered application path.
   *
   * Sole entry point for all path lookups in the main process. Paths are
   * registered in `src/main/core/paths/pathRegistry.ts`; see
   * `src/main/core/paths/README.md` for naming conventions, namespace
   * taxonomy, and usage guidelines.
   *
   * Callable only after `application.initPathRegistry()` has been invoked
   * from the preboot phase in `main/index.ts`. Earlier calls throw — any
   * consumer that runs before then is a contract violation and must be
   * either deferred (into a service `onStart()`) or migrated to a
   * special-case path source (e.g. `paths/constants.ts` for code that
   * must run before the registry exists).
   *
   * @param key      Dotted path key (e.g. 'feature.files.data', 'cherry.bin').
   *                 Type-checked at compile time against the path registry.
   * @param filename Optional filename to join under the registered root.
   *                 Should be a single relative segment (no absolute path,
   *                 no '..', no path separators). If the constraint is
   *                 violated, a warning is logged via loggerService and the
   *                 path is joined anyway — the warning is a developer hint
   *                 that you may want to register a new path key for the
   *                 deeper path you're constructing.
   */
  public getPath(key: PathKey, filename?: string): string {
    if (this.pathMap === null) {
      throw new Error(
        `application.getPath('${key}') called before application.initPathRegistry() ran. ` +
          `Ensure all app.setPath() calls finish, then invoke application.initPathRegistry() ` +
          `from main/index.ts preboot before any service uses the path registry.`
      )
    }

    const base = this.pathMap[key]

    // Lazy auto-ensure: on first access of an opt-in key, mkdir the
    // relevant directory so callers can immediately read/write without
    // an explicit `fs.mkdirSync` step.
    //   - Directory keys: ensure `base` itself.
    //   - File keys (key ends with 'file'): ensure `path.dirname(base)`
    //     so the file's parent dir exists. The file itself is NOT
    //     created — it remains the caller's responsibility.
    // Opt-out lives in `pathRegistry.shouldAutoEnsure` (data-driven, see
    // the NO_ENSURE list there). The result is cached in `ensuredKeys`
    // so each key's directory is created at most once per process.
    if (!this.ensuredKeys.has(key) && shouldAutoEnsure(key)) {
      const dirToEnsure = key.endsWith('file') ? path.dirname(base) : base
      try {
        fs.mkdirSync(dirToEnsure, { recursive: true })
      } catch (err) {
        // Don't block path resolution if mkdir fails (read-only FS,
        // missing permissions, etc.). Caller may still need the path
        // for error reporting or read-only checks.
        logger.warn(
          `application.getPath: mkdir failed for key '${key}' at '${dirToEnsure}'. ` +
            `Returning path anyway. Error: ${(err as Error).message}`
        )
      }
      // Cache regardless of success — retrying on every call would be
      // a perf trap. Failed-once is treated the same as succeeded-once.
      this.ensuredKeys.add(key)
    }

    if (filename === undefined) return base

    if (path.isAbsolute(filename) || filename.includes('..') || filename.includes(path.sep)) {
      logger.warn(
        `Application.getPath: filename "${filename}" should be a single relative segment ` +
          `(no absolute paths, no '..', no separators). Consider registering a new key in ` +
          `pathRegistry.ts if you need a deeper path.`
      )
    }

    return path.join(base, filename)
  }

  /**
   * @internal — Test-only hook for injecting a mock path registry without
   * running the heavyweight `bootstrap()` flow. Production code MUST NOT
   * call this. The double-underscore prefix and the NODE_ENV guard together
   * prevent accidental misuse.
   *
   * Usage in a test:
   * ```ts
   * vi.mock('@main/core/paths/pathRegistry', () => ({
   *   buildPathRegistry: () => Object.freeze({ 'feature.files.data': '/mock' })
   * }))
   * import { buildPathRegistry } from '@main/core/paths/pathRegistry'
   * import { Application } from '@main/core/application/Application'
   * const app = Application.getInstance()
   * app.__setPathMapForTesting(buildPathRegistry())
   * ```
   */
  public __setPathMapForTesting(map: PathMap | null): void {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('__setPathMapForTesting may only be called in tests')
    }
    this.pathMap = map
    // Clear the auto-ensure cache so each test starts from a clean state.
    // Without this, a key that was already mkdir'd in a previous test
    // would silently skip mkdir in the next test, breaking call-count
    // assertions and hiding regressions.
    this.ensuredKeys.clear()
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
