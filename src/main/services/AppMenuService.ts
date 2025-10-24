import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { locales } from '@main/utils/locales'
import { IpcChannel } from '@shared/IpcChannel'
import { app, Menu, MenuItemConstructorOptions, shell } from 'electron'

import { configManager } from './ConfigManager'
export class AppMenuService {
  public setupApplicationMenu(): void {
    const locale = locales[configManager.getLanguage()]
    const { common } = locale.translation

    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: common.about + ' ' + app.name,
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
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        role:'fileMenu'
      },
      {
        role: 'editMenu'
      },
      {
        role: 'viewMenu'
      },
      {
        role: 'windowMenu'
      },
      {
        role: 'help',
        submenu: [
          {
            label: 'Website',
            click: () => {
              shell.openExternal('https://cherry-ai.com')
            }
          },
          {
            label: 'Documentation',
            click: () => {
              shell.openExternal('https://cherry-ai.com/docs')
            }
          },
          {
            label: 'Feedback',
            click: () => {
              shell.openExternal('https://github.com/CherryHQ/cherry-studio/issues/new/choose')
            }
          },
          {
            label: 'Releases',
            click: () => {
              shell.openExternal('https://github.com/CherryHQ/cherry-studio/releases')
            }
          },

        ]
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}

export const appMenuService = isMac ? new AppMenuService() : null
