import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { Extension } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain, session } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'
import Logger from 'electron-log'

import { registerIpc } from './ipc'
import { configManager } from './services/ConfigManager'
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
          setTimeout(async () => {
            try {
              await installExtension([REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS], {
                loadExtensionOptions: { allowFileAccess: true }
              })
              // Update Redux store with the developer tools extensions
              try {
                const currentExtensions = (await reduxService.select('state.extensions')).extensions || []
                const newExtensions = session.defaultSession
                  .getAllExtensions()
                  .filter((ext) => [REDUX_DEVTOOLS.id, REACT_DEVELOPER_TOOLS.id].includes(ext.id))
                  .map((ext) => {
                    return {
                      id: ext.id,
                      name: ext.manifest.name,
                      version: ext.manifest.version,
                      description: ext.manifest.description,
                      icon: ext.manifest.icons?.[0]?.url,
                      path: ext.path,
                      enabled: true,
                      source: 'store'
                    } as Extension
                  })

                if (newExtensions.length > 0) {
                  await reduxService.dispatch({
                    type: 'extensions/setExtensions',
                    payload: [...currentExtensions, ...newExtensions]
                  })
                  Logger.info('[Extension] Added developer tools to Redux store')
                }
              } catch (error) {
                Logger.warn('[Extension] Failed to update Redux store with developer tools:', error)
              }
            } catch (err) {
              console.log('An error occurred: ', err)
            }
          }, 2000) // 添加2秒延迟
        }
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

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
