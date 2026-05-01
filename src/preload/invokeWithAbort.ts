import type { SerializedError } from '@shared/types/error'
import { ipcRenderer } from 'electron'

/**
 * Invoke a main-process IPC handler with caller-driven abort support.
 *
 * Why this exists: `ipcRenderer.invoke` returns a Promise but cannot
 * transfer port references, and `AbortSignal` is not structured-cloneable
 * across the IPC boundary. Pairing one MessagePort per request gives the
 * caller and the handler a private bidirectional channel — caller posts
 * `'abort'`, handler posts the final `{ type: 'result' | 'error', ... }`.
 *
 * The main-process side must be registered with `BaseService.ipcOn` (or
 * `ipcMain.on`) so it can read `event.ports[0]` from the incoming event.
 * It must post exactly one terminal message and then `port.close()`.
 *
 * Lifecycle: the AbortController is implicit — caller passes a real
 * `AbortSignal`, this helper bridges it to the port. Once the result or
 * error arrives, the listener and the port are torn down so a late
 * `signal.abort()` becomes a no-op.
 */
export function invokeWithAbort<TPayload, TResult>(
  channel: string,
  payload: TPayload,
  signal?: AbortSignal
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError(signal.reason))
      return
    }

    const messageChannel = new MessageChannel()
    const port = messageChannel.port1

    const onAbort = () => {
      try {
        port.postMessage({ type: 'abort', reason: stringifyReason(signal?.reason) })
      } catch {
        // Port may already be closed if the result raced ahead of the abort.
      }
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      port.onmessage = null
      port.close()
    }

    port.onmessage = (event) => {
      const data = event.data as { type: 'result'; value: TResult } | { type: 'error'; error: SerializedError }
      cleanup()
      if (data.type === 'result') resolve(data.value)
      else reject(reviveError(data.error))
    }

    port.start()
    signal?.addEventListener('abort', onAbort, { once: true })
    ipcRenderer.postMessage(channel, payload, [messageChannel.port2])
  })
}

function makeAbortError(reason: unknown): Error {
  const message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : 'Aborted'
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

function stringifyReason(reason: unknown): string | undefined {
  if (reason === undefined) return undefined
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function reviveError(serialized: SerializedError): Error {
  const err = new Error(serialized.message ?? 'Unknown error')
  if (serialized.name) err.name = serialized.name
  if (serialized.stack) err.stack = serialized.stack
  return err
}
