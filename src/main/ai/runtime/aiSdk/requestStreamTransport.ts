import type { FetchFunction } from '@ai-sdk/provider-utils'

import { STREAM_CLEANUP_TIMEOUT_MS } from '../../constants'

export interface RequestStreamTransport {
  signal: AbortSignal
  close(reason?: unknown): Promise<void>
}

export function createRequestStreamTransport({ cleanupTimeoutMs = STREAM_CLEANUP_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const pending = new Set<Promise<unknown>>()
  const bodies = new Set<{ cancel(reason?: unknown): Promise<void>; release(): void }>()
  const failures: unknown[] = []
  let closing: Promise<void> | undefined
  let closeReason: unknown
  let cleanupTimedOut = false

  const wrapFetch =
    (fetch: FetchFunction): FetchFunction =>
    async (input, init) => {
      if (closing) throw closeReason
      const request = Promise.resolve().then(async () => {
        if (closing) throw closeReason
        const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
        const response = await fetch(input, { ...init, signal })
        if (!response.body) {
          if (closing) throw closeReason
          return response
        }
        const reader = response.body.getReader()
        let target: ReadableStreamDefaultController<Uint8Array> | undefined
        let terminal: Promise<void> | undefined
        const body = {
          cancel(reason?: unknown): Promise<void> {
            if (!terminal) {
              target?.close()
              terminal = reader
                .cancel(reason)
                .catch((error) => {
                  failures.push(error)
                  throw error
                })
                .finally(body.release)
            }
            return terminal
          },
          release() {
            if (!bodies.delete(body)) return
            try {
              reader.releaseLock()
            } catch (error) {
              failures.push(error)
            }
          }
        }
        bodies.add(body)
        if (closing) {
          const cancellation = body.cancel(closeReason)
          if (cleanupTimedOut) {
            body.release()
            void cancellation.catch(() => {})
          } else await cancellation
          throw closeReason
        }
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            target = streamController
          },
          async pull(streamController) {
            try {
              const result = await reader.read()
              if (terminal) return
              if (result.done) {
                reader.releaseLock()
                bodies.delete(body)
                streamController.close()
              } else streamController.enqueue(result.value)
            } catch (error) {
              if (terminal) return
              bodies.delete(body)
              reader.releaseLock()
              streamController.error(error)
            }
          },
          cancel(reason) {
            target = undefined
            return body.cancel(reason)
          }
        })
        const wrapped = new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
        Object.defineProperty(wrapped, 'url', { value: response.url })
        return wrapped
      })
      pending.add(request)
      try {
        return await request
      } finally {
        pending.delete(request)
      }
    }
  const close = (reason?: unknown): Promise<void> => {
    if (!closing) {
      closeReason = reason ?? new DOMException('Transport closed', 'AbortError')
      closing = Promise.resolve().then(async () => {
        const settled = Promise.allSettled([...pending, ...[...bodies].map((body) => body.cancel(closeReason))])
        let timer: ReturnType<typeof setTimeout> | undefined
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            cleanupTimedOut = true
            failures.push(
              new DOMException(`Request stream transport cleanup exceeded ${cleanupTimeoutMs} ms`, 'TimeoutError')
            )
            for (const body of bodies) body.release()
            resolve()
          }, cleanupTimeoutMs)
        })
        await Promise.race([settled, deadline]).finally(() => clearTimeout(timer))
        if (failures.length) throw new AggregateError(failures, 'Response body cancellation failed')
      })
      if (reason !== undefined || pending.size || bodies.size) controller.abort(closeReason)
    }
    return closing
  }
  return { signal: controller.signal, close, wrapFetch }
}
