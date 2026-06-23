import i18n from '@renderer/i18n'

/** Base URL for parsing relative route paths */
const BASE_URL = 'https://www.cherry-ai.com/'

/**
 * Route to i18n key mapping for default tab titles
 */
const routeTitleKeys: Record<string, string> = {
  '/app/chat': 'agent.session.group.conversation',
  '/app/agents': 'title.work',
  '/app/paintings': 'title.paintings',
  '/app/translate': 'title.translate',
  '/app/launchpad': 'title.launchpad',
  '/app/mini-app': 'title.apps',
  '/app/knowledge': 'title.knowledge',
  '/app/library': 'library.title',
  '/app/files': 'title.files',
  '/app/code': 'title.code',
  '/app/notes': 'title.notes',
  '/app/openclaw': 'title.openclaw',
  '/settings': 'title.settings'
}

// Sub-routes of these base paths inherit the section's default title and
// refresh on language change. Paintings qualifies because its splat route
// ignores the URL segment (the provider comes from preference), so a
// paintings sub-path tab has no per-entity title — the section title is the
// only meaningful label. Contrast /app/mini-app, which is deliberately left
// out so caller-supplied per-entity titles survive.
const autoLocalizableBasePaths = new Set(['/app/paintings'])

/**
 * Get the base path for route matching
 * For /app/* routes, returns first two segments (e.g., '/app/chat')
 * For other routes, returns first segment (e.g., '/settings')
 */
function getBasePath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'app' && segments.length >= 2) {
    return '/' + segments.slice(0, 2).join('/')
  }
  return '/' + (segments[0] || '')
}

/**
 * Get the default title for a route URL
 *
 * @param url - Route URL (e.g., '/settings', '/app/chat/123')
 * @returns Translated title or URL path fallback
 *
 * @example
 * getDefaultRouteTitle('/settings') // '设置'
 * getDefaultRouteTitle('/app/chat/abc123') // '对话'
 * getDefaultRouteTitle('/unknown') // 'unknown'
 */
export function getDefaultRouteTitle(url: string): string {
  const sanitizedUrl = new URL(url, BASE_URL).pathname

  // Try exact match first
  const exactKey = routeTitleKeys[sanitizedUrl]
  if (exactKey) {
    return i18n.t(exactKey)
  }

  // Try matching base path
  const baseKey = routeTitleKeys[getBasePath(sanitizedUrl)]
  if (baseKey) {
    return i18n.t(baseKey)
  }

  // Fallback to last segment of pathname
  const segments = sanitizedUrl.split('/').filter(Boolean)
  return segments.pop() || sanitizedUrl
}

/**
 * Get the i18n key for a route (without translating)
 */
export function getRouteTitleKey(url: string): string | undefined {
  const sanitizedUrl = new URL(url, BASE_URL).pathname

  const exactKey = routeTitleKeys[sanitizedUrl]
  if (exactKey) return exactKey

  return routeTitleKeys[getBasePath(sanitizedUrl)]
}

/**
 * True when the URL maps exactly to a known top-level route (no extra path
 * segments). Used to decide whether a tab title should be auto-localized.
 */
export function isTopLevelRoute(url: string): boolean {
  const parsedUrl = new URL(url, BASE_URL)
  return !parsedUrl.search && !parsedUrl.hash && routeTitleKeys[parsedUrl.pathname] !== undefined
}

/**
 * Routes whose tab title + icon are owned by the PAGE (the active topic /
 * session name and its assistant / agent emoji), not derived from the route.
 * Callers that auto-relabel tabs from the route (route localization, url-sync)
 * must skip these, or they clobber the page-set title/icon.
 */
const PAGE_TITLED_ROUTE_BASE_PATHS = new Set(['/app/chat', '/app/agents'])

export function isPageTitledRoute(url: string): boolean {
  const pathname = new URL(url, BASE_URL).pathname
  return PAGE_TITLED_ROUTE_BASE_PATHS.has(getBasePath(pathname))
}

/**
 * True when TabsContext can safely refresh the title from the route's default
 * i18n key after language changes.
 */
export function shouldAutoLocalizeRouteTitle(url: string): boolean {
  const pathname = new URL(url, BASE_URL).pathname
  return isTopLevelRoute(url) || pathname.startsWith('/settings') || autoLocalizableBasePaths.has(getBasePath(pathname))
}
