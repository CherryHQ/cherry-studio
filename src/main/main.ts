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
import { serviceList } from '@main/core/application/serviceRegistry'
// Preboot phase — order matters. See core/preboot/README.md.
import { runBackupRestoreGate } from '@main/core/preboot/backupRestoreGate'
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
import { initCrashTelemetry } from '@main/core/preboot/crashTelemetry'
import { runFactoryResetGate } from '@main/core/preboot/factoryResetGate'
import { requireSingleInstance } from '@main/core/preboot/singleInstance'
import { resolveUserDataLocation } from '@main/core/preboot/userDataLocation'
import { runV2MigrationGate } from '@main/core/preboot/v2MigrationGate'

// should be the first to resolveUserDataLocation()
resolveUserDataLocation()
requireSingleInstance()
initCrashTelemetry()
// Freeze the path registry — bootstrap() asserts this completed.
application.initPathRegistry()

import { electronApp } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { app } from 'electron'

import { registerIpc } from './ipc'
import { versionService } from './services/VersionService'

const logger = loggerService.withContext('MainEntry')

const startApp = async () => {
  // Factory-reset gate: consume a pending reset marker (wipe user data,
  // reset BootConfig) before the backup gate or the migration gate read
  // anything. Without a marker it is a no-op. Never throws, but quits the
  // app when a completed wipe cannot durably clear its marker (booting on
  // would re-wipe freshly created data on the next start).
  runFactoryResetGate()

  // Chromium startup flags — after the factory-reset gate, because this
  // reads BootConfig values (app.disable_hardware_acceleration) the gate
  // may have just reset; applying pre-reset flags would leave the reset
  // session running with stale behavior while the UI shows defaults. Still
  // synchronously before the first await, so every switch lands before
  // app.whenReady() fires.
  configureChromiumFlags()

  // Backup-restore gate: swap in a staged restored DB (if any) before the v2
  // migration gate reads the DB. Never throws; on any failure the old DB
  // stays live and the app starts normally.
  await runBackupRestoreGate()

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
