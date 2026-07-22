/**
 * IPC handler for migration communication between Main and Renderer
 */

import type { VersionBlockReason } from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import { validateSender } from '@main/core/security/validateSender'
import { isSafeExternalUrl } from '@main/utils/externalUrlSafety'
import {
  type MigrationDiagnosticFailure,
  type MigrationDiagnosticRun,
  type MigrationDiagnosticSaveResult,
  type MigrationVersionDiagnostic,
  serializeMigrationDiagnosticError
} from '@shared/data/migration/v2/diagnostics'
import {
  type BeginMigrationRunPayload,
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type MigrationSummary,
  type ReportMigrationErrorPayload,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { app, clipboard, ipcMain, type IpcMainInvokeEvent, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import type { MigrationDiagnosticContext } from '../diagnostics'
import { saveMigrationDiagnosticBundleWithDialog } from './migrationDiagnosticDialogs'
import { createMigrationDiagnosticEmailUrl, MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL } from './migrationDiagnosticEmail'
import { createMigrationDiagnosticNativeI18n } from './migrationDiagnosticNativeI18n'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')
const CONCURRENT_MIGRATION_ERROR = 'Migration is already in progress.'
const DIAGNOSTIC_SAVE_QUIT_GRACE_MS = 30_000

let inFlightMigration: Promise<MigrationResult> | null = null
let diagnosticSaveInFlight: Promise<MigrationDiagnosticSaveResult> | null = null
let lastSavedDiagnosticBundlePath: string | null = null
let currentDiagnosticFailure: MigrationDiagnosticFailure | undefined
let activeDiagnosticRun: MigrationDiagnosticRun | undefined
let diagnosticStateEpoch = 0
// Set once a deferred quit has been registered, so repeated confirmations while a protected
// operation is in flight don't stack a second allSettled().then(confirmQuit).
let quitScheduled = false

// Current migration progress
let currentProgress: MigrationProgress = {
  stage: 'introduction',
  overallProgress: 0,
  currentMessage: 'Ready to start data migration',
  migrators: []
}

// Recovered non-default data directory to surface on the introduction screen.
// Held separately from currentProgress so it survives Retry (which rebuilds the
// introduction progress from scratch) instead of vanishing after a failed run.
let dataLocationNotice: string | null = null

/**
 * Register all migration IPC handlers
 */
export function registerMigrationIpcHandlers(userDataPath: string): void {
  logger.info('Registering migration IPC handlers')

  // Wire the window manager's force-quit escape hatch (crash / hang / repeated close) to the same
  // write-deferral the ConfirmQuit handler uses, so those paths never terminate mid-write.
  migrationWindowManager.setQuitRequester(requestQuit)

  ipcMain.handle(MigrationIpcChannels.BeginRun, (event, payload: BeginMigrationRunPayload) => {
    assertDiagnosticSender(event)
    if (!payload.runId) return false
    activeDiagnosticRun = { id: payload.runId, startedAt: new Date().toISOString() }
    currentDiagnosticFailure = undefined
    diagnosticStateEpoch += 1
    logger.info('Beginning migration run', { runId: payload.runId })
    return true
  })

  ipcMain.handle(MigrationIpcChannels.SaveDiagnosticBundle, async (event) => {
    assertDiagnosticSender(event)
    if (diagnosticSaveInFlight || quitScheduled) return { status: 'failed', code: 'save_in_progress' } as const

    const saveEpoch = diagnosticStateEpoch
    const operation = saveMigrationDiagnosticBundleWithDialog(createRendererDiagnosticContext()).then((outcome) => {
      if (
        outcome.result.status === 'saved' &&
        outcome.destination !== undefined &&
        diagnosticStateEpoch === saveEpoch
      ) {
        lastSavedDiagnosticBundlePath = outcome.destination
      }
      return outcome.result
    })
    diagnosticSaveInFlight = operation

    try {
      return await operation
    } finally {
      if (diagnosticSaveInFlight === operation) diagnosticSaveInFlight = null
    }
  })

  ipcMain.handle(MigrationIpcChannels.OpenDiagnosticEmail, async (event) => {
    assertDiagnosticSender(event)
    const i18n = await createMigrationDiagnosticNativeI18n(app.getLocale())
    const mailto = createMigrationDiagnosticEmailUrl(
      createRendererDiagnosticContext(),
      { version: app.getVersion(), platform: process.platform, arch: process.arch },
      i18n
    )
    if (!isSafeExternalUrl(mailto)) throw new Error('Could not create a safe support email URL.')
    await shell.openExternal(mailto)
    return true
  })

  ipcMain.handle(MigrationIpcChannels.ShowDiagnosticBundleInFolder, (event) => {
    assertDiagnosticSender(event)
    if (lastSavedDiagnosticBundlePath === null) return false
    shell.showItemInFolder(lastSavedDiagnosticBundlePath)
    return true
  })

  ipcMain.handle(MigrationIpcChannels.CopySupportEmail, (event) => {
    assertDiagnosticSender(event)
    clipboard.writeText(MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL)
    return true
  })

  // Get user data path
  ipcMain.handle(MigrationIpcChannels.GetUserDataPath, () => {
    return userDataPath
  })

  // Check if migration is needed
  ipcMain.handle(MigrationIpcChannels.CheckNeeded, async () => {
    try {
      return await migrationEngine.needsMigration()
    } catch (error) {
      logger.error('Error checking migration needed', error as Error)
      throw error
    }
  })

  // Get current progress
  ipcMain.handle(MigrationIpcChannels.GetProgress, () => {
    return currentProgress
  })

  // Get last error
  ipcMain.handle(MigrationIpcChannels.GetLastError, async () => {
    try {
      return migrationEngine.getLastError()
    } catch (error) {
      logger.error('Error getting last error', error as Error)
      throw error
    }
  })

  // Write export file from Renderer
  ipcMain.handle(
    MigrationIpcChannels.WriteExportFile,
    async (_event, exportPath: string, tableName: string, jsonData: string) => {
      try {
        await fs.mkdir(exportPath, { recursive: true })
      } catch (error) {
        const failure: MigrationDiagnosticFailure = {
          code: 'export_directory_create_failed',
          origin: 'main',
          operation: 'create_export_directory',
          targetPath: exportPath,
          error: serializeMigrationDiagnosticError(error, exportPath)
        }
        recordDiagnosticFailure(failure)
        logger.error('Error creating migration export directory', error as Error, { runId: activeDiagnosticRun?.id })
        return { ok: false, failure } as const
      }

      const filePath = path.join(exportPath, `${tableName}.json`)
      try {
        await fs.writeFile(filePath, jsonData, 'utf-8')
        logger.info('Export file written', { tableName, filePath })
        return { ok: true } as const
      } catch (error) {
        const failure: MigrationDiagnosticFailure = {
          code: 'export_file_write_failed',
          origin: 'main',
          operation: 'write_export_file',
          targetPath: filePath,
          error: serializeMigrationDiagnosticError(error, filePath)
        }
        recordDiagnosticFailure(failure)
        logger.error('Error writing export file', error as Error, { runId: activeDiagnosticRun?.id })
        return { ok: false, failure } as const
      }
    }
  )

  // Start the migration process
  ipcMain.handle(MigrationIpcChannels.StartMigration, async (_event, payload: StartMigrationPayload) => {
    if (inFlightMigration) {
      logger.warn(CONCURRENT_MIGRATION_ERROR)
      throw new Error(CONCURRENT_MIGRATION_ERROR)
    }

    if (!payload.runId || activeDiagnosticRun?.id !== payload.runId) {
      throw new Error('Stale or missing migration run.')
    }

    currentDiagnosticFailure = undefined
    let runPromise: Promise<MigrationResult> | null = null

    try {
      const { reduxData, dexieExportPath, localStorageExportPath } = payload

      if (!reduxData || !dexieExportPath) {
        throw new Error('Migration data not ready. Redux data or Dexie export path missing.')
      }

      // Set up progress callback
      migrationEngine.onProgress((progress) => {
        updateProgress(progress)
      })

      // Flip to the protected `migration` stage before running the engine. run() synchronously
      // clears all v2 tables (verifyAndClearNewTables) before emitting its first progress tick, so
      // without this the destructive clear would execute while still on the unprotected
      // `introduction` stage — a window close there would quit immediately, bypassing the
      // ConfirmQuit write-deferral. The engine's first tick overwrites this shortly after.
      updateProgress({
        stage: 'migration',
        overallProgress: 0,
        currentMessage: 'Starting migration…',
        migrators: []
      })

      // Run migration
      runPromise = migrationEngine.run(reduxData, dexieExportPath, localStorageExportPath)
      inFlightMigration = runPromise

      const result = await runPromise

      if (result.success) {
        updateProgress({
          stage: 'completed',
          overallProgress: 100,
          currentMessage: 'Migration completed successfully!',
          migrators: currentProgress.migrators.map((m) => ({
            ...m,
            status: 'completed'
          })),
          warnings: result.migratorResults.flatMap((migratorResult) => migratorResult.warnings ?? []),
          summary: createMigrationSummary(result, currentProgress)
        })
      } else {
        const failure = migrationEngine.getLastDiagnosticFailure()
        if (failure) recordDiagnosticFailure(failure)
        logger.warn('Migration run failed', { runId: payload.runId, failureCode: failure?.code })
        updateProgress({
          stage: 'error',
          overallProgress: currentProgress.overallProgress,
          currentMessage: result.error || 'Migration failed',
          migrators: currentProgress.migrators,
          error: result.error
        })
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error starting migration', error as Error, { runId: payload.runId })

      if (errorMessage === CONCURRENT_MIGRATION_ERROR) {
        throw error
      }

      if (!currentDiagnosticFailure) {
        recordDiagnosticFailure({
          code: 'migration_start_failed',
          origin: 'main',
          operation: 'start_migration',
          error: serializeMigrationDiagnosticError(error)
        })
      }

      updateProgress({
        stage: 'error',
        overallProgress: currentProgress.overallProgress,
        currentMessage: errorMessage,
        migrators: currentProgress.migrators,
        error: errorMessage
      })

      throw error
    } finally {
      if (runPromise && inFlightMigration === runPromise) {
        inFlightMigration = null
      }
    }
  })

  // Mirror renderer-local failures into main so close handling sees the terminal error stage.
  ipcMain.handle(MigrationIpcChannels.ReportError, (event, payload: ReportMigrationErrorPayload) => {
    assertDiagnosticSender(event)
    if (!payload?.runId || !payload.failure || activeDiagnosticRun?.id !== payload.runId) return false
    if (currentDiagnosticFailure) return true
    const failure = payload.failure
    recordDiagnosticFailure(failure)
    logger.error('Renderer migration step failed', { runId: payload.runId, failure })
    const message = failure.error?.message ?? failure.code
    updateProgress({
      stage: 'error',
      overallProgress: currentProgress.overallProgress,
      currentMessage: message,
      migrators: currentProgress.migrators,
      error: message
    })
    return true
  })

  // Retry migration
  ipcMain.handle(MigrationIpcChannels.Retry, async () => {
    try {
      currentDiagnosticFailure = undefined
      activeDiagnosticRun = undefined
      diagnosticStateEpoch += 1
      // Reset to the introduction stage so the user can re-trigger migration from its Start button.
      // Carry the data-location notice back so it doesn't disappear after a failed export.
      updateProgress({
        stage: 'introduction',
        overallProgress: 0,
        currentMessage: 'Ready to retry migration',
        migrators: [],
        ...(dataLocationNotice ? { dataLocation: dataLocationNotice } : {})
      })
      return true
    } catch (error) {
      logger.error('Error retrying migration', error as Error)
      throw error
    }
  })

  // Cancel migration
  ipcMain.handle(MigrationIpcChannels.Cancel, async () => {
    try {
      logger.info('Migration cancelled by user')
      return requestQuit()
    } catch (error) {
      logger.error('Error cancelling migration', error as Error)
      throw error
    }
  })

  // Skip migration (version incompatible — user chose to use defaults)
  ipcMain.handle(MigrationIpcChannels.SkipMigration, async () => {
    try {
      logger.info('User chose to skip migration and use defaults')
      await migrationEngine.skipMigration()
      migrationEngine.close()
      void migrationWindowManager.restartApp()
      return true
    } catch (error) {
      logger.error('Error skipping migration', error as Error)
      throw error
    }
  })

  // Restart app
  ipcMain.handle(MigrationIpcChannels.Restart, async () => {
    try {
      logger.info('Restarting app after migration')
      void migrationWindowManager.restartApp()
      return true
    } catch (error) {
      logger.error('Error restarting app', error as Error)
      throw error
    }
  })

  // Minimize the migration window (custom control on Windows/Linux)
  ipcMain.handle(MigrationIpcChannels.Minimize, () => {
    migrationWindowManager.minimize()
    return true
  })

  // Request a user-initiated close (custom control on Windows/Linux). Routes through the
  // native close event so the in-flow confirmation applies.
  ipcMain.handle(MigrationIpcChannels.CloseWindow, () => {
    migrationWindowManager.requestClose()
    return true
  })

  // User confirmed quit from the renderer's in-flow close dialog. Returns true when quitting
  // immediately, false when deferred (an active write must settle first) — the renderer uses this
  // to show the "app will close when the current step finishes" notice.
  ipcMain.handle(MigrationIpcChannels.ConfirmQuit, () => requestQuit())

  // Renderer dismissed the in-flow close dialog without quitting (Continue / Esc / backdrop).
  // Drop the pending-close flag so the next close re-prompts instead of force-quitting.
  ipcMain.handle(MigrationIpcChannels.CancelClose, () => {
    migrationWindowManager.clearCloseConfirm()
    return true
  })
}

/**
 * Unregister all migration IPC handlers
 */
export function unregisterMigrationIpcHandlers(): void {
  logger.info('Unregistering migration IPC handlers')

  const channels = Object.values(MigrationIpcChannels)
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }

  migrationWindowManager.setQuitRequester(null)
}

/**
 * Update progress and broadcast to window.
 */
function updateProgress(progress: MigrationProgress): void {
  currentProgress = progress
  migrationWindowManager.setStage(progress.stage)
  migrationWindowManager.send(MigrationIpcChannels.Progress, progress)
}

function assertDiagnosticSender(event: IpcMainInvokeEvent): void {
  if (!validateSender(event)) throw new Error('Untrusted migration diagnostic IPC sender.')
}

function createRendererDiagnosticContext(): MigrationDiagnosticContext {
  const compatibilityFailure =
    currentDiagnosticFailure === undefined
      ? {}
      : {
          failureCode: currentDiagnosticFailure.code,
          ...(currentDiagnosticFailure.error === undefined ? {} : { error: currentDiagnosticFailure.error }),
          failure: currentDiagnosticFailure
        }
  return {
    source: 'renderer',
    stage: currentProgress.stage,
    errorSummary: currentProgress.error ?? currentProgress.currentMessage,
    ...compatibilityFailure,
    ...(activeDiagnosticRun === undefined ? {} : { run: activeDiagnosticRun }),
    overallProgress: currentProgress.overallProgress,
    migrators: currentProgress.migrators.map(({ id, status }) => ({ id, status }))
  }
}

function recordDiagnosticFailure(failure: MigrationDiagnosticFailure): void {
  currentDiagnosticFailure = failure
  if (activeDiagnosticRun && activeDiagnosticRun.failedAt === undefined) {
    activeDiagnosticRun = { ...activeDiagnosticRun, failedAt: new Date().toISOString() }
  }
}

function waitForDiagnosticSaveBeforeQuit(save: Promise<MigrationDiagnosticSaveResult>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      logger.warn('Diagnostic bundle save exceeded the quit grace period; continuing quit')
      finish()
    }, DIAGNOSTIC_SAVE_QUIT_GRACE_MS)
    timeout.unref?.()

    void save.then(finish, finish)
  })
}

