import { dbService } from '@data/db/DbService'
import { appStateTable } from '@data/db/schemas/appState'
import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import BackupManager from '@main/services/BackupManager'
import { IpcChannel } from '@shared/IpcChannel'
import { eq } from 'drizzle-orm'
import { app, BrowserWindow, ipcMain } from 'electron'
import { app as electronApp } from 'electron'
import { join } from 'path'

import { PreferencesMigrator } from './migrators/PreferencesMigrator'

const logger = loggerService.withContext('DataRefactorMigrateService')

const DATA_REFACTOR_MIGRATION_STATUS = 'data_refactor_migration_status'

// Data refactor migration status interface
interface DataRefactorMigrationStatus {
  completed: boolean
  completedAt?: number
  version?: string
}

type MigrationStage =
  | 'introduction' // Introduction phase - user can cancel
  | 'backup_required' // Backup required - show backup requirement
  | 'backup_progress' // Backup in progress - user is backing up
  | 'backup_confirmed' // Backup confirmed - ready to migrate
  | 'migration' // Migration in progress - cannot cancel
  | 'completed' // Completed - restart app
  | 'error' // Error - recovery options

interface MigrationProgress {
  stage: MigrationStage
  progress: number
  total: number
  message: string
  error?: string
}

interface MigrationResult {
  success: boolean
  error?: string
  migratedCount: number
}

export class DataRefactorMigrateService {
  private static instance: DataRefactorMigrateService | null = null
  private migrateWindow: BrowserWindow | null = null
  private testWindows: BrowserWindow[] = []
  private backupManager: BackupManager
  private db = dbService.getDb()
  private currentProgress: MigrationProgress = {
    stage: 'introduction',
    progress: 0,
    total: 100,
    message: 'Ready to start data migration'
  }
  private isMigrating: boolean = false
  private reduxData: any = null // Cache for Redux persist data

  constructor() {
    this.backupManager = new BackupManager()
  }

  /**
   * Get backup manager instance for integration with existing backup system
   */
  public getBackupManager(): BackupManager {
    return this.backupManager
  }

  /**
   * Get cached Redux persist data for migration
   */
  public getReduxData(): any {
    return this.reduxData
  }

  /**
   * Set Redux persist data from renderer process
   */
  public setReduxData(data: any): void {
    this.reduxData = data
    logger.info('Redux data cached for migration', {
      dataKeys: data ? Object.keys(data) : [],
      hasData: !!data
    })
  }

