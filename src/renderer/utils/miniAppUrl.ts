export const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

/**
 * Extract the appId from a `/app/mini-app/<id>` URL, or null otherwise.
 * Splits on `/`, `?`, and `#` so a future query/hash suffix never bleeds
 * into the extracted id.
 */
export function miniAppIdFromTabUrl(url: string): string | null {
  if (!url.startsWith(MINI_APP_ROUTE_PREFIX)) return null
  const id = url.slice(MINI_APP_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0]
  return id ? id : null
}