/**
 * Request an app quit. Migration writes remain an unbounded hard wait so we never terminate with a
 * half-applied migration. Diagnostic saves get a bounded grace period because they are optional
 * support artifacts. Returns true when quitting immediately, false when deferred.
 *
 * Shared by the ConfirmQuit IPC handler (renderer's in-flow dialog) and the window manager's
 * force-quit escape hatch (crash / hang / repeated close), so every quit path inherits the same
 * write-safety. The `quitScheduled` guard dedups repeated triggers into a single deferred quit.
 */
function requestQuit(): boolean {
  if (quitScheduled) return false

  const pending: Promise<unknown>[] = []
  if (inFlightMigration) pending.push(inFlightMigration)
  if (diagnosticSaveInFlight) pending.push(waitForDiagnosticSaveBeforeQuit(diagnosticSaveInFlight))

  if (pending.length === 0) {
    migrationWindowManager.confirmQuit()
    return true
  }

  quitScheduled = true
  logger.info('Quit requested during an active protected operation; deferring')
  void Promise.allSettled(pending).then(() => {
    migrationWindowManager.confirmQuit()
  })
  return false
}

/**
 * Seed completion-screen summary stats from the migration result + final progress.
 * The renderer owns the user-visible migration-stage duration and may replace
 * `durationMs` before rendering the completion screen.
 */
