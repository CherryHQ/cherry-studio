import { loggerService } from '@logger'

const logger = loggerService.withContext('WebviewStateManager')

// Global WebView loaded states - shared between popup and tab modes
const globalWebviewStates = new Map<string, boolean>()

/**
 * Set WebView loaded state for a specific app
 * @param appId - The mini-app ID
 * @param loaded - Whether the WebView is loaded
 */
export const setWebviewLoaded = (appId: string, loaded: boolean) => {
  globalWebviewStates.set(appId, loaded)
  logger.debug(`WebView state set for ${appId}: ${loaded}`)
}

/**
 * Get WebView loaded state for a specific app
 * @param appId - The mini-app ID
 * @returns Whether the WebView is loaded
 */
export const getWebviewLoaded = (appId: string): boolean => {
  return globalWebviewStates.get(appId) || false
}

/**
 * Clear WebView state for a specific app
 * @param appId - The mini-app ID
 */
export const clearWebviewState = (appId: string) => {
  const wasLoaded = globalWebviewStates.delete(appId)
  if (wasLoaded) {
    logger.debug(`WebView state cleared for ${appId}`)
  }
}

/**
 * Clear all WebView states
 */
export const clearAllWebviewStates = () => {
  const count = globalWebviewStates.size
  globalWebviewStates.clear()
  logger.debug(`Cleared all WebView states (${count} apps)`)
}

/**
 * Get all loaded app IDs
 * @returns Array of app IDs that have loaded WebViews
 */
export const getLoadedAppIds = (): string[] => {
  return Array.from(globalWebviewStates.entries())
    .filter(([, loaded]) => loaded)
    .map(([appId]) => appId)
}
