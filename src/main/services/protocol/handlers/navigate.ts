import { loggerService } from '@logger'
import { isAllowedRoute, openRouteInMainWindow, openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('ProtocolService:navigate')

/**
 * Handle cherrystudio://navigate/<path> deep links.
 *
 * Examples:
 *   cherrystudio://navigate/settings/provider
 *   cherrystudio://navigate/agents
 *   cherrystudio://navigate/knowledge
 *
 * Delivery (window creation, focus, live-window event vs cold-start init data)
 * is entirely owned by openRouteInMainWindow — no retry loop is needed here.
 */
export function handleNavigateProtocolUrl(url: URL) {
  const targetPath = url.pathname || '/'
  const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`

  if (!isAllowedRoute(normalizedPath)) {
    logger.warn(`Blocked navigation to disallowed route: ${normalizedPath}`)
    return
  }

  // Preserve query parameters from the URL
  const queryString = url.search || ''
  const fullPath = `${normalizedPath}${queryString}`

  logger.debug('handleNavigateProtocolUrl', { path: fullPath })

  if (fullPath.startsWith('/settings/')) {
    openSettingsInMainWindow(normalizeSettingsPath(fullPath))
    return
  }

  openRouteInMainWindow(fullPath)
}
