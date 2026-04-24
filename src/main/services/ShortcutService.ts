import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { handleZoomFactor } from '@main/utils/zoom'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type { ShortcutPreferenceKey, SupportedPlatform } from '@shared/shortcuts/types'
import { isShortcutDefinitionEnabled, resolveShortcutPreference } from '@shared/shortcuts/utils'
import type { BrowserWindow } from 'electron'
import { globalShortcut } from 'electron'

const logger = loggerService.withContext('ShortcutService')
type ShortcutHandler = (window?: BrowserWindow) => void
type RegisteredShortcut = { key: ShortcutPreferenceKey; handler: ShortcutHandler; window: BrowserWindow }

const toAccelerator = (keys: string[]): string => keys.join('+')

const relevantDefinitions = SHORTCUT_DEFINITIONS.filter(
  (d) =>
    d.scope !== 'renderer' &&
    (!d.supportedPlatforms || d.supportedPlatforms.includes(process.platform as SupportedPlatform))
)

@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MainWindowService', 'SelectionService'])
export class ShortcutService extends BaseService {
  private mainWindow: BrowserWindow | null = null
  private handlers = new Map<ShortcutPreferenceKey, ShortcutHandler>()
  private registeredWindows = new Set<BrowserWindow>()
  private conflictedKeys = new Set<ShortcutPreferenceKey>()
  private isRegisterOnBoot = true
  private registeredAccelerators = new Map<string, RegisteredShortcut>()

  protected async onInit() {
    this.registerBuiltInHandlers()
    this.subscribeToPreferenceChanges()

    const windowService = application.get('MainWindowService')
    this.registerDisposable(windowService.onMainWindowCreated((window) => this.registerForWindow(window)))
  }

  protected async onStop() {
    this.unregisterAll()
    this.resetRuntimeState()
  }

  private registerBuiltInHandlers(): void {
    this.handlers.set('shortcut.general.show_main_window', () => {
      application.get('MainWindowService').toggleMainWindow()
    })

    this.handlers.set('shortcut.general.show_settings', () => {
      application.get('MainWindowService').showMainWindow()
      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.MainWindow_NavigateToSettings)
    })

    this.handlers.set('shortcut.feature.quick_assistant.toggle_window', () => {
      if (!application.get('PreferenceService').get('feature.quick_assistant.enabled')) return
      application.get('QuickAssistantService').toggleQuickAssistant()
    })

    this.handlers.set('shortcut.general.zoom_in', (window) => {
      if (window) handleZoomFactor([window], 0.1)
    })

    this.handlers.set('shortcut.general.zoom_out', (window) => {
      if (window) handleZoomFactor([window], -0.1)
    })

    this.handlers.set('shortcut.general.zoom_reset', (window) => {
      if (window) handleZoomFactor([window], 0, true)
    })

    this.handlers.set('shortcut.feature.selection.toggle_enabled', () => {
      application.get('SelectionService').toggleEnabled()
    })

