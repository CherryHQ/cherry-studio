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
import { isSchemaOutOfSyncError } from '@data/migration/v2/core/migrationErrors'
import {
  checkUpgradePathCompatibility,
  getBlockMessage,
  readPreviousVersion
} from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
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

    // Dev-only: when the disposable migration SQL is regenerated/deleted but
    // the local DB is kept, drizzle re-runs CREATE TABLE on objects that
    // already exist and throws "... already exists". Guide the developer to
    // reset the local DB instead of the generic connectivity message. Never
    // auto-delete, and never surface this in production — real users must not
    // be told to delete their database.
    if (isDev && isSchemaOutOfSyncError(error)) {
      dialog.showErrorBox(
        'Database Schema Out of Sync (Dev)',
        `During v2 development (before release), the database schema can change at any time. ` +
          `Your local database no longer matches the bundled migration SQL, so startup migration cannot continue.\n\n` +
          `To fix this, delete the local database, then restart:\n\n` +
          `  ${paths.databaseFile}\n\n` +
          `Or run:\n  rm -f "${paths.databaseFile}"\n\n` +
          `Then start the app again (pnpm dev).\n\n` +
          `Original error: ${(error as Error).message}`
      )
      logger.error('Exiting application due to schema out of sync (dev)')
      application.quit()
      return 'handled'
    }

    // The error wasn't the unambiguous "object already exists" signal handled above. Anything else
    // (e.g. a SQLITE_CONSTRAINT_* thrown from migrate() when a new constraint is incompatible with
    // existing rows) is AMBIGUOUS: it may be incompatible legacy/dev data OR a genuine migration bug.
    // So we never assert "delete the DB" here — in dev we surface both possibilities plus the path;
    // in production we stay neutral and never tell a real user to delete their data.
    if (isDev) {
      dialog.showErrorBox(
        'Migration Failed (Dev) - Application Cannot Start',
        `Startup migration failed while applying schema changes:\n\n` +
          `  ${(error as Error).message}\n\n` +
          `In development this is usually one of:\n\n` +
          `  1. Your local database predates a schema change (incompatible legacy data). ` +
          `If this is throwaway dev data, reset it and restart:\n` +
          `       rm -f "${paths.databaseFile}"\n\n` +
          `  2. A bug in the migration that introduced the failing change — inspect the failing ` +
          `migration and fix it. Do NOT just delete the DB, or the bug will resurface for users ` +
          `with real data.\n\n` +
          `The application will now exit.`
      )
    } else {
      dialog.showErrorBox(
        'Migration Failed - Application Cannot Start',
        `Could not complete data migration:\n\n  ${(error as Error).message}\n\n` +
          `The application will now exit. Please try again, and contact support if the problem persists.`
      )
    }
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
    application.relaunch()
    return 'handled'
  }

  return 'skipped'
}
