import { application } from '@application'
import { BaseService, Conditional, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import type { NativeCommandMenuItem, NativeMenuItem } from '@main/services/menu/adapters/nativeMenuAdapter'
import { toElectronMenuTemplate } from '@main/services/menu/adapters/nativeMenuAdapter'
import { getAppLanguage, locales } from '@main/utils/language'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  menuRegistry,
  resolveCommandKeybinding,
  type SupportedPlatform
} from '@shared/command'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { BrowserWindow } from 'electron'
import { app, Menu, shell } from 'electron'

const appMenuCommands: CommandId[] = ['app.settings.open', 'app.zoom.in', 'app.zoom.out', 'app.zoom.reset']

const appMenuShortcutCommands = new Set(appMenuCommands)

const getShortcutAccelerator = (command: CommandId): string | undefined => {
  const commandDefinition = findCommandDefinition(command)
  const rule = findKeybindingRule(command)
  if (!commandDefinition || !rule) return undefined

  const context = { platform: process.platform }
  if (!evaluateContextExpr(commandDefinition.enablement, context)) {
    return undefined
  }

  const rawPref = application.get('PreferenceService').get(rule.preferenceKey) as PreferenceShortcutType | undefined
  return resolveCommandKeybinding({
    command,
    preference: rawPref,
    context,
    platform: process.platform as SupportedPlatform
  })?.accelerator
}

@Injectable('AppMenuService')
@ServicePhase(Phase.WhenReady)
@Conditional(onPlatform('darwin'))
export class AppMenuService extends BaseService {
  protected async onInit() {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(preferenceService.subscribeChange('app.language', () => this.setupApplicationMenu()))

    for (const command of appMenuCommands) {
      const rule = findKeybindingRule(command)
      if (rule) {
        this.registerDisposable(
          preferenceService.subscribeChange(rule.preferenceKey, () => this.setupApplicationMenu())
        )
      }
    }

    this.setupApplicationMenu()
  }

  private setupApplicationMenu(): void {
    const locale = locales[getAppLanguage()]
    const { appMenu } = locale.translation

    const commandItems = this.resolveAppMenuCommandItems({
      'app.settings.open': locale.translation.settings.title,
      'app.zoom.reset': appMenu.resetZoom,
      'app.zoom.in': appMenu.zoomIn,
      'app.zoom.out': appMenu.zoomOut
    })
    const getCommandItem = (command: CommandId): NativeCommandMenuItem => {
      const item = commandItems.get(command)
      if (!item) {
        throw new Error(`Missing app menu command contribution: ${command}`)
      }
      return item
    }

    const items: NativeMenuItem[] = [
      {
        type: 'submenu',
        label: app.name,
        children: [
          {
            type: 'custom',
            label: appMenu.about + ' ' + app.name,
            click: () => {
              application.get('SettingsWindowService').open('/settings/about')
            }
          },
          getCommandItem('app.settings.open'),
          { type: 'separator' },
          { type: 'role', role: 'services', label: appMenu.services },
          { type: 'separator' },
          { type: 'role', role: 'hide', label: `${appMenu.hide} ${app.name}` },
          { type: 'role', role: 'hideOthers', label: appMenu.hideOthers },
          { type: 'role', role: 'unhide', label: appMenu.unhide },
          { type: 'separator' },
          { type: 'role', role: 'quit', label: `${appMenu.quit} ${app.name}` }
        ]
      },
      {
        type: 'submenu',
        label: appMenu.file,
        children: [{ type: 'role', role: 'close', label: appMenu.close }]
      },
      {
        type: 'submenu',
        label: appMenu.edit,
        children: [
          { type: 'role', role: 'undo', label: appMenu.undo },
          { type: 'role', role: 'redo', label: appMenu.redo },
          { type: 'separator' },
          { type: 'role', role: 'cut', label: appMenu.cut },
          { type: 'role', role: 'copy', label: appMenu.copy },
          { type: 'role', role: 'paste', label: appMenu.paste },
          { type: 'role', role: 'delete', label: appMenu.delete },
          { type: 'role', role: 'selectAll', label: appMenu.selectAll }
        ]
      },
      {
        type: 'submenu',
        label: appMenu.view,
        children: [
          { type: 'role', role: 'reload', label: appMenu.reload },
          { type: 'role', role: 'forceReload', label: appMenu.forceReload },
          { type: 'role', role: 'toggleDevTools', label: appMenu.toggleDevTools },
          { type: 'separator' },
          getCommandItem('app.zoom.reset'),
          getCommandItem('app.zoom.in'),
          getCommandItem('app.zoom.out'),
          { type: 'separator' },
          { type: 'role', role: 'togglefullscreen', label: appMenu.toggleFullscreen }
        ]
      },
      {
        type: 'submenu',
        label: appMenu.window,
        children: [
          { type: 'role', role: 'minimize', label: appMenu.minimize },
          { type: 'role', role: 'zoom', label: appMenu.zoom },
          { type: 'separator' },
          { type: 'role', role: 'front', label: appMenu.front }
        ]
      },
      {
        type: 'submenu',
        label: appMenu.help,
        children: [
          {
            type: 'custom',
            label: appMenu.website,
            click: () => {
              void shell.openExternal('https://cherry-ai.com')
            }
          },
          {
            type: 'custom',
            label: appMenu.documentation,
            click: () => {
              void shell.openExternal('https://cherry-ai.com/docs')
            }
          },
          {
            type: 'custom',
            label: appMenu.feedback,
            click: () => {
              void shell.openExternal('https://github.com/CherryHQ/cherry-studio/issues/new/choose')
            }
          },
          {
            type: 'custom',
            label: appMenu.releases,
            click: () => {
              void shell.openExternal('https://github.com/CherryHQ/cherry-studio/releases')
            }
          }
        ]
      }
    ]

    const template = toElectronMenuTemplate(items, {
      executeCommand: (command, context) => {
        application.get('CommandService').execute(command, context.browserWindow as BrowserWindow | undefined)
      }
    })
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  private resolveAppMenuCommandItems(
    labels: Partial<Record<CommandId, string>>
  ): Map<CommandId, NativeCommandMenuItem> {
    const model = menuRegistry.resolve({
      location: 'app.menu',
      context: { platform: process.platform },
      getCommandState: (command) => {
        return {
          label: labels[command] ?? command,
          enabled: true,
          shortcutLabel: '',
          accelerator: appMenuShortcutCommands.has(command) ? getShortcutAccelerator(command) : undefined
        }
      }
    })

    const commandItems = new Map<CommandId, NativeCommandMenuItem>()
    for (const item of model.items) {
      if (item.type === 'command') {
        commandItems.set(item.command, item)
      }
    }
    return commandItems
  }
}
