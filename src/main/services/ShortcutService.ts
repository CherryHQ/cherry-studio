import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import type { CommandShortcutPreferenceKey } from '@shared/command'
import {
  collectContextKeys,
  type CommandId,
  type ContextReader,
  type ContextValue,
  evaluateContextExpr,
  findCommandDefinition,
  REGISTERED_KEYBINDINGS,
  resolveCommandKeybinding,
  type SupportedPlatform
} from '@shared/command'
import type { PreferenceKeyType, PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ShortcutPreferenceKey } from '@shared/shortcuts/types'
import type { BrowserWindow } from 'electron'
import { globalShortcut } from 'electron'

const logger = loggerService.withContext('ShortcutService')
type ShortcutHandler = (window?: BrowserWindow) => void
type RegisteredShortcut = {
  key: CommandShortcutPreferenceKey<CommandId>
  handler: ShortcutHandler
  window: BrowserWindow
}

const mainKeybindings = REGISTERED_KEYBINDINGS.filter((rule) => rule.scope !== 'renderer')

const relevantKeybindings = mainKeybindings.filter(
  (rule) =>
    !(isMac && rule.command === 'app.settings.open') &&
    (!rule.supportedPlatforms || rule.supportedPlatforms.includes(process.platform as SupportedPlatform))
)

const contextKeys = Array.from(
  new Set(
    relevantKeybindings.flatMap((rule) => {
      const command = findCommandDefinition(rule.command)
      return [...collectContextKeys(command?.enablement), ...collectContextKeys(rule.when)].filter(
        (key) => key !== 'platform'
      )
    })
  )
)

const toContextValue = (value: unknown): ContextValue => {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null
    ? value
    : undefined
}

@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MainWindowService', 'CommandService'])
export class ShortcutService extends BaseService {
  private mainWindow: BrowserWindow | null = null
  private handlers = new Map<CommandId, ShortcutHandler>()
  private registeredWindows = new Set<BrowserWindow>()
  private conflictedKeys = new Set<CommandShortcutPreferenceKey<CommandId>>()
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
    for (const rule of mainKeybindings) {
      this.handlers.set(rule.command, (window) => {
        application.get('CommandService').execute(rule.command, window)
      })
    }
  }

  private subscribeToPreferenceChanges(): void {
    const preferenceService = application.get('PreferenceService')
    for (const rule of relevantKeybindings) {
      this.registerDisposable(
        preferenceService.subscribeChange(rule.preferenceKey, () => {
          logger.debug(`Shortcut preference changed: ${rule.preferenceKey}`)
          this.reregisterShortcuts()
        })
      )
    }

    for (const key of contextKeys) {
      this.registerDisposable(
        preferenceService.subscribeChange(key as PreferenceKeyType, () => {
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

    if (!window.isDestroyed()) {
      this.registerShortcuts(window, !window.isFocused())
    }
  }

  private registerShortcuts(window: BrowserWindow, onlyPersistent: boolean): void {
    if (window.isDestroyed()) return

    const preferenceService = application.get('PreferenceService')

    // Build the desired set of accelerators
    const desired = new Map<string, RegisteredShortcut>()
    const context: ContextReader = (key) => {
      if (key === 'platform') {
        return process.platform
      }
      return toContextValue(preferenceService.get(key as PreferenceKeyType))
    }

    for (const rule of relevantKeybindings) {
      if (onlyPersistent && !rule.global) continue

      const command = findCommandDefinition(rule.command)
      if (!command || !evaluateContextExpr(command.enablement, context)) {
        continue
      }

      const rawPref = preferenceService.get(rule.preferenceKey) as PreferenceShortcutType | undefined
      const resolved = resolveCommandKeybinding({
        command: rule.command,
        preference: rawPref,
        context,
        platform: process.platform as SupportedPlatform
      })
      if (!resolved?.enabled || !resolved.binding.length) continue

      const handler = this.handlers.get(rule.command)
      if (!handler) continue

      if (resolved.accelerator) {
        desired.set(resolved.accelerator, { key: rule.preferenceKey, handler, window })
      }

      if (resolved.additionalBindings) {
        for (const variant of resolved.additionalBindings) {
          const variantAccelerator = variant.join('+')
          if (variantAccelerator) {
            desired.set(variantAccelerator, { key: rule.preferenceKey, handler, window })
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

  private markRegistrationConflict(key: CommandShortcutPreferenceKey<CommandId>, accelerator: string): void {
    if (this.conflictedKeys.has(key)) {
      return
    }

    this.conflictedKeys.add(key)
    this.emitRegistrationConflict({ key, accelerator, hasConflict: true })
  }

  private clearRegistrationConflict(key: CommandShortcutPreferenceKey<CommandId>): void {
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
