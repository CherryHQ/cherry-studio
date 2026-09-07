/** Ordinary browsing permits public, loopback and private-network HTTP(S) URLs. */
export function normalizeBrowserUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported browser URL')
  return url.href
}
