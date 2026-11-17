// Parsing base only: the WHATWG URL API rejects relative input. Its protocol and host are
// what discriminate app routes from absolute urls, so it must never be a real site.
const APP_ROUTE_BASE = 'app://app-route.invalid'

/** Parse an app-relative url (`/app/chat?x=1`); returns null for anything that is not an app route. */
export function parseAppRouteUrl(url: string): URL | null {
  const parsed = URL.parse(url, APP_ROUTE_BASE)
  if (!parsed || parsed.origin !== 'null' || parsed.protocol !== 'app:' || parsed.host !== 'app-route.invalid') {
    return null
  }
  return parsed
}
