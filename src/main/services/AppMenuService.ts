import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { getAppLanguage, locales } from '@main/utils/language'
import { IpcChannel } from '@shared/IpcChannel'
import type { MenuItemConstructorOptions } from 'electron'
import { app, Menu, shell } from 'electron'

import { configManager } from './ConfigManager'
export class AppMenuService {
  private languageChangeCallback?: (newLanguage: string) => void

  constructor() {
    // Subscribe to language change events
    this.languageChangeCallback = () => {
      this.setupApplicationMenu()
    }
    configManager.subscribe('language', this.languageChangeCallback)
  }

  public destroy(): void {
    // Clean up subscription to prevent memory leaks
    if (this.languageChangeCallback) {
      configManager.unsubscribe('language', this.languageChangeCallback)
    }
  }

  public setupApplicationMenu(): void {
    const locale = locales[getAppLanguage()]
    const { appMenu } = locale.translation

    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: appMenu.about + ' ' + app.name,
            click: () => {
              // Emit event to navigate to About page
              const mainWindow = windowService.getMainWindow()
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IpcChannel.Windows_NavigateToAbout)
                windowService.showMainWindow()
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
          { role: 'resetZoom', label: appMenu.resetZoom },
          { role: 'zoomIn', label: appMenu.zoomIn },
          { role: 'zoomOut', label: appMenu.zoomOut },
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
              shell.openExternal('https://cherry-ai.com')
            }
          },
          {
            label: appMenu.documentation,
            click: () => {
              shell.openExternal('https://cherry-ai.com/docs')
            }
          },
          {
            label: appMenu.feedback,
            click: () => {
              shell.openExternal('https://github.com/CherryHQ/cherry-studio/issues/new/choose')
            }
          },
          {
            label: appMenu.releases,
            click: () => {
              shell.openExternal('https://github.com/CherryHQ/cherry-studio/releases')
            }
          }
        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}

export const appMenuService = isMac ? new AppMenuService() : null
