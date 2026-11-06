/**
 * Electron main-process entry — preboot → bootstrap → running.
 *
 * DO NOT add new code here. If you feel the need to, you almost certainly
 * misunderstand the startup timing or service architecture. New services
 * belong in the lifecycle system (see core/lifecycle/); non-removable
 * preboot steps belong in core/preboot/; removable capabilities that must
 * execute at preboot time belong in their nature-home (e.g. services/)
 * and are invoked from here. This file is glue — it should only shrink.
 */

// BootConfig must load before any other import (configures userData path)

import '@main/data/bootConfig'
import { application } from '@application'
import { serviceList } from '@main/core/application/serviceRegistry'
// Preboot phase — order matters. See core/preboot/README.md.
import { prepareBackupRestoreSession, runBackupRestoreGate } from '@main/core/preboot/backupRestoreGate'
import { configureChromiumFlags } from '@main/core/preboot/chromiumFlags'
import { initCrashTelemetry } from '@main/core/preboot/crashTelemetry'
import { showSupportedMessageBox } from '@main/core/preboot/nativeErrorDialog'
import { requireSingleInstance } from '@main/core/preboot/singleInstance'
import { resolveUserDataLocation } from '@main/core/preboot/userDataLocation'
import { runV2MigrationGate } from '@main/core/preboot/v2MigrationGate'
import { MINI_APP_SCHEME_DECLARATION } from '@main/features/miniApp/runtime/protocol'
import { runDataReset } from '@main/services/dataReset'
import { CHERRY_MEDIA_SCHEME_DECLARATION } from '@main/services/mediaProtocol'
import { configureRemoteDebugging } from '@main/services/remoteDebugging'
import { initSentry } from '@main/services/sentry'
import { runUserDataRelocation } from '@main/services/userDataRelocation'
import { getApplicationId } from '@main/utils/appEdition'

// should be the first to resolveUserDataLocation()
resolveUserDataLocation()
requireSingleInstance()
configureChromiumFlags()
configureRemoteDebugging()
initCrashTelemetry()
// Freeze the path registry — bootstrap() asserts this completed.
application.initPathRegistry()
const isolatedRestoreSession = prepareBackupRestoreSession()
initSentry()
// Privileged schemes must be declared before the app is ready, and only ONCE per
// process — startApp() itself awaits app.whenReady(), so this cannot move in there.
protocol.registerSchemesAsPrivileged([CHERRY_MEDIA_SCHEME_DECLARATION, MINI_APP_SCHEME_DECLARATION])

import { electronApp } from '@electron-toolkit/utils'
import { app, protocol } from 'electron'

import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'

import { registerIpc } from './ipc'
import { versionService } from './services/VersionService'

const logger = loggerService.withContext('MainEntry')

const startApp = async () => {
  // Reset before backup, migration, or services open user data.
  await runDataReset()

  // userData relocation: a pending/failed relocation makes this a dedicated
  // relocation launch (execute or explain, then relaunch) before any service
  // opens files under the source tree. See services/userDataRelocation/README.md.
  const relocationResult = await runUserDataRelocation()
  if (relocationResult === 'handled') return

  // Backup-restore gate: swap in a staged restored DB (if any) before the v2
  // migration gate reads the DB. An isolated restore launch must relaunch
  // before services can use the path registry's original session snapshot.
  const restoreResult = await runBackupRestoreGate(isolatedRestoreSession)
  if (restoreResult === 'handled') return

  // 'handled' = migration window took over OR fatal error already quit the app.
  const migrationResult = await runV2MigrationGate()
  if (migrationResult === 'handled') return

  // Set the Windows AppUserModelID — the identity Windows uses to attribute this
  // app's notifications, taskbar icon grouping, and Jump Lists (no-op on macOS/Linux).
  // Must run before any window is created or notification fires, hence after the
  // migration gate returns and before lifecycle bootstrap.
  electronApp.setAppUserModelId(getApplicationId())

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
  const technicalDetail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  // Labels are built only after ready. t() without a language reads PreferenceService,
  // and app.getLocale requires ready on Windows. Both are unavailable in this catch.
  const present = async () => {
    if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
    const language = resolveSystemLanguage(app.getLocale())
    await showSupportedMessageBox({
      box: {
        type: 'error',
        title: t('dialog.startup.title', undefined, language),
        message: t('dialog.startup.message', undefined, language),
        detail: t('dialog.startup.detail', undefined, language),
        buttons: [t('dialog.support.exit', undefined, language)],
        defaultId: 0,
        cancelId: 0
      },
      technicalDetail
    })
  }
  void present()
    .catch((dialogError) => {
      logger.error('Failed to present the startup error', dialogError as Error)
    })
    .finally(() => {
      application.forceExit(1)
    })
})
