import net from 'node:net'

import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'

import type { BridgeNotificationMap, BridgePluginRequestMap, BridgeToolCallResult } from './protocol'

export interface BridgeLink {
  /** False after 'error'/'close'; there is no reconnect — the host owns this process. */
  readonly connected: boolean
  request<M extends keyof BridgePluginRequestMap>(
    method: M,
    params: BridgePluginRequestMap[M]['params'],
    signal?: AbortSignal
  ): Promise<BridgePluginRequestMap[M]['result']>
  /** Fire-and-forget; silently dropped once disconnected (the host is gone either way). */
  notify<M extends keyof BridgeNotificationMap>(method: M, params: BridgeNotificationMap[M]): void
  callTool(
    request: { sessionId: string; name: string; args: unknown },
    signal?: AbortSignal
  ): Promise<BridgeToolCallResult>
}

export function connectBridgeLink(options: {
  socketPath: string
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown>
}): BridgeLink {
  const socket = net.connect(options.socketPath)
  const transport = new JsonRpcLineTransport(socket, socket)
  let connected = true
  let toolCallSeq = 0

  const markDisconnected = () => {
    if (!connected) return
    connected = false
    // Fail closed: every in-flight request (tool calls, approvals) rejects here.
    transport.close()
  }
  socket.on('error', markDisconnected)
  socket.on('close', markDisconnected)
  transport.onRequest(options.onRequest)
  transport.start()

  function request<M extends keyof BridgePluginRequestMap>(
    method: M,
    params: BridgePluginRequestMap[M]['params'],
    signal?: AbortSignal
  ): Promise<BridgePluginRequestMap[M]['result']> {
    return transport.request(method, params, signal) as Promise<BridgePluginRequestMap[M]['result']>
  }

  return {
    get connected() {
      return connected
    },
    request,
    notify(method, params) {
      if (connected) transport.notify(method, params)
    },
    callTool(toolRequest, signal) {
      if (!connected) return Promise.reject(new Error('dsh bridge host is not connected'))
      const callId = `tool-${++toolCallSeq}`
      const onAbort = () => {
        if (connected) transport.notify('tool/cancel', { sessionId: toolRequest.sessionId, callId })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      return request('tool/call', { ...toolRequest, callId }, signal).finally(() =>
        signal?.removeEventListener('abort', onAbort)
      )
    }
  }
}
