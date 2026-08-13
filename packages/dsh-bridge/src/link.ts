import net from 'node:net'

import {
  type BridgeToHostMessage,
  type BridgeToolCallResult,
  createBridgeFrameDecoder,
  encodeBridgeMessage,
  type HostToBridgeMessage
} from './protocol'

export interface BridgeLink {
  /** False after 'error'/'close'; there is no reconnect — the host owns this process. */
  readonly connected: boolean
  send(message: BridgeToHostMessage): void
  callTool(
    request: { sessionId: string; name: string; args: unknown },
    signal?: AbortSignal
  ): Promise<BridgeToolCallResult>
}

export function connectBridgeLink(options: {
  socketPath: string
  onMessage: (message: HostToBridgeMessage) => void
  onDisconnect: () => void
}): BridgeLink {
  const socket = net.connect(options.socketPath)
  let connected = true
  let toolCallSeq = 0
  const pendingToolCalls = new Map<
    string,
    {
      resolve: (result: BridgeToolCallResult) => void
      reject: (error: Error) => void
      signal?: AbortSignal
      onAbort?: () => void
    }
  >()

  const takeToolCall = (id: string) => {
    const pending = pendingToolCalls.get(id)
    if (!pending) return undefined
    pendingToolCalls.delete(id)
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
    return pending
  }

  const markDisconnected = () => {
    if (!connected) return
    connected = false
    for (const id of pendingToolCalls.keys()) {
      takeToolCall(id)?.reject(new Error('dsh bridge host disconnected'))
    }
    options.onDisconnect()
  }
  socket.on('error', markDisconnected)
  socket.on('close', markDisconnected)
  // Frames are trusted between the two Cherry-owned endpoints; shape holds by contract.
  socket.on(
    'data',
    createBridgeFrameDecoder((message) => {
      const frame = message as HostToBridgeMessage
      if (frame.type === 'toolCallResult') {
        const pending = takeToolCall(frame.id)
        if (!pending) return
        if (frame.ok) pending.resolve({ text: frame.text, ...(frame.data === undefined ? {} : { data: frame.data }) })
        else pending.reject(new Error(frame.error))
        return
      }
      options.onMessage(frame)
    })
  )

  return {
    get connected() {
      return connected
    },
    send(message) {
      if (connected) socket.write(encodeBridgeMessage(message))
    },
    callTool(request, signal) {
      if (!connected) return Promise.reject(new Error('dsh bridge host is not connected'))
      if (signal?.aborted) return Promise.reject(abortError())
      const id = `tool-${++toolCallSeq}`
      return new Promise<BridgeToolCallResult>((resolve, reject) => {
        const pending = { resolve, reject, signal, onAbort: undefined as (() => void) | undefined }
        if (signal) {
          pending.onAbort = () => {
            if (takeToolCall(id)) reject(abortError())
          }
          signal.addEventListener('abort', pending.onAbort, { once: true })
        }
        pendingToolCalls.set(id, pending)
        socket.write(encodeBridgeMessage({ type: 'toolCall', id, ...request }))
      })
    }
  }
}

function abortError(): Error {
  const error = new Error('dsh bridge tool call aborted')
  error.name = 'AbortError'
  return error
}
