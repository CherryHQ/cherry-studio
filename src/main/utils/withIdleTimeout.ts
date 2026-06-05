/**
 * Wrap a `ReadableStream` with an idle-chunk timeout.
 *
 * The returned stream is a passthrough that resets an internal timer on every
 * chunk it pulls from `source`. If `timeoutMs` elapses without a new chunk,
 * the supplied `controller` is aborted with a `TimeoutError`. Aborting the
 * controller propagates into the underlying AI SDK request (the controller's
 * signal was already passed into `AiService.streamText`), so the upstream
 * provider connection is torn down — not just the downstream reader.
 *
 * Timer is cleaned up on any terminal path: normal close, upstream error, and
 * downstream cancel.
 *
 * Why a stream wrapper and not a plugin: plugins only see request
 * boundaries (`transformParams` / `onRequestEnd`); they have no hook on
 * individual chunks. And why not inside `AiStreamManager`: the manager's
 * read loop is already ~100 lines handling lifecycle + broadcast + abort
 * + accumulator. Keeping the tap as a standalone utility leaves the
 * manager's read loop unchanged and the idle behaviour unit-testable in
 * isolation.
 */

import { IdleTimeoutController } from './IdleTimeoutController'

export function withIdleTimeout<T>(
  source: ReadableStream<T>,
  controller: AbortController,
  timeoutMs: number
): ReadableStream<T> {
  const idle = new IdleTimeoutController(timeoutMs)

  // When the idle timer fires, abort the caller's controller so the abort
  // propagates through every signal already wired into the AI SDK request
  // (provider HTTP, stream-manager reader, agent loop, etc.).
  const onIdleAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('Stream idle timeout exceeded', 'TimeoutError'))
    }
  }
  idle.signal.addEventListener('abort', onIdleAbort, { once: true })

  const cleanup = () => {
    idle.cleanup()
    idle.signal.removeEventListener('abort', onIdleAbort)
  }

  const reader = source.getReader()

  return new ReadableStream<T>({
    async pull(dest) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          cleanup()
          dest.close()
          return
        }
        idle.reset()
        dest.enqueue(value)
      } catch (err) {
        cleanup()
        dest.error(err)
      }
    },
    cancel(reason) {
      cleanup()
      return reader.cancel(reason)
    }
  })
}
