export function proxyUrlFromChromiumRoute(route: string, configuredUrl?: string): string | undefined {
  // Choose the first PAC route only. Never silently fall back direct if its
  // proxy fails, even when a later candidate is DIRECT.
  const first = route.split(';')[0].trim()
  if (first.toUpperCase() === 'DIRECT') return undefined
  const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\S+)$/i.exec(first)
  if (!match) throw new Error('Unsupported app proxy route')
  const schemes: Record<string, string> = {
    PROXY: 'http',
    HTTPS: 'https',
    SOCKS: 'socks4',
    SOCKS4: 'socks4',
    SOCKS5: 'socks5'
  }
  const resolved = new URL(`${schemes[match[1].toUpperCase()]}://${match[2]}`)
  normalizeProxyEndpoint(resolved.toString())
  if (configuredUrl) {
    const configured = new URL(configuredUrl)
    const configuredProtocol = configured.protocol === 'socks:' ? 'socks5:' : configured.protocol
    if (configuredProtocol === resolved.protocol && configured.host === resolved.host) return configured.toString()
  }
  return resolved.toString()
}

export type ProxyEndpoint =
  | {
      kind: 'http'
      url: string
      displayOrigin: string
    }
  | {
      kind: 'socks'
      version: 4 | 5
      host: string
      port: number
      userId?: string
      password?: string
      displayOrigin: string
    }

/** Normalize the configured proxy once in main before any runtime-local adapter consumes it. */
export function normalizeProxyEndpoint(proxyUrl: string | undefined): ProxyEndpoint | null {
  if (!proxyUrl) return null

  const url = new URL(proxyUrl)
  const displayOrigin = `${url.protocol}//${url.host}`
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'http', url: url.toString(), displayOrigin }
  }
  if (url.protocol !== 'socks:' && url.protocol !== 'socks4:' && url.protocol !== 'socks5:') {
    throw new Error(`Unsupported proxy protocol: ${url.protocol}`)
  }

  const port = Number(url.port)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SOCKS proxy URL must include a valid port')
  }
  return {
    kind: 'socks',
    version: url.protocol === 'socks4:' ? 4 : 5,
    host: url.hostname,
    port,
    userId: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    displayOrigin
  }
}
