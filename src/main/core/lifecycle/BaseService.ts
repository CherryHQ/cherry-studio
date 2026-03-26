import { type ErrorStrategy, isPausable, LifecycleState } from './types'

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
    await this.onStop()
    this._state = LifecycleState.Stopped
  }

  /**
   * Internal method to execute destroy
   * Called by LifecycleManager
   */
  public async _doDestroy(): Promise<void> {
    await this.onDestroy()
    this._state = LifecycleState.Destroyed
  }

  /**
   * Internal method to execute pause.
   * Only works if the service implements Pausable interface.
   * Called by LifecycleManager.
   * @returns True if pause was successful, false if service doesn't support pause
   */
  public async _doPause(): Promise<boolean> {
    if (!isPausable(this)) {
      return false
    }
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
    if (!isPausable(this)) {
      return false
    }
    this._state = LifecycleState.Resuming
    await this.onResume()
    this._state = LifecycleState.Ready
    return true
  }
}
