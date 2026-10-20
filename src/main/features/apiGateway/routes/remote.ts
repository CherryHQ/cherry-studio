import type { AnyElysia } from 'elysia'

import { application } from '@application'
import { remoteConnectPath } from '@cherrystudio/remote-protocol'
import type { RemoteSocket } from '@cherrystudio/remote-transport'

export const REMOTE_CONNECT_PATH = remoteConnectPath

/** RemoteSocketStream needs the underlying socket's EventTarget and backpressure APIs. */
function underlyingSocket(raw: unknown): RemoteSocket | undefined {
  const peer = raw as { websocket?: unknown; _internal?: { ws?: unknown } }
  const socket = peer.websocket ?? peer._internal?.ws
  return socket && typeof (socket as RemoteSocket).send === 'function' ? (socket as RemoteSocket) : undefined
}

/**
 * Encrypted remote-access ingress for paired devices; pairing, configuration and Agent methods live
 * behind it. `.ws()` binds to the adapter of the app it is called on, so this is a functional plugin
 * rather than a detached `new Elysia()` instance, which would register a WebSocket the node adapter
 * never sees.
 */
export const remoteRoutes = (app: AnyElysia) =>
  app.ws(REMOTE_CONNECT_PATH, {
    detail: { hide: true },
    open(ws) {
      const socket = underlyingSocket(ws.raw)
      if (!socket) {
        ws.close(1011, 'Unsupported WebSocket adapter')
        return
      }
      application.get('RemoteAccessService').accept(socket, ws.remoteAddress ?? '')
    },
    message() {},
    close() {}
  })
