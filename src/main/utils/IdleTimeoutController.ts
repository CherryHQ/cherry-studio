/**
 * A resettable idle-timeout AbortController.
 *
 * Port of `src/renderer/src/utils/IdleTimeoutController.ts` (origin/main).
 * Each call to `reset()` restarts the countdown; when the timeout fires
 * without being reset, the internal `AbortController` is aborted with a
 * `TimeoutError` DOMException.
 */

/** Timer controls for upstream progress, bounded waits and consumer backpressure. */
export interface IdleTimeoutHandle {
  /** Restart the countdown. Pass `durationMs` to arm a one-off window (e.g. a generous
   *  human-approval wait); omit it to use the controller's configured timeout. */
  reset: (durationMs?: number) => void
  cleanup: () => void
  pause: () => void
  resume: () => void
}

export class IdleTimeoutController {
  private controller: AbortController
  private timerId: ReturnType<typeof setTimeout> | null = null
  private readonly timeoutMs: number
  private paused = false

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs
    this.controller = new AbortController()
    this.startTimer()
  }

  /** The AbortSignal that will be aborted on idle timeout. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Reset the idle timer. Call this every time new data arrives. Pass `durationMs` to arm a one-off
   *  window (e.g. a generous human-approval wait); omit it to use the configured timeout. */
  reset = (durationMs?: number): void => {
    if (this.controller.signal.aborted || this.paused) return
    this.clearTimer()
    this.startTimer(durationMs ?? this.timeoutMs)
  }

  /** Clean up the timer (e.g. when the stream finishes normally). */
  cleanup = (): void => {
    this.clearTimer()
  }

  pause = (): void => {
    this.paused = true
    this.clearTimer()
  }

  resume = (): void => {
    if (!this.paused) return
    this.paused = false
    this.reset()
  }

  private startTimer(durationMs: number = this.timeoutMs): void {
    this.timerId = setTimeout(() => {
      this.controller.abort(new DOMException('Idle timeout exceeded', 'TimeoutError'))
    }, durationMs)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }
}
