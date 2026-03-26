/**
 * Main Entry Point
 *
 * WARNING: This file currently lacks proper lifecycle management. Event handlers
 * and initialization timing are fragmented — services are manually imported,
 * initialized in scattered locations, and cleaned up across multiple exit hooks.
 *
 * The v2 refactoring is progressively migrating old services into the lifecycle
 * system (see src/main/core/lifecycle/). During migration, the old manual pattern
 * (import singleton → call init()) coexists with the new lifecycle-managed pattern
 * (application.bootstrap() → application.get()). This file will be thoroughly
 * refactored once all services have been migrated.
 */

// Boot config must be the first to load
import { bootConfigService } from '@main/data/bootConfig'

if (bootConfigService.get('app.disable_hardware_acceleration')) {
  app.disableHardwareAcceleration()
}

// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready
// eslint-disable-next-line
import './bootstrap'

import '@main/config'

import { loggerService } from '@logger'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { app, dialog, crashReporter } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'
import { isDev, isLinux, isWin } from './constant'

import process from 'node:process'

import { registerIpc } from './ipc'
import { agentService } from './services/agents'
import { analyticsService } from './services/AnalyticsService'
import { apiServerService } from './services/ApiServerService'
import { appMenuService } from './services/AppMenuService'
import { lanTransferClientService } from './services/lanTransfer'
import { mcpService } from './services/MCPService'
import { localTransferService } from './services/LocalTransferService'
import { openClawService } from './services/OpenClawService'
import { nodeTraceService } from './services/NodeTraceService'
import { powerMonitorService } from './services/PowerMonitorService'
import {
  CHERRY_STUDIO_PROTOCOL,
  handleProtocolUrl,
  registerProtocolClient,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import { selectionService, initSelectionService } from './services/SelectionService'
import { registerShortcuts } from './services/ShortcutService'
import { themeService } from './services/ThemeService'
import { trayService } from './services/TrayService'
import { versionService } from './services/VersionService'
import { windowService } from './services/WindowService'
import {
  getAllMigrators,
  migrationEngine,
  migrationWindowManager,
  registerMigrationIpcHandlers,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { initWebviewHotkeys } from './services/WebviewService'
import { runAsyncFunction } from './utils'
import { isOvmsSupported } from './services/OvmsManager'
import { application, serviceList } from './core/application'

const logger = loggerService.withContext('MainEntry')

// enable local crash reports
crashReporter.start({
  companyName: 'CherryHQ',
  productName: 'CherryStudio',
  submitURL: '',
  uploadToServer: false
})

/**
 * Disable hardware acceleration if setting is enabled
 */
//FIXME should not use preferenceService before initialization
//TODO 我们需要调整配置管理的加载位置，以保证其在 preferenceService 初始化之前被调用
// const disableHardwareAcceleration = preferenceService.get('app.disable_hardware_acceleration')
// if (disableHardwareAcceleration) {
//   app.disableHardwareAcceleration()
// }

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

/**
 * Set window class and name for Linux
 * This ensures the window manager identifies the app correctly on both X11 and Wayland
 */
if (isLinux) {
  app.commandLine.appendSwitch('class', 'CherryStudio')
  app.commandLine.appendSwitch('name', 'CherryStudio')
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
  application.quit()
  process.exit(0)
} else {
  // ============================================================================
  // V2 Migration Gate
  // Migration check runs BEFORE app.whenReady() so it doesn't block lifecycle's
  // parallel startup. Only a bare DB connection is used — no lifecycle services.
  // If migration is needed, the app shows a migration window and restarts after.
  // If not, the lifecycle starts normally with BeforeReady parallel to whenReady.
  // ============================================================================
  const startApp = async () => {
    // ── Migration check (BEFORE whenReady — no Electron API needed) ──
    let needsMigration = false

    try {
      logger.info('Checking if data migration v2 is needed')
      await migrationEngine.initialize()
      migrationEngine.registerMigrators(getAllMigrators())
      needsMigration = await migrationEngine.needsMigration()
      logger.info('Migration status check result', { needsMigration })
    } catch (error) {
      logger.error('Migration status check failed', error as Error)
      await app.whenReady()
      dialog.showErrorBox(
        'Migration Status Check Failed - Application Cannot Start',
        `Could not determine if data migration is completed.\n\nThis may indicate a database connectivity issue: ${(error as Error).message}\n\nThe application will now exit. Please check your installation and try again.`
      )
      logger.error('Exiting application due to migration status check failure')
      application.quit()
      return
    }

    // ── Migration path: lifecycle never starts ──
    if (needsMigration) {
      logger.info('Data Migration v2 needed, starting migration process')
      registerMigrationIpcHandlers()

      try {
        await app.whenReady()
        migrationWindowManager.create()
        await migrationWindowManager.waitForReady()
        logger.info('Migration window created successfully')
      } catch (migrationError) {
        logger.error('Failed to start migration process', migrationError as Error)
        unregisterMigrationIpcHandlers()
        dialog.showErrorBox(
          'Migration Required - Application Cannot Start',
          `This version of Cherry Studio requires data migration to function properly.\n\nMigration window failed to start: ${(migrationError as Error).message}\n\nThe application will now exit. Please try starting again or contact support if the problem persists.`
        )
        logger.error('Exiting application due to failed migration startup')
        application.quit()
      }
      return
    }

    // ── Normal path: no migration needed ──
    migrationEngine.close()

    // Start lifecycle (BeforeReady runs parallel with app.whenReady)
    application.registerAll(serviceList)
    const bootstrapPromise = application.bootstrap().catch((error) => {
      logger.error('Application lifecycle bootstrap failed:', error)
    })

    // Register protocol/event handlers while bootstrap runs in parallel (same as old code)
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
      application.markQuitting()

      // quit selection service
      if (selectionService) {
        selectionService.quit()
      }

      lanTransferClientService.dispose()
      localTransferService.dispose()
    })

    app.on('will-quit', async () => {
      // Flush boot config to ensure pending writes are saved
      // FIXME：临时方案，等改造本文件时应在 application 中统一处理
      bootConfigService.flush()

      // 简单的资源清理，不阻塞退出流程
      if (isOvmsSupported) {
        const { ovmsManager } = await import('./services/OvmsManager')
        if (ovmsManager) {
          await ovmsManager.stopOvms()
        } else {
          logger.warn('Unexpected behavior: undefined ovmsManager, but OVMS should be supported.')
        }
      }

      try {
        await analyticsService.destroy()
        await openClawService.stopGateway()
        await mcpService.cleanup()
        await apiServerService.stop()
      } catch (error) {
        logger.warn('Error cleaning up services:', error as Error)
      }

      // v2 Refactoring: Shutdown lifecycle-managed services
      await application.shutdown()

      // finish the logger
      logger.finish()
    })

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    await app.whenReady()
    // Wait for lifecycle bootstrap to complete
    // (DbService, PreferenceService, CacheService, DataApiService are now ready)
    await bootstrapPromise

    // Record current version for tracking
    // A preparation for v2 data refactoring
    versionService.recordCurrentVersion()

    initWebviewHotkeys()
    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = application.get('PreferenceService').get('app.tray.on_launch')
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    // Check for backup restore marker and complete restoration (highest priority, before window creation)
    const { BackupManager } = await import('./services/BackupManager')
    await BackupManager.handleStartupRestore()

    // TODO: Remove manual init after ThemeService is migrated to lifecycle system
    themeService.init()

    // Create main window - migration has either completed or was not needed
    const mainWindow = windowService.createMainWindow()

    trayService.init()

    // Setup macOS application menu
    appMenuService?.setupApplicationMenu()
    nodeTraceService.init()
    powerMonitorService.init()
    analyticsService.init()

    app.on('activate', function () {
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        windowService.createMainWindow()
      } else {
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)
    await registerIpc(mainWindow, app)
    localTransferService.startDiscovery({ resetList: true })

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

    void runAsyncFunction(async () => {
      // Start API server if enabled or if agents exist
      try {
        const config = apiServerService.getCurrentConfig()
        logger.info('API server config:', config)

        // Check if there are any agents
        let shouldStart = config.enabled
        if (!shouldStart) {
          try {
            const { total } = await agentService.listAgents({ limit: 1 })
            if (total > 0) {
              shouldStart = true
              logger.info(`Detected ${total} agent(s), auto-starting API server`)
            }
          } catch (error: any) {
            logger.warn('Failed to check agent count:', error)
          }
        }

        if (shouldStart) {
          await apiServerService.start()
        }
      } catch (error: any) {
        logger.error('Failed to check/start API server:', error)
      }
    })
  }

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
  void startApp()
}
