/**
 * When the gateway binds the LAN (`0.0.0.0`) the same listener serves both the
 * desktop's own loopback consumers and remote mobile clients. Only the pairing
 * bootstrap and the paired-device provider export are meant to cross the LAN;
 * the generation, MCP, and knowledge routes must stay loopback-only (an exposed
 * MCP proxy is remote tool execution, and the chat routes leak the desktop API
 * key over the wire). This screens every request by its socket peer: loopback
 * and in-process callers are unrestricted, a remote peer may reach only the
 * allow-listed routes.
 */

/** Routes a non-loopback (LAN) client is permitted to reach. */
const LAN_ALLOWED_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ['POST', '/pair'],
  ['GET', '/v1/export/providers']
]

/**
 * A missing address is treated as loopback: it only occurs for in-process
 * `app.handle()` calls that never touch a socket, never for a real remote peer.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return true
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
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
 * Returns a 403 body to short-circuit a LAN request that targets a loopback-only
 * route, or `undefined` to let the request proceed.
 */
export function screenLanRequest(request: Request, pathname: string): { error: string } | undefined {
  if (isLoopbackAddress(readRemoteAddress(request))) return undefined
  if (isLanAllowedRoute(request.method, pathname)) return undefined
  return { error: 'Forbidden: this endpoint is not reachable over the LAN' }
}
