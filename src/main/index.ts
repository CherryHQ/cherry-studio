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
// eslint-disable-next-line
import '@main/data/bootConfig'

// [v2] the following code is to be refactored
// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready

import './bootstrap'

import '@main/config'

import process from 'node:process'

import {
  getAllMigrators,
  migrationEngine,
  migrationWindowManager,
  registerMigrationIpcHandlers,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { bootConfigService } from '@main/data/bootConfig'
import { app, crashReporter, dialog } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { isDev, isLinux, isWin } from './constant'
import { application, serviceList } from './core/application'
import { registerIpc } from './ipc'
import {
  CHERRY_STUDIO_PROTOCOL,
  handleProtocolUrl,
  registerProtocolClient,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import { versionService } from './services/VersionService'
import { extractRtkBinaries } from './utils/rtk'

const logger = loggerService.withContext('MainEntry')

// [v2] Should handle earlier
// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  application.quit()
  process.exit(0)
}

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
if (bootConfigService.get('app.disable_hardware_acceleration')) {
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

  // Check for backup restore marker and complete restoration BEFORE bootstrap.
  // BackupManager physically removes/replaces IndexedDB and Local Storage directories.
  // Must run before bootstrap creates the main window (which starts the renderer),
  // otherwise Chromium holds file handles causing EBUSY on Windows or data corruption on macOS/Linux.
  const { BackupManager } = await import('./services/BackupManager')
  await BackupManager.handleStartupRestore()

  // Extract bundled rtk binary to ~/.cherrystudio/bin/ on first run
  // TODO: v2 refactor to use lifecycle
  extractRtkBinaries().catch((error) => {
    logger.warn('Failed to extract rtk binaries (non-fatal)', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

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
    application.get('WindowService').showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    handleOpenUrl(argv)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
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

  // Set app user model id for windows
  electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

  // Main window was created by WindowService.onReady() during bootstrap.
  // registerIpc still needs the window reference for legacy IPC handlers.
  const mainWindow = application.get('WindowService').getMainWindow()!
  await registerIpc(mainWindow, app)

  // Setup deep link for AppImage on Linux
  await setupAppImageDeepLink()

  if (isDev) {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
      .then((name) => logger.info(`Added Extension:  ${name}`))
      .catch((err) => logger.error('An error occurred: ', err))
  }
}

void startApp()
