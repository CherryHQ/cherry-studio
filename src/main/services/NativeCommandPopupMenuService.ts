import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type NativeMenuItem, toElectronMenuTemplate } from '@main/services/menu/adapters/nativeMenuAdapter'
import type {
  CommandId,
  MenuAnchor,
  NativePopupMenuItem,
  NativePopupMenuModel,
  NativePopupMenuResult,
  ResolvedMenuItem
} from '@shared/command'
import { findCommandDefinition } from '@shared/command'
import { IpcChannel } from '@shared/IpcChannel'
import type { IpcMainInvokeEvent } from 'electron'
import { BrowserWindow, Menu } from 'electron'

const logger = loggerService.withContext('NativeCommandPopupMenuService')

const nativePopupMenuLocations = new Set([
  'webcontents.context',
  'chat.input.tools.context',
  'chat.message.context',
  'topic.context'
])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isCommandId = (value: unknown): value is CommandId =>
  typeof value === 'string' && findCommandDefinition(value as CommandId) !== undefined

const isMenuAnchor = (value: unknown): value is MenuAnchor => {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return (
    (value.x === undefined || typeof value.x === 'number') && (value.y === undefined || typeof value.y === 'number')
  )
}

const isResolvedMenuItem = (value: unknown): value is ResolvedMenuItem<CommandId> => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  if (value.type === 'separator') {
    return true
  }

  if (value.type === 'command') {
    return (
      isCommandId(value.command) &&
      typeof value.label === 'string' &&
      typeof value.enabled === 'boolean' &&
      (value.checked === undefined || typeof value.checked === 'boolean') &&
      (value.destructive === undefined || typeof value.destructive === 'boolean') &&
      (value.iconKey === undefined || typeof value.iconKey === 'string') &&
      typeof value.shortcutLabel === 'string' &&
      (value.accelerator === undefined || typeof value.accelerator === 'string')
    )
  }

  if (value.type === 'submenu') {
    return (
      typeof value.label === 'string' &&
      typeof value.enabled === 'boolean' &&
      (value.iconKey === undefined || typeof value.iconKey === 'string') &&
      Array.isArray(value.children) &&
      value.children.every(isResolvedMenuItem)
    )
  }

  return false
}

const isNativePopupMenuItem = (value: unknown): value is NativePopupMenuItem<CommandId> => {
  if (!isRecord(value)) {
    return false
  }

  if (value.type === 'custom') {
    return (
      typeof value.id === 'string' &&
      typeof value.label === 'string' &&
      (value.enabled === undefined || typeof value.enabled === 'boolean') &&
      (value.checked === undefined || typeof value.checked === 'boolean') &&
      (value.shortcutLabel === undefined || typeof value.shortcutLabel === 'string') &&
      (value.accelerator === undefined || typeof value.accelerator === 'string')
    )
  }

  if (value.type === 'submenu') {
    return (
      typeof value.label === 'string' &&
      typeof value.enabled === 'boolean' &&
      (value.iconKey === undefined || typeof value.iconKey === 'string') &&
      Array.isArray(value.children) &&
      value.children.every(isNativePopupMenuItem)
    )
  }

  return isResolvedMenuItem(value)
}

const isNativePopupMenuModel = (value: unknown): value is NativePopupMenuModel<CommandId> =>
  isRecord(value) &&
  typeof value.location === 'string' &&
  nativePopupMenuLocations.has(value.location) &&
  Array.isArray(value.items) &&
  value.items.every(isNativePopupMenuItem)

@Injectable('NativeCommandPopupMenuService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CommandService'])
export class NativeCommandPopupMenuService extends BaseService {
  protected async onInit() {
    this.ipcHandle(IpcChannel.NativeCommandPopupMenu_Show, (event, model: unknown, anchor: unknown) =>
      this.showNativePopupMenu(event, model, anchor)
    )
  }

  private showNativePopupMenu(
    event: IpcMainInvokeEvent,
    model: unknown,
    anchor: unknown
  ): Promise<NativePopupMenuResult<CommandId> | undefined> {
    if (!isNativePopupMenuModel(model) || !isMenuAnchor(anchor)) {
      logger.warn('Rejected invalid native command popup menu payload')
      return Promise.resolve(undefined)
    }

    return new Promise((resolve) => {
      let settled = false
      const settle = (result?: NativePopupMenuResult<CommandId>) => {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      const template = toElectronMenuTemplate(this.toNativeMenuItems(model.items, settle), {
        registerAccelerator: false,
        executeCommand: (command) => this.executeCommand(command, event, settle)
      })
      if (!template.length) {
        settle(undefined)
        return
      }

      try {
        const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const menu = Menu.buildFromTemplate(template)
        menu.popup({
          window,
          x: anchor?.x,
          y: anchor?.y,
          callback: () => settle(undefined)
        })
      } catch (error) {
        logger.error('Failed to show native command popup menu', error as Error)
        settle(undefined)
      }
    })
  }

  private toNativeMenuItems(
    items: readonly NativePopupMenuItem<CommandId>[],
    settle: (result?: NativePopupMenuResult<CommandId>) => void
  ): NativeMenuItem[] {
    return items.map((item) => {
      if (item.type === 'custom') {
        return {
          type: 'custom',
          label: item.label,
          enabled: item.enabled,
          checked: item.checked,
          accelerator: item.accelerator,
          click: () => settle({ type: 'custom', id: item.id })
        }
      }

      if (item.type === 'submenu') {
        return {
          type: 'submenu',
          label: item.label,
          enabled: item.enabled,
          iconKey: item.iconKey,
          children: this.toNativeMenuItems(item.children, settle)
        }
      }

      return item
    })
  }

  private executeCommand(
    command: CommandId,
    event: IpcMainInvokeEvent,
    settle: (result?: NativePopupMenuResult<CommandId>) => void
  ): void {
    const commandService = application.get('CommandService')
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined

    if (commandService.hasHandler(command)) {
      commandService.execute(command, window)
      settle(undefined)
      return
    }

    settle({ type: 'command', command })
  }
}
