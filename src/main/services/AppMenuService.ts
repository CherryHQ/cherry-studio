import type { BrowserWindow } from 'electron'
import { app, Menu, shell } from 'electron'

import { application } from '@application'
import { BaseService, Conditional, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import type { NativeCommandMenuItem, NativeMenuItem } from '@main/services/menu/adapters/nativeMenuAdapter'
import { toElectronMenuTemplate } from '@main/services/menu/adapters/nativeMenuAdapter'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { SupportedPlatform } from '@shared/types/command'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  resolveCommandKeybinding,
  resolveMenu
} from '@shared/utils/command'

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
    const commandItems = this.resolveAppMenuCommandItems({
      'app.settings.open': t('settings.title'),
      'app.zoom.reset': t('appMenu.resetZoom'),
      'app.zoom.in': t('appMenu.zoomIn'),
      'app.zoom.out': t('appMenu.zoomOut')
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
            label: t('appMenu.about') + ' ' + app.name,
            click: () => {
              openSettingsInMainWindow('/settings/about')
            }
          },
          getCommandItem('app.settings.open'),
          { type: 'separator' },
          { type: 'role', role: 'services', label: t('appMenu.services') },
          { type: 'separator' },
          { type: 'role', role: 'hide', label: `${t('appMenu.hide')} ${app.name}` },
          { type: 'role', role: 'hideOthers', label: t('appMenu.hideOthers') },
          { type: 'role', role: 'unhide', label: t('appMenu.unhide') },
          { type: 'separator' },
          { type: 'role', role: 'quit', label: `${t('appMenu.quit')} ${app.name}` }
        ]
      },
      {
        type: 'submenu',
        label: t('appMenu.file'),
        children: [{ type: 'role', role: 'close', label: t('appMenu.close') }]
      },
      {
        type: 'submenu',
        label: t('appMenu.edit'),
        children: [
          { type: 'role', role: 'undo', label: t('appMenu.undo') },
          { type: 'role', role: 'redo', label: t('appMenu.redo') },
          { type: 'separator' },
          { type: 'role', role: 'cut', label: t('appMenu.cut') },
          { type: 'role', role: 'copy', label: t('appMenu.copy') },
          { type: 'role', role: 'paste', label: t('appMenu.paste') },
          { type: 'role', role: 'delete', label: t('appMenu.delete') },
          { type: 'role', role: 'selectAll', label: t('appMenu.selectAll') }
        ]
      },
      {
        type: 'submenu',
        label: t('appMenu.view'),
        children: [
          { type: 'role', role: 'reload', label: t('appMenu.reload') },
          { type: 'role', role: 'forceReload', label: t('appMenu.forceReload') },
          { type: 'role', role: 'toggleDevTools', label: t('appMenu.toggleDevTools') },
          { type: 'separator' },
          getCommandItem('app.zoom.reset'),
          getCommandItem('app.zoom.in'),
          getCommandItem('app.zoom.out'),
          { type: 'separator' },
          { type: 'role', role: 'togglefullscreen', label: t('appMenu.toggleFullscreen') }
        ]
      },
      {
        type: 'submenu',
        label: t('appMenu.window'),
        children: [
          { type: 'role', role: 'minimize', label: t('appMenu.minimize') },
          { type: 'role', role: 'zoom', label: t('appMenu.zoom') },
          { type: 'separator' },
          { type: 'role', role: 'front', label: t('appMenu.front') }
        ]
      },
      {
        type: 'submenu',
        label: t('appMenu.help'),
        children: [
          {
            type: 'custom',
            label: t('appMenu.website'),
            click: () => {
              void shell.openExternal('https://cherry-ai.com')
            }
          },
          {
            type: 'custom',
            label: t('appMenu.documentation'),
            click: () => {
              void shell.openExternal('https://cherry-ai.com/docs')
            }
          },
          {
            type: 'custom',
            label: t('appMenu.feedback'),
            click: () => {
              void shell.openExternal('https://github.com/CherryHQ/cherry-studio/issues/new/choose')
            }
          },
          {
            type: 'custom',
            label: t('appMenu.releases'),
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
    const model = resolveMenu({
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
