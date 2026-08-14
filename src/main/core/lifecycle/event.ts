/**
 * VS Code-style typed event system for inter-service communication.
 *
 * Provides type-safe, lifecycle-managed events as an alternative to ad-hoc
 * EventEmitter patterns. Producers own an Emitter<T> and expose its Event<T>
 * for consumers to subscribe to.
 *
 * @example
 * // Producer (MainWindowService):
 * private readonly _onMainWindowCreated = new Emitter<BrowserWindow>()
 * readonly onMainWindowCreated: Event<BrowserWindow> = this._onMainWindowCreated.event
 *
 * // Consumer (ShortcutService):
 * this.registerDisposable(windowService.onMainWindowCreated((win) => { ... }))
 */

/**
 * A resource that can be cleaned up. Call dispose() to release it.
 *
 * Used for event subscriptions, signals, and any resource that needs
 * deterministic cleanup. Register via BaseService.registerDisposable()
 * for automatic cleanup on service stop/destroy.
 */
export interface Disposable {
  dispose(): void
}

/**
 * Wrap a cleanup function as a Disposable.
 * Bridges APIs that return () => void (e.g., PreferenceService.subscribeChange)
 * to the Disposable interface used by BaseService.registerDisposable().
 */
export function toDisposable(fn: () => void): Disposable {
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      fn()
    }
  }
}

/**
 * Function signature for subscribing to a typed event.
 * Call with a listener to subscribe; returns a Disposable to unsubscribe.
 */
export type Event<T> = (listener: (e: T) => void) => Disposable

/**
 * Type-safe event emitter. The producer owns the Emitter and calls fire().
 * Consumers subscribe via the public .event property.
 *
 * - Subscriptions return Disposable for unsubscribe
 * - fire() is synchronous with error isolation (one bad listener cannot break others)
 * - Disposed emitter silently ignores fire() and returns no-op on subscribe
 */
export class Emitter<T> implements Disposable {
  private listeners = new Set<(e: T) => void>()
  private _disposed = false

  /**
   * The Event function that consumers subscribe to.
   * Returns a Disposable to unsubscribe.
   */
  public readonly event: Event<T> = (listener: (e: T) => void): Disposable => {
    if (this._disposed) {
      return { dispose: () => {} }
    }

    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      }
    }
  }

  /**
   * Fire the event, notifying all current listeners synchronously.
   * Snapshots listener set before iteration to protect against mutation.
   * Each listener is error-isolated — one throw does not prevent others.
   */
  public fire(event: T): void {
    if (this._disposed) return

    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // Error isolation: one bad listener must not break others
      }
    }
  }

  /**
   * Dispose the emitter. Clears all listeners.
   * Further fire() and event() calls become no-ops.
   */
  public dispose(): void {
    this._disposed = true
    this.listeners.clear()
  }

  /**
   * Whether this emitter has been disposed.
   */
  public get isDisposed(): boolean {
    return this._disposed
  }

  /**
   * Number of active listeners.
   */
  public get listenerCount(): number {
    return this.listeners.size
  }
}
