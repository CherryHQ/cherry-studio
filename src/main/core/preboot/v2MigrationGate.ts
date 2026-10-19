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

import { promises as fs } from 'node:fs'

import { app, dialog } from 'electron'

import { application } from '@application'
import {
  describeErrorChain,
  evaluateCandidateVersion,
  getAllMigrators,
  getBlockMessage,
  isMigrationStorageError,
  isSchemaOutOfSyncError,
  type MigrationPaths,
  migrationEngine,
  migrationWindowManager,
  pinUserDataPath,
  registerMigrationIpcHandlers,
  resolveMigrationPaths,
  saveMigrationDiagnosticBundle,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { showSupportedMessageBox } from '@main/core/preboot/nativeErrorDialog'
import { resolveSystemLanguage, t } from '@main/i18n'
import type { MigrationStage } from '@shared/data/migration/v2/types'

const logger = loggerService.withContext('V2MigrationGate')

type PrebootLanguage = ReturnType<typeof resolveSystemLanguage>

async function systemLanguage(): Promise<PrebootLanguage> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  return resolveSystemLanguage(app.getLocale())
}

function versionFallbackMessage(
  reason: 'no_version_log' | 'v1_too_old' | 'v2_gateway_skipped',
  details: Record<string, string>,
  language: PrebootLanguage
): string {
  switch (reason) {
    case 'no_version_log':
      return t('dialog.migration.version.no_version_log', { requiredVersion: details.requiredVersion ?? '' }, language)
    case 'v1_too_old':
      return t(
        'dialog.migration.version.v1_too_old',
        { previousVersion: details.previousVersion ?? '', requiredVersion: details.requiredVersion ?? '' },
        language
      )
    case 'v2_gateway_skipped':
      return t(
        'dialog.migration.version.v2_gateway_skipped',
        {
          currentVersion: details.currentVersion ?? '',
          gatewayVersion: details.gatewayVersion ?? '',
          previousVersion: details.previousVersion ?? ''
        },
        language
      )
  }
}

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
 * Surface a fatal "cannot persist userData location" error and quit.
 *
 * Reached when the strict `pinUserDataPath()` persist fails: the next launch
 * depends on that write, so continuing would relaunch into the old directory
 * and loop (or make migrated data appear lost). Stop loudly instead.
 */
function migrationSupportAction(language: PrebootLanguage, stage: MigrationStage = 'error') {
  const logDate = new Date().toISOString().slice(0, 10)
  return {
    label: t('dialog.support.migration_export', undefined, language),
    run: async () => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: t('dialog.support.migration_export', undefined, language),
        defaultPath: 'cherry-studio-migration-diagnostics.zip'
      })
      if (canceled || !filePath) return
      const saved = await saveMigrationDiagnosticBundle({ destination: filePath, stage, logDate })
      if (saved === false) throw new Error(t('dialog.support.archive_write_failed', undefined, language))
    }
  }
}

async function showMigrationFailure(title: string, message: string, technicalDetail?: string): Promise<void> {
  const language = await systemLanguage()
  await showSupportedMessageBox({
    box: {
      type: 'error',
      title,
      message,
      buttons: [t('dialog.support.exit', undefined, language)],
      defaultId: 0,
      cancelId: 0
    },
    technicalDetail,
    action: migrationSupportAction(language)
  })
}

async function quitWithDataLocationError(cause: unknown): Promise<V2MigrationGateResult> {
  logger.error('Failed to persist userData location; cannot continue', cause as Error)
  await app.whenReady()
  const language = await systemLanguage()
  const reason = (cause as Error).message ?? ''
  const path = application.getPath('cherry.home')
  const message = t('dialog.migration.data_location.message', { path, reason }, language)
  await showMigrationFailure(
    t('dialog.migration.data_location.title', undefined, language),
    message,
    `${reason}\n${path}`
  )
  application.quit()
  return 'handled'
}

