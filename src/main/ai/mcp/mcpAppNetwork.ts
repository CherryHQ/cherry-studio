import { net } from 'electron'

import { denyGuestNetwork } from '@main/core/security/guestNetwork'

export async function installMcpAppNetworkPolicy(session: Electron.Session, origins: readonly string[]) {
  // Covers transports Chromium does not send through the HTTPS handler.
  await denyGuestNetwork(session)
  const allowed = new Set(origins)
  const closed = new AbortController()
  session.protocol.handle('https', (request) => {
    const url = new URL(request.url)
    if (!allowed.has(url.origin) || url.username || url.password) return new Response(null, { status: 403 })

    return net.fetch(request, {
      bypassCustomProtocolHandlers: true,
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, closed.signal])
    })
  })
  return () => {
    closed.abort()
    session.protocol.unhandle('https')
  }
}
