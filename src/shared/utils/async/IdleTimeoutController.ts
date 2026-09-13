import type { Disposable } from '@shared/types/disposable'

/** Inactivity deadline controls without access to the abort controller. */
export interface IdleTimeoutHandle extends Disposable {
  /** Restart the countdown. Pass `durationMs` to arm a one-off window (e.g. a generous
   *  human-approval wait); omit it to use the controller's configured timeout. */
  reset: (durationMs?: number) => void
}

/** Resettable inactivity deadline; disposal prevents late activity from rearming it. */
export class IdleTimeoutController implements IdleTimeoutHandle {
  private controller: AbortController
  private timerId: ReturnType<typeof setTimeout> | null = null
  private readonly timeoutMs: number
  private disposed = false

  constructor(
    timeoutMs: number,
    private readonly reasonFactory: () => unknown = () => new DOMException('Idle timeout exceeded', 'TimeoutError')
  ) {
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
    if (this.disposed || this.controller.signal.aborted) return
    this.clearTimer()
    this.startTimer(durationMs ?? this.timeoutMs)
  }

  /** Permanently release the timer without aborting the signal. */
  dispose = (): void => {
    this.disposed = true
    this.clearTimer()
  }

  private startTimer(durationMs: number = this.timeoutMs): void {
    this.timerId = setTimeout(() => {
      this.controller.abort(this.reasonFactory())
    }, durationMs)
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }
}
