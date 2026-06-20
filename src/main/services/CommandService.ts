import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase, toDisposable } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { showNativePopupMenu } from '@main/services/nativePopupMenu'
import { handleZoomFactor } from '@main/utils/zoom'
import { IpcChannel } from '@shared/IpcChannel'
import type { ContextReader } from '@shared/types/command'
import { type CommandId, evaluateContextExpr, findCommandDefinition } from '@shared/utils/command'
import type { BrowserWindow } from 'electron'

const logger = loggerService.withContext('CommandService')

type MainCommandHandler = (window?: BrowserWindow) => void | Promise<void>

const getMainWindows = (): BrowserWindow[] => application.get('WindowManager').getWindowsByType(WindowType.Main)

const getCommandTargetWindows = (window?: BrowserWindow): BrowserWindow[] => (window ? [window] : getMainWindows())

@Injectable('CommandService')
@ServicePhase(Phase.WhenReady)
export class CommandService extends BaseService {
  private handlers = new Map<CommandId, MainCommandHandler>()

  protected async onInit() {
    this.registerBuiltInHandlers()

    this.ipcHandle(IpcChannel.NativeCommandPopupMenu_Show, (event, model: unknown, anchor: unknown) =>
      showNativePopupMenu(event, model, anchor, (command, window) => {
        if (!this.canExecute(command)) {
          return false
        }
        this.execute(command, window)
        return true
      })
    )
  }

  protected async onStop() {
    this.handlers.clear()
  }

  registerHandler(command: CommandId, handler: MainCommandHandler): Disposable {
    this.handlers.set(command, handler)
    return toDisposable(() => {
      if (this.handlers.get(command) === handler) {
        this.handlers.delete(command)
      }
    })
  }

  hasHandler(command: CommandId): boolean {
    return this.handlers.has(command)
  }

  canExecute(command: CommandId, context: ContextReader = this.getDefaultContext()): boolean {
    const definition = findCommandDefinition(command)
    return Boolean(definition && this.handlers.has(command) && evaluateContextExpr(definition.enablement, context))
  }

  execute(command: CommandId, window?: BrowserWindow, context: ContextReader = this.getDefaultContext()): void {
    const handler = this.handlers.get(command)
    if (!handler || !this.canExecute(command, context)) {
      logger.warn(`Command is not executable: ${command}`)
      return
    }

    try {
      void Promise.resolve(handler(window)).catch((error) => {
        logger.error(`Command handler failed: ${command}`, error as Error)
      })
    } catch (error) {
      logger.error(`Command handler failed: ${command}`, error as Error)
    }
  }

  private registerBuiltInHandlers(): void {
    this.registerHandler('app.window.show', () => {
      application.get('MainWindowService').toggleMainWindow()
    })

    this.registerHandler('app.settings.open', () => {
      application.get('SettingsWindowService').open('/settings/provider')
    })

    this.registerHandler('quick_assistant.toggle', () => {
      application.get('QuickAssistantService').toggleQuickAssistant()
    })

    this.registerHandler('app.zoom.in', (window) => {
      handleZoomFactor(getCommandTargetWindows(window), 0.1)
    })

    this.registerHandler('app.zoom.out', (window) => {
      handleZoomFactor(getCommandTargetWindows(window), -0.1)
    })

    this.registerHandler('app.zoom.reset', (window) => {
      handleZoomFactor(getCommandTargetWindows(window), 0, true)
    })

    this.registerHandler('selection.toggle', () => {
      application.get('SelectionService').toggleEnabled()
    })

    this.registerHandler('selection.capture_text', () => {
      application.get('SelectionService').processSelectTextByShortcut()
    })
  }

  private getDefaultContext(): ContextReader {
    const preferenceService = application.get('PreferenceService')
    return {
      'feature.quick_assistant.enabled': Boolean(preferenceService.get('feature.quick_assistant.enabled')),
      'feature.selection.enabled': Boolean(preferenceService.get('feature.selection.enabled')),
      platform: process.platform
    }
  }
}
