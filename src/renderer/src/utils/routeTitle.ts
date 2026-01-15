import i18n from '@renderer/i18n'

/** Base URL for parsing relative route paths */
const BASE_URL = 'https://www.cherry-ai.com/'

/**
 * Route to i18n key mapping for default tab titles
 */
const routeTitleKeys: Record<string, string> = {
  '/': 'title.home',
  '/home': 'title.home',
  '/app/chat': 'common.chat',
  '/app/assistant': 'title.store',
  '/app/paintings': 'title.paintings',
  '/app/translate': 'title.translate',
  '/app/minapp': 'title.apps',
  '/app/knowledge': 'title.knowledge',
  '/app/files': 'title.files',
  '/app/code': 'title.code',
  '/app/notes': 'title.notes',
  '/settings': 'title.settings'
}

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
 * getDefaultRouteTitle('/app/chat/abc123') // '助手'
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
