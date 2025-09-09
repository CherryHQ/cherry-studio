import { loggerService } from '@logger'

const logger = loggerService.withContext('WebviewStateManager')

// Global WebView loaded states - shared between popup and tab modes
const globalWebviewStates = new Map<string, boolean>()

// Per-app listeners (fine grained)
type WebviewStateListener = (loaded: boolean) => void
const appListeners = new Map<string, Set<WebviewStateListener>>()

const emitState = (appId: string, loaded: boolean) => {
  const listeners = appListeners.get(appId)
  if (listeners && listeners.size) {
    listeners.forEach((cb) => {
      try {
        cb(loaded)
      } catch (e) {
        // Swallow listener errors to avoid breaking others
        logger.debug(`Listener error for ${appId}: ${(e as Error).message}`)
      }
    })
  }
}

/**
 * Set WebView loaded state for a specific app
 * @param appId - The mini-app ID
 * @param loaded - Whether the WebView is loaded
 */
export const setWebviewLoaded = (appId: string, loaded: boolean) => {
  globalWebviewStates.set(appId, loaded)
  logger.debug(`WebView state set for ${appId}: ${loaded}`)
  emitState(appId, loaded)
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
  // 清掉监听（避免潜在内存泄漏）
  appListeners.delete(appId)
}

/**
 * Clear all WebView states
 */
export const clearAllWebviewStates = () => {
  const count = globalWebviewStates.size
  globalWebviewStates.clear()
  logger.debug(`Cleared all WebView states (${count} apps)`)
  appListeners.clear()
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

/**
 * Subscribe to a specific app's webview loaded state changes.
 * Returns an unsubscribe function.
 */
export const onWebviewStateChange = (appId: string, listener: WebviewStateListener): (() => void) => {
  let listeners = appListeners.get(appId)
  if (!listeners) {
    listeners = new Set<WebviewStateListener>()
    appListeners.set(appId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners!.delete(listener)
    if (listeners!.size === 0) appListeners.delete(appId)
  }
}

/**
 * Promise helper: wait until the webview becomes loaded.
 * Optional timeout (ms) to avoid hanging forever; resolves false on timeout.
 */
export const waitForWebviewLoaded = (appId: string, timeout = 15000): Promise<boolean> => {
  if (getWebviewLoaded(appId)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const unsubscribe = onWebviewStateChange(appId, (loaded) => {
      if (!loaded) return
      if (done) return
      done = true
      unsubscribe()
      resolve(true)
    })
    if (timeout > 0) {
      setTimeout(() => {
        if (done) return
        done = true
        unsubscribe()
        resolve(false)
      }, timeout)
    }
  })
}
