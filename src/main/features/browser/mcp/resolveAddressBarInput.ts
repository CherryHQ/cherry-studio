const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const HOST_PORT_PATTERN = /^(?:\[[^\]]+\]|[^:/?#\s]+):\d+(?:[/?#]|$)/
const LOCAL_ADDRESS_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export type AddressBarResolution =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string }
  | { kind: 'invalid' }

/**
 * Resolve what the user typed into the standalone browser window's address bar.
 *
 * Input with spaces is a search term; a single token that parses as a host is a
 * URL. Explicit schemes must survive URL validation with an allowed protocol, so
 * typos like `htp://` become `invalid` instead of a mangled `https://htp://…`
 * navigation. `file:` is rejected: ordinary guests in this window cannot open
 * local files. Invalid results must never reach `loadURL` — Chromium would
 * canonicalize them into a punycode-with-%20 address and show it in the bar.
 */
export function resolveAddressBarInput(value: string): AddressBarResolution {
  const trimmed = value.trim()
  if (!trimmed) return { kind: 'invalid' }

  if (URL_SCHEME_PATTERN.test(trimmed) && !HOST_PORT_PATTERN.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return ALLOWED_PROTOCOLS.has(url.protocol) ? { kind: 'url', url: url.toString() } : { kind: 'invalid' }
    } catch {
      return { kind: 'invalid' }
    }
  }

  if (LOCAL_ADDRESS_PATTERN.test(trimmed)) {
    try {
      return { kind: 'url', url: new URL(`http://${trimmed}`).toString() }
    } catch {
      return { kind: 'invalid' }
    }
  }

  if (/\s/.test(trimmed)) return { kind: 'search', query: trimmed }

  try {
    const url = new URL(`https://${trimmed}`)
    return url.hostname.includes('.') ? { kind: 'url', url: url.toString() } : { kind: 'search', query: trimmed }
  } catch {
    return { kind: 'search', query: trimmed }
  }
}
