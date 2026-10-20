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
