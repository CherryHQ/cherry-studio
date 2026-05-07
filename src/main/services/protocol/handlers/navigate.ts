import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'

const logger = loggerService.withContext('ProtocolService:navigate')

// Allowed route prefixes to prevent arbitrary navigation
const ALLOWED_ROUTES = [
  '/settings/',
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
  '/launchpad',
  '/'
]

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

  if (!ALLOWED_ROUTES.some((route) => normalizedPath === route || normalizedPath.startsWith(route))) {
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

      void mainWindow.webContents.executeJavaScript(`window.navigate('${fullPath}')`)
      if (isMac) {
        application.get('MainWindowService').showMainWindow()
      }
    } catch (error) {
      logger.error('Failed to navigate:', error as Error)
    }
  }

  void navigateMainWindow()
}
