import i18n from '@renderer/i18n'

/**
 * Route to i18n key mapping for default tab titles
 */
const routeTitleKeys: Record<string, string> = {
  '/': 'tab.new',
  '/chat': 'assistants.title',
  '/store': 'assistants.presets.title',
  '/paintings': 'paintings.title',
  '/translate': 'translate.title',
  '/apps': 'minapp.title',
  '/knowledge': 'knowledge.title',
  '/files': 'files.title',
  '/code': 'code.title',
  '/notes': 'notes.title',
  '/settings': 'settings.title'
}

/**
 * Get the default title for a route URL
 *
 * @param url - Route URL (e.g., '/settings', '/chat/123')
 * @returns Translated title or URL path fallback
 *
 * @example
 * getDefaultRouteTitle('/settings') // '设置'
 * getDefaultRouteTitle('/chat/abc123') // '助手'
 * getDefaultRouteTitle('/unknown') // 'unknown'
 */
export function getDefaultRouteTitle(url: string): string {
  // Try exact match first
  const exactKey = routeTitleKeys[url]
  if (exactKey) {
    return i18n.t(exactKey)
  }

  // Try matching base path (e.g., '/chat/123' -> '/chat')
  const basePath = '/' + url.split('/').filter(Boolean)[0]
  const baseKey = routeTitleKeys[basePath]
  if (baseKey) {
    return i18n.t(baseKey)
  }

  // Fallback to URL path
  return url.split('/').pop() || url
}

/**
 * Get the i18n key for a route (without translating)
 */
export function getRouteTitleKey(url: string): string | undefined {
  const exactKey = routeTitleKeys[url]
  if (exactKey) return exactKey

  const basePath = '/' + url.split('/').filter(Boolean)[0]
  return routeTitleKeys[basePath]
}
