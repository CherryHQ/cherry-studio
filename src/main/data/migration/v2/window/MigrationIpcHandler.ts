/**
 * IPC handler for migration communication between Main and Renderer
 */

import { application } from '@application'
import type { VersionBlockReason } from '@data/migration/v2/core/versionPolicy'
import { loggerService } from '@logger'
import type { ServiceToken } from '@main/core/lifecycle'
import type { WindowType } from '@main/core/window/types'
import LegacyBackupManager from '@main/services/LegacyBackupManager'
import {
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type MigrationSummary,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')
const CONCURRENT_MIGRATION_ERROR = 'Migration is already in progress.'

// Local backup result shape; not part of the shared contract because the renderer
// drives its UI from progress updates, not from this return value.
type MigrationBackupResult = { success: boolean; path?: string; error?: string; canceled?: boolean }

let inFlightMigration: Promise<MigrationResult> | null = null
// Guards the preboot backup flow so a second ShowBackupDialog can't open another
// save dialog or interleave the scoped container.get override (see performBackupToFile).
let backupInFlight = false
const backupManager = new LegacyBackupManager()

// Current migration progress
let currentProgress: MigrationProgress = {
  stage: 'introduction',
  overallProgress: 0,
  currentMessage: 'Ready to start data migration',
  migrators: []
}

/**
 * Register all migration IPC handlers
 */
export function registerMigrationIpcHandlers(userDataPath: string): void {
  logger.info('Registering migration IPC handlers')

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
      return await migrationEngine.getLastError()
    } catch (error) {
      logger.error('Error getting last error', error as Error)
      throw error
    }
  })

  // Proceed to backup stage
  ipcMain.handle(MigrationIpcChannels.ProceedToBackup, async () => {
    try {
      updateProgress({
        stage: 'backup_required',
        overallProgress: 0,
        currentMessage: 'Data backup is required before migration can proceed',
        migrators: []
      })
      return true
    } catch (error) {
      logger.error('Error proceeding to backup', error as Error)
      throw error
    }
  })

  // Show Backup Dialog
  ipcMain.handle(MigrationIpcChannels.ShowBackupDialog, async () => {
    // Single-flight: while a backup flow is active we must not open a second save
    // dialog or interleave the scoped container.get override in performBackupToFile.
    if (backupInFlight) {
      logger.warn('Backup already in progress; ignoring duplicate backup dialog request')
      return { success: false, error: 'Backup already in progress' }
    }
    backupInFlight = true
    try {
      logger.info('Opening backup dialog for migration')

      const result = await dialog.showSaveDialog({
        title: 'Save Migration Backup',
        defaultPath: `cherry-studio-migration-backup-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'Backup Files', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePath) {
        logger.info('User selected backup location', { filePath: result.filePath })
        updateProgress({
          stage: 'backup_progress',
          overallProgress: 0,
          currentMessage: 'Creating backup file...',
          i18nMessage: { key: 'migration.backup_progress.description' },
          migrators: []
        })

        // Perform the actual backup to the selected location
        const backupResult = await performBackupToFile(result.filePath)

        if (backupResult.success) {
          updateProgress({
            stage: 'backup_confirmed',
            overallProgress: 100,
            currentMessage: 'Backup completed! Ready to start migration. Click "Start Migration" to continue.',
            migrators: [],
            ...(backupResult.path ? { backupInfo: { createdBackupPath: backupResult.path } } : {})
          })
        } else {
          const errorMessage = backupResult.error || 'Unknown backup error'
          updateProgress({
            stage: 'backup_required',
            overallProgress: 0,
            currentMessage: `Backup failed: ${errorMessage}`,
            migrators: []
          })
        }

        return backupResult
      } else {
        logger.info('User cancelled backup dialog')
        updateProgress({
          stage: 'backup_required',
          overallProgress: 0,
          currentMessage: 'Data backup is required before migration can proceed',
          migrators: []
        })
        return { success: false, canceled: true }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Error showing backup dialog', error as Error)
      updateProgress({
        stage: 'backup_required',
        overallProgress: 0,
        currentMessage: `Backup failed: ${errorMessage}`,
        migrators: []
      })
      return { success: false, error: errorMessage }
    } finally {
      backupInFlight = false
    }
  })

  // Backup completed
  ipcMain.handle(MigrationIpcChannels.BackupCompleted, async () => {
    try {
      updateProgress({
        stage: 'backup_confirmed',
        overallProgress: 100,
        currentMessage: 'Backup completed! Ready to start migration. Click "Start Migration" to continue.',
        migrators: []
      })
      return true
    } catch (error) {
      logger.error('Error confirming backup', error as Error)
      throw error
    }
  })

  // Write export file from Renderer
  ipcMain.handle(
    MigrationIpcChannels.WriteExportFile,
    async (_event, exportPath: string, tableName: string, jsonData: string) => {
      try {
        // Ensure export directory exists
        await fs.mkdir(exportPath, { recursive: true })

        // Write table data to file
        const filePath = path.join(exportPath, `${tableName}.json`)
        await fs.writeFile(filePath, jsonData, 'utf-8')

        logger.info('Export file written', { tableName, filePath })
        return true
      } catch (error) {
        logger.error('Error writing export file', error as Error)
        throw error
      }
    }
  )

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

      // Set up progress callback. Preserve created-backup display metadata across
      // every running tick so the completion screen can still show the backup path.
      migrationEngine.onProgress((progress) => {
        updateProgress(progress, { preserveBackupInfo: true })
      })

      // Run migration
      runPromise = migrationEngine.run(reduxData, dexieExportPath, localStorageExportPath)
      inFlightMigration = runPromise

      const result = await runPromise

      if (result.success) {
        updateProgress(
          {
            stage: 'completed',
            overallProgress: 100,
            currentMessage: 'Migration completed successfully!',
            migrators: currentProgress.migrators.map((m) => ({
              ...m,
              status: 'completed'
            })),
            warnings: result.migratorResults.flatMap((migratorResult) => migratorResult.warnings ?? []),
            summary: createMigrationSummary(result, currentProgress)
          },
          { preserveBackupInfo: true }
        )
      } else {
        updateProgress(
          {
            stage: 'error',
            overallProgress: currentProgress.overallProgress,
            currentMessage: result.error || 'Migration failed',
            migrators: currentProgress.migrators,
            error: result.error
          },
          { preserveBackupInfo: true }
        )
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

  // Retry migration
  ipcMain.handle(MigrationIpcChannels.Retry, async () => {
    try {
      // Reset to backup confirmed stage
      updateProgress(
        {
          stage: 'backup_confirmed',
          overallProgress: 0,
          currentMessage: 'Ready to retry migration',
          migrators: []
        },
        { preserveBackupInfo: true }
      )
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

  // User confirmed quit from the renderer's in-flow close dialog
  ipcMain.handle(MigrationIpcChannels.ConfirmQuit, () => {
    migrationWindowManager.confirmQuit()
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
}

/**
 * Update progress and broadcast to window.
 *
 * `backupInfo` is display metadata only. It is preserved across an update solely
 * when `preserveBackupInfo` is requested (engine progress ticks + success/error
 * completion), and never overwrites a `backupInfo` the new progress already sets.
 * `summary` is never implicitly preserved.
 */
function updateProgress(progress: MigrationProgress, options: { preserveBackupInfo?: boolean } = {}): void {
  const next: MigrationProgress = { ...progress }
  if (options.preserveBackupInfo && !next.backupInfo && currentProgress.backupInfo) {
    next.backupInfo = currentProgress.backupInfo
  }
  currentProgress = next
  migrationWindowManager.setStage(next.stage)
  migrationWindowManager.send(MigrationIpcChannels.Progress, next)
}

/**
 * Derive completion-screen summary stats from the migration result + final progress.
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
  backupInFlight = false
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
 * Progress payload emitted by LegacyBackupManager.onProgress. Mirrors its private
 * `ProgressData` shape (not exported); `progress` is already a 0-100 value.
 */
type BackupProgressData = { stage: string; progress: number; total: number }

/**
 * Map a LegacyBackupManager progress tick onto the migration window's
 * `backup_progress` stage. Legacy backup already reports `progress` as a 0-100
 * percentage (`total` is 100), but normalize/clamp defensively in case that ever
 * changes. Only `overallProgress` is rendered on the backup_progress page.
 */
function reportBackupProgress({ stage, progress, total }: BackupProgressData): void {
  const overallProgress =
    total > 0 ? Math.max(0, Math.min(100, Math.round((progress / total) * 100))) : Math.max(0, Math.min(100, progress))
  // The v1 direct backup() emits `compressing` once at 80% then archives silently,
  // so the bar holds there. Surface a stage-specific message so the hold reads as
  // "compressing", not "stuck". Other stages reuse the generic description copy.
  const i18nKey =
    stage === 'compressing' ? 'migration.backup_progress.compressing' : 'migration.backup_progress.description'
  updateProgress({
    stage: 'backup_progress',
    overallProgress,
    currentMessage: 'Creating backup…',
    i18nMessage: { key: i18nKey },
    migrators: []
  })
}

/**
 * Minimal stand-in for the lifecycle WindowManager, used ONLY during the preboot
 * backup. LegacyBackupManager (DO NOT MODIFY) reports progress via
 * `application.get('WindowManager').broadcastToType(Main, BackupProgress, data)`;
 * we forward those ticks to the migration window. Installed/removed scoped around
 * the backup call in performBackupToFile().
 */
const backupProgressWindowManager = {
  broadcastToType(_type: WindowType, channel: string, data: BackupProgressData): void {
    if (channel === IpcChannel.BackupProgress) {
      reportBackupProgress(data)
    }
    // RestoreProgress / other channels are ignored — migration never restores.
  }
}

/**
 * Perform backup to a specific file location
 */
async function performBackupToFile(filePath: string): Promise<MigrationBackupResult> {
  // Preboot migration has no lifecycle WindowManager, but LegacyBackupManager
  // (DO NOT MODIFY — verbatim v1 mirror) reports progress only through
  // application.get('WindowManager').broadcastToType(...). Override container.get
  // to satisfy ONLY that call for the duration of the backup, then restore exactly
  // — leaving nothing in the container so a later registerAll() can never be
  // masked by a stale 'WindowManager' entry.
  const container = application.getContainer()
  const hadOwnGet = Object.prototype.hasOwnProperty.call(container, 'get')
  const originalGet = container.get
  const scopedGet = (<T>(token: ServiceToken<T>): T => {
    if (token === 'WindowManager') {
      return backupProgressWindowManager as T
    }
    return originalGet.call(container, token) as T
  }) as typeof container.get
  container.get = scopedGet

  try {
    logger.info('Performing backup to file', { filePath })

    // Extract directory and filename from the full path
    const destinationDir = path.dirname(filePath)
    const fileName = path.basename(filePath)

    // Use the existing backup manager to create a backup
    const backupPath = await backupManager.backup(
      null as any, // IpcMainInvokeEvent - we're calling directly so pass null
      fileName,
      destinationDir,
      false // Don't skip backup files - full backup for migration safety
    )

    if (backupPath) {
      logger.info('Backup created successfully', { path: backupPath })
      return { success: true, path: backupPath }
    } else {
      return {
        success: false,
        error: 'Backup process did not return a file path'
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Backup failed during migration:', error as Error)
    return {
      success: false,
      error: errorMessage
    }
  } finally {
    if (hadOwnGet) {
      container.get = originalGet
    } else {
      Reflect.deleteProperty(container, 'get')
    }
  }
}
