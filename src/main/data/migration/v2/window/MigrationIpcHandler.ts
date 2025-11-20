/**
 * IPC handler for migration communication between Main and Renderer
 */

import { loggerService } from '@logger'
import BackupManager from '@main/services/BackupManager'
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { migrationEngine } from '../core/MigrationEngine'
import { MigrationIpcChannels, type MigrationProgress } from '../core/types'
import { migrationWindowManager } from './MigrationWindowManager'

const logger = loggerService.withContext('MigrationIpcHandler')

// Store for cached data from Renderer
let cachedReduxData: Record<string, unknown> | null = null
let cachedDexieExportPath: string | null = null
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
            stage: 'backup_progress',
            overallProgress: 100,
            currentMessage: 'Backup created successfully!',
            migrators: []
          })

          // Wait a moment to show the success message, then transition to confirmed state
          setTimeout(() => {
            updateProgress({
              stage: 'backup_confirmed',
              overallProgress: 100,
              currentMessage: 'Backup completed! Ready to start migration. Click "Start Migration" to continue.',
              migrators: []
            })
          }, 1000)
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

  // Receive Redux data from Renderer
  ipcMain.handle(MigrationIpcChannels.SendReduxData, async (_event, data: Record<string, unknown>) => {
    try {
      cachedReduxData = data
      logger.info('Redux data received', {
        categories: Object.keys(data)
      })
      return true
    } catch (error) {
      logger.error('Error receiving Redux data', error as Error)
      throw error
    }
  })

  // Dexie export completed
  ipcMain.handle(MigrationIpcChannels.DexieExportCompleted, async (_event, exportPath: string) => {
    try {
      cachedDexieExportPath = exportPath
      logger.info('Dexie export completed', { exportPath })
      return true
    } catch (error) {
      logger.error('Error receiving Dexie export path', error as Error)
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
  ipcMain.handle(MigrationIpcChannels.StartMigration, async () => {
    try {
      if (!cachedReduxData || !cachedDexieExportPath) {
        throw new Error('Migration data not ready. Redux data or Dexie export path missing.')
      }

      // Set up progress callback
      migrationEngine.onProgress((progress) => {
        updateProgress(progress)
      })

      // Run migration
      const result = await migrationEngine.run(cachedReduxData, cachedDexieExportPath)

      if (result.success) {
        updateProgress({
          stage: 'completed',
          overallProgress: 100,
          currentMessage: 'Migration completed successfully! Click restart to continue.',
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

      updateProgress({
        stage: 'error',
        overallProgress: currentProgress.overallProgress,
        currentMessage: errorMessage,
        migrators: currentProgress.migrators,
        error: errorMessage
      })

      throw error
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
      migrationWindowManager.restartApp()
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
  cachedReduxData = null
  cachedDexieExportPath = null
  currentProgress = {
    stage: 'introduction',
    overallProgress: 0,
    currentMessage: 'Ready to start data migration',
    migrators: []
  }
}

/**
 * Get backup data from the current application
 */
async function getBackupData(): Promise<string> {
  try {
    const { getDataPath } = await import('@main/utils')
    const dataPath = getDataPath()

    // Gather basic system information
    const data = {
      backup: {
        timestamp: new Date().toISOString(),
        version: app.getVersion(),
        type: 'pre-migration-backup',
        note: 'This is a safety backup created before data migration'
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      },
      // Include basic configuration files if they exist
      configs: {} as Record<string, any>
    }

    // Check if there are any config files we should backup
    const configFiles = ['config.json', 'settings.json', 'preferences.json']
    for (const configFile of configFiles) {
      const configPath = path.join(dataPath, configFile)
      try {
        // Check if file exists
        await fs.access(configPath)
        const configContent = await fs.readFile(configPath, 'utf-8')
        data.configs[configFile] = JSON.parse(configContent)
      } catch (err) {
        // Ignore if file doesn't exist or can't be read
      }
    }

    return JSON.stringify(data, null, 2)
  } catch (error) {
    logger.error('Failed to get backup data:', error as Error)
    throw error
  }
}

/**
 * Perform backup to a specific file location
 */
async function performBackupToFile(filePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('Performing backup to file', { filePath })

    // Get backup data
    const backupData = await getBackupData()

    // Extract directory and filename from the full path
    const destinationDir = path.dirname(filePath)
    const fileName = path.basename(filePath)

    // Use the existing backup manager to create a backup
    const backupPath = await backupManager.backup(
      null as any, // IpcMainInvokeEvent - we're calling directly so pass null
      fileName,
      backupData,
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
