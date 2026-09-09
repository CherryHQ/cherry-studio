import { loggerService } from '@logger'
import type { WebviewTag } from 'electron'

const logger = loggerService.withContext('MiniAppWebviewService')

type WebviewStateListener = (loaded: boolean) => void
type WebviewElementListener = () => void

class MiniAppWebviewService {
  private readonly globalWebviewStates = new Map<string, boolean>()
  private readonly globalWebviewElements = new Map<string, WebviewTag>()

  private readonly appListeners = new Map<string, Set<WebviewStateListener>>()
  private readonly elementListeners = new Map<string, Set<WebviewElementListener>>()

  private readonly emitState = (appId: string, loaded: boolean) => {
    const listeners = this.appListeners.get(appId)
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

  private readonly emitElementChange = (appId: string) => {
    const listeners = this.elementListeners.get(appId)
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

  readonly setWebviewElement = (appId: string, element: WebviewTag | null) => {
    if (this.getWebviewElement(appId) === element) return
    if (element) this.globalWebviewElements.set(appId, element)
    else this.globalWebviewElements.delete(appId)
    this.emitElementChange(appId)
  }

  readonly getWebviewElement = (appId: string): WebviewTag | null => {
    return this.globalWebviewElements.get(appId) ?? null
  }

  readonly onWebviewElementChange = (appId: string, listener: WebviewElementListener): (() => void) => {
    let listeners = this.elementListeners.get(appId)
    if (!listeners) {
      listeners = new Set<WebviewElementListener>()
      this.elementListeners.set(appId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.elementListeners.delete(appId)
    }
  }

  readonly setWebviewLoaded = (appId: string, loaded: boolean) => {
    this.globalWebviewStates.set(appId, loaded)
    logger.debug(`WebView state set for ${appId}: ${loaded}`)
    this.emitState(appId, loaded)
  }

  readonly getWebviewLoaded = (appId: string): boolean => {
    return this.globalWebviewStates.get(appId) || false
  }

  readonly clearWebviewState = (appId: string) => {
    const wasLoaded = this.globalWebviewStates.delete(appId)
    const hadElement = this.globalWebviewElements.delete(appId)
    if (wasLoaded) {
      logger.debug(`WebView state cleared for ${appId}`)
    }
    // Mounted subscribers must observe both eviction and replacement.
    this.emitState(appId, false)
    if (hadElement) this.emitElementChange(appId)
  }

  readonly clearAllWebviewStates = () => {
    const count = this.globalWebviewStates.size
    this.globalWebviewStates.clear()
    this.globalWebviewElements.clear()
    logger.debug(`Cleared all WebView states (${count} apps)`)
    this.appListeners.clear()
    this.elementListeners.clear()
  }

  readonly getLoadedAppIds = (): string[] => {
    return Array.from(this.globalWebviewStates.entries())
      .filter(([, loaded]) => loaded)
      .map(([appId]) => appId)
  }

  readonly onWebviewStateChange = (appId: string, listener: WebviewStateListener): (() => void) => {
    let listeners = this.appListeners.get(appId)
    if (!listeners) {
      listeners = new Set<WebviewStateListener>()
      this.appListeners.set(appId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.appListeners.delete(appId)
    }
  }

  readonly waitForWebviewLoaded = (appId: string, timeout = 15000): Promise<boolean> => {
    if (this.getWebviewLoaded(appId)) return Promise.resolve(true)
    return new Promise((resolve) => {
      let done = false
      const unsubscribe = this.onWebviewStateChange(appId, (loaded) => {
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

  readonly getWebviewElements = () => this.globalWebviewElements.entries()
}

export const miniAppWebviewService = new MiniAppWebviewService()

export const {
  setWebviewElement,
  getWebviewElement,
  onWebviewElementChange,
  setWebviewLoaded,
  getWebviewLoaded,
  clearWebviewState,
  clearAllWebviewStates,
  getLoadedAppIds,
  onWebviewStateChange,
  waitForWebviewLoaded,
  getWebviewElements
} = miniAppWebviewService
