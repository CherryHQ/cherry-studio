import { application } from '@application'

import { REMOTE_CONNECT_PATH } from './routes/remote'

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

function isModelApiRequest(request: Request, pathname: string): boolean {
  if (request.method === 'GET') return /^\/v1\/models\/?$/.test(pathname)
  return (
    request.method === 'POST' &&
    (/^\/v1\/(?:chat\/completions|responses|messages(?:\/count_tokens)?)\/?$/.test(pathname) ||
      /^\/v1beta\/models\/.+:(?:generateContent|streamGenerateContent|countTokens)\/?$/.test(pathname))
  )
}

export function allowsKeylessModelRequest(request: Request): boolean {
  const peer = readRemoteAddress(request)
  if (!peer || !isLoopbackAddress(peer)) return false
  const url = new URL(request.url)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false
  const host = request.headers.get('host')
  if (host !== null && host.toLowerCase() !== url.host) return false
  if (!isModelApiRequest(request, url.pathname)) return false
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  const hasCredential = ['authorization', 'x-api-key', 'x-goog-api-key'].some((name) => request.headers.has(name))
  return (
    (origin === null || origin === url.origin) &&
    (fetchSite === null || fetchSite === 'same-origin' || fetchSite === 'none') &&
    (!hasCredential || !application.get('ApiGatewayService').isInternalRequest(request.headers))
  )
}

export function screenLanRequest(request: Request, pathname: string): { error: string } | undefined {
  const preferences = application.get('PreferenceService')
  const enabled = preferences.get('feature.api_gateway.enabled')
  const pairingEnabled = enabled && preferences.get('feature.api_gateway.host') === '0.0.0.0'
  if (pathname === REMOTE_CONNECT_PATH && !pairingEnabled) return { error: 'Forbidden: LAN access is disabled' }
  if (isLoopbackAddress(readRemoteAddress(request))) return undefined
  if (!enabled) return { error: 'Forbidden: LAN access is disabled' }
  if (
    pairingEnabled &&
    request.method === 'GET' &&
    pathname === REMOTE_CONNECT_PATH &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket'
  )
    return undefined
  if (preferences.get('feature.api_gateway.lan_http_enabled') === true && isModelApiRequest(request, pathname)) {
    return undefined
  }
  return { error: 'Forbidden: this endpoint is not reachable over the LAN' }
}
