import { application } from '@application'
import { BaseService, Conditional, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage, locales } from '@main/utils/language'
import { handleZoomFactor } from '@main/utils/zoom'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { findShortcutDefinition } from '@shared/shortcuts/definitions'
import type { ShortcutPreferenceKey } from '@shared/shortcuts/types'
import { resolveShortcutPreference } from '@shared/shortcuts/utils'
import type { MenuItemConstructorOptions } from 'electron'
import { app, Menu, shell } from 'electron'

const zoomShortcutKeys: ShortcutPreferenceKey[] = [
  'shortcut.general.zoom_in',
  'shortcut.general.zoom_out',
  'shortcut.general.zoom_reset'
]

const getShortcutAccelerator = (key: ShortcutPreferenceKey): string | undefined => {
  const definition = findShortcutDefinition(key)
  if (!definition) return undefined
  const rawPref = application.get('PreferenceService').get(key) as PreferenceShortcutType | undefined
  const resolved = resolveShortcutPreference(definition, rawPref)
  if (!resolved.enabled || !resolved.binding.length) {
    return undefined
  }
  return resolved.binding.join('+')
}

const getMainWindows = (): Electron.BrowserWindow[] =>
  [application.get('WindowService').getMainWindow()].filter(Boolean) as Electron.BrowserWindow[]

@Injectable('AppMenuService')
@ServicePhase(Phase.WhenReady)
@Conditional(onPlatform('darwin'))
export class AppMenuService extends BaseService {
  protected async onInit() {
    const preferenceService = application.get('PreferenceService')
    this.registerDisposable(preferenceService.subscribeChange('app.language', () => this.setupApplicationMenu()))

    for (const key of zoomShortcutKeys) {
      this.registerDisposable(preferenceService.subscribeChange(key, () => this.setupApplicationMenu()))
    }

    this.setupApplicationMenu()
  }

  private setupApplicationMenu(): void {
    const locale = locales[getAppLanguage()]
    const { appMenu } = locale.translation

    const zoomInAccelerator = getShortcutAccelerator('shortcut.general.zoom_in')
    const zoomOutAccelerator = getShortcutAccelerator('shortcut.general.zoom_out')
    const zoomResetAccelerator = getShortcutAccelerator('shortcut.general.zoom_reset')

    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: appMenu.about + ' ' + app.name,
            click: () => {
              const mainWindow = application.get('WindowService').getMainWindow()
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IpcChannel.Windows_NavigateToAbout)
                application.get('WindowService').showMainWindow()
              }
            }
          },
          { type: 'separator' },
          { role: 'services', label: appMenu.services },
          { type: 'separator' },
          { role: 'hide', label: `${appMenu.hide} ${app.name}` },
          { role: 'hideOthers', label: appMenu.hideOthers },
          { role: 'unhide', label: appMenu.unhide },
          { type: 'separator' },
          { role: 'quit', label: `${appMenu.quit} ${app.name}` }
        ]
      },
      {
        label: appMenu.file,
        submenu: [{ role: 'close', label: appMenu.close }]
      },
      {
        label: appMenu.edit,
        submenu: [
          { role: 'undo', label: appMenu.undo },
          { role: 'redo', label: appMenu.redo },
          { type: 'separator' },
          { role: 'cut', label: appMenu.cut },
          { role: 'copy', label: appMenu.copy },
          { role: 'paste', label: appMenu.paste },
          { role: 'delete', label: appMenu.delete },
          { role: 'selectAll', label: appMenu.selectAll }
        ]
      },
      {
        label: appMenu.view,
        submenu: [
          { role: 'reload', label: appMenu.reload },
          { role: 'forceReload', label: appMenu.forceReload },
          { role: 'toggleDevTools', label: appMenu.toggleDevTools },
          { type: 'separator' },
          {
            label: appMenu.resetZoom,
            accelerator: zoomResetAccelerator,
            click: () => handleZoomFactor(getMainWindows(), 0, true)
          },
          {
            label: appMenu.zoomIn,
            accelerator: zoomInAccelerator,
            click: () => handleZoomFactor(getMainWindows(), 0.1)
          },
          {
            label: appMenu.zoomOut,
            accelerator: zoomOutAccelerator,
            click: () => handleZoomFactor(getMainWindows(), -0.1)
          },
          { type: 'separator' },
          { role: 'togglefullscreen', label: appMenu.toggleFullscreen }
        ]
      },
      {
        label: appMenu.window,
        submenu: [
          { role: 'minimize', label: appMenu.minimize },
          { role: 'zoom', label: appMenu.zoom },
          { type: 'separator' },
          { role: 'front', label: appMenu.front }
        ]
      },
      {
        label: appMenu.help,
        submenu: [
          {
            label: appMenu.website,
            click: () => {
              void shell.openExternal('https://cherry-ai.com')
            }
          },
          {
            label: appMenu.documentation,
            click: () => {
              void shell.openExternal('https://cherry-ai.com/docs')
            }
          },
          {
            label: appMenu.feedback,
            click: () => {
              void shell.openExternal('https://github.com/CherryHQ/cherry-studio/issues/new/choose')
            }
          },
          {
            label: appMenu.releases,
            click: () => {
              void shell.openExternal('https://github.com/CherryHQ/cherry-studio/releases')
            }
          }
        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}
