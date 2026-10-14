import { application } from '@application'

import { REMOTE_CONNECT_PATH } from './routes/remote'

/**
 * When the gateway binds the LAN (`0.0.0.0`) the same listener serves the
 * desktop's own loopback consumers and the encrypted WebSocket upgrade used by
 * remote devices. No other HTTP route may cross the LAN: an exposed MCP proxy is
 * remote tool execution, and the chat routes leak the desktop API key over the
 * wire. This screens every request by its socket peer.
 */

/**
 * A missing address is treated as loopback: it only occurs for in-process
 * `app.handle()` calls that never touch a socket, never for a real remote peer.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return true
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/** The srvx Node request exposes the peer address as `.ip` (its raw socket underneath). */
function readRemoteAddress(request: Request): string | undefined {
  const carrier = request as {
    ip?: string
    runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } }
  }
  return carrier.ip ?? carrier.runtime?.node?.req?.socket?.remoteAddress
}

/** Returns a 403 body for a non-loopback request unless it is the remote-access upgrade. */
export function screenLanRequest(request: Request, pathname: string): { error: string } | undefined {
  const preferences = application.get('PreferenceService')
  const enabled =
    preferences.get('feature.api_gateway.enabled') && preferences.get('feature.api_gateway.host') === '0.0.0.0'
  if (pathname === REMOTE_CONNECT_PATH && !enabled) return { error: 'Forbidden: LAN access is disabled' }
  if (isLoopbackAddress(readRemoteAddress(request))) return undefined
  if (!enabled) return { error: 'Forbidden: LAN access is disabled' }
  if (
    request.method === 'GET' &&
    pathname === REMOTE_CONNECT_PATH &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket'
  )
    return undefined
  return { error: 'Forbidden: this endpoint is not reachable over the LAN' }
}
