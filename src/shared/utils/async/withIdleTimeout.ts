import { onAbort } from './cancellation'
import { IdleTimeoutController, type IdleTimeoutHandle } from './IdleTimeoutController'

/** Reset the inactivity deadline on each chunk; abort the owner controller on timeout. */
export function withIdleTimeout<T>(
  source: ReadableStream<T>,
  controller: AbortController,
  timeoutMs: number
): { stream: ReadableStream<T>; idle: IdleTimeoutHandle } {
  const idle = new IdleTimeoutController(
    timeoutMs,
    () => new DOMException('Stream idle timeout exceeded', 'TimeoutError')
  )

  // Abort the owner controller so cancellation reaches the upstream request too.
  const detachAbort = onAbort(idle.signal, (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  })

  const dispose = () => {
    idle.dispose()
    detachAbort()
  }

  const reader = source.getReader()

  const stream = new ReadableStream<T>({
    async pull(dest) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          dispose()
          dest.close()
          return
        }
        idle.reset()
        dest.enqueue(value)
      } catch (err) {
        dispose()
        dest.error(err)
      }
    },
    cancel(reason) {
      dispose()
      return reader.cancel(reason)
    }
  })

  // Owners can extend the deadline for bounded waits such as human approval.
  return { stream, idle: { reset: idle.reset, dispose } }
}