async function checkMigrationStatus(paths: MigrationPaths, legacyDataConfirmed: boolean): Promise<boolean | null> {
  while (true) {
    try {
      logger.info('Checking if data migration v2 is needed')
      migrationEngine.initialize(paths, legacyDataConfirmed)
      migrationEngine.registerMigrators(getAllMigrators())
      const needsMigration = await migrationEngine.needsMigration()
      logger.info('Migration status check result', { needsMigration })
      return needsMigration
    } catch (error) {
      if (isDev || !isMigrationStorageError(error)) throw error

      const reason = describeErrorChain(error)
      logger.error(`Migration database unavailable: ${reason}`, error as Error)
      migrationEngine.close()
      await app.whenReady()
      const language = resolveSystemLanguage(app.getLocale())
      const response = await showSupportedMessageBox({
        box: {
          type: 'error',
          title: t('dialog.migration_database_unavailable.title', undefined, language),
          message: t('dialog.migration_database_unavailable.message', undefined, language),
          detail: t('dialog.migration_database_unavailable.detail', undefined, language),
          buttons: [
            t('dialog.migration_database_unavailable.retry', undefined, language),
            t('dialog.migration_database_unavailable.quit', undefined, language)
          ],
          defaultId: 0,
          cancelId: 1
        },
        technicalDetail: reason,
        action: migrationSupportAction(language)
      })
      if (response === 0) continue

      application.quit()
      return null
    }
  }
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
    await app.whenReady()
    const language = await systemLanguage()
    const response = await showSupportedMessageBox({
      box: {
        type: 'warning',
        title: t('dialog.migration.legacy_inaccessible.title', undefined, language),
        message: t('dialog.migration.legacy_inaccessible.message', { path: inaccessibleLegacyPath }, language),
        buttons: [
          t('dialog.migration_database_unavailable.retry', undefined, language),
          t('dialog.migration.legacy_inaccessible.use_default', undefined, language),
          t('dialog.migration_database_unavailable.quit', undefined, language)
        ],
        defaultId: 0,
        cancelId: 2
      },
      action: migrationSupportAction(language)
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
    const result = await checkMigrationStatus(paths, legacyDataConfirmed)
    if (result === null) return 'handled'
    needsMigration = result
  } catch (error) {
    // The driver reason lives in `.cause`, which neither `error.message` nor the
    // winston serializer carries — flatten it or the failure is undiagnosable.
    const reason = describeErrorChain(error)
    logger.error(`Migration status check failed: ${reason}`, error as Error)
    await app.whenReady()
    const language = await systemLanguage()

    // Shipped migrations run on real data, including development copies.
    // Keep the database; this branch is dev-only and never deletes it.
    if (isDev && isSchemaOutOfSyncError(error)) {
      const schemaMessage = t('dialog.migration.dev_schema.message', { path: paths.databaseFile, reason }, language)
      await showMigrationFailure(
        t('dialog.migration.dev_schema.title', undefined, language),
        schemaMessage,
        `${paths.databaseFile}\n${reason}`
      )
      logger.error('Exiting application due to schema out of sync (dev)')
      application.quit()
      return 'handled'
    }

    // Other failures are ambiguous. Keep the database in dev and production;
    // only the dialog copy differs.
    if (isDev) {
      const devMessage = t('dialog.migration.dev_failed.message', { path: paths.databaseFile, reason }, language)
      await showMigrationFailure(
        t('dialog.migration.dev_failed.title', undefined, language),
        devMessage,
        `${paths.databaseFile}\n${reason}`
      )
    } else {
      const productionMessage = t('dialog.migration.failed.message', { reason }, language)
      await showMigrationFailure(t('dialog.migration.failed.title', undefined, language), productionMessage, reason)
    }
    logger.error('Exiting application due to migration status check failure')
    application.quit()
    return 'handled'
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
      registerMigrationIpcHandlers(paths)

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
        const language = await systemLanguage()
        const blockMessage = getBlockMessage(versionCheck.reason, versionCheck.details)
        await showMigrationFailure(
          t('dialog.migration.version.title', undefined, language),
          versionFallbackMessage(versionCheck.reason, versionCheck.details, language),
          blockMessage
        )
        application.quit()
        return 'handled'
      }
    }

    // Surface the auto-recovered non-default data directory on the intro
    // screen (fuzzy B1 fallback only). Must precede handler registration so the
    // renderer reads it via GetProgress on mount.
    if (dataLocation) setDataLocationNotice(dataLocation)

    logger.info('Data Migration v2 needed, starting migration process')
    registerMigrationIpcHandlers(paths)

    try {
      await app.whenReady()
      migrationWindowManager.create()
      await migrationWindowManager.waitForReady()
      logger.info('Migration window created successfully')
      return 'handled'
    } catch (migrationError) {
      logger.error('Failed to start migration process', migrationError as Error)
      unregisterMigrationIpcHandlers()
      const language = await systemLanguage()
      const reason = (migrationError as Error).message ?? ''
      const windowMessage = t('dialog.migration.window_failed.message', { reason }, language)
      await showMigrationFailure(t('dialog.migration.window_failed.title', undefined, language), windowMessage, reason)
      logger.error('Exiting application due to failed migration startup')
      application.quit()
      return 'handled'
    }
  }

  // Normal path: no migration needed. Release the bare DB handle so the
  // lifecycle DbService can open its own connection when bootstrap runs.
  migrationEngine.close()

  // Migration is no longer pending: sweep the renderer-export staging tree
  // (plaintext v1 dumps) that the engine's own cleanup paths can miss.
  try {
    await fs.rm(paths.migrationTempDir, { recursive: true, force: true })
  } catch (error) {
    logger.warn('Failed to sweep legacy migration export staging', error as Error, {
      path: paths.migrationTempDir
    })
  }

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
