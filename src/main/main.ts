/**
 * Electron main-process entry — preboot → bootstrap → running.
 *
 * DO NOT add new code here. If you feel the need to, you almost certainly
 * misunderstand the startup timing or service architecture. New services
 * belong in the lifecycle system (see core/lifecycle/); new preboot work
 * belongs in core/preboot/. This file is glue — it should only shrink.
 */

// BootConfig must load before any other import (configures userData path)

import '@main/data/bootConfig'

import { application } from '@application'
import { electronApp } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { serviceList } from '@main/core/application/serviceRegistry'
// Preboot phase — order matters. See core/preboot/README.md.
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
import { initCrashTelemetry } from '@main/core/preboot/crashTelemetry'
import { runUserDataRelocationGate } from '@main/core/preboot/relocation/relocationGate'
import { requireSingleInstance } from '@main/core/preboot/singleInstance'
import {
  clearCommittedUserDataLocation,
  InvalidConfiguredUserDataPathError,
  resolveUserDataLocation
} from '@main/core/preboot/userDataLocation'
import { runV2MigrationGate } from '@main/core/preboot/v2MigrationGate'
import { app, dialog } from 'electron'

const logger = loggerService.withContext('MainEntry')

let invalidUserDataPathError: InvalidConfiguredUserDataPathError | null = null

try {
  // should be the first to resolveUserDataLocation()
  resolveUserDataLocation()
} catch (error) {
  if (!(error instanceof InvalidConfiguredUserDataPathError)) throw error
  invalidUserDataPathError = error
}

if (!invalidUserDataPathError) {
  requireSingleInstance()
  configureChromiumFlags()
  initCrashTelemetry()
  // Freeze the path registry — bootstrap() asserts this completed.
  application.initPathRegistry()
}

import { registerIpc } from './ipc'
import { versionService } from './services/VersionService'

async function handleInvalidConfiguredUserDataPath(error: InvalidConfiguredUserDataPathError): Promise<void> {
  logger.warn('Configured userData path is not usable; blocking startup', {
    exe: error.exe,
    configuredPath: error.configuredPath,
    reason: error.reason
  })

  await app.whenReady()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Custom Data Directory Inaccessible',
    message:
      `Your configured data directory is currently inaccessible:\n${error.configuredPath}\n\n` +
      `Reason: ${error.reason}\n\n` +
      'Cherry Studio will not start with the default data directory unless you explicitly reset this setting.',
    buttons: ['Retry', 'Use Default', 'Quit'],
    defaultId: 0,
    cancelId: 2
  })

  if (response === 0) {
    application.relaunch()
    return
  }
  if (response === 1) {
    clearCommittedUserDataLocation(error.exe)
    application.relaunch()
    return
  }

  application.quit()
}

const startApp = async () => {
  if (invalidUserDataPathError) {
    await handleInvalidConfiguredUserDataPath(invalidUserDataPathError)
    return
  }

  // Relocation gate runs first: if a userData relocation is pending it takes
  // over the whole launch (dedicated window → copy → relaunch), so it must
  // run before the v1→v2 migration gate and before bootstrap — neither
  // should start against a userData that is about to move.
  // 'handled' = relocation window took over; caller must return immediately.
  const relocationResult = await runUserDataRelocationGate()
  if (relocationResult === 'handled') return

  // 'handled' = migration window took over OR fatal error already quit the app.
  const migrationResult = await runV2MigrationGate()
  if (migrationResult === 'handled') return

  // Set the Windows AppUserModelID — the identity Windows uses to attribute this
  // app's notifications, taskbar icon grouping, and Jump Lists (no-op on macOS/Linux).
  // Must run before any window is created or notification fires, hence after the
  // migration gate returns and before lifecycle bootstrap.
  electronApp.setAppUserModelId('com.cherryai.cherrystudio')

  // Start lifecycle (BeforeReady runs parallel with app.whenReady)
  application.registerAll(serviceList)
  const bootstrapPromise = application.bootstrap()

  await app.whenReady()
  // Wait for lifecycle bootstrap (all core services are now ready)
  await bootstrapPromise

  // Record current version for upgrade-path tracking
  versionService.recordCurrentVersion()

  // Legacy monolithic IPC registration — causes timing coupling between
  // bootstrap and IPC readiness. TODO(v2): decompose into per-service
  // ipcHandle/ipcOn inside lifecycle services.
  await registerIpc()
}

// Top-level safety net: bootstrap() handles known fatal errors internally
// (ServiceInitError → dialog → exit/relaunch), so this catch only fires
// for unexpected errors that escape the normal handling path.
startApp().catch((error) => {
  logger.error('Fatal startup error:', error)
  application.forceExit(1)
})
