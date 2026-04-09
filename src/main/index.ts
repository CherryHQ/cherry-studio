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

import '@main/data/bootConfig'

// Preboot phase: synchronous setup that must complete BEFORE
// application.bootstrap() is called. See core/preboot/README.md for the
// membership criteria and the preboot/bootstrap/running vocabulary.
//
// Each preboot module is imported from its concrete file (no barrel export)
// so the timing contract of each call stays visible at this call site:
//   - resolveUserDataLocation() must run before application.initPathRegistry()
//     (handles both normal startup and pending userData relocation, then
//     calls app.setPath('userData', ...))
//   - configureChromiumFlags() must run before app.whenReady() (Chromium
//     reads its command-line switches and GPU flags exactly once at startup)
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
import { resolveUserDataLocation } from '@main/core/preboot/userDataLocation'

resolveUserDataLocation()

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
import { app, crashReporter, dialog } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'

import { isDev } from './constant'
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

// Configure Chromium startup flags. Must run before app.whenReady() fires.
// See core/preboot/chromiumFlags.ts for the full list and rationale.
configureChromiumFlags()

// enable local crash reports
crashReporter.start({
  companyName: 'CherryHQ',
  productName: 'CherryStudio',
  submitURL: '',
  uploadToServer: false
})

// Initialize the path registry now that:
//   (1) resolveUserDataLocation() above has finished all app.setPath('userData', ...)
//       calls — buildPathRegistry() reads app.getPath('userData') and other
//       Electron paths, so userData must be settled first.
//   (2) the single-instance lock check has confirmed we're the live process —
//       second instances quit before reaching this line, so we don't waste
//       initialization on a process that's about to exit.
// From this point on, application.getPath() is safe to call from any
// preboot, migration, or service-startup code. application.bootstrap()
// asserts this initialization happened — see Application.initPathRegistry().
application.initPathRegistry()

// Set the Windows app user model id before app.whenReady() so Windows groups
// our windows under the correct taskbar entry from the first frame.
electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

// Paired with the DocumentPolicyIncludeJSCallStacksInCrashReports feature
// flag enabled in configureChromiumFlags(). The Document-Policy header below
// opts every web contents into the JS-call-stack crash report policy so that
// the 'unresponsive' listener can collect call stacks from stuck renderers.
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

  // Extract bundled rtk binary to ~/.cherrystudio/bin/ on first run
  // TODO: v2 refactor to use lifecycle
  extractRtkBinaries().catch((error) => {
    logger.warn('Failed to extract rtk binaries (non-fatal)', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  // [v2] temporary code to set the CherryAI client secret (move from config.ts)
  // TODO: should move to somewhere else
  global.CHERRYAI_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET

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
