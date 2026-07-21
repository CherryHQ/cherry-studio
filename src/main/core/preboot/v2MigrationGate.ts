/**
 * TEMPORARY convenience gate — deleted wholesale once all users have
 * migrated off v1 (see data/migration/v2/).
 *
 * Do NOT use this file as a sample for preboot work. Its shape — a fat
 * orchestrating gate holding a whole domain's flow inside core/preboot/ —
 * is tolerated only because it is throwaway. Permanent capabilities invert
 * this: the domain entry point owns the orchestration, and core/preboot/
 * keeps no domain files (see core/preboot/README.md, Membership criteria).
 */

import { application } from '@application'
import {
  evaluateCandidateVersion,
  getAllMigrators,
  getBlockMessage,
  isSchemaOutOfSyncError,
  migrationEngine,
  migrationWindowManager,
  pinUserDataPath,
  presentMigrationDiagnosticFailure,
  registerMigrationIpcHandlers,
  resolveMigrationPaths,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { app } from 'electron'

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

interface NativeMigrationFailure {
  readonly failureCode: string
  readonly errorSummary: string
  readonly type: 'error' | 'warning'
  readonly title: string
  readonly message: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
}

async function presentNativeMigrationFailure(failure: NativeMigrationFailure): Promise<number> {
  await app.whenReady()
  const { failureCode, errorSummary, ...dialogFailure } = failure
  return presentMigrationDiagnosticFailure({
    locale: app.getLocale(),
    context: { source: 'native', stage: 'preboot', failureCode, errorSummary },
    failure: dialogFailure
  })
}

/**
 * Surface a fatal "cannot persist userData location" error and quit.
 *
 * Reached when the strict `pinUserDataPath()` persist fails: the next launch
 * depends on that write, so continuing would relaunch into the old directory
 * and loop (or make migrated data appear lost). Stop loudly instead.
 */
async function quitWithDataLocationError(cause: unknown): Promise<V2MigrationGateResult> {
  logger.error('Failed to persist userData location; cannot continue', cause as Error)
  await presentNativeMigrationFailure({
    failureCode: 'data_location_pin_failed',
    errorSummary: 'Could not save the application data directory.',
    type: 'error',
    title: 'Data Location Error - Application Cannot Start',
    message:
      `Could not save the application data directory:\n\n  ${(cause as Error).message}\n\n` +
      `Check that there is free disk space and that ~/.cherrystudio is writable, then try again. The application will now exit.`,
    buttons: ['Quit'],
    defaultId: 0,
    cancelId: 0
  })
  application.quit()
  return 'handled'
}

async function quitWithMigrationCheckError(
  error: unknown,
  databaseFile: string,
  failureCode: 'database_initialize_failed' | 'migration_status_probe_failed',
  errorSummary: string
): Promise<V2MigrationGateResult> {
  logger.error('Migration status check failed', error as Error)

  // Dev-only: when the disposable migration SQL is regenerated/deleted but
  // the local DB is kept, drizzle re-runs CREATE TABLE on objects that
  // already exist and throws "... already exists". Guide the developer to
  // reset the local DB instead of the generic connectivity message. Never
  // auto-delete, and never surface this in production — real users must not
  // be told to delete their database.
  if (isDev && isSchemaOutOfSyncError(error)) {
    await presentNativeMigrationFailure({
      failureCode,
      errorSummary,
      type: 'error',
      title: 'Database Schema Out of Sync (Dev)',
      message:
        `During v2 development (before release), the database schema can change at any time. ` +
        `Your local database no longer matches the bundled migration SQL, so startup migration cannot continue.\n\n` +
        `To fix this, delete the local database, then restart:\n\n` +
        `  ${databaseFile}\n\n` +
        `Or run:\n  rm -f "${databaseFile}"\n\n` +
        `Then start the app again (pnpm dev).\n\n` +
        `Original error: ${(error as Error).message}`,
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0
    })
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
    await presentNativeMigrationFailure({
      failureCode,
      errorSummary,
      type: 'error',
      title: 'Migration Failed (Dev) - Application Cannot Start',
      message:
        `Startup migration failed while applying schema changes:\n\n` +
        `  ${(error as Error).message}\n\n` +
        `In development this is usually one of:\n\n` +
        `  1. Your local database predates a schema change (incompatible legacy data). ` +
        `If this is throwaway dev data, reset it and restart:\n` +
        `       rm -f "${databaseFile}"\n\n` +
        `  2. A bug in the migration that introduced the failing change — inspect the failing ` +
        `migration and fix it. Do NOT just delete the DB, or the bug will resurface for users ` +
        `with real data.\n\n` +
        `The application will now exit.`,
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0
    })
  } else {
    await presentNativeMigrationFailure({
      failureCode,
      errorSummary,
      type: 'error',
      title: 'Migration Failed - Application Cannot Start',
      message:
        `Could not complete data migration:\n\n  ${(error as Error).message}\n\n` +
        `The application will now exit. Please try again, and contact support if the problem persists.`,
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0
    })
  }
  logger.error('Exiting application due to migration status check failure')
  application.quit()
  return 'handled'
}

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
  let resolved: ReturnType<typeof resolveMigrationPaths>
  try {
    resolved = resolveMigrationPaths()
  } catch (error) {
    // resolveMigrationPaths()'s only throwing operation is the strict
    // pinUserDataPath() persist on the redirect branch. Failing there means we
    // cannot durably record which userData directory to use next launch — a
    // silent continue would relaunch into the OLD location and loop.
    return quitWithDataLocationError(error)
  }
  const { paths, userDataChanged, inaccessibleLegacyPath, legacyDataConfirmed, dataLocation } = resolved

  // Legacy custom path found but inaccessible (e.g. external drive not
  // mounted, or a stale abandoned entry). Silently falling back to the default
  // path would run an empty-data migration and markCompleted-lock it, making
  // user data appear permanently lost. Offer three ways out so the user is
  // never stuck in a retry loop when the directory will never come back.
  if (inaccessibleLegacyPath) {
    logger.warn('Legacy userData path inaccessible, prompting user', { inaccessibleLegacyPath })
    const response = await presentNativeMigrationFailure({
      failureCode: 'legacy_data_location_unavailable',
      errorSummary: 'The previous custom data directory is not currently accessible.',
      type: 'warning',
      title: 'Custom Data Directory Inaccessible',
      message:
        `Your previous data was stored at:\n${inaccessibleLegacyPath}\n\n` +
        'This directory is currently inaccessible — an external drive may not be mounted.\n\n' +
        '• Retry after reconnecting it.\n' +
        '• Continue with a new default data directory (you can change it later in Settings).\n' +
        '• Quit.',
      buttons: ['Retry', 'Use Default Directory', 'Quit'],
      defaultId: 0,
      cancelId: 2
    })
    if (response === 0) {
      application.relaunch()
      return 'handled'
    }
    if (response === 2) {
      application.quit()
      return 'handled'
    }
    // response === 1: continue on the default directory. Pin it in boot-config
    // so this prompt never fires again, then FALL THROUGH to the normal flow —
    // userData already IS the default and the path registry is frozen there, so
    // no relaunch is needed.
    try {
      pinUserDataPath(paths.userData)
    } catch (error) {
      return quitWithDataLocationError(error)
    }
    logger.info('User chose to continue with the default data directory', { defaultPath: paths.userData })
  }

  let needsMigration = false

  try {
    logger.info('Checking if data migration v2 is needed')
    migrationEngine.initialize(paths, legacyDataConfirmed)
    migrationEngine.registerMigrators(getAllMigrators())
  } catch (error) {
    return quitWithMigrationCheckError(
      error,
      paths.databaseFile,
      'database_initialize_failed',
      'Could not initialize the migration database.'
    )
  }

  try {
    needsMigration = await migrationEngine.needsMigration()
    logger.info('Migration status check result', { needsMigration })
  } catch (error) {
    return quitWithMigrationCheckError(
      error,
      paths.databaseFile,
      'migration_status_probe_failed',
      'Could not check the migration status.'
    )
  }

  if (needsMigration) {
    // Version compatibility gate: ensure the upgrade path is valid before
    // showing the migration UI. This catches manual installs that bypassed
    // the auto-updater's version filtering. evaluateCandidateVersion is the
    // single assembler of the version.log existence/read/compatibility check,
    // shared with the candidate selector so the two cannot drift.
    const {
      check: versionCheck,
      previousVersion,
      versionLogExists
    } = evaluateCandidateVersion(paths.userData, app.getVersion())

    logger.info('Version compatibility check', { currentVersion: app.getVersion(), previousVersion, versionLogExists })

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
        await presentNativeMigrationFailure({
          failureCode: 'version_window_failed',
          errorSummary: 'Could not open the upgrade guidance window.',
          type: 'error',
          title: 'Version Upgrade Required',
          message: getBlockMessage(versionCheck.reason, versionCheck.details),
          buttons: ['Quit'],
          defaultId: 0,
          cancelId: 0
        })
        application.quit()
        return 'handled'
      }
    }

    // Surface the auto-recovered non-default data directory on the intro
    // screen (fuzzy B1 fallback only). Must precede handler registration so the
    // renderer reads it via GetProgress on mount.
    if (dataLocation) setDataLocationNotice(dataLocation)

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
      await presentNativeMigrationFailure({
        failureCode: 'migration_window_failed',
        errorSummary: 'Could not open the migration window.',
        type: 'error',
        title: 'Migration Required - Application Cannot Start',
        message: `This version of Cherry Studio requires data migration to function properly.\n\nMigration window failed to start: ${(migrationError as Error).message}\n\nThe application will now exit. Please try starting again or contact support if the problem persists.`,
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0
      })
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
