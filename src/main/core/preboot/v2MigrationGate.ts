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
  classifyMigrationPrebootFailure,
  createMigrationDatabaseDiagnostics,
  createMigrationDiagnosticBundleBuilder,
  createMigrationDiagnosticsCoordinator,
  createMigrationRendererExportDiagnosticFailure,
  createMigrationWindowFailureClaim,
  evaluateCandidateVersion,
  getAllMigrators,
  isSchemaOutOfSyncError,
  type MigrationDiagnosticBundleSaveResult,
  type MigrationDiagnosticFailure,
  type MigrationDiagnosticNativeDecision,
  type MigrationDiagnosticNativeFailureCode,
  type MigrationDiagnosticNativeSaveResult,
  migrationEngine,
  type MigrationRendererExportMainWriteFailure,
  type MigrationRendererFailureReason,
  migrationWindowManager,
  pinUserDataPath,
  presentMigrationDiagnosticFailure,
  presentMigrationDiagnosticRecovery,
  registerMigrationIpcHandlers,
  resolveMigrationPaths,
  runMigrationDiagnosticSaveTransaction,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import type { MigrationRendererExportFailureReport } from '@shared/data/migration/v2/diagnostics'
import { app } from 'electron'

const logger = loggerService.withContext('V2MigrationGate')

const MEMORY_ONLY_DATABASE_DIAGNOSTICS = Object.freeze({
  file: Object.freeze({
    status: 'unreadable' as const,
    sqliteHeader: 'unavailable' as const
  }),
  sqlite: Object.freeze({ status: 'unavailable' as const, reason: 'not_attempted' as const })
})

/**
 * Outcome of the v1→v2 migration gate.
 *
 * - `'skipped'`: no migration is needed; bootstrap may continue.
 * - `'handled'`: the gate opened migration UI or handled a native decision;
 *                the caller must not start bootstrap.
 */
export type V2MigrationGateResult = 'handled' | 'skipped'

function toNativeSaveResult(result: MigrationDiagnosticBundleSaveResult): MigrationDiagnosticNativeSaveResult {
  if (result.status === 'saved') return { status: 'saved' }
  return { status: 'failed', code: 'bundle_save_failed' }
}

function applyNativeDecision(decision: MigrationDiagnosticNativeDecision): V2MigrationGateResult {
  if (decision === 'retry') {
    application.relaunch()
  } else {
    application.quit()
  }
  return 'handled'
}

/**
 * Decide whether the v1→v2 data migration must run before bootstrap.
 * This is preboot code: it owns a scoped coordinator and never resolves a
 * lifecycle-managed service.
 */
