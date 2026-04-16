import { loggerService } from '@logger'
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

import { type Disposable, toDisposable } from './event'
import { type ErrorStrategy, isActivatable, isPausable, LifecycleState } from './types'

const logger = loggerService.withContext('Lifecycle')

/**
 * Abstract base class for all lifecycle-managed services
 * Provides lifecycle hooks and state management.
 * All services are singletons - attempting to instantiate twice will throw an error.
 */
export abstract class BaseService {
  /** Track instantiated service classes to prevent duplicate instantiation */
  private static instances = new WeakSet<object>()

  /** Current lifecycle state */
  private _state: LifecycleState = LifecycleState.Created

  /** Guard flag to ensure onAllReady is called at most once per service instance */
  private _allReadyCalled = false

  /** Disposables registered via registerDisposable(), auto-cleaned on stop */
  private _disposables: Disposable[] = []

  /** Whether the service's heavy resources are currently activated (Activatable interface) */
  private _activated = false

  /** Guard flag to prevent concurrent activate/deactivate execution */
  private _activating = false

  /** Error handling strategy for this service */
  static errorStrategy: ErrorStrategy = 'graceful'

  /**
   * Reset the singleton guard (for testing only)
   */
  public static resetInstances(): void {
    BaseService.instances = new WeakSet<object>()
  }

  constructor() {
    const ctor = this.constructor
    if (BaseService.instances.has(ctor)) {
      throw new Error(
        `Service '${ctor.name}' has already been instantiated. ` +
          `Use ServiceContainer.get(${ctor.name}) to access the existing instance.`
      )
    }
    BaseService.instances.add(ctor)
  }

  /**
   * Get current lifecycle state
   */
  public get state(): LifecycleState {
    return this._state
  }

  /**
   * Set lifecycle state (internal use)
   * @param state - New lifecycle state
   */
  protected setState(state: LifecycleState): void {
    this._state = state
  }

  /**
   * Check if service is in ready state
   */
  public get isReady(): boolean {
    return this._state === LifecycleState.Ready
  }

  /**
   * Check if service is destroyed
   */
  public get isDestroyed(): boolean {
    return this._state === LifecycleState.Destroyed
  }

  /**
   * Check if service is paused
   */
  public get isPaused(): boolean {
    return this._state === LifecycleState.Paused
  }

  /**
   * Check if service is stopped
   */
  public get isStopped(): boolean {
    return this._state === LifecycleState.Stopped
  }

  /**
   * Whether the service's heavy resources are currently activated.
   * Only meaningful for services implementing the Activatable interface.
   * Always false for non-Activatable services.
   */
  public get isActivated(): boolean {
    return this._activated
  }

