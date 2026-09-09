import { raceCancellation } from './promises'

/** An owned task; chaining returns ordinary promises without cancellation authority. */
export interface CancelablePromise<T> extends Promise<T> {
  cancel(reason?: unknown): void
}

/**
 * Start a task eagerly and expose its cancellation authority alongside its result.
 * Cancellation rejects promptly; the producer still owns checkpoints and cleanup.
 * @param factory Receives the task's signal; synchronous throws become rejections.
 * @param onLateResult Optional cleanup for an exclusively owned result arriving after cancellation.
 * Cleanup failures are observed without replacing cancellation; report them inside the callback if needed.
 */
export function createCancelablePromise<T>(
  factory: (signal: AbortSignal) => T | PromiseLike<T>,
  onLateResult?: (value: T) => void | PromiseLike<void>
): CancelablePromise<T> {
  const controller = new AbortController()
  let settled = false
  const work = new Promise<T>((resolve) => resolve(factory(controller.signal))).then(
    (value) => {
      settled = true
      if (controller.signal.aborted && onLateResult) {
        return Promise.resolve(onLateResult(value)).then(() => value)
      }
      return value
    },
    (error) => {
      settled = true
      throw error
    }
  )

  return Object.assign(raceCancellation(work, controller.signal), {
    cancel(reason?: unknown): void {
      if (settled) return
      settled = true
      controller.abort(reason)
    }
  })
}