export async function runV2MigrationGate(): Promise<V2MigrationGateResult> {
  // This is deliberately the first business action. Path resolution itself can
  // fail, so diagnostics must already exist in memory before it starts.
  const diagnosticsCoordinator = createMigrationDiagnosticsCoordinator()
  const bundleBuilder = createMigrationDiagnosticBundleBuilder()
  const databaseDiagnostics = createMigrationDatabaseDiagnostics()
  let resolvedPaths: ReturnType<typeof resolveMigrationPaths>['paths'] | null = null
  let engineInitialized = false
  let attemptActive = false
  let startRendererExportInFlight: Promise<void> | null = null
  type AttemptFinish = Parameters<(typeof diagnosticsCoordinator)['finishAttempt']>[0]
  type DiagnosticLocation = Parameters<(typeof diagnosticsCoordinator)['updateLocation']>[0]

  const saveDiagnosticBundle = async (destination: string): Promise<MigrationDiagnosticNativeSaveResult> => {
    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      const result = await bundleBuilder.save({
        destination,
        snapshot,
        collectDatabaseDiagnostics: () => {
          if (resolvedPaths === null) return Promise.resolve(MEMORY_ONLY_DATABASE_DIAGNOSTICS)
          return databaseDiagnostics.inspect(resolvedPaths.databaseFile)
        }
      })
      return toNativeSaveResult(result)
    } catch {
      return { status: 'failed', code: 'snapshot_failed' }
    }
  }

  const presentFailure = async (
    code: MigrationDiagnosticNativeFailureCode,
    options: { readonly allowUseDefault?: boolean; readonly detail?: string } = {}
  ): Promise<MigrationDiagnosticNativeDecision> => {
    await app.whenReady()
    return presentMigrationDiagnosticFailure({
      locale: app.getLocale(),
      code,
      ...(options.allowUseDefault ? { allowUseDefault: true } : {}),
      ...(options.detail === undefined ? {} : { detail: options.detail }),
      saveBundle: saveDiagnosticBundle,
      runSaveTransaction: runMigrationDiagnosticSaveTransaction
    })
  }

  const beginAttempt = (trigger: 'initial' | 'manual_retry' | 'recovered_retry'): boolean => {
    try {
      diagnosticsCoordinator.beginAttempt(trigger)
      attemptActive = true
      return true
    } catch {
      logger.error('Failed to begin migration diagnostic attempt')
      return false
    }
  }

  const updateLocation = (location: DiagnosticLocation): void => {
    if (!attemptActive) return
    try {
      diagnosticsCoordinator.updateLocation(location)
    } catch {
      logger.error('Failed to update bounded migration diagnostic location')
    }
  }

  const finishAttempt = (result: AttemptFinish): void => {
    if (!attemptActive) return
    try {
      diagnosticsCoordinator.finishAttempt(result)
    } catch {
      logger.error('Failed to finish bounded migration diagnostic attempt')
    } finally {
      attemptActive = false
    }
  }

  const finishPrebootFailure = (
    errorCode: Extract<MigrationDiagnosticFailure, { kind: 'preboot_failed' }>['errorCode'],
    phase: Extract<DiagnosticLocation['phase'], 'resolve_paths' | 'initialize' | 'validate' | 'finalize'>
  ): void => {
    finishAttempt({
      status: 'failed',
      failure: {
        kind: 'preboot_failed',
        scope: 'gate',
        phase,
        errorCode
      }
    })
  }

  const finishCompletedAttempt = (): void => finishAttempt({ status: 'completed' })

  const completeDiagnostics = (): void => {
    try {
      diagnosticsCoordinator.complete()
    } catch {
      logger.error('Failed to clean completed migration diagnostics')
    }
  }

  const migrationAttemptDiagnostics = {
    updateLocation,
    finishAttempt,
    complete: completeDiagnostics
  }

  const runRendererExportStart = async (): Promise<void> => {
    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.current?.status !== 'in_progress') {
        if (!beginAttempt('manual_retry')) return
      } else {
        attemptActive = true
      }
      updateLocation({ scope: 'renderer_export', phase: 'prepare' })
    } catch {
      logger.error('Failed to start renderer export diagnostics')
    }
  }

  const startRendererExport = (): Promise<void> => {
    if (startRendererExportInFlight !== null) return startRendererExportInFlight

    const operation = runRendererExportStart().finally(() => {
      if (startRendererExportInFlight === operation) {
        startRendererExportInFlight = null
      }
    })
    startRendererExportInFlight = operation
    return operation
  }

  const finishRendererExportFailure = async (
    report: MigrationRendererExportFailureReport,
    mainWriteFailure?: MigrationRendererExportMainWriteFailure
  ): Promise<void> => {
    const pendingStart = startRendererExportInFlight
    if (pendingStart !== null) await pendingStart

    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.current?.status !== 'in_progress') {
        attemptActive = false
        return
      }
      attemptActive = true
      finishAttempt({
        status: 'failed',
        failure: createMigrationRendererExportDiagnosticFailure(report, mainWriteFailure)
      })
    } catch {
      logger.error('Failed to finish renderer export diagnostics')
    }
  }

  let rendererFailureObserved = false
  let versionGateRecorded = false
  let versionGateCleaned = false

  const completeVersionGate = (): void => {
    if (!versionGateRecorded || versionGateCleaned || rendererFailureObserved) return
    versionGateCleaned = true
    completeDiagnostics()
  }

  const migrationIpcDiagnosticCapabilities = {
    start: startRendererExport,
    reportRendererExportFailure: finishRendererExportFailure,
    saveDiagnosticBundle,
    snapshot: () => diagnosticsCoordinator.snapshot(),
    completeVersionGate
  }

  const recordRendererInterruption = async (reason: MigrationRendererFailureReason): Promise<void> => {
    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.current?.status !== 'in_progress') {
        attemptActive = false
        return
      }
      attemptActive = true
      finishAttempt({
        status: 'interrupted',
        failure: {
          kind: 'process_interrupted',
          scope: 'engine',
          phase: 'interrupted',
          errorCode: reason
        }
      })
    } catch {
      logger.error('Failed to finish renderer failure diagnostic attempt')
    }
  }

  const finishWindowFailure = async (code: MigrationDiagnosticNativeFailureCode): Promise<void> => {
    unregisterMigrationIpcHandlers({ preserveWriteDeferral: true })
    let decision: MigrationDiagnosticNativeDecision
    try {
      decision = await presentFailure(code)
    } finally {
      unregisterMigrationIpcHandlers()
    }
    if (engineInitialized) {
      migrationEngine.close()
      engineInitialized = false
    }
    applyNativeDecision(decision)
  }

  let resolved: ReturnType<typeof resolveMigrationPaths>
  try {
    resolved = resolveMigrationPaths()
    resolvedPaths = resolved.paths
  } catch (error) {
    beginAttempt('initial')
    finishPrebootFailure('path_resolution_failed', 'resolve_paths')
    return applyNativeDecision(await presentFailure('path_resolution_failed'))
  }

  const { paths, userDataChanged, inaccessibleLegacyPath, legacyDataConfirmed, dataLocation } = resolved
  try {
    diagnosticsCoordinator.attachPaths(paths)
  } catch {
    logger.warn('Migration checkpoint attachment failed; continuing without cross-launch diagnostics')
  }

  let attemptTrigger: 'initial' | 'recovered_retry' = 'initial'
  if (diagnosticsCoordinator.recovered) {
    await app.whenReady()
    const recoveryDecision = await presentMigrationDiagnosticRecovery({
      locale: app.getLocale(),
      saveBundle: saveDiagnosticBundle
    })
    if (recoveryDecision === 'exit') {
      application.quit()
      return 'handled'
    }
    attemptTrigger = 'recovered_retry'
  }

  beginAttempt(attemptTrigger)
  updateLocation({ scope: 'gate', phase: 'resolve_paths' })

  if (inaccessibleLegacyPath) {
    finishPrebootFailure('legacy_data_location_unavailable', 'resolve_paths')
    const decision = await presentFailure('legacy_data_location_unavailable', { allowUseDefault: true })
    if (decision !== 'use_default') {
      return applyNativeDecision(decision)
    }
    beginAttempt('manual_retry')
    updateLocation({ scope: 'gate', phase: 'resolve_paths' })
    try {
      pinUserDataPath(paths.userData)
    } catch {
      finishPrebootFailure('data_location_pin_failed', 'resolve_paths')
      return applyNativeDecision(await presentFailure('data_location_pin_failed'))
    }
  }

  try {
    migrationEngine.initialize(paths, legacyDataConfirmed, migrationAttemptDiagnostics)
    engineInitialized = true
    migrationEngine.registerMigrators(getAllMigrators())
  } catch (error) {
    logger.error('Migration database initialization failed', error as Error)
    finishPrebootFailure(classifyMigrationPrebootFailure(error, 'database_initialize_failed'), 'initialize')

    if (isDev) {
      const detail = isSchemaOutOfSyncError(error)
        ? `During v2 development (before release), the database schema can change at any time. ` +
          `Your local database no longer matches the bundled migration SQL, so startup migration cannot continue.\n\n` +
          `To fix this, delete the local database, then restart:\n\n` +
          `  ${paths.databaseFile}\n\n` +
          `Or run:\n  rm -f "${paths.databaseFile}"\n\n` +
          `Then start the app again (pnpm dev).\n\n` +
          `Original error: ${(error as Error).message}`
        : `Startup migration failed while applying schema changes:\n\n` +
          `  ${(error as Error).message}\n\n` +
          `In development this is usually one of:\n\n` +
          `  1. Your local database predates a schema change (incompatible legacy data). ` +
          `If this is throwaway dev data, reset it and restart:\n` +
          `       rm -f "${paths.databaseFile}"\n\n` +
          `  2. A bug in the migration that introduced the failing change — inspect the failing ` +
          `migration and fix it. Do NOT just delete the DB, or the bug will resurface for users ` +
          `with real data.`
      const decision = await presentFailure('database_initialize_failed', { detail })
      if (engineInitialized) migrationEngine.close()
      engineInitialized = false
      return applyNativeDecision(decision)
    }

    const decision = await presentFailure('database_initialize_failed')
    if (engineInitialized) migrationEngine.close()
    engineInitialized = false
    return applyNativeDecision(decision)
  }

  let needsMigration: boolean
  updateLocation({ scope: 'gate', phase: 'validate' })
  try {
    needsMigration = await migrationEngine.needsMigration()
  } catch (error) {
    logger.error('Migration status probe failed', error as Error)
    finishPrebootFailure(classifyMigrationPrebootFailure(error, 'migration_status_probe_failed'), 'validate')
    const decision = await presentFailure('migration_status_probe_failed')
    migrationEngine.close()
    engineInitialized = false
    return applyNativeDecision(decision)
  }

  if (!needsMigration) {
    migrationEngine.close()
    engineInitialized = false
    finishCompletedAttempt()
    completeDiagnostics()

    if (userDataChanged) {
      application.relaunch()
      return 'handled'
    }
    return 'skipped'
  }

  let versionEvaluation: ReturnType<typeof evaluateCandidateVersion>
  try {
    versionEvaluation = evaluateCandidateVersion(paths.userData, app.getVersion())
  } catch (error) {
    finishPrebootFailure('version_check_failed', 'validate')
    const decision = await presentFailure('version_check_failed')
    migrationEngine.close()
    engineInitialized = false
    return applyNativeDecision(decision)
  }

  const windowFailureClaim = createMigrationWindowFailureClaim()
  const onRendererFailure = async (
    reason: MigrationRendererFailureReason,
    writesSettled: Promise<void>
  ): Promise<void> => {
    rendererFailureObserved = true
    await recordRendererInterruption(reason)
    await writesSettled
    await finishWindowFailure(reason)
  }

  const { check: versionCheck, previousVersion, versionLogExists } = versionEvaluation
  logger.info('Version compatibility check', { previousVersion, versionLogExists })
  if (versionCheck.outcome === 'block') {
    setVersionIncompatible(versionCheck.reason, versionCheck.details)
    registerMigrationIpcHandlers(paths, migrationIpcDiagnosticCapabilities)
    try {
      await app.whenReady()
      migrationWindowManager.create({ failureClaim: windowFailureClaim, onRendererFailure })
      await migrationWindowManager.waitForReady()
      if (!rendererFailureObserved) {
        finishAttempt({
          status: 'failed',
          failure: {
            kind: 'upgrade_path_blocked',
            scope: 'gate',
            phase: 'validate',
            errorCode: versionCheck.reason
          }
        })
        versionGateRecorded = true
      }
      return 'handled'
    } catch (error) {
      const failure = windowFailureClaim.claim(async () => {
        logger.error('Version guidance window failed', error as Error)
        finishPrebootFailure('version_window_failed', 'finalize')
        await finishWindowFailure('version_window_failed')
      })
      await failure.completion
      return 'handled'
    }
  }

  if (dataLocation) setDataLocationNotice(dataLocation)
  registerMigrationIpcHandlers(paths, migrationIpcDiagnosticCapabilities)
  try {
    await app.whenReady()
    migrationWindowManager.create({ failureClaim: windowFailureClaim, onRendererFailure })
    await migrationWindowManager.waitForReady()
    return 'handled'
  } catch (error) {
    const failure = windowFailureClaim.claim(async () => {
      logger.error('Migration window failed', error as Error)
      finishPrebootFailure('migration_window_failed', 'finalize')
      await finishWindowFailure('migration_window_failed')
    })
    await failure.completion
    return 'handled'
  }
}