  /**
   * Register migration-specific IPC handlers
   * This creates an isolated IPC environment only for migration operations
   */
  public registerMigrationIpcHandlers(): void {
    logger.info('Registering migration-specific IPC handlers')

    // Only register the minimal IPC handlers needed for migration
    ipcMain.handle(IpcChannel.DataMigrate_CheckNeeded, async () => {
      try {
        return await this.isMigrated()
      } catch (error) {
        logger.error('IPC handler error: checkMigrationNeeded', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_ProceedToBackup, async () => {
      try {
        await this.proceedToBackup()
        return true
      } catch (error) {
        logger.error('IPC handler error: proceedToBackup', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_StartMigration, async () => {
      try {
        await this.startMigrationProcess()
        return true
      } catch (error) {
        logger.error('IPC handler error: startMigrationProcess', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_RetryMigration, async () => {
      try {
        await this.retryMigration()
        return true
      } catch (error) {
        logger.error('IPC handler error: retryMigration', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_GetProgress, () => {
      try {
        return this.getCurrentProgress()
      } catch (error) {
        logger.error('IPC handler error: getCurrentProgress', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_Cancel, async () => {
      try {
        return await this.cancelMigration()
      } catch (error) {
        logger.error('IPC handler error: cancelMigration', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_BackupCompleted, async () => {
      try {
        await this.notifyBackupCompleted()
        return true
      } catch (error) {
        logger.error('IPC handler error: notifyBackupCompleted', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_ShowBackupDialog, async () => {
      try {
        logger.info('Opening backup dialog for migration')

        // Update progress to indicate backup dialog is opening
        // await this.updateProgress('backup_progress', 10, 'Opening backup dialog...')

        // Instead of performing backup automatically, let's open the file dialog
        // and let the user choose where to save the backup
        const { dialog } = await import('electron')
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
          await this.updateProgress('backup_progress', 10, 'Creating backup file...')

          // Perform the actual backup to the selected location
          const backupResult = await this.performBackupToFile(result.filePath)

          if (backupResult.success) {
            await this.updateProgress('backup_progress', 100, 'Backup created successfully!')
            // Wait a moment to show the success message, then transition to confirmed state
            setTimeout(async () => {
              await this.updateProgress(
                'backup_confirmed',
                100,
                'Backup completed! Ready to start migration. Click "Start Migration" to continue.'
              )
            }, 1000)
          } else {
            await this.updateProgress('backup_required', 0, `Backup failed: ${backupResult.error}`)
          }

          return backupResult
        } else {
          logger.info('User cancelled backup dialog')
          await this.updateProgress('backup_required', 0, 'Backup cancelled. Please create a backup to continue.')
          return { success: false, error: 'Backup cancelled by user' }
        }
      } catch (error) {
        logger.error('IPC handler error: showBackupDialog', error as Error)
        await this.updateProgress('backup_required', 0, 'Backup process failed')
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_StartFlow, async () => {
      try {
        return await this.startMigrationFlow()
      } catch (error) {
        logger.error('IPC handler error: startMigrationFlow', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_RestartApp, async () => {
      try {
        await this.restartApplication()
        return true
      } catch (error) {
        logger.error('IPC handler error: restartApplication', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_CloseWindow, () => {
      try {
        this.closeMigrateWindow()
        return true
      } catch (error) {
        logger.error('IPC handler error: closeMigrateWindow', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_SendReduxData, (_event, data) => {
      try {
        this.setReduxData(data)
        return { success: true }
      } catch (error) {
        logger.error('IPC handler error: sendReduxData', error as Error)
        throw error
      }
    })

    ipcMain.handle(IpcChannel.DataMigrate_GetReduxData, () => {
      try {
        return this.getReduxData()
      } catch (error) {
        logger.error('IPC handler error: getReduxData', error as Error)
        throw error
      }
    })

    logger.info('Migration IPC handlers registered successfully')
  }

  /**
   * Remove migration-specific IPC handlers
   * Clean up when migration is complete or cancelled
   */
  public unregisterMigrationIpcHandlers(): void {
    logger.info('Unregistering migration-specific IPC handlers')

    try {
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_CheckNeeded)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_GetProgress)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_Cancel)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_BackupCompleted)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_ShowBackupDialog)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_StartFlow)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_ProceedToBackup)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_StartMigration)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_RetryMigration)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_RestartApp)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_CloseWindow)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_SendReduxData)
      ipcMain.removeAllListeners(IpcChannel.DataMigrate_GetReduxData)

      logger.info('Migration IPC handlers unregistered successfully')
    } catch (error) {
      logger.warn('Error unregistering migration IPC handlers', error as Error)
    }
  }

  public static getInstance(): DataRefactorMigrateService {
    if (!DataRefactorMigrateService.instance) {
      DataRefactorMigrateService.instance = new DataRefactorMigrateService()
    }
    return DataRefactorMigrateService.instance
  }

  /**
   * Convenient static method to open test window
   */
  public static openTestWindow(): BrowserWindow {
    const instance = DataRefactorMigrateService.getInstance()
    return instance.createTestWindow()
  }

  /**
   * Check if migration is needed
   */
  async isMigrated(): Promise<boolean> {
    try {
      const isMigrated = await this.isMigrationCompleted()
      if (isMigrated) {
        logger.info('Data Refactor Migration already completed')
        return true
      }

      logger.info('Data Refactor Migration is needed')
      return false
    } catch (error) {
      logger.error('Failed to check migration status', error as Error)
      return false
    }
  }

  /**
   * Check if migration is already completed
   */
  private async isMigrationCompleted(): Promise<boolean> {
    try {
      logger.debug('Checking migration completion status in database')

      // First check if the database is available
      if (!this.db) {
        logger.warn('Database not initialized, assuming migration not completed')
        return false
      }

      const result = await this.db
        .select()
        .from(appStateTable)
        .where(eq(appStateTable.key, DATA_REFACTOR_MIGRATION_STATUS))
        .limit(1)

      logger.debug('Migration status query result', { resultCount: result.length })

      if (result.length === 0) {
        logger.info('No migration status record found, migration needed')
        return false
      }

      const status = result[0].value as DataRefactorMigrationStatus
      const isCompleted = status.completed === true

      logger.info('Migration status found', {
        completed: isCompleted,
        completedAt: status.completedAt,
        version: status.version
      })

      return isCompleted
    } catch (error) {
      logger.error('Failed to check migration state - treating as not completed', error as Error)
      // In case of database errors, assume migration is needed to be safe
      return false
    }
  }

  /**
   * Mark migration as completed
   */
  private async markMigrationCompleted(): Promise<void> {
    try {
      const migrationStatus: DataRefactorMigrationStatus = {
        completed: true,
        completedAt: Date.now(),
        version: electronApp.getVersion()
      }

      await this.db
        .insert(appStateTable)
        .values({
          key: DATA_REFACTOR_MIGRATION_STATUS,
          value: migrationStatus, // drizzle handles JSON serialization automatically
          description: 'Data refactoring migration status from legacy format (ElectronStore + Redux persist) to SQLite',
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
        .onConflictDoUpdate({
          target: appStateTable.key,
          set: {
            value: migrationStatus,
            updatedAt: Date.now()
          }
        })

      logger.info('Migration marked as completed in app_state table', {
        version: migrationStatus.version,
        completedAt: migrationStatus.completedAt
      })
    } catch (error) {
      logger.error('Failed to mark migration as completed', error as Error)
      throw error
    }
  }

  /**
   * Create and show migration window
   */
  private createMigrateWindow(): BrowserWindow {
    if (this.migrateWindow && !this.migrateWindow.isDestroyed()) {
      this.migrateWindow.show()
      return this.migrateWindow
    }

    // Register migration-specific IPC handlers before creating window
    this.registerMigrationIpcHandlers()

    this.migrateWindow = new BrowserWindow({
      width: 640,
      height: 480,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/simplest.js'),
        sandbox: false,
        webSecurity: false,
        contextIsolation: true
      }
    })

    // Load the migration window
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.migrateWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/dataRefactorMigrate.html')
    } else {
      this.migrateWindow.loadFile(join(__dirname, '../renderer/dataRefactorMigrate.html'))
    }

    this.migrateWindow.once('ready-to-show', () => {
      this.migrateWindow?.show()
    })

    this.migrateWindow.on('closed', () => {
      this.migrateWindow = null
      // Clean up IPC handlers when window is closed
      this.unregisterMigrationIpcHandlers()
    })

    logger.info('Migration window created')
    return this.migrateWindow
  }

  /**
   * Show migration window and initialize introduction stage
   */
  async runMigration(): Promise<void> {
    if (this.isMigrating) {
      logger.warn('Migration already in progress')
      this.migrateWindow?.show()
      return
    }

    this.isMigrating = true
    logger.info('Showing migration window')

    // Initialize introduction stage
    await this.updateProgress('introduction', 0, 'Welcome to Cherry Studio data migration')

    // Create migration window
    const window = this.createMigrateWindow()

    // Wait for window to be ready
    await new Promise<void>((resolve) => {
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', () => resolve())
      } else {
        resolve()
      }
    })
  }

  /**
   * Start migration flow - simply ensure we're in introduction stage
   * This is called when user first opens the migration window
   */
  async startMigrationFlow(): Promise<void> {
    if (!this.isMigrating) {
      logger.warn('Migration not started, cannot execute flow.')
      return
    }

    logger.info('Confirming introduction stage for migration flow')
    await this.updateProgress('introduction', 0, 'Ready to begin migration process. Please read the information below.')
  }

  /**
   * Proceed from introduction to backup requirement stage
   * This is called when user clicks "Next" in introduction
   */
  async proceedToBackup(): Promise<void> {
    if (!this.isMigrating) {
      logger.warn('Migration not started, cannot proceed to backup.')
      return
    }

    logger.info('Proceeding from introduction to backup stage')
    await this.updateProgress('backup_required', 0, 'Data backup is required before migration can proceed')
  }

  /**
   * Start the actual migration process
   * This is called when user confirms backup and clicks "Start Migration"
   */
  async startMigrationProcess(): Promise<void> {
    if (!this.isMigrating) {
      logger.warn('Migration not started, cannot start migration process.')
      return
    }

    logger.info('Starting actual migration process')
    try {
      await this.executeMigrationFlow()
    } catch (error) {
      logger.error('Migration process failed', error as Error)
      // error is already handled in executeMigrationFlow
    }
  }

  /**
   * Execute the actual migration process
   * Called after user has confirmed backup completion
   */
  private async executeMigrationFlow(): Promise<void> {
    try {
      // Start migration
      await this.updateProgress('migration', 0, 'Starting data migration...')
      const migrationResult = await this.executeMigration()

      if (!migrationResult.success) {
        throw new Error(migrationResult.error || 'Migration failed')
      }

      await this.updateProgress(
        'migration',
        100,
        `Migration completed: ${migrationResult.migratedCount} items migrated`
      )

      // Mark as completed
      await this.markMigrationCompleted()

      await this.updateProgress('completed', 100, 'Migration completed successfully! Click restart to continue.')
    } catch (error) {
      logger.error('Migration flow failed', error as Error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.updateProgress(
        'error',
        0,
        'Migration failed. You can close this window and try again, or continue using the previous version.',
        errorMessage
      )

      throw error
    }
  }

  /**
   * Perform backup to a specific file location
   */
  private async performBackupToFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('Performing backup to file', { filePath })

      // Get backup data from the current application state
      const backupData = await this.getBackupData()

      // Extract directory and filename from the full path
      const path = await import('path')
      const destinationDir = path.dirname(filePath)
      const fileName = path.basename(filePath)

      // Use the existing backup manager to create a backup
      const backupPath = await this.backupManager.backup(
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

  /**
   * Get backup data from the current application
   * This creates a minimal backup with essential system information
   */
  private async getBackupData(): Promise<string> {
    try {
      const fs = await import('fs-extra')
      const path = await import('path')

      // Gather basic system information
      const data = {
        backup: {
          timestamp: new Date().toISOString(),
          version: electronApp.getVersion(),
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

      // Try to read some basic configuration files (non-critical if they fail)
      try {
        const { getDataPath } = await import('@main/utils')
        const dataPath = getDataPath()

        // Check if there are any config files we should backup
        const configFiles = ['config.json', 'settings.json', 'preferences.json']
        for (const configFile of configFiles) {
          const configPath = path.join(dataPath, configFile)
          if (await fs.pathExists(configPath)) {
            try {
              const configContent = await fs.readJson(configPath)
              data.configs[configFile] = configContent
            } catch (err) {
              logger.warn(`Could not read config file ${configFile}`, err as Error)
            }
          }
        }
      } catch (err) {
        logger.warn('Could not access data directory for config backup', err as Error)
      }

      return JSON.stringify(data, null, 2)
    } catch (error) {
      logger.error('Failed to get backup data:', error as Error)
      throw error
    }
  }

  /**
   * Notify that backup has been completed (called from IPC handler)
   */
  public async notifyBackupCompleted(): Promise<void> {
    logger.info('Backup completed by user')
    await this.updateProgress(
      'backup_confirmed',
      100,
      'Backup completed! Ready to start migration. Click "Start Migration" to continue.'
    )
  }

  /**
   * Execute the actual migration
   */
  private async executeMigration(): Promise<MigrationResult> {
    try {
      logger.info('Executing migration')

      // Create preferences migrator with reference to this service for Redux data access
      const preferencesMigrator = new PreferencesMigrator(this)

      // Execute preferences migration with progress updates
      const result = await preferencesMigrator.migrate((progress, message) => {
        this.updateProgress('migration', progress, message)
      })

      logger.info('Migration execution completed', result)

      return {
        success: result.success,
        migratedCount: result.migratedCount,
        error: result.errors.length > 0 ? result.errors.map((e) => e.error).join('; ') : undefined
      }
    } catch (error) {
      logger.error('Migration execution failed', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        migratedCount: 0
      }
    }
  }

  /**
   * Update migration progress and broadcast to window
   */
  private async updateProgress(
    stage: MigrationStage,
    progress: number,
    message: string,
    error?: string
  ): Promise<void> {
    this.currentProgress = {
      stage,
      progress,
      total: 100,
      message,
      error
    }

    if (this.migrateWindow && !this.migrateWindow.isDestroyed()) {
      this.migrateWindow.webContents.send(IpcChannel.DataMigrateProgress, this.currentProgress)
    }

    logger.debug('Progress updated', this.currentProgress)
  }

  /**
   * Get current migration progress
   */
  getCurrentProgress(): MigrationProgress {
    return this.currentProgress
  }

  /**
   * Cancel migration process
   * Only allowed during introduction and backup phases
   */
  async cancelMigration(): Promise<void> {
    if (!this.isMigrating) {
      return
    }

    const currentStage = this.currentProgress.stage
    if (currentStage === 'migration') {
      logger.warn('Cannot cancel migration during migration process')
      return
    }

    logger.info('Cancelling migration process')
    this.isMigrating = false
    this.closeMigrateWindow()
  }

  /**
   * Retry migration after error
   */
  async retryMigration(): Promise<void> {
    logger.info('Retrying migration process')
    await this.updateProgress(
      'introduction',
      0,
      'Ready to restart migration process. Please read the information below.'
    )
  }

  /**
   * Close migration window
   */
  private closeMigrateWindow(): void {
    if (this.migrateWindow && !this.migrateWindow.isDestroyed()) {
      this.migrateWindow.close()
      this.migrateWindow = null
    }

    this.isMigrating = false
    // Clean up migration-specific IPC handlers
    this.unregisterMigrationIpcHandlers()
  }

  /**
   * Restart the application after successful migration
   */
  private async restartApplication(): Promise<void> {
    try {
      logger.info('Preparing to restart application after migration completion')

      // Ensure migration status is properly saved before restart
      await this.verifyMigrationStatus()

      // Give some time for database operations to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      logger.info('Restarting application now')

      // In development mode, relaunch might not work properly
      if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
        logger.warn('Development mode detected - showing restart instruction instead of auto-restart')

        const { dialog } = await import('electron')
        await dialog.showMessageBox({
          type: 'info',
          title: 'Migration Complete - Restart Required',
          message:
            'Data migration completed successfully!\n\nSince you are in development mode, please manually restart the application to continue.',
          buttons: ['Close App'],
          defaultId: 0
        })

        // Clean up migration window and handlers after showing dialog
        this.closeMigrateWindow()
        app.quit()
      } else {
        // Production mode - clean up first, then relaunch
        this.closeMigrateWindow()
        app.relaunch()
        app.exit(0)
      }
    } catch (error) {
      logger.error('Failed to restart application', error as Error)
      // Update UI to show restart failure and provide manual restart instruction
      await this.updateProgress(
        'error',
        0,
        'Application restart failed. Please manually restart the application to complete migration.',
        error instanceof Error ? error.message : String(error)
      )
      // Fallback: just close migration window and let user manually restart
      this.closeMigrateWindow()
    }
  }

  /**
   * Verify that migration status is properly saved
   */
  private async verifyMigrationStatus(): Promise<void> {
    try {
      const isCompleted = await this.isMigrationCompleted()
      if (isCompleted) {
        logger.info('Migration status verified as completed')
      } else {
        logger.warn('Migration status not found as completed, attempting to mark again')
        await this.markMigrationCompleted()

        // Double-check
        const recheck = await this.isMigrationCompleted()
        if (recheck) {
          logger.info('Migration status successfully marked as completed on retry')
        } else {
          logger.error('Failed to mark migration as completed even on retry')
        }
      }
    } catch (error) {
      logger.error('Failed to verify migration status', error as Error)
      // Don't throw - still allow restart
    }
  }

  /**
   * Create and show test window for testing PreferenceService and usePreference functionality
   */
  public createTestWindow(): BrowserWindow {
    const windowNumber = this.testWindows.length + 1

    const testWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      resizable: true,
      maximizable: true,
      minimizable: true,
      show: false,
      frame: true,
      autoHideMenuBar: true,
      title: `Data Refactor Test Window #${windowNumber} - PreferenceService Testing`,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
        contextIsolation: true
      }
    })

    // Add to test windows array
    this.testWindows.push(testWindow)

    // Load the test window
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      testWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/dataRefactorTest.html')
      // Open DevTools in development mode for easier testing
      testWindow.webContents.openDevTools()
    } else {
      testWindow.loadFile(join(__dirname, '../renderer/dataRefactorTest.html'))
    }

    testWindow.once('ready-to-show', () => {
      testWindow?.show()
      testWindow?.focus()
    })

    testWindow.on('closed', () => {
      // Remove from test windows array when closed
      const index = this.testWindows.indexOf(testWindow)
      if (index > -1) {
        this.testWindows.splice(index, 1)
      }
    })

    logger.info(`Test window #${windowNumber} created for PreferenceService testing`)
    return testWindow
  }

  /**
   * Get test window instance (first one)
   */
  public getTestWindow(): BrowserWindow | null {
    return this.testWindows.length > 0 ? this.testWindows[0] : null
  }

  /**
   * Get all test windows
   */
  public getTestWindows(): BrowserWindow[] {
    return this.testWindows.filter((window) => !window.isDestroyed())
  }

  /**
   * Close all test windows
   */
  public closeTestWindows(): void {
    this.testWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
    this.testWindows = []
    logger.info('All test windows closed')
  }

  /**
   * Close a specific test window
   */
  public closeTestWindow(window?: BrowserWindow): void {
    if (window) {
      if (!window.isDestroyed()) {
        window.close()
      }
    } else {
      // Close first window if no specific window provided
      const firstWindow = this.getTestWindow()
      if (firstWindow && !firstWindow.isDestroyed()) {
        firstWindow.close()
      }
    }
  }

  /**
   * Check if any test windows are open
   */
  public isTestWindowOpen(): boolean {
    return this.testWindows.some((window) => !window.isDestroyed())
  }
}

// Export singleton instance
export const dataRefactorMigrateService = DataRefactorMigrateService.getInstance()
