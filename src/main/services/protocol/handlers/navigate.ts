import { application } from '@application'
import { loggerService } from '@logger'
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

const MAX_NAVIGATE_RETRY_ATTEMPTS = 30

/**
 * Handle cherrystudio://navigate/<path> deep links.
 *
 * Examples:
 *   cherrystudio://navigate/settings/provider
 *   cherrystudio://navigate/agents
 *   cherrystudio://navigate/knowledge
 */
export function handleNavigateProtocolUrl(url: URL, retryAttempt = 0) {
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
    application.get('SettingsWindowService').open(normalizeSettingsPath(fullPath))
    return
  }

  const navigateMainWindow = async () => {
    const mainWindow = application.get('MainWindowService').getMainWindow()

    if (!mainWindow || mainWindow.isDestroyed()) {
      if (retryAttempt >= MAX_NAVIGATE_RETRY_ATTEMPTS) {
        logger.warn('Main window not available, dropping navigation URL after retry limit', { path: fullPath })
        return
      }

      logger.warn('Main window not available, retrying in 1s', { retryAttempt: retryAttempt + 1 })
      setTimeout(() => handleNavigateProtocolUrl(url, retryAttempt + 1), 1000)
      return
    }

    try {
      const hasNavigate = await mainWindow.webContents.executeJavaScript(`typeof window.navigate === 'function'`)

      if (!hasNavigate) {
        if (retryAttempt >= MAX_NAVIGATE_RETRY_ATTEMPTS) {
          logger.warn('window.navigate not available, dropping navigation URL after retry limit', { path: fullPath })
          return
        }

        logger.warn('window.navigate not available yet, retrying in 1s', { retryAttempt: retryAttempt + 1 })
        setTimeout(() => handleNavigateProtocolUrl(url, retryAttempt + 1), 1000)
        return
      }

      await mainWindow.webContents.executeJavaScript(`window.navigate({ to: ${JSON.stringify(fullPath)} })`)
      // Always raise Main: Win/Linux used to rely on MainWindowService's
      // `second-instance` listener for this, but that listener now skips
      // protocol URLs to avoid stealing focus from Settings/OAuth flows.
      application.get('MainWindowService').showMainWindow()
    } catch (error) {
      logger.error('Failed to navigate:', error as Error)
    }
  }

  void navigateMainWindow()
}
