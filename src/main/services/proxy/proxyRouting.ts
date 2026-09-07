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

/**
 * The routing policy ProxyService hands to an isolated runtime (currently the inference
 * worker). It carries the *rules*, not a pre-computed verdict per origin: a model download
 * redirects across origins (`huggingface.co` -> `us.aws.cdn.hf.co`,
 * `www.modelscope.cn` -> `cdn-lfs-cn-1.modelscope.cn`), so the set of origins to judge is
 * not knowable up front. A table of pre-evaluated origins would send every later hop to the
 * proxy — exposing traffic the user's rules exempt, and breaking downloads for anyone whose
 * proxy cannot reach the CDN. ProxyService remains the single owner of the policy; the
 * consumer only applies it, through the shared matcher in `bypassRules.ts`.
 */
export type ProxyRoutingSnapshot =
  | { version: number; mode: 'direct' }
  | {
      version: number
      mode: 'proxy'
      endpoint: ProxyEndpoint
      /** Normalized Electron-style bypass rules, evaluated per hop by the consumer. */
      bypassRules: string[]
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

export function createProxyRoutingSnapshot(
  version: number,
  endpoint: ProxyEndpoint | null,
  bypassRules: readonly string[]
): ProxyRoutingSnapshot {
  if (!endpoint) return { version, mode: 'direct' }
  return { version, mode: 'proxy', endpoint: { ...endpoint }, bypassRules: [...bypassRules] }
}
