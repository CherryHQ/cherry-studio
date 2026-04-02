/**
 * IPC handler for migration communication between Main and Renderer
 */

import { loggerService } from '@logger'
import BackupManager from '@main/services/BackupManager'
import {
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')
const CONCURRENT_MIGRATION_ERROR = 'Migration is already in progress.'

let inFlightMigration: Promise<MigrationResult> | null = null
const backupManager = new BackupManager()

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
export function registerMigrationIpcHandlers(): void {
  logger.info('Registering migration IPC handlers')

  // Get user data path
  ipcMain.handle(MigrationIpcChannels.GetUserDataPath, () => {
    return app.getPath('userData')
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
    try {
      logger.info('Opening backup dialog for migration')

      // Update progress to indicate backup dialog is opening
      updateProgress({
        stage: 'backup_progress',
        overallProgress: 10,
        currentMessage: 'Opening backup dialog...',
        migrators: []
      })

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
          overallProgress: 10,
          currentMessage: 'Creating backup file...',
          migrators: []
        })

        // Perform the actual backup to the selected location
        const backupResult = await performBackupToFile(result.filePath)

        if (backupResult.success) {
          updateProgress({
            stage: 'backup_confirmed',
            overallProgress: 100,
            currentMessage: 'Backup completed! Ready to start migration. Click "Start Migration" to continue.',
            migrators: []
          })
        } else {
          updateProgress({
            stage: 'backup_required',
            overallProgress: 0,
            currentMessage: `Backup failed: ${backupResult.error}`,
            migrators: []
          })
        }

        return backupResult
      } else {
        logger.info('User cancelled backup dialog')
        updateProgress({
          stage: 'backup_required',
          overallProgress: 0,
          currentMessage: 'Backup cancelled. Please create a backup to continue.',
          migrators: []
        })
        return { success: false, error: 'Backup cancelled by user' }
      }
    } catch (error) {
      logger.error('Error showing backup dialog', error as Error)
      updateProgress({
        stage: 'backup_required',
        overallProgress: 0,
        currentMessage: 'Backup process failed',
        migrators: []
      })
      throw error
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

      // Set up progress callback
      migrationEngine.onProgress((progress) => {
        updateProgress(progress)
      })

      // Run migration
      runPromise = migrationEngine.run(reduxData, dexieExportPath, localStorageExportPath)
      inFlightMigration = runPromise

      const result = await runPromise

      if (result.success) {
        updateProgress({
          stage: 'migration_completed',
          overallProgress: 100,
          currentMessage: 'Migration completed successfully! Please confirm to continue.',
          migrators: currentProgress.migrators.map((m) => ({
            ...m,
            status: 'completed'
          }))
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

  // Retry migration
  ipcMain.handle(MigrationIpcChannels.Retry, async () => {
    try {
      // Reset to backup confirmed stage
      updateProgress({
        stage: 'backup_confirmed',
        overallProgress: 0,
        currentMessage: 'Ready to retry migration',
        migrators: []
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
 * Update progress and broadcast to window
 */
function updateProgress(progress: MigrationProgress): void {
  currentProgress = progress
  migrationWindowManager.send(MigrationIpcChannels.Progress, progress)
}

/**
 * Reset cached data
 */
export function resetMigrationData(): void {
  inFlightMigration = null
  currentProgress = {
    stage: 'introduction',
    overallProgress: 0,
    currentMessage: 'Ready to start data migration',
    migrators: []
  }
}

/**
 * Perform backup to a specific file location
 */
async function performBackupToFile(filePath: string): Promise<{ success: boolean; error?: string }> {
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
      return { success: true }
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
  }
}
