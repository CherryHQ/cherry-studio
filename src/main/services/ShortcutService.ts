import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { handleZoomFactor } from '@main/utils/zoom'
import type { PreferenceDefaultScopeType } from '@shared/data/preference/preferenceTypes'
import { SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type {
  ShortcutDefinition,
  ShortcutHandler,
  ShortcutPreferenceKey,
  ShortcutPreferenceValue,
  ShortcutRuntimeConfig
} from '@shared/shortcuts/types'
import { coerceShortcutPreference } from '@shared/shortcuts/utils'
import type { BrowserWindow } from 'electron'
import { globalShortcut } from 'electron'

import selectionService from './SelectionService'
import { windowService } from './WindowService'

const logger = loggerService.withContext('ShortcutService')

const toAccelerator = (keys: string[]): string => keys.join('+')

const relevantDefinitions = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope !== 'renderer')

export class ShortcutService {
  private handlers = new Map<ShortcutPreferenceKey, ShortcutHandler>()
  private windowLifecycleHandlers = new Map<
    BrowserWindow,
    { onFocus: () => void; onBlur: () => void; onClosed: () => void }
  >()
  private currentWindow: BrowserWindow | null = null
  private preferenceUnsubscribers: Array<() => void> = []

  constructor() {
    this.registerBuiltInHandlers()
    this.subscribeToPreferenceChanges()
  }

  public registerHandler(key: ShortcutPreferenceKey, handler: ShortcutHandler): void {
    if (this.handlers.has(key)) {
      logger.warn(`Handler for ${key} is being overwritten`)
    }
    this.handlers.set(key, handler)
    logger.debug(`Registered handler for ${key}`)
  }

  public registerForWindow(window: BrowserWindow): void {
    if (this.windowLifecycleHandlers.has(window)) {
      logger.warn(`Window ${window.id} already registered for shortcuts`)
      return
    }

    const onFocus = () => {
      logger.debug(`Window ${window.id} focused - registering shortcuts`)
      this.currentWindow = window
      this.registerAllShortcuts(window)
    }

    const onBlur = () => {
      logger.debug(`Window ${window.id} blurred - unregistering non-persistent shortcuts`)
      this.unregisterTransientShortcuts(window)
    }

    const onClosed = () => {
      logger.debug(`Window ${window.id} closed - cleaning up shortcut registrations`)
      this.unregisterWindow(window)
    }

    window.on('focus', onFocus)
    window.on('blur', onBlur)
    window.on('closed', onClosed)

    this.windowLifecycleHandlers.set(window, { onFocus, onBlur, onClosed })
    this.currentWindow = window

    if (window.isFocused()) {
      this.registerAllShortcuts(window)
    } else {
      this.unregisterTransientShortcuts(window)
    }

    logger.info(`ShortcutService attached to window ${window.id}`)
  }

  public unregisterWindow(window: BrowserWindow): void {
    const lifecycle = this.windowLifecycleHandlers.get(window)
    if (!lifecycle) {
      return
    }

    window.off('focus', lifecycle.onFocus)
    window.off('blur', lifecycle.onBlur)
    window.off('closed', lifecycle.onClosed)

    this.windowLifecycleHandlers.delete(window)

    if (this.currentWindow === window) {
      this.currentWindow = null
      globalShortcut.unregisterAll()
    }
  }

  public cleanup(): void {
    this.windowLifecycleHandlers.forEach((_handlers, window) => this.unregisterWindow(window))
    this.windowLifecycleHandlers.clear()
    this.handlers.clear()
    this.currentWindow = null

    this.preferenceUnsubscribers.forEach((unsubscribe) => unsubscribe())
    this.preferenceUnsubscribers = []

    globalShortcut.unregisterAll()

    logger.info('ShortcutService cleaned up')
  }

  private registerBuiltInHandlers(): void {
    this.registerHandler('shortcut.app.show_main_window', () => {
      windowService.toggleMainWindow()
    })

    this.registerHandler('shortcut.app.show_settings', () => {
      let targetWindow = windowService.getMainWindow()

      if (
        !targetWindow ||
        targetWindow.isDestroyed() ||
        targetWindow.isMinimized() ||
        !targetWindow.isVisible() ||
        !targetWindow.isFocused()
      ) {
        windowService.showMainWindow()
        targetWindow = windowService.getMainWindow()
      }

      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }

      void targetWindow.webContents
        .executeJavaScript(`typeof window.navigate === 'function' && window.navigate('/settings/provider')`, true)
        .catch((error) => {
          logger.warn('Failed to navigate to settings from shortcut:', error as Error)
        })
    })

