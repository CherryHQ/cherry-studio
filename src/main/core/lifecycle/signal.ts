/**
 * One-shot deferred value for signaling work completion.
 *
 * Unlike Emitter (repeatable events), a Signal fires exactly once.
 * Implements PromiseLike<T> so it can be directly awaited.
 * Late subscribers receive the resolved value immediately.
 *
 * @example
 * // Producer:
 * readonly migrationComplete = new Signal<void>()
 * await this.runMigrations()
 * this.migrationComplete.resolve()
 *
 * // Consumer (await style):
 * await dbService.migrationComplete
 *
 * // Consumer (callback style):
 * this.registerDisposable(dbService.migrationComplete.onResolved(() => { ... }))
 */

import type { Disposable, Event } from './event'
import { Emitter } from './event'

export class Signal<T> implements Disposable, PromiseLike<T> {
  private _value: T | undefined
  private _resolved = false
  private _disposed = false
  private readonly _emitter = new Emitter<T>()
  private _resolve!: (value: T) => void
  private readonly _promise: Promise<T>

  constructor() {
    this._promise = new Promise<T>((resolve) => {
      this._resolve = resolve
    })
  }

  /**
   * Event that fires when the signal is resolved.
   * If already resolved, the listener is called immediately with the value.
   */
  public get onResolved(): Event<T> {
    return (listener: (e: T) => void): Disposable => {
      if (this._resolved && !this._disposed) {
        listener(this._value as T)
        return { dispose: () => {} }
      }
      return this._emitter.event(listener)
    }
  }

  /**
   * Resolve the signal with a value. Can only be called once.
   * Notifies all current subscribers and fulfills the internal promise.
   * @throws Error if already resolved
   */
  public resolve(value: T): void {
    if (this._resolved) {
      throw new Error('Signal has already been resolved')
    }
    if (this._disposed) return

    this._value = value
    this._resolved = true
    this._resolve(value)
    this._emitter.fire(value)
  }

  /**
   * Whether the signal has been resolved.
   */
  public get isResolved(): boolean {
    return this._resolved
  }

  /**
   * Get the resolved value.
   * @throws Error if not yet resolved
   */
  public get value(): T {
    if (!this._resolved) {
      throw new Error('Signal has not been resolved yet')
    }
    return this._value as T
  }

  /**
   * Implement PromiseLike so signals can be awaited directly.
   * @example const result = await signal
   */
  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected)
  }

  /**
   * Dispose the signal. Clears listeners but preserves resolved value.
   *
   * Note: If disposed before resolve(), any pending `await signal` will
   * hang indefinitely. This is by design — services are stopped in reverse
   * dependency order, so consumers are stopped before producers.
   */
  public dispose(): void {
    this._disposed = true
    this._emitter.dispose()
  }
}