  /**
   * Register an IPC handler (ipcMain.handle).
   * Automatically tracked and removed on service stop/destroy.
   * Returns a Disposable to manually unregister before service stop if needed.
   */
  protected ipcHandle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any
  ): Disposable {
    ipcMain.handle(channel, listener)
    return this.registerDisposable(() => ipcMain.removeHandler(channel))
  }

  /**
   * Register an IPC event listener (ipcMain.on).
   * Automatically tracked and removed on service stop/destroy.
   * Returns a Disposable to manually unregister before service stop if needed.
   */
  protected ipcOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): Disposable {
    ipcMain.on(channel, listener)
    return this.registerDisposable(() => ipcMain.removeListener(channel, listener))
  }

  /**
   * Register a disposable for automatic cleanup on service stop/destroy.
   * Accepts either a Disposable object or a plain cleanup function.
   * Returns the registered disposable for optional inline assignment.
   *
   * @example
   * // Disposable object (e.g., Emitter subscription)
   * this.registerDisposable(windowService.onMainWindowCreated((win) => this.bind(win)))
   *
   * // Plain cleanup function (e.g., PreferenceService.subscribeChange)
   * this.registerDisposable(preferenceService.subscribeChange('key', handler))
   *
   * // Inline assignment
   * this.emitter = this.registerDisposable(new Emitter<void>())
   */
  protected registerDisposable<T extends Disposable>(disposable: T): T
  protected registerDisposable(dispose: () => void): Disposable
  protected registerDisposable<T extends Disposable>(disposableOrFn: T | (() => void)): T | Disposable {
    const disposable = typeof disposableOrFn === 'function' ? toDisposable(disposableOrFn) : disposableOrFn
    this._disposables.push(disposable)
    return disposable
  }

  /**
   * Dispose all tracked disposables (IPC handlers, event subscriptions, signals, etc.).
   * Called automatically after onStop() and in _doDestroy().
   */
  private _cleanupDisposables(): void {
    for (const disposable of this._disposables) {
      disposable.dispose()
    }
    this._disposables = []
  }

  /**
   * Called when the service is being initialized
   * Override this method to perform initialization logic
   */
  protected onInit(): Promise<void> | void {}

  /**
   * Called when the service has completed initialization and is ready
   * Override this method to perform post-initialization logic
   */
  protected onReady(): Promise<void> | void {}

  /**
   * Called when the service is being stopped
   * Override this method to perform cleanup before stopping
   */
  protected onStop(): Promise<void> | void {}

  /**
   * Called when the service is being destroyed
   * Override this method to release resources
   */
  protected onDestroy(): Promise<void> | void {}

  /**
   * Called once after all services across all bootstrap phases have completed initialization.
   * Unlike onReady (called when this service is ready), onAllReady fires when the entire
   * system is ready — safe to access any service regardless of @DependsOn declarations.
   * Only called once per service instance; service restarts do not re-trigger this hook.
   */
  protected onAllReady(): Promise<void> | void {}

  /**
   * Internal method to execute the all-ready hook.
   * Called by LifecycleManager after all bootstrap phases complete.
   * Guarded by _allReadyCalled to ensure at-most-once execution.
   */
  public async _doAllReady(): Promise<void> {
    if (this._allReadyCalled) return
    this._allReadyCalled = true
    await this.onAllReady()
  }

  /**
   * Internal method to execute initialization
   * Called by LifecycleManager
   */
  public async _doInit(): Promise<void> {
    this._state = LifecycleState.Initializing
    await this.onInit()
    this._state = LifecycleState.Ready
    await this.onReady()
  }

  /**
   * Internal method to execute stop
   * Called by LifecycleManager
   */
  public async _doStop(): Promise<void> {
    this._state = LifecycleState.Stopping
    try {
      // Auto-deactivate: independent try/catch, failure does not block onStop
      if (this._activated && isActivatable(this)) {
        try {
          await this.onDeactivate()
        } catch {
          // best-effort — logged by service
        }
        this._activated = false
      }
      await this.onStop()
    } finally {
      this._cleanupDisposables()
    }
    this._state = LifecycleState.Stopped
  }

  /**
   * Internal method to execute destroy
   * Called by LifecycleManager
   */
  public async _doDestroy(): Promise<void> {
    if (this._state === LifecycleState.Destroyed) {
      return
    }
    // Safety net: deactivate if still active (e.g., destroy without stop)
    if (this._activated && isActivatable(this)) {
      try {
        await this.onDeactivate()
      } catch {
        // best-effort
      }
      this._activated = false
    }
    await this.onDestroy()
    this._cleanupDisposables()
    this._state = LifecycleState.Destroyed
  }

  /**
   * Internal method to execute feature activation.
   * Only works if the service implements Activatable and is in Ready state.
   * Idempotent. Guarded against concurrent execution.
   * Called by LifecycleManager or via protected activate().
   * @returns True if activation succeeded or was already active
   */
  public async _doActivate(): Promise<boolean> {
    if (!isActivatable(this)) return false
    if (this._activated || this._activating) return this._activated
    if (this._state !== LifecycleState.Ready) return false
    this._activating = true
    try {
      const start = performance.now()
      await this.onActivate()
      const duration = performance.now() - start
      this._activated = true
      logger.info(`Service '${this.constructor.name}' activated (${duration.toFixed(3)}ms)`)
      return true
    } finally {
      this._activating = false
    }
  }

  /**
   * Internal method to execute feature deactivation.
   * Only works if the service implements Activatable.
   * Idempotent. Guarded against concurrent execution.
   * Called by LifecycleManager or via protected deactivate().
   * @returns True if deactivation succeeded or was already inactive
   */
  public async _doDeactivate(): Promise<boolean> {
    if (!isActivatable(this)) return false
    if (!this._activated || this._activating) return !this._activated
    this._activating = true
    try {
      const start = performance.now()
      await this.onDeactivate()
      const duration = performance.now() - start
      this._activated = false
      logger.info(`Service '${this.constructor.name}' deactivated (${duration.toFixed(3)}ms)`)
      return true
    } finally {
      this._activating = false
    }
  }

  /**
   * Self-activate: load heavy resources.
   * For use within the service itself (e.g., in onReady() or event handlers).
   * External callers should use application.activate(name) instead.
   */
  protected async activate(): Promise<boolean> {
    return this._doActivate()
  }

  /**
   * Self-deactivate: release heavy resources.
   * For use within the service itself.
   * External callers should use application.deactivate(name) instead.
   */
  protected async deactivate(): Promise<boolean> {
    return this._doDeactivate()
  }

  /**
   * Internal method to execute pause.
   * Only works if the service implements Pausable interface.
   * Called by LifecycleManager.
   * @returns True if pause was successful, false if service doesn't support pause
   */
  public async _doPause(): Promise<boolean> {
    if (!isPausable(this)) return false
    this._state = LifecycleState.Pausing
    await this.onPause()
    this._state = LifecycleState.Paused
    return true
  }

  /**
   * Internal method to execute resume.
   * Only works if the service implements Pausable interface.
   * Called by LifecycleManager.
   * @returns True if resume was successful, false if service doesn't support resume
   */
  public async _doResume(): Promise<boolean> {
    if (!isPausable(this)) return false
    this._state = LifecycleState.Resuming
    await this.onResume()
    this._state = LifecycleState.Ready
    return true
  }
}
