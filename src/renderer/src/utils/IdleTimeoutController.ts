/** Lightweight handle exposing only the reset/cleanup callbacks. */
export interface IdleTimeoutHandle {
  reset: () => void
  cleanup: () => void
}

/**
 * A resettable idle timeout that aborts via an AbortController.
 * Each call to `reset()` restarts the countdown.
 * When the timeout fires without being reset, the internal AbortController is aborted.
 */
export class IdleTimeoutController {
  private controller: AbortController
  private timerId: ReturnType<typeof setTimeout> | null = null
  private readonly timeoutMs: number

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs
    this.controller = new AbortController()
    this.startTimer()
  }

  /** The AbortSignal that will be aborted on idle timeout. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Reset the idle timer. Call this every time new data arrives. */
  reset = (): void => {
    if (this.controller.signal.aborted) return
    this.clearTimer()
    this.startTimer()
  }

  /** Clean up the timer (e.g. when the stream finishes normally). */
  cleanup = (): void => {
    this.clearTimer()
  }

  private startTimer(): void {
    this.timerId = setTimeout(() => {
      this.controller.abort(new DOMException('Idle timeout exceeded', 'TimeoutError'))
    }, this.timeoutMs)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }
}
