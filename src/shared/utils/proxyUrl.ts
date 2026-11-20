const PROXY_URL = /^(?:https?|socks[45]?):\/\/[^/\\?#\s]+\/?$/i
const PROXY_HOSTNAME = /^(?:[a-z\d_.-]+|\[[a-f\d:.]+\])$/i

/** Parse the endpoint entered in proxy settings. Chromium proxy-rule syntax is a separate input. */
export function parseCustomProxyUrl(value: string): URL | null {
  const endpoint = value.trim()
  if (!PROXY_URL.test(endpoint)) return null

  try {
    const url = new URL(endpoint)
    if (!url.hostname || url.port === '0' || (url.protocol.startsWith('socks') && !url.port)) return null

    // SOCKS URLs use opaque hosts in WHATWG URL. Canonicalize with the same host rules as HTTP.
    const { hostname } = new URL(`http://${url.hostname}`)
    if (!PROXY_HOSTNAME.test(hostname)) return null
    url.hostname = hostname
    return url
  } catch {
    return null
  }
}
