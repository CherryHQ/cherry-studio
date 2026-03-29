/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcChannel } from '@shared/IpcChannel'
import type { Shortcut } from '@types'
import type { BrowserWindow } from 'electron'
import { globalShortcut } from 'electron'

// TODO: Migrate configManager usage to PreferenceService
import { configManager } from './ConfigManager'

const logger = loggerService.withContext('ShortcutService')

@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'SelectionService', 'PreferenceService'])
export class ShortcutService extends BaseService {
  private mainWindow: BrowserWindow | null = null
  private showAppAccelerator: string | null = null
  private showMiniWindowAccelerator: string | null = null
  private selectionAssistantToggleAccelerator: string | null = null
  private selectionAssistantSelectTextAccelerator: string | null = null
  //indicate if the shortcuts are registered on app boot time
  private isRegisterOnBoot = true
  // store the focus and blur handlers for each window to unregister them later
  private windowOnHandlers = new Map<BrowserWindow, { onFocusHandler: () => void; onBlurHandler: () => void }>()

  protected async onInit() {
    this.registerIpcHandlers()

    const windowService = application.get('WindowService')
    this.registerDisposable(windowService.onMainWindowCreated((window) => this.registerShortcutsForWindow(window)))
  }

  protected async onStop() {
    this.unregisterAllShortcuts()
    this.mainWindow = null
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.Shortcuts_Update, (_, shortcuts: Shortcut[]) => {
      configManager.setShortcuts(shortcuts)
      if (this.mainWindow) {
        this.unregisterAllShortcuts()
        this.registerShortcutsForWindow(this.mainWindow)
      }
    })
  }

  private registerShortcutsForWindow(window: BrowserWindow) {
    this.mainWindow = window

    if (this.isRegisterOnBoot) {
      window.once('ready-to-show', () => {
        if (application.get('PreferenceService').get('app.tray.on_launch')) {
          registerOnlyUniversalShortcuts()
        }
      })
      this.isRegisterOnBoot = false
    }

    //only for clearer code
    const registerOnlyUniversalShortcuts = () => {
      register(true)
    }

    //onlyUniversalShortcuts is used to register shortcuts that are not window specific, like show_app & mini_window
    //onlyUniversalShortcuts is needed when we launch to tray
    const register = (onlyUniversalShortcuts: boolean = false) => {
      if (window.isDestroyed()) return

      const shortcuts = configManager.getShortcuts()
      if (!shortcuts) return

      shortcuts.forEach((shortcut) => {
        try {
          if (shortcut.shortcut.length === 0) {
            return
          }

          if (!shortcut.enabled) {
            return
          }

          // only register universal shortcuts when needed
          if (
            onlyUniversalShortcuts &&
            !['show_app', 'mini_window', 'selection_assistant_toggle', 'selection_assistant_select_text'].includes(
              shortcut.key
            )
          ) {
            return
          }

          const handler = this.getShortcutHandler(shortcut)
          if (!handler) {
            return
          }

          switch (shortcut.key) {
            case 'show_app':
              this.showAppAccelerator = this.formatShortcutKey(shortcut.shortcut)
              break

            case 'mini_window':
              // 移除注册时的条件检查，在处理器内部进行检查
              logger.info(`Processing mini_window shortcut, enabled: ${shortcut.enabled}`)
              this.showMiniWindowAccelerator = this.formatShortcutKey(shortcut.shortcut)
              logger.debug(`Mini window accelerator set to: ${this.showMiniWindowAccelerator}`)
              break

            case 'selection_assistant_toggle':
              this.selectionAssistantToggleAccelerator = this.formatShortcutKey(shortcut.shortcut)
              break

            case 'selection_assistant_select_text':
              this.selectionAssistantSelectTextAccelerator = this.formatShortcutKey(shortcut.shortcut)
              break

            //the following ZOOMs will register shortcuts separately, so will return
            case 'zoom_in':
              globalShortcut.register('CommandOrControl+=', () => handler(window))
              globalShortcut.register('CommandOrControl+numadd', () => handler(window))
              return

            case 'zoom_out':
              globalShortcut.register('CommandOrControl+-', () => handler(window))
              globalShortcut.register('CommandOrControl+numsub', () => handler(window))
              return

            case 'zoom_reset':
              globalShortcut.register('CommandOrControl+0', () => handler(window))
              return
          }

          const accelerator = this.convertShortcutFormat(shortcut.shortcut)

          globalShortcut.register(accelerator, () => handler(window))
        } catch (error) {
          logger.warn(`Failed to register shortcut ${shortcut.key}`)
        }
      })
    }

    const unregister = () => {
      if (window.isDestroyed()) return

      try {
        globalShortcut.unregisterAll()

        if (this.showAppAccelerator) {
          const handler = this.getShortcutHandler({ key: 'show_app' } as Shortcut)
          const accelerator = this.convertShortcutFormat(this.showAppAccelerator)
          handler && globalShortcut.register(accelerator, () => handler(window))
        }

        if (this.showMiniWindowAccelerator) {
          const handler = this.getShortcutHandler({ key: 'mini_window' } as Shortcut)
          const accelerator = this.convertShortcutFormat(this.showMiniWindowAccelerator)
          handler && globalShortcut.register(accelerator, () => handler(window))
        }

        if (this.selectionAssistantToggleAccelerator) {
          const handler = this.getShortcutHandler({ key: 'selection_assistant_toggle' } as Shortcut)
          const accelerator = this.convertShortcutFormat(this.selectionAssistantToggleAccelerator)
          handler && globalShortcut.register(accelerator, () => handler(window))
        }

        if (this.selectionAssistantSelectTextAccelerator) {
          const handler = this.getShortcutHandler({ key: 'selection_assistant_select_text' } as Shortcut)
          const accelerator = this.convertShortcutFormat(this.selectionAssistantSelectTextAccelerator)
          handler && globalShortcut.register(accelerator, () => handler(window))
        }
      } catch (error) {
        logger.warn('Failed to unregister shortcuts')
      }
    }

    // only register the event handlers once
    if (undefined === this.windowOnHandlers.get(window)) {
      // pass register() directly to listener, the func will receive Event as argument, it's not expected
      const registerHandler = () => {
        register()
      }
      window.on('focus', registerHandler)
      window.on('blur', unregister)
      this.windowOnHandlers.set(window, { onFocusHandler: registerHandler, onBlurHandler: unregister })
    }

    if (!window.isDestroyed() && window.isFocused()) {
      register()
    }
  }

  private unregisterAllShortcuts() {
    try {
      this.showAppAccelerator = null
      this.showMiniWindowAccelerator = null
      this.selectionAssistantToggleAccelerator = null
      this.selectionAssistantSelectTextAccelerator = null
      this.windowOnHandlers.forEach((handlers, window) => {
        window.off('focus', handlers.onFocusHandler)
        window.off('blur', handlers.onBlurHandler)
      })
      this.windowOnHandlers.clear()
      globalShortcut.unregisterAll()
    } catch (error) {
      logger.warn('Failed to unregister all shortcuts')
    }
  }

  private getShortcutHandler(shortcut: Shortcut) {
    switch (shortcut.key) {
      case 'zoom_in':
        return (window: BrowserWindow) => handleZoomFactor([window], 0.1)
      case 'zoom_out':
        return (window: BrowserWindow) => handleZoomFactor([window], -0.1)
      case 'zoom_reset':
        return (window: BrowserWindow) => handleZoomFactor([window], 0, true)
      case 'show_app':
        return () => {
          application.get('WindowService').toggleMainWindow()
        }
      case 'mini_window':
        return () => {
          // 在处理器内部检查QuickAssistant状态，而不是在注册时检查
          const quickAssistantEnabled = application.get('PreferenceService').get('feature.quick_assistant.enabled')
          logger.info(`mini_window shortcut triggered, QuickAssistant enabled: ${quickAssistantEnabled}`)

          if (!quickAssistantEnabled) {
            logger.warn('QuickAssistant is disabled, ignoring mini_window shortcut trigger')
            return
          }

          application.get('WindowService').toggleMiniWindow()
        }
      case 'selection_assistant_toggle':
        return () => {
          application.get('SelectionService').toggleEnabled()
        }
      case 'selection_assistant_select_text':
        return () => {
          application.get('SelectionService').processSelectTextByShortcut()
        }
      default:
        return null
    }
  }

  private formatShortcutKey(shortcut: string[]): string {
    return shortcut.join('+')
  }

  // convert the shortcut recorded by JS keyboard event key value to electron global shortcut format
  // see: https://www.electronjs.org/zh/docs/latest/api/accelerator
  private convertShortcutFormat(shortcut: string | string[]): string {
    const accelerator = (() => {
      if (Array.isArray(shortcut)) {
        return shortcut
      } else {
        return shortcut.split('+').map((key) => key.trim())
      }
    })()

    return accelerator
      .map((key) => {
        switch (key) {
          // NEW WAY FOR MODIFIER KEYS
          // you can see all the modifier keys in the same
          case 'CommandOrControl':
            return 'CommandOrControl'
          case 'Ctrl':
            return 'Ctrl'
          case 'Alt':
            return 'Alt' // Use `Alt` instead of `Option`. The `Option` key only exists on macOS, whereas the `Alt` key is available on all platforms.
          case 'Meta':
            return 'Meta' // `Meta` key is mapped to the Windows key on Windows and Linux, `Cmd` on macOS.
          case 'Shift':
            return 'Shift'

          // For backward compatibility with old data
          case 'Command':
          case 'Cmd':
            return 'CommandOrControl'
          case 'Control':
            return 'Ctrl'
          case 'ArrowUp':
            return 'Up'
          case 'ArrowDown':
            return 'Down'
          case 'ArrowLeft':
            return 'Left'
          case 'ArrowRight':
            return 'Right'
          case 'AltGraph':
            return 'AltGr'
          case 'Slash':
            return '/'
          case 'Semicolon':
            return ';'
          case 'BracketLeft':
            return '['
          case 'BracketRight':
            return ']'
          case 'Backslash':
            return '\\'
          case 'Quote':
            return "'"
          case 'Comma':
            return ','
          case 'Minus':
            return '-'
          case 'Equal':
            return '='
          default:
            return key
        }
      })
      .join('+')
  }
}
