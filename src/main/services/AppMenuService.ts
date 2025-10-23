import { IpcChannel } from '@shared/IpcChannel'
import { app, Menu, MenuItemConstructorOptions } from 'electron'

import { isMac } from '../constant'

export class AppMenuService {
  public setupApplicationMenu(): void {
    if (!isMac) {
      return
    }

    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          {
            label: 'About ' + app.name,
            click: () => {
              // Emit event to navigate to About page
              const mainWindow = require('./WindowService').windowService.getMainWindow()
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IpcChannel.Windows_NavigateToAbout)
                require('./WindowService').windowService.showMainWindow()
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
        role: 'editMenu'
      },
      {
        role: 'windowMenu'
      }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}

export const appMenuService = new AppMenuService()
