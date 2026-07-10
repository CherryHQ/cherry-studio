const SCHEME_URL_RE = /^[a-z][a-z\d+.-]*:\/\//i

/**
 * Redact a proxy URL for assistant-visible diagnostics. Keep only routing information; never expose
 * credentials, tenant paths, query tokens, or fragments.
 */
export function redactProxyUrlToOrigin(proxyUrl: string): string {
  const value = proxyUrl.trim()
  if (!value) return 'configured'

  if (SCHEME_URL_RE.test(value)) {
    try {
      const url = new URL(value)
      if (!url.host) return 'configured'
      return `${url.protocol}//${url.host}`
    } catch {
      return 'configured'
    }
  }

  const authority = value.replace(/^\/\//, '').split(/[/?#]/, 1)[0]
  const host = authority.slice(authority.lastIndexOf('@') + 1)

  if (!host || /\s/.test(host)) return 'configured'

  try {
    const url = new URL(`http://${host}`)
    return url.host || 'configured'
  } catch {
    return 'configured'
  }
}
