/**
 * Simple Signal implementation for renderer process
 * One-shot deferred value for signaling work completion
 */
export class Signal<T> implements PromiseLike<T> {
  private _value: T | undefined
  private _resolved = false
  private _listeners: ((value: T) => void)[] = []
  private _resolve!: (value: T) => void
  private readonly _promise: Promise<T>

  constructor() {
    this._promise = new Promise<T>((resolve) => {
      this._resolve = resolve
    })
  }

  /**
   * Event that fires when the signal is resolved
   * If already resolved, the listener is called immediately with the value
   */
  public onResolved(listener: (value: T) => void): () => void {
    if (this._resolved) {
      listener(this._value as T)
      return () => {}
    }

    this._listeners.push(listener)
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener)
    }
  }

  /**
   * Resolve the signal with a value
   */
  public resolve(value: T): void {
    if (this._resolved) return

    this._value = value
    this._resolved = true
    this._resolve(value)

    for (const listener of this._listeners) {
      listener(value)
    }
    this._listeners = []
  }

  /**
   * Whether the signal has been resolved
   */
  public get isResolved(): boolean {
    return this._resolved
  }

  /**
   * Get the resolved value
   */
  public get value(): T {
    if (!this._resolved) {
      throw new Error('Signal has not been resolved yet')
    }
    return this._value as T
  }

  /**
   * Implement PromiseLike so signals can be awaited directly
   */
  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected)
  }
}
