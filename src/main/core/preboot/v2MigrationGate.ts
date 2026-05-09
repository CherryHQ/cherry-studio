import fs from 'node:fs'

import { application } from '@application'
import {
  getAllMigrators,
  migrationEngine,
  migrationWindowManager,
  registerMigrationIpcHandlers,
  resolveMigrationPaths,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import {
  checkUpgradePathCompatibility,
  getBlockMessage,
  readPreviousVersion
} from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import { app, dialog } from 'electron'

const logger = loggerService.withContext('V2MigrationGate')

/**
 * Outcome of the v1→v2 migration gate.
 *
 * - `'skipped'`  : no migration needed; caller should continue with
 *                  `application.bootstrap()` as normal.
 * - `'handled'`  : the gate took over. Either a migration window is now
 *                  running (the user will drive migration through it and
 *                  the app will relaunch afterwards), or a fatal error
 *                  was surfaced via `dialog.showErrorBox` and
 *                  `application.quit()` has already been called. Either
 *                  way the caller MUST return immediately without
 *                  starting bootstrap.
 */
export type V2MigrationGateResult = 'handled' | 'skipped'

/**
 * Decide whether the v1→v2 data migration must run before
 * `application.bootstrap()` is allowed to start.
 *
 * Timing contract:
 *   - Runs during preboot, but async (unlike most preboot modules). The
 *     `await` points are DB probes and the migration window's ready
 *     barrier — neither of which can be expressed synchronously.
 *   - Touches only a bare DB connection through `migrationEngine`; it
 *     does NOT depend on any lifecycle-managed service. This matches the
 *     "no `application.get(...)`" membership criterion in
 *     core/preboot/README.md.
 *   - Must complete (with either outcome) before
 *     `application.bootstrap()` is called. Bootstrap would otherwise
 *     start services against unmigrated data.
 *
 * This module is a temporary v2-transition artifact — once all users
 * have migrated off v1 the entire file can be deleted, hence the `v2`
 * prefix in both file name and exported function name.
 */
export async function runV2MigrationGate(): Promise<V2MigrationGateResult> {
  // Step 0: Resolve all migration-critical paths, including v1 legacy
  // userData detection. This MUST run before migrationEngine.initialize()
  // so that all subsequent path-dependent operations use the correct
  // directory. See MigrationPaths.ts for the full resolution logic.
  const { paths, userDataChanged, inaccessibleLegacyPath } = resolveMigrationPaths()

  // Legacy custom path found but inaccessible (e.g. external drive not
  // mounted). Warn the user — silently falling back to the default path
  // would cause an empty-data migration, making user data appear lost.
  if (inaccessibleLegacyPath) {
    logger.warn('Legacy userData path inaccessible, prompting user', { inaccessibleLegacyPath })
    await app.whenReady()
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Custom Data Directory Inaccessible',
      message:
        `Your previous data was stored at:\n${inaccessibleLegacyPath}\n\n` +
        'This directory is currently inaccessible. Please ensure the drive is mounted and try again.',
      buttons: ['Retry', 'Quit'],
      defaultId: 0
    })
    if (response === 0) {
      application.relaunch()
      return 'handled'
    }
    application.quit()
    return 'handled'
  }

  let needsMigration = false

  try {
    logger.info('Checking if data migration v2 is needed')
    await migrationEngine.initialize(paths)
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
    return 'handled'
  }

  if (needsMigration) {
    // Version compatibility gate: ensure the upgrade path is valid
    // before showing the migration UI. This catches manual installs
    // that bypassed the auto-updater's version filtering.
    const versionLogExists = fs.existsSync(paths.versionLogFile)
    const previousVersion = versionLogExists ? readPreviousVersion(paths.versionLogFile, app.getVersion()) : null

    logger.info('Version compatibility check', { currentVersion: app.getVersion(), previousVersion, versionLogExists })

    const versionCheck = checkUpgradePathCompatibility({
      currentAppVersion: app.getVersion(),
      previousVersion,
      versionLogExists
    })

    if (versionCheck.outcome === 'block') {
      logger.warn('Version compatibility check failed, showing version incompatible UI', {
        reason: versionCheck.reason,
        ...versionCheck.details
      })

      // Do NOT close the engine — the "skip migration" action needs it
      // to write the completed status. Set the initial stage so the
      // renderer picks it up via GetProgress on mount.
      setVersionIncompatible(versionCheck.reason, versionCheck.details)
      registerMigrationIpcHandlers(paths.userData)

      try {
        await app.whenReady()
        migrationWindowManager.create()
        await migrationWindowManager.waitForReady()
        logger.info('Version incompatible window created successfully')
        return 'handled'
      } catch (windowError) {
        // Fallback: if the window fails to create, use a plain dialog
        logger.error('Failed to create version incompatible window, falling back to dialog', windowError as Error)
        unregisterMigrationIpcHandlers()
        migrationEngine.close()
        dialog.showErrorBox('Version Upgrade Required', getBlockMessage(versionCheck.reason, versionCheck.details))
        application.quit()
        return 'handled'
      }
    }

    logger.info('Data Migration v2 needed, starting migration process')
    registerMigrationIpcHandlers(paths.userData)

    try {
      await app.whenReady()
      migrationWindowManager.create()
      await migrationWindowManager.waitForReady()
      logger.info('Migration window created successfully')
      return 'handled'
    } catch (migrationError) {
      logger.error('Failed to start migration process', migrationError as Error)
      unregisterMigrationIpcHandlers()
      dialog.showErrorBox(
        'Migration Required - Application Cannot Start',
        `This version of Cherry Studio requires data migration to function properly.\n\nMigration window failed to start: ${(migrationError as Error).message}\n\nThe application will now exit. Please try starting again or contact support if the problem persists.`
      )
      logger.error('Exiting application due to failed migration startup')
      application.quit()
      return 'handled'
    }
  }

  // Normal path: no migration needed. Release the bare DB handle so the
  // lifecycle DbService can open its own connection when bootstrap runs.
  migrationEngine.close()

  // Edge case: userData was redirected from legacy config but migration is
  // not needed (e.g. boot-config.json was manually deleted after a
  // completed migration). The path registry was frozen with the Electron
  // default during initPathRegistry(), creating an inconsistency with the
  // app.setPath() call in resolveMigrationPaths(). Force a clean relaunch
  // so resolveUserDataLocation() reads the pre-written boot-config.json
  // and freezes the registry correctly.
  if (userDataChanged) {
    logger.info('Legacy userData resolved but migration not needed, relaunching for path consistency')
    await app.whenReady()
    application.relaunch()
    return 'handled'
  }

  return 'skipped'
}