    this.registerHandler('shortcut.app.show_mini_window', () => {
      windowService.toggleMiniWindow()
    })

    this.registerHandler('shortcut.app.zoom_in', (window) => {
      if (window) {
        handleZoomFactor([window], 0.1)
      }
    })

    this.registerHandler('shortcut.app.zoom_out', (window) => {
      if (window) {
        handleZoomFactor([window], -0.1)
      }
    })

    this.registerHandler('shortcut.app.zoom_reset', (window) => {
      if (window) {
        handleZoomFactor([window], 0, true)
      }
    })

    this.registerHandler('shortcut.selection.toggle_enabled', () => {
      if (selectionService) {
        selectionService.toggleEnabled()
      }
    })

    this.registerHandler('shortcut.selection.get_text', () => {
      if (selectionService) {
        selectionService.processSelectTextByShortcut()
      }
    })
  }

  private subscribeToPreferenceChanges(): void {
    this.preferenceUnsubscribers = relevantDefinitions.map((definition) =>
      preferenceService.subscribeChange(definition.key, () => {
        logger.debug(`Shortcut preference changed: ${definition.key}`)
        this.reregisterShortcuts()
      })
    )
  }

  private registerAllShortcuts(window: BrowserWindow): void {
    globalShortcut.unregisterAll()

    relevantDefinitions.forEach((definition) => {
      const runtimeConfig = this.getRuntimeConfig(definition)
      if (!runtimeConfig.enabled) {
        return
      }

      if (definition.enabledWhen && !definition.enabledWhen(this.getPreferenceValue)) {
        logger.debug(`Skipping ${definition.key} - enabledWhen condition not met`)
        return
      }

      const handler = this.handlers.get(definition.key)
      if (!handler) {
        logger.warn(`No handler registered for ${definition.key}`)
        return
      }

      this.registerSingleShortcut(runtimeConfig.binding, handler, window)

      if (definition.variants) {
        definition.variants.forEach((variant) => {
          this.registerSingleShortcut(variant, handler, window)
        })
      }
    })
  }

  private unregisterTransientShortcuts(window: BrowserWindow): void {
    globalShortcut.unregisterAll()

    relevantDefinitions
      .filter((definition) => definition.persistOnBlur)
      .forEach((definition) => {
        const runtimeConfig = this.getRuntimeConfig(definition)
        if (!runtimeConfig.enabled) {
          return
        }

        if (definition.enabledWhen && !definition.enabledWhen(this.getPreferenceValue)) {
          return
        }

        const handler = this.handlers.get(definition.key)
        if (!handler) {
          return
        }

        this.registerSingleShortcut(runtimeConfig.binding, handler, window)

        if (definition.variants) {
          definition.variants.forEach((variant) => {
            this.registerSingleShortcut(variant, handler, window)
          })
        }
      })
  }

  private registerSingleShortcut(keys: string[], handler: ShortcutHandler, window: BrowserWindow): void {
    if (!keys.length) {
      return
    }

    const accelerator = toAccelerator(keys)

    try {
      globalShortcut.register(accelerator, () => {
        logger.debug(`Shortcut triggered: ${accelerator}`)
        const targetWindow = window?.isDestroyed?.() ? undefined : window
        handler(targetWindow)
      })
      logger.verbose(`Registered shortcut: ${accelerator}`)
    } catch (error) {
      logger.error(`Failed to register shortcut ${accelerator}:`, error as Error)
    }
  }

  private getRuntimeConfig(definition: ShortcutDefinition): ShortcutRuntimeConfig {
    const preference = this.getPreference(definition)
    return {
      ...definition,
      binding: preference.binding,
      enabled: preference.enabled,
      editable: preference.editable,
      system: preference.system
    }
  }

  private getPreference(definition: ShortcutDefinition): ShortcutPreferenceValue {
    const rawPreference = preferenceService.get(definition.key)
    return coerceShortcutPreference(definition, rawPreference as any)
  }

  private getPreferenceValue = <K extends ShortcutPreferenceKey | keyof PreferenceDefaultScopeType>(
    key: K
  ): PreferenceDefaultScopeType[K] => {
    return preferenceService.get(key)
  }

  private reregisterShortcuts(): void {
    if (!this.currentWindow || this.currentWindow.isDestroyed()) {
      return
    }

    if (this.currentWindow.isFocused()) {
      this.registerAllShortcuts(this.currentWindow)
      return
    }

    this.unregisterTransientShortcuts(this.currentWindow)
  }
}

export const shortcutService = new ShortcutService()
