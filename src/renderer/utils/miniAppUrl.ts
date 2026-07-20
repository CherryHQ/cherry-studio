export const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

/** Extract the appId from a `/app/mini-app/<id>` URL, or null otherwise. */
export function miniAppIdFromTabUrl(url: string): string | null {
  if (!url.startsWith(MINI_APP_ROUTE_PREFIX)) return null
  const id = url.slice(MINI_APP_ROUTE_PREFIX.length).split('/')[0]
  return id ? id : null
}
