import type { AnyElysia } from 'elysia'

import { application } from '@application'
import { remoteConnectPath } from '@cherrystudio/remote-protocol'
import type { RemoteSocket } from '@cherrystudio/remote-transport'

export const REMOTE_CONNECT_PATH = remoteConnectPath

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native adapter sockets are opaque until every listener, binary, and backpressure capability required by RemoteSocket is verified.
function isRemoteSocket(socket: unknown): socket is RemoteSocket {
  return (
    typeof socket === 'object' &&
    socket !== null &&
    'binaryType' in socket &&
    typeof socket.binaryType === 'string' &&
    'bufferedAmount' in socket &&
    typeof socket.bufferedAmount === 'number' &&
    'readyState' in socket &&
    typeof socket.readyState === 'number' &&
    'send' in socket &&
    typeof socket.send === 'function' &&
    'close' in socket &&
    typeof socket.close === 'function' &&
    'addEventListener' in socket &&
    typeof socket.addEventListener === 'function' &&
    'removeEventListener' in socket &&
    typeof socket.removeEventListener === 'function'
  )
}

/** RemoteSocketStream needs the underlying socket's EventTarget and backpressure APIs. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Elysia's Node adapter exposes a crossws peer behind its Bun-shaped raw type; verify the native socket's complete transport capabilities.
function underlyingSocket(raw: unknown): RemoteSocket | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const exposedSocket = 'websocket' in raw ? raw.websocket : undefined
  if (exposedSocket != null) return isRemoteSocket(exposedSocket) ? exposedSocket : undefined
  const internal = '_internal' in raw ? raw._internal : undefined
  const socket = typeof internal === 'object' && internal !== null && 'ws' in internal ? internal.ws : undefined
  return isRemoteSocket(socket) ? socket : undefined
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
