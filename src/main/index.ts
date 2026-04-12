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

import { application, serviceList } from '@application'
// Preboot (sync pre-bootstrap setup). Order matters — each module's JSDoc
// documents its own timing contract. See core/preboot/README.md.
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
import { initCrashTelemetry } from '@main/core/preboot/crashTelemetry'
import { requireSingleInstance } from '@main/core/preboot/singleInstance'
import { resolveUserDataLocation } from '@main/core/preboot/userDataLocation'
import { runV2MigrationGate } from '@main/core/preboot/v2MigrationGate'

requireSingleInstance()
resolveUserDataLocation()
configureChromiumFlags()
initCrashTelemetry()
// Freeze the path registry. From here application.getPath() is safe
// everywhere; bootstrap() asserts this happened.
application.initPathRegistry()

import { electronApp } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { app } from 'electron'

import { registerIpc } from './ipc'
import { versionService } from './services/VersionService'
import { extractRtkBinaries } from './utils/rtk'

const logger = loggerService.withContext('MainEntry')

// Set the Windows app user model id before app.whenReady() so Windows groups
// our windows under the correct taskbar entry from the first frame.
electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.kangfenmao.CherryStudio')

const startApp = async () => {
  // 'handled' = migration window took over OR fatal error already quit the app.
  const migrationResult = await runV2MigrationGate()
  if (migrationResult === 'handled') return

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
}

void startApp()