    this.handlers.set('shortcut.feature.selection.get_text', () => {
      application.get('SelectionService').processSelectTextByShortcut()
    })
  }

  private subscribeToPreferenceChanges(): void {
    const preferenceService = application.get('PreferenceService')
    for (const definition of relevantDefinitions) {
      this.registerDisposable(
        preferenceService.subscribeChange(definition.key, () => {
          logger.debug(`Shortcut preference changed: ${definition.key}`)
          this.reregisterShortcuts()
        })
      )
    }

    const dependencyKeys = new Set<NonNullable<(typeof relevantDefinitions)[number]['enabledWhen']>>()
    for (const definition of relevantDefinitions) {
      if (!definition.enabledWhen) {
        continue
      }
      dependencyKeys.add(definition.enabledWhen)
    }

    for (const key of dependencyKeys) {
      this.registerDisposable(
        preferenceService.subscribeChange(key, () => {
          logger.debug(`Shortcut dependency changed: ${key}`)
          this.reregisterShortcuts()
        })
      )
    }
  }

  private registerForWindow(window: BrowserWindow): void {
    this.mainWindow = window

    if (this.isRegisterOnBoot) {
      const onReadyToShow = () => {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return
        if (application.get('PreferenceService').get('app.tray.on_launch')) {
          this.registerShortcuts(window, true)
        }
      }
      window.once('ready-to-show', onReadyToShow)
      this.registerDisposable(() => window.off('ready-to-show', onReadyToShow))
      this.isRegisterOnBoot = false
    }

    if (!this.registeredWindows.has(window)) {
      this.registeredWindows.add(window)

      const onFocus = () => {
        if (this.mainWindow !== window) return
        this.registerShortcuts(window, false)
      }
      const onBlur = () => {
        if (this.mainWindow !== window) return
        this.registerShortcuts(window, true)
      }
      const onClosed = () => {
        this.registeredWindows.delete(window)
        if (this.mainWindow === window) {
          this.mainWindow = null
        }
      }

      window.on('focus', onFocus)
      window.on('blur', onBlur)
      window.once('closed', onClosed)
      this.registerDisposable(() => window.off('focus', onFocus))
      this.registerDisposable(() => window.off('blur', onBlur))
      this.registerDisposable(() => window.off('closed', onClosed))
    }

    if (!window.isDestroyed() && window.isFocused()) {
      this.registerShortcuts(window, false)
    }
  }

  private registerShortcuts(window: BrowserWindow, onlyPersistent: boolean): void {
    if (window.isDestroyed()) return

    const preferenceService = application.get('PreferenceService')

    // Build the desired set of accelerators
    const desired = new Map<string, RegisteredShortcut>()

    for (const definition of relevantDefinitions) {
      if (onlyPersistent && !definition.global) continue

      if (!isShortcutDefinitionEnabled(definition, (key) => preferenceService.get(key))) {
        continue
      }

      const rawPref = preferenceService.get(definition.key) as PreferenceShortcutType | undefined
      const pref = resolveShortcutPreference(definition, rawPref)
      if (!pref.enabled || !pref.binding.length) continue

      const handler = this.handlers.get(definition.key)
      if (!handler) continue

      const accelerator = toAccelerator(pref.binding)
      if (accelerator) {
        desired.set(accelerator, { key: definition.key, handler, window })
      }

      if (definition.variants) {
        for (const variant of definition.variants) {
          const variantAccelerator = toAccelerator(variant)
          if (variantAccelerator) {
            desired.set(variantAccelerator, { key: definition.key, handler, window })
          }
        }
      }
    }

    const activeKeys = new Set(Array.from(desired.values(), (entry) => entry.key))
    for (const key of this.conflictedKeys) {
      if (!activeKeys.has(key)) {
        this.clearRegistrationConflict(key)
      }
    }

    // Unregister shortcuts that are no longer needed or have a different handler
    for (const [accelerator, previous] of this.registeredAccelerators) {
      const entry = desired.get(accelerator)
      if (!entry || entry.handler !== previous.handler || entry.window !== previous.window) {
        try {
          globalShortcut.unregister(accelerator)
        } catch (error) {
          logger.debug(`Failed to unregister shortcut accelerator: ${accelerator}`, error as Error)
        }
        this.registeredAccelerators.delete(accelerator)
      }
    }

    // Register new or changed shortcuts
    for (const [accelerator, { key, handler, window: win }] of desired) {
      if (!this.registeredAccelerators.has(accelerator)) {
        try {
          const success = globalShortcut.register(accelerator, () => {
            const targetWindow = win?.isDestroyed?.() ? undefined : win
            try {
              handler(targetWindow)
            } catch (error) {
              logger.error(`Shortcut handler threw for accelerator: ${accelerator}`, error as Error)
            }
          })
          if (success) {
            this.registeredAccelerators.set(accelerator, { key, handler, window: win })
            this.clearRegistrationConflict(key)
          } else {
            logger.warn(`Failed to register shortcut ${accelerator}: accelerator is held by another application`)
            this.markRegistrationConflict(key, accelerator)
          }
        } catch (error) {
          logger.error(`Failed to register shortcut ${accelerator}`, error as Error)
          this.markRegistrationConflict(key, accelerator)
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
    for (const accelerator of this.registeredAccelerators.keys()) {
      try {
        globalShortcut.unregister(accelerator)
      } catch (error) {
        logger.debug(`Failed to unregister shortcut accelerator: ${accelerator}`, error as Error)
      }
    }
    this.registeredAccelerators.clear()
  }

  private resetRuntimeState(): void {
    this.mainWindow = null
    this.registeredWindows.clear()
    this.conflictedKeys.clear()
    this.isRegisterOnBoot = true
  }

  private markRegistrationConflict(key: ShortcutPreferenceKey, accelerator: string): void {
    if (this.conflictedKeys.has(key)) {
      return
    }

    this.conflictedKeys.add(key)
    this.emitRegistrationConflict({ key, accelerator, hasConflict: true })
  }

  private clearRegistrationConflict(key: ShortcutPreferenceKey): void {
    if (!this.conflictedKeys.delete(key)) {
      return
    }
    this.emitRegistrationConflict({ key, hasConflict: false })
  }

  private emitRegistrationConflict(payload: {
    key: ShortcutPreferenceKey
    accelerator?: string
    hasConflict: boolean
  }): void {
    application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Shortcut_RegistrationConflict, payload)
  }
}
