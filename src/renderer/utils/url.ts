export function getUrlOriginOrFallback(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** Protocols the proxy settings and Electron's proxy stack accept. */
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:'])

/**
 * 检查 URL 是否是有效的代理 URL。
 * @param {string} url 代理 URL
 * @returns {boolean} 是否有效
 */
export const isValidProxyUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return PROXY_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname)
  } catch {
    return false
  }
}
