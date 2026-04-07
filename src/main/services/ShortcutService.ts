import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { handleZoomFactor } from '@main/utils/zoom'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type { ShortcutPreferenceKey, SupportedPlatform } from '@shared/shortcuts/types'
import { coerceShortcutPreference } from '@shared/shortcuts/utils'
import type { BrowserWindow } from 'electron'
import { globalShortcut } from 'electron'

const logger = loggerService.withContext('ShortcutService')

type ShortcutHandler = (window?: BrowserWindow) => void

const toAccelerator = (keys: string[]): string => keys.join('+')

const relevantDefinitions = SHORTCUT_DEFINITIONS.filter(
  (d) =>
    d.scope !== 'renderer' &&
    (!d.supportedPlatforms || d.supportedPlatforms.includes(process.platform as SupportedPlatform))
)

@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'SelectionService', 'PreferenceService'])
export class ShortcutService extends BaseService {
  private mainWindow: BrowserWindow | null = null
  private handlers = new Map<ShortcutPreferenceKey, ShortcutHandler>()
  private windowOnHandlers = new Map<BrowserWindow, { onFocus: () => void; onBlur: () => void }>()
  private isRegisterOnBoot = true
  private registeredAccelerators = new Map<string, ShortcutHandler>()

  protected async onInit() {
    this.registerBuiltInHandlers()
    this.subscribeToPreferenceChanges()

    const windowService = application.get('WindowService')
    this.registerDisposable(windowService.onMainWindowCreated((window) => this.registerForWindow(window)))

    const existingWindow = windowService.getMainWindow()
    if (existingWindow && !existingWindow.isDestroyed()) {
      this.registerForWindow(existingWindow)
    }
  }

  protected async onStop() {
    this.unregisterAll()
    this.mainWindow = null
  }

  private registerBuiltInHandlers(): void {
    this.handlers.set('shortcut.app.show_main_window', () => {
      application.get('WindowService').toggleMainWindow()
    })

    this.handlers.set('shortcut.app.show_settings', () => {
      let targetWindow = application.get('WindowService').getMainWindow()

      if (
        !targetWindow ||
        targetWindow.isDestroyed() ||
        targetWindow.isMinimized() ||
        !targetWindow.isVisible() ||
        !targetWindow.isFocused()
      ) {
        application.get('WindowService').showMainWindow()
        targetWindow = application.get('WindowService').getMainWindow()
      }

      if (!targetWindow || targetWindow.isDestroyed()) return

      targetWindow.webContents.send(IpcChannel.Windows_NavigateToSettings)
    })

    this.handlers.set('shortcut.app.show_mini_window', () => {
      if (!application.get('PreferenceService').get('feature.quick_assistant.enabled')) return
      application.get('WindowService').toggleMiniWindow()
    })

    this.handlers.set('shortcut.app.zoom_in', (window) => {
      if (window) handleZoomFactor([window], 0.1)
    })

    this.handlers.set('shortcut.app.zoom_out', (window) => {
      if (window) handleZoomFactor([window], -0.1)
    })

    this.handlers.set('shortcut.app.zoom_reset', (window) => {
      if (window) handleZoomFactor([window], 0, true)
    })

    this.handlers.set('shortcut.selection.toggle_enabled', () => {
      application.get('SelectionService').toggleEnabled()
    })

    this.handlers.set('shortcut.selection.get_text', () => {
      application.get('SelectionService').processSelectTextByShortcut()
    })
  }

  private subscribeToPreferenceChanges(): void {
    const preferenceService = application.get('PreferenceService')
    for (const definition of relevantDefinitions) {
      const unsub = preferenceService.subscribeChange(definition.key, () => {
        logger.debug(`Shortcut preference changed: ${definition.key}`)
        this.reregisterShortcuts()
      })
      this.registerDisposable({ dispose: unsub })
    }
  }

  private registerForWindow(window: BrowserWindow): void {
    this.mainWindow = window

    if (this.isRegisterOnBoot) {
      window.once('ready-to-show', () => {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return
        if (application.get('PreferenceService').get('app.tray.on_launch')) {
          this.registerShortcuts(window, true)
        }
      })
      this.isRegisterOnBoot = false
    }

    if (!this.windowOnHandlers.has(window)) {
      const onFocus = () => this.registerShortcuts(window, false)
      const onBlur = () => this.registerShortcuts(window, true)
      window.on('focus', onFocus)
      window.on('blur', onBlur)
      this.windowOnHandlers.set(window, { onFocus, onBlur })
    }

    if (!window.isDestroyed() && window.isFocused()) {
      this.registerShortcuts(window, false)
    }
  }

  private registerShortcuts(window: BrowserWindow, onlyPersistent: boolean): void {
    if (window.isDestroyed()) return

    const preferenceService = application.get('PreferenceService')
    const getPreference = <K extends string>(key: K) => preferenceService.get(key as any)

    // Build the desired set of accelerators
    const desired = new Map<string, { handler: ShortcutHandler; window: BrowserWindow }>()

    for (const definition of relevantDefinitions) {
      if (onlyPersistent && !definition.global) continue

      const rawPref = preferenceService.get(definition.key) as PreferenceShortcutType | undefined
      const pref = coerceShortcutPreference(definition, rawPref)
      if (!pref.enabled || !pref.binding.length) continue
      if (definition.enabledWhen && !definition.enabledWhen(getPreference as any)) continue

      const handler = this.handlers.get(definition.key)
      if (!handler) continue

      const accelerator = toAccelerator(pref.binding)
      if (accelerator) {
        desired.set(accelerator, { handler, window })
      }

      if (definition.variants) {
        for (const variant of definition.variants) {
          const variantAccelerator = toAccelerator(variant)
          if (variantAccelerator) {
            desired.set(variantAccelerator, { handler, window })
          }
        }
      }
    }

    // Unregister shortcuts that are no longer needed or have a different handler
    for (const [accelerator, prevHandler] of this.registeredAccelerators) {
      const entry = desired.get(accelerator)
      if (!entry || entry.handler !== prevHandler) {
        try {
          globalShortcut.unregister(accelerator)
        } catch {
          // ignore
        }
        this.registeredAccelerators.delete(accelerator)
      }
    }

    // Register new or changed shortcuts
    for (const [accelerator, { handler, window: win }] of desired) {
      if (!this.registeredAccelerators.has(accelerator)) {
        try {
          globalShortcut.register(accelerator, () => {
            const targetWindow = win?.isDestroyed?.() ? undefined : win
            handler(targetWindow)
          })
          this.registeredAccelerators.set(accelerator, handler)
        } catch (error) {
          logger.warn(`Failed to register shortcut ${accelerator}`)
        }
      }
    }
  }

  private reregisterShortcuts(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    if (this.mainWindow.isFocused()) {
      this.registerShortcuts(this.mainWindow, false)
    } else {
      this.registerShortcuts(this.mainWindow, true)
    }
  }

  private unregisterAll(): void {
    try {
      this.windowOnHandlers.forEach((handlers, window) => {
        window.off('focus', handlers.onFocus)
        window.off('blur', handlers.onBlur)
      })
      this.windowOnHandlers.clear()
      for (const accelerator of this.registeredAccelerators.keys()) {
        try {
          globalShortcut.unregister(accelerator)
        } catch {
          // ignore
        }
      }
      this.registeredAccelerators.clear()
    } catch (error) {
      logger.warn('Failed to unregister all shortcuts')
    }
  }
}
