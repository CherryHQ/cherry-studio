import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { Extension } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import buildChromeContextMenu from 'electron-chrome-context-menu'
import Logger from 'electron-log'

import { registerIpc } from './ipc'
import { configManager } from './services/ConfigManager'
import mcpService from './services/MCPService'
import { extensionService } from './services/ExtensionService'
import { CHERRY_STUDIO_PROTOCOL, handleProtocolUrl, registerProtocolClient } from './services/ProtocolClient'
import { reduxService } from './services/ReduxService'
import { registerShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { windowService } from './services/WindowService'

// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
} else {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = configManager.getLaunchToTray()
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    const mainWindow = windowService.createMainWindow()
    new TrayService()

    // Wait for the window to be ready before initializing extensions
    mainWindow.once('ready-to-show', async () => {
      // 初始化ExtensionService
      try {
        await extensionService.initialize()
        Logger.info('Extension Service initialized successfully')

        // Add delay before installing DevTools
        if (process.env.NODE_ENV === 'development') {
          const currentExtensions = (await reduxService.select('state.extensions')).extensions || []
          const devToolIds = ['fmkadmapgofadopljbjfkapdkoienihi', 'lmhkpmbekcpmknklioeibfkpmmfibljd']
          const installedDevTools = currentExtensions.filter((ext) => devToolIds.includes(ext.id))

          const devTools: Extension[] = []
          // Install React DevTools if not installed
          if (!installedDevTools.find((ext) => ext.id === 'fmkadmapgofadopljbjfkapdkoienihi')) {
            const reactDevTool = await extensionService.installExtension(undefined, {
              extensionId: 'fmkadmapgofadopljbjfkapdkoienihi', //REACT_DEVELOPER_TOOLS
              allowFileAccess: true
            })
            devTools.push(reactDevTool)
          }

          // Install Redux DevTools if not installed
          if (!installedDevTools.find((ext) => ext.id === 'lmhkpmbekcpmknklioeibfkpmmfibljd')) {
            const reduxDevTool = await extensionService.installExtension(undefined, {
              extensionId: 'lmhkpmbekcpmknklioeibfkpmmfibljd', //REDUX_DEVTOOLS
              allowFileAccess: true
            })
            devTools.push(reduxDevTool)
          }

          if (devTools.length > 0) {
            Logger.info(
              'DevTools installed:',
              devTools.map((tool) => tool.name)
            )
          } else {
            Logger.info('All DevTools are already installed')
          }
        }
        const extensions = extensionService.getExtensions
        app.on('web-contents-created', (_event, webContents) => {
          webContents.on('context-menu', (_e, params) => {
            const menu = buildChromeContextMenu({
              params,
              webContents,
              extensionMenuItems: extensions!.getContextMenuItems(webContents, params),
              openLink: (url) => {
                // Open the link in a new tab within the extension window
                extensionService.createExtensionTab({ url, active: true })
              }
            })
            menu.popup()
          })
        })
        extensionService.registerHostWindow(mainWindow)
        mainWindow.on('focus', () => {
          extensionService.selectHostWindowTab(mainWindow)
        })
      } catch (error) {
        Logger.error('Failed to initialize Extension Service:', error)
      }
    })

    app.on('activate', function () {
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        windowService.createMainWindow()
      } else {
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)

    registerIpc(mainWindow, app)

    replaceDevtoolsFont(mainWindow)

    ipcMain.handle(IpcChannel.System_GetDeviceType, () => {
      return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
    })

    ipcMain.handle(IpcChannel.System_GetHostname, () => {
      return require('os').hostname()
    })
  })

  registerProtocolClient(app)

  // macOS specific: handle protocol when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  registerProtocolClient(app)

  // macOS specific: handle protocol when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    const url = argv.find((arg) => arg.startsWith(CHERRY_STUDIO_PROTOCOL + '://'))
    if (url) handleProtocolUrl(url)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('before-quit', () => {
    app.isQuitting = true
  })

  app.on('will-quit', async () => {
    // event.preventDefault()
    try {
      await mcpService.cleanup()
    } catch (error) {
      Logger.error('Error cleaning up MCP service:', error)
    }
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
