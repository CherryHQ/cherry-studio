import type { Readable, Writable } from 'node:stream'

import { CancellationTokenSource, createMessageConnection, ResponseError } from 'vscode-jsonrpc/node'

import type { JsonObject, JsonValue, RpcPeer } from '../types.js'

/** Demo protocol: JSON-RPC 2.0 / Content-Length over a caller-owned stream pair. */
export function createRpcPeer(
  input: Readable,
  output: Writable,
  options: { authorize(method: string, params: JsonObject): Promise<boolean>; onError?(error: Error): void }
): RpcPeer & { dispose(): void } {
  const connection = createMessageConnection(input, output)
  const handlers = new Map<string, (params: JsonObject, signal: AbortSignal) => Promise<JsonValue>>()
  let disposed = false
  let active = 0
  let pending = 0
  const disposals = new Set<() => void>()
  const object = (value: unknown): value is JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const cancel of disposals) cancel()
    handlers.clear()
    connection.dispose()
  }
  connection.onClose(dispose)
  connection.onError(([error]) => {
    options.onError?.(error)
    dispose()
  })
  connection.onRequest(async (method, params, token) => {
    const handler = handlers.get(method)
    if (!handler) throw new ResponseError(-32601, 'Method not found')
    if (!object(params)) throw new ResponseError(-32602, 'Expected object params')
    if (active >= 32) throw new ResponseError(-32001, 'Too many active handlers')
    active++
    const abort = new AbortController()
    const cancel = () => abort.abort()
    const cancelled = token.onCancellationRequested(cancel)
    disposals.add(cancel)
    const timer = setTimeout(cancel, 5000)
    try {
      if (token.isCancellationRequested) cancel()
      if (!(await options.authorize(method, params))) throw new ResponseError(-32003, 'Access denied')
      if (disposed || abort.signal.aborted) throw new ResponseError(-32800, 'Request cancelled')
      return await handler(params, abort.signal)
    } finally {
      active--
      clearTimeout(timer)
      cancelled.dispose()
      disposals.delete(cancel)
    }
  })
  connection.listen()
  return {
    handle(method, handler) {
      if (disposed) throw new Error('RPC disconnected')
      if (handlers.has(method)) throw new Error(`RPC method already registered: ${method}`)
      handlers.set(method, handler)
      return {
        dispose: () => {
          if (handlers.get(method) === handler) handlers.delete(method)
        }
      }
    },
    async request(method, params, requestOptions = {}) {
      if (disposed) throw new Error('RPC disconnected')
      if (!object(params)) throw new Error('Expected object params')
      if (pending >= 32) throw new Error('Too many pending RPC requests')
      const timeout = requestOptions.timeoutMs ?? 5000
      if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('Invalid RPC timeout')
      if (Buffer.byteLength(JSON.stringify(params)) > 32768) throw new Error('RPC params exceed demo limit')
      const cancellation = new CancellationTokenSource()
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel = () => {}
      const interrupted = new Promise<never>((_, reject) => {
        cancel = () => {
          if (!disposed) cancellation.cancel()
          reject(new Error('RPC cancelled or disconnected'))
        }
        timer = setTimeout(() => {
          cancellation.cancel()
          reject(new Error('RPC request timed out'))
        }, timeout)
      })
      disposals.add(cancel)
      requestOptions.signal?.addEventListener('abort', cancel, { once: true })
      try {
        if (requestOptions.signal?.aborted) {
          cancel()
          return await interrupted
        }
        const response = connection.sendRequest<JsonValue>(method, params, cancellation.token)
        pending++
        // Cancellation does not remove vscode-jsonrpc's pending response promise.
        return await Promise.race([response.finally(() => pending--), interrupted])
      } finally {
        clearTimeout(timer)
        disposals.delete(cancel)
        requestOptions.signal?.removeEventListener('abort', cancel)
        cancellation.dispose()
      }
    },
    dispose
  }
}
