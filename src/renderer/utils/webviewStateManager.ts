import { loggerService } from '@logger'
import type { WebviewTag } from 'electron'

const logger = loggerService.withContext('WebviewStateManager')

// Global WebView loaded states - shared between popup and tab modes
const globalWebviewStates = new Map<string, boolean>()
const globalWebviewElements = new Map<string, WebviewTag>()

// Per-app listeners (fine grained)
type WebviewStateListener = (loaded: boolean) => void
const appListeners = new Map<string, Set<WebviewStateListener>>()
type WebviewElementListener = () => void
const elementListeners = new Map<string, Set<WebviewElementListener>>()

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

const emitElementChange = (appId: string) => {
  const listeners = elementListeners.get(appId)
  if (listeners && listeners.size) {
    listeners.forEach((cb) => {
      try {
        cb()
      } catch (e) {
        logger.debug(`Element listener error for ${appId}: ${(e as Error).message}`)
      }
    })
  }
}

export const setWebviewElement = (appId: string, element: WebviewTag | null) => {
  if (getWebviewElement(appId) === element) return
  if (element) globalWebviewElements.set(appId, element)
  else globalWebviewElements.delete(appId)
  emitElementChange(appId)
}

export const getWebviewElement = (appId: string): WebviewTag | null => {
  return globalWebviewElements.get(appId) ?? null
}

export const onWebviewElementChange = (appId: string, listener: WebviewElementListener): (() => void) => {
  let listeners = elementListeners.get(appId)
  if (!listeners) {
    listeners = new Set<WebviewElementListener>()
    elementListeners.set(appId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) elementListeners.delete(appId)
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
  const hadElement = globalWebviewElements.delete(appId)
  if (wasLoaded) {
    logger.debug(`WebView state cleared for ${appId}`)
  }
  // Keep mounted consumers in sync when an LRU eviction destroys the WebView.
  // Subscribers own their cleanup; removing them here would leave their local
  // ready state stale and prevent them from observing a replacement WebView.
  emitState(appId, false)
  if (hadElement) emitElementChange(appId)
}

/**
 * Clear all WebView states
 */
export const clearAllWebviewStates = () => {
  const count = globalWebviewStates.size
  globalWebviewStates.clear()
  globalWebviewElements.clear()
  logger.debug(`Cleared all WebView states (${count} apps)`)
  appListeners.clear()
  elementListeners.clear()
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
    listeners.delete(listener)
    if (listeners.size === 0) appListeners.delete(appId)
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
