import '@main/config'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initAppDataDir } from '@main/utils/file'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { app } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { setupLogger } from './configs/logger'
import Logger from './configs/logger'
import { isDev, isWin } from './constant'
import { registerIpc } from './ipc'
import { configManager } from './services/ConfigManager'
import mcpService from './services/MCPService'
import {
  CHERRY_STUDIO_PROTOCOL,
  handleProtocolUrl,
  registerProtocolClient,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import selectionService, { initSelectionService } from './services/SelectionService'
import { registerShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { windowService } from './services/WindowService'

// Early warning handler to catch console errors before logger setup
process.on('warning', (warning) => {
  // Diagnostic: Log warning details to file directly
  const fs = require('fs')
  const path = require('path')
  const userDataPath = app.getPath('userData')
  const logPath = path.join(userDataPath, 'early-warnings.log')
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] Warning: ${warning.name} - ${warning.message}\nStack: ${warning.stack}\n\n`

  try {
    fs.appendFileSync(logPath, logEntry)
    // Also log the path to console so user can find it
    console.log(`[DEBUG] Diagnostic logs are being written to: ${userDataPath}`)
  } catch (err) {
    // Can't log file write errors
  }
})

// Override console.error early to prevent EIO errors
const originalConsoleError = console.error
console.error = (...args) => {
  try {
    if (originalConsoleError) {
      originalConsoleError.apply(console, args)
    }
  } catch (error) {
    // Silently ignore console errors during early initialization
    // These will be properly handled once the logger is set up
  }
}

initAppDataDir()
setupLogger()

/**
 * Disable chromium's window animations
 * main purpose for this is to avoid the transparent window flashing when it is shown
 * (especially on Windows for SelectionAssistant Toolbar)
 * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
 */
if (isWin) {
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}

// Enable features for unresponsive renderer js call stacks
app.commandLine.appendSwitch('enable-features', 'DocumentPolicyIncludeJSCallStacksInCrashReports')
app.on('web-contents-created', (_, webContents) => {
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports']
      }
    })
  })

  webContents.on('unresponsive', async () => {
    // Interrupt execution and collect call stack from unresponsive renderer
    Logger.error('Renderer unresponsive start')
    const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
    Logger.error('Renderer unresponsive js call stack\n', callStack)
  })
})

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  try {
    Logger.error('Uncaught Exception:', error.message, error.stack)
  } catch {
    // If logger fails, try to write to a crash file as last resort
    const crashFile = require('path').join(app.getPath('userData'), 'crash.log')
    const fs = require('fs')
    const crashData = `[${new Date().toISOString()}] Uncaught Exception: ${error.message}\n${error.stack}\n`
    fs.appendFileSync(crashFile, crashData)
  }

  // In production, we've logged the error, but let the app continue if possible
})

process.on('unhandledRejection', (reason, promise) => {
  try {
    Logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
  } catch {
    // If logger fails, try to write to a crash file as last resort
    const crashFile = require('path').join(app.getPath('userData'), 'crash.log')
    const fs = require('fs')
    const crashData = `[${new Date().toISOString()}] Unhandled Rejection: ${reason}\n`
    fs.appendFileSync(crashFile, crashData)
  }
})

// Prevent writes to closed stdio streams
process.stdout.on('error', (err) => {
  // Ignore EPIPE and EIO errors on stdout
  if (err.code === 'EPIPE' || err.code === 'EIO') {
    return
  }
})

process.stderr.on('error', (err) => {
  // Ignore EPIPE and EIO errors on stderr
  if (err.code === 'EPIPE' || err.code === 'EIO') {
    return
  }
})

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

    Logger.info('[Main] Creating main window...')
    const mainWindow = windowService.createMainWindow()
    Logger.info('[Main] Main window created')

    Logger.info('[Main] Creating tray service...')
    new TrayService()
    Logger.info('[Main] Tray service created')

    app.on('activate', function () {
      Logger.info('[Main] App activate event fired')
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        Logger.info('[Main] Main window not found or destroyed, creating new one')
        windowService.createMainWindow()
      } else {
        Logger.info('[Main] Showing existing main window')
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)

    registerIpc(mainWindow, app)

    replaceDevtoolsFont(mainWindow)

    // Setup deep link for AppImage on Linux
    await setupAppImageDeepLink()

    if (isDev) {
      installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((name) => console.log(`Added Extension:  ${name}`))
        .catch((err) => console.log('An error occurred: ', err))
    }

    //start selection assistant service
    initSelectionService()
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

    // quit selection service
    if (selectionService) {
      selectionService.quit()
    }
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