function createMigrationSummary(result: MigrationResult, progress: MigrationProgress): MigrationSummary {
  return {
    completedMigrators: result.migratorResults.length,
    totalMigrators: progress.migrators.length || result.migratorResults.length,
    itemsProcessed: result.migratorResults.reduce((sum, r) => sum + r.recordsProcessed, 0),
    durationMs: result.totalDuration
  }
}

/**
 * Reset cached data
 */
export function resetMigrationData(): void {
  inFlightMigration = null
  diagnosticSaveInFlight = null
  lastSavedDiagnosticBundlePath = null
  currentDiagnosticFailure = undefined
  activeDiagnosticRun = undefined
  diagnosticStateEpoch += 1
  quitScheduled = false
  dataLocationNotice = null
  currentProgress = {
    stage: 'introduction',
    overallProgress: 0,
    currentMessage: 'Ready to start data migration',
    migrators: []
  }
}

/**
 * Set the initial progress to version_incompatible stage.
 * Must be called BEFORE registerMigrationIpcHandlers() so that the
 * renderer picks up this state via the GetProgress IPC on mount.
 */
export function setVersionIncompatible(
  reason: VersionBlockReason,
  details: Record<string, string>,
  diagnostic: {
    readonly currentVersion: string
    readonly previousVersion: string | null
    readonly versionLogExists: boolean
    readonly versionLogPath: string
  }
): void {
  const version: MigrationVersionDiagnostic = {
    reason,
    currentVersion: diagnostic.currentVersion,
    ...(diagnostic.previousVersion === null ? {} : { previousVersion: diagnostic.previousVersion }),
    ...(details.requiredVersion === undefined ? {} : { requiredVersion: details.requiredVersion }),
    ...(details.gatewayVersion === undefined ? {} : { gatewayVersion: details.gatewayVersion }),
    versionLogExists: diagnostic.versionLogExists
  }
  currentDiagnosticFailure = {
    code: reason,
    origin: 'main',
    operation: 'evaluate_version',
    targetPath: diagnostic.versionLogPath,
    version
  }
  currentProgress = {
    stage: 'version_incompatible',
    overallProgress: 0,
    currentMessage: `Version incompatible: ${reason}`,
    i18nMessage: { key: `migration.version_incompatible.${reason}`, params: details },
    migrators: []
  }
}

/**
 * Seed the recovered non-default data directory so the introduction screen can
 * show a "data migration directory" notice. Must be called BEFORE
 * registerMigrationIpcHandlers() so the renderer picks it up via GetProgress on
 * mount. Also retained across Retry (see the Retry handler).
 */
export function setDataLocationNotice(dataLocation: string): void {
  dataLocationNotice = dataLocation
  currentProgress = { ...currentProgress, dataLocation }
}
