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
