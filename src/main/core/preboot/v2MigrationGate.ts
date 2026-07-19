import { application } from '@application'
import {
  classifyMigrationError,
  createMigrationDatabaseDiagnostics,
  createMigrationDiagnosticBundleBuilder,
  createMigrationDiagnosticsCoordinator,
  createMigrationWindowFailureClaim,
  evaluateCandidateVersion,
  getAllMigrators,
  type MigrationDiagnosticBundleSaveResult,
  type MigrationDiagnosticNativeDecision,
  type MigrationDiagnosticNativeFailureCode,
  type MigrationDiagnosticNativeSaveResult,
  migrationEngine,
  type MigrationRendererFailureReason,
  migrationWindowManager,
  pinUserDataPath,
  presentMigrationDiagnosticFailure,
  presentMigrationDiagnosticRecovery,
  registerMigrationIpcHandlers,
  resolveMigrationPaths,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from '@data/migration/v2'
import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('V2MigrationGate')

const MEMORY_ONLY_DATABASE_DIAGNOSTICS = Object.freeze({
  version: 1 as const,
  expectedSchemaVersion: 1 as const,
  completion: Object.freeze({ status: 'failed' as const, code: 'lease_unavailable' as const })
})

/**
 * Outcome of the v1→v2 migration gate.
 *
 * - `'skipped'`: no migration is needed; bootstrap may continue.
 * - `'handled'`: the gate opened migration UI or handled a native decision;
 *                the caller must not start bootstrap.
 */
export type V2MigrationGateResult = 'handled' | 'skipped'

function toNativeSaveResult(
  result: MigrationDiagnosticBundleSaveResult | { readonly status: 'failed'; readonly code: 'save_in_progress' }
): MigrationDiagnosticNativeSaveResult {
  if (result.status === 'saved') return { status: 'saved' }
  if (result.code === 'save_in_progress') return result
  if (result.code === 'publish_failed') return { status: 'failed', code: 'publish_failed' }
  return { status: 'failed', code: 'archive_failed' }
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
  type DiagnosticEventInput = Parameters<(typeof diagnosticsCoordinator)['recordEvent']>[0]

  const saveDiagnosticBundle = async (destination: string): Promise<MigrationDiagnosticNativeSaveResult> => {
    try {
      const result = await diagnosticsCoordinator.runSave((snapshot) =>
        bundleBuilder.save({
          destination,
          snapshot,
          collectDatabaseDiagnostics: () => {
            if (resolvedPaths === null) return Promise.resolve(MEMORY_ONLY_DATABASE_DIAGNOSTICS)
            return engineInitialized
              ? migrationEngine.collectDatabaseDiagnostics(databaseDiagnostics)
              : databaseDiagnostics.inspect(resolvedPaths.databaseFile)
          }
        })
      )
      return toNativeSaveResult(result)
    } catch {
      return { status: 'failed', code: 'snapshot_failed' }
    }
  }

  const presentFailure = async (
    code: MigrationDiagnosticNativeFailureCode,
    options: { readonly allowUseDefault?: boolean; readonly retry?: 'relaunch' | 'none' } = {}
  ): Promise<MigrationDiagnosticNativeDecision> => {
    await app.whenReady()
    return presentMigrationDiagnosticFailure({
      locale: app.getLocale(),
      code,
      retry: options.retry ?? 'relaunch',
      ...(options.allowUseDefault ? { allowUseDefault: true } : {}),
      saveBundle: saveDiagnosticBundle
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

  const recordEvent = (input: DiagnosticEventInput): void => {
    if (!attemptActive) return
    try {
      diagnosticsCoordinator.recordEvent(input)
    } catch {
      logger.error('Failed to record bounded migration gate diagnostic event')
    }
  }

  const finishFailedAttempt = (error: unknown, phase: DiagnosticEventInput['phase']): void => {
    if (!attemptActive) return
    const classified = classifyMigrationError(error)
    recordEvent({
      scope: 'gate',
      phase,
      state: 'failed',
      category: classified.category,
      code: classified.code,
      causeDepth: classified.causeDepth
    })
    try {
      diagnosticsCoordinator.finishAttempt('failed', {
        scope: 'gate',
        phase: 'finalize',
        state: 'failed',
        category: classified.category,
        code: classified.code,
        causeDepth: classified.causeDepth
      })
    } catch {
      logger.error('Failed to finish bounded migration diagnostic attempt')
    } finally {
      attemptActive = false
    }
  }

  const finishInterruptedAttempt = (code: 'unknown' | 'path_unavailable'): void => {
    if (!attemptActive) return
    try {
      diagnosticsCoordinator.finishAttempt('interrupted', {
        scope: 'gate',
        phase: 'finalize',
        state: 'interrupted',
        code,
        ...(code === 'path_unavailable' ? { category: 'filesystem' as const } : {})
      })
    } catch {
      logger.error('Failed to interrupt bounded migration diagnostic attempt')
    } finally {
      attemptActive = false
    }
  }

  const finishCompletedAttempt = (): void => {
    if (!attemptActive) return
    try {
      diagnosticsCoordinator.finishAttempt('completed', {
        scope: 'gate',
        phase: 'finalize',
        state: 'completed',
        code: 'unknown'
      })
    } catch {
      logger.error('Failed to finish completed migration diagnostic attempt')
    } finally {
      attemptActive = false
    }
  }

  const runRendererExportStart = async (): Promise<void> => {
    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.attempts.at(-1)?.outcome !== 'in_progress') {
        if (!beginAttempt('manual_retry')) return
      } else {
        attemptActive = true
      }
      recordEvent({
        scope: 'renderer_export',
        phase: 'prepare',
        state: 'started',
        code: 'unknown'
      })
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

  const finishRendererExportFailure = async (): Promise<void> => {
    const pendingStart = startRendererExportInFlight
    if (pendingStart !== null) await pendingStart

    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.attempts.at(-1)?.outcome !== 'in_progress') {
        attemptActive = false
        return
      }
      attemptActive = true
      diagnosticsCoordinator.finishAttempt('failed', {
        scope: 'renderer_export',
        phase: 'finalize',
        state: 'failed',
        category: 'source',
        code: 'source_parse'
      })
    } catch {
      logger.error('Failed to finish renderer export diagnostics')
    } finally {
      attemptActive = false
    }
  }

  const migrationIpcDiagnosticCapabilities = {
    start: startRendererExport,
    reportRendererExportFailure: finishRendererExportFailure,
    saveDiagnosticBundle
  }

  const finishActiveRendererFailureAttempt = async (reason: MigrationRendererFailureReason): Promise<void> => {
    try {
      const snapshot = await diagnosticsCoordinator.snapshot()
      if (snapshot.attempts.at(-1)?.outcome !== 'in_progress') {
        attemptActive = false
        return
      }
      diagnosticsCoordinator.finishAttempt('failed', {
        scope: 'gate',
        phase: 'finalize',
        state: 'failed',
        category: 'process',
        code: reason
      })
    } catch {
      logger.error('Failed to finish renderer failure diagnostic attempt')
    } finally {
      attemptActive = false
    }
  }

  const finishWindowFailure = async (code: MigrationDiagnosticNativeFailureCode): Promise<void> => {
    unregisterMigrationIpcHandlers()
    const decision = await presentFailure(code)
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
    finishFailedAttempt(error, 'resolve_paths')
    return applyNativeDecision(await presentFailure('path_resolution_failed'))
  }

  const { paths, userDataChanged, inaccessibleLegacyPath, legacyDataConfirmed, dataLocation } = resolved
  try {
    diagnosticsCoordinator.attachPaths(paths)
  } catch (error) {
    beginAttempt('initial')
    finishFailedAttempt(error, 'resolve_paths')
    return applyNativeDecision(await presentFailure('diagnostics_journal_failed'))
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

  if (!beginAttempt(attemptTrigger)) {
    return applyNativeDecision(await presentFailure('diagnostics_journal_failed'))
  }
  recordEvent({ scope: 'gate', phase: 'resolve_paths', state: 'completed', code: 'unknown' })

  if (inaccessibleLegacyPath) {
    recordEvent({
      scope: 'gate',
      phase: 'resolve_paths',
      state: 'unavailable',
      category: 'filesystem',
      code: 'path_unavailable'
    })
    const decision = await presentFailure('legacy_data_location_unavailable', { allowUseDefault: true })
    if (decision !== 'use_default') {
      finishInterruptedAttempt('path_unavailable')
      return applyNativeDecision(decision)
    }
    try {
      pinUserDataPath(paths.userData)
      recordEvent({ scope: 'gate', phase: 'resolve_paths', state: 'completed', code: 'unknown' })
    } catch (error) {
      finishFailedAttempt(error, 'resolve_paths')
      return applyNativeDecision(await presentFailure('data_location_pin_failed'))
    }
  }

  try {
    migrationEngine.initialize(paths, legacyDataConfirmed, diagnosticsCoordinator)
    engineInitialized = true
    migrationEngine.registerMigrators(getAllMigrators())
  } catch (error) {
    logger.error('Migration database initialization failed')
    finishFailedAttempt(error, 'initialize')
    const decision = await presentFailure('database_initialize_failed')
    if (engineInitialized) migrationEngine.close()
    engineInitialized = false
    return applyNativeDecision(decision)
  }

  let needsMigration: boolean
  recordEvent({ scope: 'gate', phase: 'validate', state: 'started', code: 'unknown' })
  try {
    needsMigration = await migrationEngine.needsMigration()
    recordEvent({ scope: 'gate', phase: 'validate', state: 'completed', code: 'unknown' })
  } catch (error) {
    logger.error('Migration status probe failed')
    finishFailedAttempt(error, 'validate')
    const decision = await presentFailure('migration_status_probe_failed')
    migrationEngine.close()
    engineInitialized = false
    return applyNativeDecision(decision)
  }

  if (!needsMigration) {
    migrationEngine.close()
    engineInitialized = false
    finishCompletedAttempt()
    try {
      diagnosticsCoordinator.complete()
    } catch {
      logger.error('Failed to clean a completed migration diagnostic journal')
    }

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
    finishFailedAttempt(error, 'validate')
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
    // This runs synchronously before the manager starts its write waiter. If an
    // engine write is active, its own terminal event will therefore remain last.
    recordEvent({
      scope: 'gate',
      phase: 'finalize',
      state: 'failed',
      category: 'process',
      code: reason
    })
    await writesSettled
    await finishActiveRendererFailureAttempt(reason)
    await finishWindowFailure(reason)
  }

  const { check: versionCheck, previousVersion, versionLogExists } = versionEvaluation
  logger.info('Version compatibility check', { previousVersion, versionLogExists })
  if (versionCheck.outcome === 'block') {
    setVersionIncompatible(versionCheck.reason, versionCheck.details)
    registerMigrationIpcHandlers(paths.userData, migrationIpcDiagnosticCapabilities)
    try {
      await app.whenReady()
      migrationWindowManager.create({ failureClaim: windowFailureClaim, onRendererFailure })
      await migrationWindowManager.waitForReady()
      return 'handled'
    } catch (error) {
      const failure = windowFailureClaim.claim(async () => {
        logger.error('Version guidance window failed')
        finishFailedAttempt(error, 'initialize')
        await finishWindowFailure('version_window_failed')
      })
      await failure.completion
      return 'handled'
    }
  }

  if (dataLocation) setDataLocationNotice(dataLocation)
  registerMigrationIpcHandlers(paths.userData, migrationIpcDiagnosticCapabilities)
  try {
    await app.whenReady()
    migrationWindowManager.create({ failureClaim: windowFailureClaim, onRendererFailure })
    await migrationWindowManager.waitForReady()
    return 'handled'
  } catch (error) {
    const failure = windowFailureClaim.claim(async () => {
      logger.error('Migration window failed')
      finishFailedAttempt(error, 'initialize')
      await finishWindowFailure('migration_window_failed')
    })
    await failure.completion
    return 'handled'
  }
}
