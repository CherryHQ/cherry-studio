import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('ProtocolService:navigate')

const ALLOWED_ROUTE_PREFIXES = [
  '/settings',
  '/agents',
  '/knowledge',
  '/openclaw',
  '/paintings',
  '/translate',
  '/files',
  '/notes',
  '/apps',
  '/code',
  '/store',
  '/launchpad'
]

const isAllowedRoute = (path: string): boolean =>
  ALLOWED_ROUTE_PREFIXES.some((route) => path === route || path.startsWith(`${route}/`))

/**
 * Handle cherrystudio://navigate/<path> deep links.
 *
 * Examples:
 *   cherrystudio://navigate/settings/provider
 *   cherrystudio://navigate/agents
 *   cherrystudio://navigate/knowledge
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
    application.get('SettingsWindowService').openUsingPreference(normalizeSettingsPath(fullPath))
    return
  }

  const navigateMainWindow = async () => {
    const mainWindow = application.get('MainWindowService').getMainWindow()

    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.warn('Main window not available, retrying in 1s')
      setTimeout(() => handleNavigateProtocolUrl(url), 1000)
      return
    }

    try {
      const hasNavigate = await mainWindow.webContents.executeJavaScript(`typeof window.navigate === 'function'`)

      if (!hasNavigate) {
        logger.warn('window.navigate not available yet, retrying in 1s')
        setTimeout(() => handleNavigateProtocolUrl(url), 1000)
        return
      }

      await mainWindow.webContents.executeJavaScript(`window.navigate({ to: ${JSON.stringify(fullPath)} })`)
      if (isMac) {
        application.get('MainWindowService').showMainWindow()
      }
    } catch (error) {
      logger.error('Failed to navigate:', error as Error)
    }
  }

  void navigateMainWindow()
}
