/**
 * IPC handler for migration communication between Main and Renderer
 */

import { application } from '@application'
import type { VersionBlockReason } from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import { validateSender } from '@main/core/security/validateSender'
import {
  type MigrationDiagnosticSavePayload,
  type MigrationDiagnosticSaveResult,
  type MigrationExportFileWriteMode,
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type MigrationSummary,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { app, dialog, ipcMain, type IpcMainInvokeEvent, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')
const CONCURRENT_MIGRATION_ERROR = 'Migration is already in progress.'

let inFlightMigration: Promise<MigrationResult> | null = null
// Set once a deferred quit has been registered, so repeated confirmations while a migration
// write is in flight don't stack a second allSettled().then(confirmQuit).
let quitScheduled = false

let lastSavedDiagnosticBundlePath: string | null = null

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

function assertMigrationDiagnosticSender(event: IpcMainInvokeEvent): void {
  if (!validateSender(event)) throw new Error('Unauthorized migration diagnostic IPC sender.')
}

function isValidLocalDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/**
 * Register all migration IPC handlers
 */
export function registerMigrationIpcHandlers(userDataPath: string): void {
  logger.info('Registering migration IPC handlers')

  // Wire the window manager's force-quit escape hatch (crash / hang / repeated close) to the same
  // write-deferral the ConfirmQuit handler uses, so those paths never terminate mid-write.
  migrationWindowManager.setQuitRequester(requestQuit)

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
    async (
      _event,
      exportPath: string,
      tableName: string,
      jsonData: string,
      writeMode: MigrationExportFileWriteMode = 'overwrite'
    ) => {
      try {
        // Ensure export directory exists
        await fs.mkdir(exportPath, { recursive: true })

        // Write table data to file
        const filePath = path.join(exportPath, `${tableName}.json`)
        if (writeMode === 'append') {
          await fs.appendFile(filePath, jsonData, 'utf-8')
        } else {
          await fs.writeFile(filePath, jsonData, 'utf-8')
        }

        logger.debug('Export file chunk written', { tableName, filePath, writeMode, chunkLength: jsonData.length })
        return true
      } catch (error) {
        logger.error('Error writing export file', error as Error)
        throw error
      }
    }
  )

  ipcMain.handle(
    MigrationIpcChannels.SaveDiagnosticBundle,
    async (
      event: IpcMainInvokeEvent,
      payload: MigrationDiagnosticSavePayload
    ): Promise<MigrationDiagnosticSaveResult> => {
      assertMigrationDiagnosticSender(event)
      const dialogTitle = payload.dialogTitle.trim()
      if (dialogTitle.length < 1 || dialogTitle.length > 120) {
        throw new Error('Invalid migration diagnostic dialog title.')
      }
      if (!isValidLocalDate(payload.logDate)) {
        throw new Error('Invalid migration diagnostic log date.')
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: dialogTitle,
        defaultPath: application.getPath('app.logs', 'cherry-studio-migration-diagnostics.zip'),
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (canceled || !filePath) return { status: 'canceled' }

      try {
        const { saveMigrationDiagnosticBundle } = await import('../migrationDiagnosticBundle')
        const logs = await saveMigrationDiagnosticBundle({
          destination: filePath,
          stage: currentProgress.stage,
          logDate: payload.logDate
        })
        if (!logs) return { status: 'failed' }
        lastSavedDiagnosticBundlePath = filePath
        return { status: 'saved', logs }
      } catch (error) {
        logger.error('Failed to save migration diagnostic bundle', error as Error)
        return { status: 'failed' }
      }
    }
  )

  ipcMain.handle(MigrationIpcChannels.ShowDiagnosticBundleInFolder, async (event: IpcMainInvokeEvent) => {
    assertMigrationDiagnosticSender(event)
    if (!lastSavedDiagnosticBundlePath) return false
    shell.showItemInFolder(lastSavedDiagnosticBundlePath)
    return true
  })

  // Start the migration process
  ipcMain.handle(MigrationIpcChannels.StartMigration, async (_event, payload: StartMigrationPayload) => {
    if (inFlightMigration) {
      logger.warn(CONCURRENT_MIGRATION_ERROR)
      throw new Error(CONCURRENT_MIGRATION_ERROR)
    }

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
      logger.error('Error starting migration', error as Error)

      if (errorMessage === CONCURRENT_MIGRATION_ERROR) {
        throw error
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
  ipcMain.handle(MigrationIpcChannels.ReportError, (_event, message: string) => {
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
      migrationWindowManager.close()
      app.quit()
      return true
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

/**
 * Request an app quit. If a migration write is still in flight, defer the quit until it settles so
 * we never terminate mid-write (which would leave a half-applied migration). Returns true when
 * quitting immediately, false when deferred.
 *
 * Shared by the ConfirmQuit IPC handler (renderer's in-flow dialog) and the window manager's
 * force-quit escape hatch (crash / hang / repeated close), so every quit path inherits the same
 * write-safety. The `quitScheduled` guard dedups repeated triggers into a single deferred quit.
 */
function requestQuit(): boolean {
  const pending: Promise<unknown>[] = []
  if (inFlightMigration) pending.push(inFlightMigration)

  if (pending.length === 0) {
    migrationWindowManager.confirmQuit()
    return true
  }

  if (!quitScheduled) {
    quitScheduled = true
    logger.info('Quit requested during an active write; deferring until it settles')
    void Promise.allSettled(pending).then(() => {
      migrationWindowManager.confirmQuit()
    })
  }
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
  quitScheduled = false
  dataLocationNotice = null
  lastSavedDiagnosticBundlePath = null
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
export function setVersionIncompatible(reason: VersionBlockReason, details: Record<string, string>): void {
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
