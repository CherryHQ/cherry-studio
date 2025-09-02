// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready
// eslint-disable-next-line
import './bootstrap'

import '@main/config'

import { loggerService } from '@logger'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { dbService } from '@data/db/DbService'
import { preferenceService } from '@data/PreferenceService'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { app, dialog } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { isDev, isLinux, isWin } from './constant'
import { registerIpc } from './ipc'
import { configManager } from './services/ConfigManager'
import mcpService from './services/MCPService'
import { nodeTraceService } from './services/NodeTraceService'
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
import { dataRefactorMigrateService } from './data/migrate/dataRefactor/DataRefactorMigrateService'
import process from 'node:process'

const logger = loggerService.withContext('MainEntry')

/**
 * Disable hardware acceleration if setting is enabled
 */
//FIXME should not use configManager, use usePreference instead
//TODO 我们需要调整配置管理的加载位置，以保证其在 preferenceService 初始化之前被调用
const disableHardwareAcceleration = configManager.getDisableHardwareAcceleration()
if (disableHardwareAcceleration) {
  app.disableHardwareAcceleration()
}

/**
 * Disable chromium's window animations
 * main purpose for this is to avoid the transparent window flashing when it is shown
 * (especially on Windows for SelectionAssistant Toolbar)
 * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
 */
if (isWin) {
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}

/**
 * Enable GlobalShortcutsPortal for Linux Wayland Protocol
 * see: https://www.electronjs.org/docs/latest/api/global-shortcut
 */
if (isLinux && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

// DocumentPolicyIncludeJSCallStacksInCrashReports: Enable features for unresponsive renderer js call stacks
// EarlyEstablishGpuChannel,EstablishGpuChannelAsync: Enable features for early establish gpu channel
// speed up the startup time
// https://github.com/microsoft/vscode/pull/241640/files
app.commandLine.appendSwitch(
  'enable-features',
  'DocumentPolicyIncludeJSCallStacksInCrashReports,EarlyEstablishGpuChannel,EstablishGpuChannelAsync'
)
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
    logger.error('Renderer unresponsive start')
    const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
    logger.error(`Renderer unresponsive js call stack\n ${callStack}`)
  })
})

// in production mode, handle uncaught exception and unhandled rejection globally
if (!isDev) {
  // handle uncaught exception
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  // handle unhandled rejection
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`)
  })
}

// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
} else {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // First of all, init & migrate the database
    await dbService.migrateDb()
    await dbService.migrateSeed('preference')

    // Data Refactor Migration
    // Check if data migration is needed BEFORE creating any windows
    try {
      logger.info('Checking if data refactor migration is needed')
      const isMigrated = await dataRefactorMigrateService.isMigrated()
      logger.info('Migration status check result', { isMigrated })

      if (!isMigrated) {
        logger.info('Data Refactor Migration needed, starting migration process')

        try {
          await dataRefactorMigrateService.runMigration()
          logger.info('Migration window created successfully')
          // Migration service will handle the migration flow, no need to continue startup
          return
        } catch (migrationError) {
          logger.error('Failed to start migration process', migrationError as Error)

          // Migration is required for this version - show error and exit
          await dialog.showErrorBox(
            'Migration Required - Application Cannot Start',
            `This version of Cherry Studio requires data migration to function properly.\n\nMigration window failed to start: ${(migrationError as Error).message}\n\nThe application will now exit. Please try starting again or contact support if the problem persists.`
          )

          logger.error('Exiting application due to failed migration startup')
          app.quit()
          return
        }
      }
    } catch (error) {
      logger.error('Migration status check failed', error as Error)

      // If we can't check migration status, this could indicate a serious database issue
      // Since migration may be required, it's safer to exit and let user investigate
      await dialog.showErrorBox(
        'Migration Status Check Failed - Application Cannot Start',
        `Could not determine if data migration is completed.\n\nThis may indicate a database connectivity issue: ${(error as Error).message}\n\nThe application will now exit. Please check your installation and try again.`
      )

      logger.error('Exiting application due to migration status check failure')
      app.quit()
      return
    }

    //************FOR TESTING ONLY START****************/

    await preferenceService.initialize()

    // // Create two test windows for cross-window preference sync testing
    // logger.info('Creating test windows for PreferenceService cross-window sync testing')
    // const testWindow1 = dataRefactorMigrateService.createTestWindow()
    // const testWindow2 = dataRefactorMigrateService.createTestWindow()

    // // Position windows to avoid overlap
    // testWindow1.once('ready-to-show', () => {
    //   const [x, y] = testWindow1.getPosition()
    //   testWindow2.setPosition(x + 50, y + 50)
    // })
    /************FOR TESTING ONLY END****************/

    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = configManager.getLaunchToTray()
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    // Create main window - migration has either completed or was not needed
    const mainWindow = windowService.createMainWindow()

    new TrayService()
    nodeTraceService.init()

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

    // Setup deep link for AppImage on Linux
    await setupAppImageDeepLink()

    if (isDev) {
      installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((name) => logger.info(`Added Extension:  ${name}`))
        .catch((err) => logger.error('An error occurred: ', err))
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

  const handleOpenUrl = (args: string[]) => {
    const url = args.find((arg) => arg.startsWith(CHERRY_STUDIO_PROTOCOL + '://'))
    if (url) handleProtocolUrl(url)
  }

  // for windows to start with url
  handleOpenUrl(process.argv)

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    handleOpenUrl(argv)
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
    // 简单的资源清理，不阻塞退出流程
    try {
      await mcpService.cleanup()
    } catch (error) {
      logger.warn('Error cleaning up MCP service:', error as Error)
    }
    // finish the logger
    logger.finish()
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
