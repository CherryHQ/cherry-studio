import { BlockList, isIPv4 } from 'node:net'

import { application } from '@application'

/**
 * When the gateway binds the LAN (`0.0.0.0`) the same listener serves both the
 * desktop's own loopback consumers and remote mobile clients. Only the pairing
 * bootstrap, paired-device provider export, and Agent connection discovery cross the LAN;
 * the generation, MCP, and knowledge routes must stay loopback-only (an exposed
 * MCP proxy is remote tool execution, and the chat routes leak the desktop API
 * key over the wire). This screens every request by its socket peer: loopback
 * and in-process callers are unrestricted, a remote peer may reach only the
 * allow-listed routes. Pairing and provider export are LAN-only product features:
 * they answer only a peer whose address is on the LAN, never a tunnel or port forward.
 */

/** Routes a non-loopback (LAN) client is permitted to reach. */
const LAN_ALLOWED_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['POST', '/pair'],
  ['GET', '/v1/export/providers'],
  ['GET', '/v1/remote-agent']
]

/** Routes that carry a device credential in plaintext, so they are served only to a peer on the LAN itself. */
const DEVICE_CREDENTIAL_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['POST', '/pair'],
  ['GET', '/v1/export/providers']
]

/** Private, link-local, and CGNAT (Tailscale and other overlay networks) ranges. */
const LAN_PEERS = new BlockList()
LAN_PEERS.addSubnet('10.0.0.0', 8)
LAN_PEERS.addSubnet('172.16.0.0', 12)
LAN_PEERS.addSubnet('192.168.0.0', 16)
LAN_PEERS.addSubnet('169.254.0.0', 16)
LAN_PEERS.addSubnet('100.64.0.0', 10)

/**
 * A missing address is treated as loopback: it only occurs for in-process
 * `app.handle()` calls that never touch a socket, never for a real remote peer.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return true
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/** The LAN listener is IPv4-only, so an IPv6 peer is never a LAN peer. */
export function isLanPeerAddress(address: string): boolean {
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  return isIPv4(ipv4) && LAN_PEERS.check(ipv4)
}

export function isLanAllowedRoute(method: string, pathname: string): boolean {
  return LAN_ALLOWED_ROUTES.some(([allowedMethod, allowedPath]) => method === allowedMethod && pathname === allowedPath)
}

/** The srvx Node request exposes the peer address as `.ip` (its raw socket underneath). */
function readRemoteAddress(request: Request): string | undefined {
  const carrier = request as {
    ip?: string
    runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } }
  }
  return carrier.ip ?? carrier.runtime?.node?.req?.socket?.remoteAddress
}

/**
 * Returns a 403 body when LAN access is disabled or the route is loopback-only,
 * or `undefined` to let the request proceed.
 */
export function screenLanRequest(request: Request, pathname: string): { error: string } | undefined {
  const address = readRemoteAddress(request)
  // A same-machine tunnel arrives as loopback and a port forward as a public peer; neither is the LAN.
  const carriesCredential = DEVICE_CREDENTIAL_ROUTES.some(([m, path]) => request.method === m && pathname === path)
  if (carriesCredential && address && !isLanPeerAddress(address)) {
    return { error: 'Forbidden: this endpoint is only reachable from the local network' }
  }
  if (isLoopbackAddress(address)) return undefined
  // A local task can keep the listener alive after stopping; LAN access must still be revoked.
  if (application.get('PreferenceService').get('feature.api_gateway.host') !== '0.0.0.0') {
    return { error: 'Forbidden: LAN access is disabled' }
  }
  if (isLanAllowedRoute(request.method, pathname)) return undefined
  return { error: 'Forbidden: this endpoint is not reachable over the LAN' }
}
