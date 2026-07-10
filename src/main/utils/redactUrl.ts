const SCHEME_URL_RE = /^[a-z][a-z\d+.-]*:\/\//i

/**
 * Redact a configured URL for assistant-visible diagnostics. Keep only routing information;
 * never expose credentials, tenant paths, query tokens, or fragments.
 */
export function redactUrlToOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'configured'

  if (SCHEME_URL_RE.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (!url.host) return 'configured'
      return `${url.protocol}//${url.host}`
    } catch {
      return 'configured'
    }
  }

  const authority = trimmed.replace(/^\/\//, '').split(/[/?#]/, 1)[0]
  const host = authority.slice(authority.lastIndexOf('@') + 1)

  if (!host || /\s/.test(host)) return 'configured'

  try {
    const url = new URL(`http://${host}`)
    return url.host || 'configured'
  } catch {
    return 'configured'
  }
}
