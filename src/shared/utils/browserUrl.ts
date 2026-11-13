import { isSensitiveKey } from './redaction'

/** Ordinary browsing permits public, loopback and private-network HTTP(S) URLs. */
export function normalizeBrowserUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported browser URL')
  return url.href
}

/** Explicit local HTML entries use the artifact profile and its directory-scoped file policy. */
export function normalizeBrowserEntryUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'file:') return normalizeBrowserUrl(value)
  const pathname = decodeURIComponent(url.pathname)
  if (url.hostname || pathname.startsWith('//') || pathname.includes('\\') || !/\.html?$/i.test(pathname))
    throw new Error('Unsupported local HTML URL')
  return url.href
}

/** Sanitizes HTTP(S) destinations for browsing-history and remembered-page storage. */
export function sanitizeBrowserVisitUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (!['http:', 'https:'].includes(url.protocol)) return undefined
  url.username = ''
  url.password = ''
  removeSensitiveParameters(url.searchParams)
  url.hash = sanitizeHistoryFragment(url.hash.slice(1))
  if (url.href.length > 16_384) return undefined
  return url.href
}

function removeSensitiveParameters(params: URLSearchParams): void {
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key) || /^(code|signature)$/i.test(key)) {
      params.delete(key)
    }
  }
}

function sanitizeHistoryFragment(fragment: string): string {
  const path = fragment.split('?', 1)[0]
  let decoded = path
  for (let layer = 0; layer < 8; layer++) {
    if (/[?=&]/.test(decoded)) return ''
    if (!/%[\da-f]{2}/i.test(decoded)) return path
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      return ''
    }
  }
  return ''
}
