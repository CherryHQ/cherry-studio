import { isMac } from '@main/constant'
import { windowService } from '@main/services/WindowService'
import { locales } from '@main/utils/locales'
import { BUILD_CONSTANTS } from '@shared/build-constants'
import { IpcChannel } from '@shared/IpcChannel'
import type { MenuItemConstructorOptions } from 'electron'
import { Menu, shell } from 'electron'

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
    const locale = locales[configManager.getLanguage()]
    const { appMenu } = locale.translation

    const appName = BUILD_CONSTANTS.APP_NAME

    const template: MenuItemConstructorOptions[] = [
      {
        label: appName,
        submenu: [
          {
            label: appMenu.about + ' ' + appName,
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
          { role: 'hide', label: `${appMenu.hide} ${appName}` },
          { role: 'hideOthers', label: appMenu.hideOthers },
          { role: 'unhide', label: appMenu.unhide },
          { type: 'separator' },
          { role: 'quit', label: `${appMenu.quit} ${appName}` }
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
              shell.openExternal(BUILD_CONSTANTS.APP_HOMEPAGE)
            }
          },
          ...(BUILD_CONSTANTS.SHOW_DOCS
            ? [
                {
                  label: appMenu.documentation,
                  click: () => {
                    shell.openExternal('https://docs.cherry-ai.com/')
                  }
                }
              ]
            : []),
          {
            label: appMenu.feedback,
            click: () => {
              shell.openExternal(`${BUILD_CONSTANTS.GITHUB_REPO_URL}/issues/new/choose`)
            }
          },
          {
            label: appMenu.releases,
            click: () => {
              shell.openExternal(`${BUILD_CONSTANTS.GITHUB_REPO_URL}/releases`)
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
