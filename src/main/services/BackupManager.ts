/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { IpcChannel } from '@shared/IpcChannel'
import type { WebDavConfig } from '@types'
import type { S3Config } from '@types'
import archiver from 'archiver'
import { app } from 'electron'
import * as fs from 'fs-extra'
import StreamZip from 'node-stream-zip'
import * as path from 'path'
import type { CreateDirectoryOptions, FileStat } from 'webdav'

import { getDataPath } from '../utils'
import S3Storage from './S3Storage'
import WebDav from './WebDav'
import { windowService } from './WindowService'

const logger = loggerService.withContext('BackupManager')

class BackupManager {
  private tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup', 'temp')
  private backupDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup')

  // Cached instance to avoid recreating
  private s3Storage: S3Storage | null = null
  private webdavInstance: WebDav | null = null

  // Cached core connection config, used to detect if connection config has changed
  private cachedS3ConnectionConfig: {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    root?: string
  } | null = null

  private cachedWebdavConnectionConfig: {
    webdavHost: string
    webdavUser?: string
    webdavPass?: string
    webdavPath?: string
  } | null = null

  /**
   * Handle backup restoration on app startup
   * Called after window is created but before renderer is loaded
   */
  static async handleStartupRestore(): Promise<void> {
    const userDataPath = app.getPath('userData')

    try {
      const indexedDBRestore = path.join(userDataPath, 'IndexedDB.restore')
      const indexedDBDest = path.join(userDataPath, 'IndexedDB')
      const hasIndexedDBRestore = await fs.pathExists(indexedDBRestore)

      const localStorageRestore = path.join(userDataPath, 'Local Storage.restore')
      const localStorageDest = path.join(userDataPath, 'Local Storage')
      const hasLocalStorageRestore = await fs.pathExists(localStorageRestore)

      const dataRestore = getDataPath() + '.restore'
      const dataDest = getDataPath()
      const hasDataRestore = await fs.pathExists(dataRestore)

      // Restore IndexedDB
      if (hasIndexedDBRestore) {
        logger.info('[handleStartupRestore] Found IndexedDB.restore directories, completing restoration...')
        await fs.remove(indexedDBDest).catch(() => {})
        await fs.rename(indexedDBRestore, indexedDBDest)
      }

      // Restore Local Storage
      if (hasLocalStorageRestore) {
        logger.info('[handleStartupRestore] Found Local Storage.restore directories, completing restoration...')
        await fs.remove(localStorageDest).catch(() => {})
        await fs.rename(localStorageRestore, localStorageDest)
      }

      // Restore Data
      if (hasDataRestore) {
        logger.info('[handleStartupRestore] Found Local Data.restore directories, completing restoration...')
        await fs.remove(dataDest).catch(() => {})
        await fs.rename(dataRestore, dataDest)
      }

      logger.info('[handleStartupRestore] Restoration completed successfully')
    } catch (error) {
      logger.error('[handleStartupRestore] Failed to complete restoration:', error as Error)
    }
  }

  /**
   * Backup metadata for direct backup format (version 6+)
   */
  private createDirectBackupMetadata(): {
    version: number
    timestamp: number
    appName: string
    appVersion: string
    platform: string
    arch: string
  } {
    return {
      version: 6,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    }
  }

  /**
   * Direct backup method - copies IndexedDB and Local Storage directories directly.
   * No JSON serialization, better performance for large databases.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @param skipBackupFile - Whether to skip backing up the Data directory
   * @returns Path to the created backup file
   */
  async backup(
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    destinationPath: string = this.backupDir,
    skipBackupFile: boolean = false
  ): Promise<string> {
    const onProgress = this.onProgress(IpcChannel.BackupProgress, true)

    try {
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      const userDataPath = app.getPath('userData')
      let currentProgress = 10

      // Step 2: Copy IndexedDB and Local Storage directories
      onProgress({ stage: 'copying_database', progress: 15, total: 100 })
      logger.debug('[backupDirect] Copying database directories...')

      const indexedDBSource = path.join(userDataPath, 'IndexedDB')
      const indexedDBDest = path.join(this.tempDir, 'IndexedDB')
      if (await fs.pathExists(indexedDBSource)) {
        await fs.copy(indexedDBSource, indexedDBDest)
      } else {
        logger.debug('[backupDirect] IndexedDB directory not found, skipping')
      }

      const localStorageSource = path.join(userDataPath, 'Local Storage')
      const localStorageDest = path.join(this.tempDir, 'Local Storage')
      if (await fs.pathExists(localStorageSource)) {
        await fs.copy(localStorageSource, localStorageDest)
      } else {
        logger.debug('[backupDirect] Local Storage directory not found, skipping')
      }

      currentProgress = 50
      onProgress({ stage: 'copying_database', progress: currentProgress, total: 100 })

      // Step 3: Write metadata.json
      const metadata = this.createDirectBackupMetadata()
      await fs.writeJson(path.join(this.tempDir, 'metadata.json'), metadata, { spaces: 2 })
      onProgress({ stage: 'copying_database', progress: 52, total: 100 })

      // Step 4: Copy Data directory (if not skipped)
      if (!skipBackupFile) {
        const sourcePath = path.join(userDataPath, 'Data')
        const tempDataDir = path.join(this.tempDir, 'Data')

        if (await fs.pathExists(sourcePath)) {
          const totalSize = await this.getDirSize(sourcePath)
          let copiedSize = 0

          await this.copyDirWithProgress(sourcePath, tempDataDir, (size) => {
            copiedSize += size
            const progress = Math.min(80, 52 + Math.floor((copiedSize / totalSize) * 28))
            onProgress({ stage: 'copying_files', progress, total: 100 })
          })
        }
      } else {
        logger.debug('[backupDirect] Skip the backup of the file')
        await fs.promises.mkdir(path.join(this.tempDir, 'Data'))
      }
      onProgress({ stage: 'compressing', progress: 80, total: 100 })

      // Step 5: Create ZIP archive
      const backupedFilePath = path.join(destinationPath, fileName)
      const output = fs.createWriteStream(backupedFilePath)
      const archive = archiver('zip', {
        zlib: { level: 0 }, // No compression - data is already compressed by LevelDB
        zip64: true
      })

      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve())
        archive.on('error', reject)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            logger.warn('[backupDirect] Archive warning:', err)
          }
        })
        archive.pipe(output)
        archive.directory(this.tempDir, false)
        archive.finalize()
      })

      // Clean up temp directory
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      logger.info('[backupDirect] Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[backupDirect] Backup failed:', error as Error)
      await fs.remove(this.tempDir).catch(() => {})

      throw error
    }
  }

  /**
   * Legacy backup method (JSON format, used by LanTransfer)
   * Creates a backup in the old format with data.json and optional Data directory.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param data - JSON string data to backup
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @param skipBackupFile - Whether to skip backing up the Data directory
   * @returns Path to the created backup file
   */
  async backupLegacy(
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    data: string,
    destinationPath: string = this.backupDir,
    skipBackupFile: boolean = false
  ): Promise<string> {
    const onProgress = this.onProgress(IpcChannel.BackupProgress, true)

    try {
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      // Write data.json using streaming
      const tempDataPath = path.join(this.tempDir, 'data.json')

      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(tempDataPath)
        writeStream.write(data)
        writeStream.end()

        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      onProgress({ stage: 'writing_data', progress: 20, total: 100 })

      logger.debug(`BackupManager IPC, skipBackupFile: ${skipBackupFile}`)

      if (!skipBackupFile) {
        // Copy Data directory to temp directory
        const sourcePath = path.join(app.getPath('userData'), 'Data')
        const tempDataDir = path.join(this.tempDir, 'Data')

        // Get total size of source directory
        const totalSize = await this.getDirSize(sourcePath)
        let copiedSize = 0

        // Use streaming copy
        await this.copyDirWithProgress(sourcePath, tempDataDir, (size) => {
          copiedSize += size
          const progress = Math.min(50, Math.floor((copiedSize / totalSize) * 50))
          onProgress({ stage: 'copying_files', progress, total: 100 })
        })

        onProgress({ stage: 'preparing_compression', progress: 50, total: 100 })
      } else {
        logger.debug('Skip the backup of the file')
        await fs.promises.mkdir(path.join(this.tempDir, 'Data')) // Creating empty Data dir is required, otherwise restore will fail
      }

      // Create output file stream
      const backupedFilePath = path.join(destinationPath, fileName)
      const output = fs.createWriteStream(backupedFilePath)

      // Create archiver instance, enable ZIP64 support
      const archive = archiver('zip', {
        zlib: { level: 1 }, // Use lowest compression level for speed
        zip64: true // Enable ZIP64 support for large files
      })

      let lastProgress = 50
      let totalEntries = 0
      let processedEntries = 0
      let totalBytes = 0
      let processedBytes = 0

      // First calculate total files and size, but don't log details
      const calculateTotals = async (dirPath: string) => {
        try {
          const items = await fs.readdir(dirPath, { withFileTypes: true })
          for (const item of items) {
            const fullPath = path.join(dirPath, item.name)
            if (item.isDirectory()) {
              await calculateTotals(fullPath)
            } else {
              totalEntries++
              const stats = await fs.stat(fullPath)
              totalBytes += stats.size
            }
          }
        } catch (error) {
          // Only log on error
          logger.error('[BackupManager] Error calculating totals:', error as Error)
        }
      }

      await calculateTotals(this.tempDir)

      // Listen for file entry events
      archive.on('entry', () => {
        processedEntries++
        if (totalEntries > 0) {
          const progressPercent = Math.min(55, 50 + Math.floor((processedEntries / totalEntries) * 5))
          if (progressPercent > lastProgress) {
            lastProgress = progressPercent
            onProgress({ stage: 'compressing', progress: progressPercent, total: 100 })
          }
        }
      })

      // Listen for data write events
      archive.on('data', (chunk) => {
        processedBytes += chunk.length
        if (totalBytes > 0) {
          const progressPercent = Math.min(99, 55 + Math.floor((processedBytes / totalBytes) * 44))
          if (progressPercent > lastProgress) {
            lastProgress = progressPercent
            onProgress({ stage: 'compressing', progress: progressPercent, total: 100 })
          }
        }
      })

      // Use Promise to wait for compression to complete
      await new Promise<void>((resolve, reject) => {
        output.on('close', () => {
          onProgress({ stage: 'compressing', progress: 100, total: 100 })
          resolve()
        })
        archive.on('error', reject)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            logger.warn('[BackupManager] Archive warning:', err)
          }
        })

        // Pipe output stream to archiver
        archive.pipe(output)

        // Add entire temp directory to archive
        archive.directory(this.tempDir, false)

        // Finalize compression
        archive.finalize()
      })

      // Clean up temp directory
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      logger.info('Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[BackupManager] Backup failed:', error as Error)
      // Ensure temp directory is cleaned up
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  /**
   * Direct backup to local directory
   * Creates a backup and saves it to a local directory.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param localConfig - Local backup configuration (directory path and options)
   * @returns Path to the created backup file
   */
  async backupToLocalDir(
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    localConfig: { localBackupDir?: string; skipBackupFile?: boolean }
  ) {
    try {
      const backupDir = localConfig.localBackupDir || this.backupDir
      await fs.ensureDir(backupDir)
      return await this.backup(_, fileName, backupDir, localConfig.skipBackupFile)
    } catch (error) {
      logger.error('[backupToLocalDir] Local backup failed:', error as Error)
      throw error
    }
  }

  /**
   * Direct backup to WebDAV
   * Creates a backup and uploads it to a WebDAV server.
   * @param _ - Electron IPC event
   * @param webdavConfig - WebDAV configuration including server URL, credentials, and options
   * @returns Result from WebDAV upload operation
   */
  async backupToWebdav(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
    const backupedFilePath = await this.backup(_, filename, undefined, webdavConfig.skipBackupFile)
    const webdavClient = this.getWebDavInstance(webdavConfig)
    try {
      let result
      if (webdavConfig.disableStream) {
        const fileContent = await fs.readFile(backupedFilePath)
        result = await webdavClient.putFileContents(filename, fileContent, { overwrite: true })
      } else {
        const contentLength = (await fs.stat(backupedFilePath)).size
        result = await webdavClient.putFileContents(filename, fs.createReadStream(backupedFilePath), {
          overwrite: true,
          contentLength
        })
      }
      await fs.remove(backupedFilePath)
      return result
    } catch (error) {
      await fs.remove(backupedFilePath).catch(() => {})
      throw error
    }
  }

  /**
   * Direct backup to S3
   * Creates a backup and uploads it to an S3-compatible storage.
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration including endpoint, bucket, credentials, and options
   * @returns Result from S3 upload operation
   */
  async backupToS3(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    const os = require('os')
    const deviceName = os.hostname ? os.hostname() : 'device'
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14)
    const filename = s3Config.fileName || `cherry-studio.backup.${deviceName}.${timestamp}.zip`

    logger.debug(`[backupToS3] Starting S3 backup to ${filename}`)

    const backupedFilePath = await this.backup(_, filename, undefined, s3Config.skipBackupFile)
    const s3Client = this.getS3Storage(s3Config)
    try {
      const fileBuffer = await fs.promises.readFile(backupedFilePath)
      const result = await s3Client.putFileContents(filename, fileBuffer)
      await fs.remove(backupedFilePath)
      logger.info(`S3 backup completed: ${filename}`)
      return result
    } catch (error) {
      logger.error('[backupToS3] S3 backup failed:', error as Error)
      await fs.remove(backupedFilePath)
      throw error
    }
  }

  /**
   * Restore from a backup file
   * Automatically detects backup format (direct v6+ or legacy) and restores accordingly.
   * For direct backup: replaces IndexedDB and Local Storage directories, then relaunches app.
   * For legacy backup: restores data from data.json and Data directory.
   * @param _ - Electron IPC event
   * @param backupPath - Path to the backup ZIP file
   * @returns For legacy backup: the data string from data.json. For direct backup: void (app will relaunch)
   */
  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<string | void> {
    const onProgress = this.onProgress(IpcChannel.RestoreProgress, true)

    try {
      // Create temp directory
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      logger.debug(`step 1: unzip backup file: ${this.tempDir}`)

      const zip = new StreamZip.async({ file: backupPath })
      onProgress({ stage: 'extracting', progress: 15, total: 100 })
      await zip.extract(null, this.tempDir)
      onProgress({ stage: 'extracted', progress: 20, total: 100 })

      // Check for backup type: direct (version 6+) or legacy (version <= 5)
      const metadataPath = path.join(this.tempDir, 'metadata.json')
      const isDirectBackup = await fs.pathExists(metadataPath)

      if (isDirectBackup) {
        // Direct backup format (version 6+)
        logger.debug('Detected direct backup format (version 6+)')
        await fs.remove(this.tempDir).catch(() => {}) // Clean up before restoreDirect creates its own temp
        await this.restoreDirect()
        // Direct restore doesn't return data - app needs to relaunch
        return
      }

      // Legacy backup format (version <= 5)
      logger.debug('Detected legacy backup format (version <= 5)')

      const data = await this.restoreLegacy()

      return data
    } catch (error) {
      logger.error('Restore failed:', error as Error)
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  /**
   * Restore from direct backup format (version 6+)
   * Directly replaces IndexedDB and Local Storage directories.
   * On Windows, uses .restore suffix to avoid file lock issues - handled on next startup.
   */
  private async restoreDirect(): Promise<void> {
    const onProgress = this.onProgress(IpcChannel.RestoreProgress, true)

    try {
      // Read and validate metadata
      const metadataPath = path.join(this.tempDir, 'metadata.json')
      const metadata = await fs.readJson(metadataPath)

      // Warn about cross-platform restore
      if (metadata.platform && metadata.platform !== process.platform) {
        logger.warn(
          `[restoreDirect] Cross-platform restore: backup from ${metadata.platform}, current is ${process.platform}`
        )
      }

      onProgress({ stage: 'validating', progress: 25, total: 100 })

      onProgress({ stage: 'restoring_database', progress: 30, total: 100 })

      const userDataPath = app.getPath('userData')

      // Restore IndexedDB and Local Storage
      // On Windows, use .restore suffix to avoid file lock issues - handled on next startup
      // On macOS/Linux, use direct replacement
      const restoreSuffix = isWin ? '.restore' : ''

      // IndexedDB & Local Storage Path
      const indexedDBSource = path.join(this.tempDir, 'IndexedDB')
      const indexedDBDest = path.join(userDataPath, 'IndexedDB' + restoreSuffix)
      const localStorageSource = path.join(this.tempDir, 'Local Storage')
      const localStorageDest = path.join(userDataPath, 'Local Storage' + restoreSuffix)

      logger.debug('[restoreDirect] Restoring database directories...')

      // Windows: copy to .restore suffix directories (swap happens on next startup)
      // macOS/Linux: copy directly to target directories
      // Always remove target directory first to ensure clean overwrite
      if (await fs.pathExists(indexedDBSource)) {
        await fs.remove(indexedDBDest).catch(() => {})
        await fs.copy(indexedDBSource, indexedDBDest)
      }

      if (await fs.pathExists(localStorageSource)) {
        await fs.remove(localStorageDest).catch(() => {})
        await fs.copy(localStorageSource, localStorageDest)
      }

      onProgress({ stage: 'restoring_database', progress: 65, total: 100 })

      //  Restore Data directory
      const dataSource = path.join(this.tempDir, 'Data')
      const dataDest = path.join(getDataPath(), restoreSuffix)
      const dataExists = await fs.pathExists(dataSource)
      const dataFiles = dataExists ? await fs.readdir(dataSource) : []

      if (dataExists && dataFiles.length > 0) {
        logger.debug('[restoreDirect] Restoring Data directory...')

        const totalSize = await this.getDirSize(dataSource)
        let copiedSize = 0

        await fs.remove(dataDest)

        await this.copyDirWithProgress(dataSource, dataDest, (size) => {
          copiedSize += size
          const progress = Math.min(95, 65 + Math.floor((copiedSize / totalSize) * 30))
          onProgress({ stage: 'restoring_data', progress, total: 100 })
        })
      } else {
        logger.debug('[restoreDirect] No Data directory to restore')
      }

      // Clean up
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      logger.info('[restoreDirect] Restore completed successfully, relaunching app...')

      // Relaunch app to load restored data
      app.relaunch()
      app.exit(0)
    } catch (error) {
      logger.error('[restoreDirect] Restore failed:', error as Error)
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  /**
   * Restore from legacy backup format (version <= 5)
   * Restores data from data.json and Data directory.
   * @param onProgress - Callback function to report restore progress
   * @returns The data string read from data.json
   */
  private async restoreLegacy(): Promise<string> {
    const onProgress = this.onProgress(IpcChannel.RestoreProgress, false)

    try {
      logger.debug('[restoreLegacy] read data.json')

      // Read data.json
      const dataPath = path.join(this.tempDir, 'data.json')
      const data = await fs.readFile(dataPath, 'utf-8')
      onProgress({ stage: 'reading_data', progress: 35, total: 100 })

      logger.debug('[restoreLegacy] restore Data directory')

      // Restore Data directory
      const restoreSuffix = isWin ? '.restore' : ''
      const dataSourcePath = path.join(this.tempDir, 'Data')
      const dataDestPath = path.join(getDataPath(), restoreSuffix)

      const dataExists = await fs.pathExists(dataSourcePath)
      const dataFiles = dataExists ? await fs.readdir(dataSourcePath) : []

      if (dataExists && dataFiles.length > 0) {
        // Get total size of source directory
        const dataTotalSize = await this.getDirSize(dataSourcePath)
        let copiedSize = 0

        await fs.remove(dataDestPath)

        // Use streaming copy
        await this.copyDirWithProgress(dataSourcePath, dataDestPath, (size) => {
          copiedSize += size
          const progress = Math.min(85, 35 + Math.floor((copiedSize / dataTotalSize) * 50))
          onProgress({ stage: 'copying_files', progress, total: 100 })
        })
      } else {
        logger.debug('[restoreLegacy] skipBackupFile is true, skip restoring Data directory')
      }

      // Clean up temp directory
      logger.debug('[restoreLegacy] clean up temp directory')
      await fs.remove(this.tempDir)

      onProgress({ stage: 'completed', progress: 100, total: 100 })

      logger.info('[restoreLegacy] Restore completed successfully')

      return data
    } catch (error) {
      logger.error('[restoreLegacy] Restore failed:', error as Error)
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  /**
   * Restore from a local backup file
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param localBackupDir - Directory where the backup file is located
   * @returns Result from restore operation
   */
  async restoreFromLocalBackup(_: Electron.IpcMainInvokeEvent, fileName: string, localBackupDir: string) {
    try {
      const backupDir = localBackupDir
      const backupPath = path.join(backupDir, fileName)

      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`)
      }

      return await this.restore(_, backupPath)
    } catch (error) {
      logger.error('[BackupManager] Local restore failed:', error as Error)
      throw error
    }
  }

  /**
   * Restore from a WebDAV backup
   * Downloads the backup file from WebDAV server and restores it.
   * @param _ - Electron IPC event
   * @param webdavConfig - WebDAV configuration including server URL, credentials, and file name
   * @returns Result from restore operation
   */
  async restoreFromWebdav(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
    const webdavClient = this.getWebDavInstance(webdavConfig)
    try {
      const retrievedFile = await webdavClient.getFileContents(filename)
      const backupedFilePath = path.join(this.backupDir, filename)

      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true })
      }

      // Write file using streaming
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(backupedFilePath)
        writeStream.write(retrievedFile as Buffer)
        writeStream.end()

        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      return await this.restore(_, backupedFilePath)
    } catch (error: any) {
      logger.error('Failed to restore from WebDAV:', error)
      throw new Error(error.message || 'Failed to restore backup file')
    }
  }

  /**
   * Restore from an S3 backup
   * Downloads the backup file from S3 storage and restores it.
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration including bucket, credentials, and file name
   * @returns Result from restore operation
   */
  async restoreFromS3(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    const filename = s3Config.fileName || 'cherry-studio.backup.zip'

    logger.debug(`Starting restore from S3: ${filename}`)

    const s3Client = this.getS3Storage(s3Config)
    try {
      const retrievedFile = await s3Client.getFileContents(filename)
      const backupedFilePath = path.join(this.backupDir, filename)
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true })
      }
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(backupedFilePath)
        writeStream.write(retrievedFile as Buffer)
        writeStream.end()
        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      logger.info(`S3 restore file downloaded successfully: ${filename}`)
      return await this.restore(_, backupedFilePath)
    } catch (error: any) {
      logger.error('[BackupManager] Failed to restore from S3:', error)
      throw new Error(error.message || 'Failed to restore backup file')
    }
  }

  // ==================== File Utility Methods ====================
  // These are helper methods for file operations like size calculation,
  // directory copying with progress, and permission management.

  /**
   * Create a progress callback that sends IPC message and optionally logs.
   * copying_files stage is never logged as it generates too many logs.
   */
  private onProgress = (channel: IpcChannel, shouldLog: boolean) => {
    return (processData: { stage: string; progress: number; total: number }) => {
      const mainWindow = windowService.getMainWindow()
      mainWindow?.webContents.send(channel, processData)
      // Never log copying_files as it generates too many log entries
      if (shouldLog && processData.stage !== 'copying_files') {
        logger.info('Backup progress', processData)
      }
    }
  }

  /**
   * Calculate total size of a directory recursively
   * @param dirPath - Directory path to calculate size
   * @returns Total size in bytes
   */
  private async getDirSize(dirPath: string): Promise<number> {
    let size = 0
    const items = await fs.readdir(dirPath, { withFileTypes: true })

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        size += await this.getDirSize(fullPath)
      } else {
        const stats = await fs.stat(fullPath)
        size += stats.size
      }
    }
    return size
  }

  /**
   * Create a empty restore data path, it will be reset after app relaunch
   */
  public async resetData() {
    if (!isWin) {
      return await fs.remove(getDataPath()).catch(() => {})
    }

    const dataRestorePath = getDataPath() + '.restore'
    await fs.remove(dataRestorePath).catch(() => {})
    await fs.ensureDir(dataRestorePath)
  }

  /**
   * Deep compare two WebDAV config objects for equality
   * Only compares core fields that affect client connection, ignores volatile fields like fileName
   * @param cachedConfig - The cached WebDAV configuration
   * @param config - The new WebDAV configuration to compare
   * @returns True if the configs are equal (connection-related fields only)
   */
  private isWebDavConfigEqual(cachedConfig: typeof this.cachedWebdavConnectionConfig, config: WebDavConfig): boolean {
    if (!cachedConfig) return false

    return (
      cachedConfig.webdavHost === config.webdavHost &&
      cachedConfig.webdavUser === config.webdavUser &&
      cachedConfig.webdavPass === config.webdavPass &&
      cachedConfig.webdavPath === config.webdavPath
    )
  }

  /**
   * Get WebDav instance, reuses existing instance if connection config hasn't changed
   * Note: Only connection-related config changes will recreate the instance
   * Other config changes don't affect instance reuse
   * @param config - WebDAV configuration
   * @returns WebDav instance
   */
  private getWebDavInstance(config: WebDavConfig): WebDav {
    // Check if core connection config has changed
    const configChanged = !this.isWebDavConfigEqual(this.cachedWebdavConnectionConfig, config)

    if (configChanged || !this.webdavInstance) {
      this.webdavInstance = new WebDav(config)
      // Only cache connection-related config fields
      this.cachedWebdavConnectionConfig = {
        webdavHost: config.webdavHost,
        webdavUser: config.webdavUser,
        webdavPass: config.webdavPass,
        webdavPath: config.webdavPath
      }
      logger.debug('[BackupManager] Created new WebDav instance')
    } else {
      logger.debug('[BackupManager] Reusing existing WebDav instance')
    }

    return this.webdavInstance
  }

  // ==================== WebDAV Methods ====================
  // These methods handle backup operations with WebDAV servers.

  /**
   * List backup files on WebDAV server
   * @param _ - Electron IPC event
   * @param config - WebDAV configuration
   * @returns Array of backup file info (name, modified time, size), sorted by newest first
   */
  listWebdavFiles = async (_: Electron.IpcMainInvokeEvent, config: WebDavConfig) => {
    try {
      const client = this.getWebDavInstance(config)
      const response = await client.getDirectoryContents()
      const files = Array.isArray(response) ? response : response.data

      return files
        .filter((file: FileStat) => file.type === 'file' && file.basename.endsWith('.zip'))
        .map((file: FileStat) => ({
          fileName: file.basename,
          modifiedTime: file.lastmod,
          size: file.size
        }))
        .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error: any) {
      logger.error('Failed to list WebDAV files:', error)
      throw new Error(error.message || 'Failed to list backup files')
    }
  }

  /**
   * Copy directory with progress reporting
   * Recursively copies files from source to destination while reporting progress
   * @param source - Source directory path
   * @param destination - Destination directory path
   * @param onProgress - Callback function called with size of each copied file
   */
  private async copyDirWithProgress(
    source: string,
    destination: string,
    onProgress: (size: number) => void
  ): Promise<void> {
    // First count total files
    let totalFiles = 0
    let processedFiles = 0
    let lastProgressReported = 0

    // Calculate total file count
    const countFiles = async (dir: string): Promise<number> => {
      let count = 0
      const items = await fs.readdir(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory()) {
          count += await countFiles(path.join(dir, item.name))
        } else {
          count++
        }
      }
      return count
    }

    totalFiles = await countFiles(source)

    // Copy files and update progress
    const copyDir = async (src: string, dest: string): Promise<void> => {
      const items = await fs.readdir(src, { withFileTypes: true })

      for (const item of items) {
        const sourcePath = path.join(src, item.name)
        const destPath = path.join(dest, item.name)

        if (item.isDirectory()) {
          await fs.ensureDir(destPath)
          await copyDir(sourcePath, destPath)
        } else {
          const stats = await fs.stat(sourcePath)
          await fs.copy(sourcePath, destPath)
          processedFiles++

          // Only report progress when change exceeds 5%
          const currentProgress = Math.floor((processedFiles / totalFiles) * 100)
          if (currentProgress - lastProgressReported >= 5 || processedFiles === totalFiles) {
            lastProgressReported = currentProgress
            onProgress(stats.size)
          }
        }
      }
    }

    await copyDir(source, destination)
  }

  /**
   * Check WebDAV connection
   * @param _ - Electron IPC event
   * @param webdavConfig - WebDAV configuration to test
   * @returns True if connection is successful
   */
  async checkConnection(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const webdavClient = this.getWebDavInstance(webdavConfig)
    return await webdavClient.checkConnection()
  }

  /**
   * Create a directory on WebDAV server
   * @param _ - Electron IPC event
   * @param webdavConfig - WebDAV configuration
   * @param path - Directory path to create
   * @param options - Optional directory creation options
   * @returns Result from WebDAV operation
   */
  async createDirectory(
    _: Electron.IpcMainInvokeEvent,
    webdavConfig: WebDavConfig,
    path: string,
    options?: CreateDirectoryOptions
  ) {
    const webdavClient = this.getWebDavInstance(webdavConfig)
    return await webdavClient.createDirectory(path, options)
  }

  /**
   * Delete a backup file from WebDAV server
   * @param _ - Electron IPC event
   * @param fileName - Name of the file to delete
   * @param webdavConfig - WebDAV configuration
   * @returns Result from WebDAV operation
   */
  async deleteWebdavFile(_: Electron.IpcMainInvokeEvent, fileName: string, webdavConfig: WebDavConfig) {
    try {
      const webdavClient = this.getWebDavInstance(webdavConfig)
      return await webdavClient.deleteFile(fileName)
    } catch (error: any) {
      logger.error('Failed to delete WebDAV file:', error)
      throw new Error(error.message || 'Failed to delete backup file')
    }
  }

  // ==================== Local Backup Methods ====================
  // These methods handle backup operations with local directories.

  /**
   * List backup files in a local directory
   * @param _ - Electron IPC event
   * @param localBackupDir - Directory to list backup files from
   * @returns Array of backup file info (name, modified time, size), sorted by newest first
   */
  async listLocalBackupFiles(_: Electron.IpcMainInvokeEvent, localBackupDir: string) {
    try {
      const files = await fs.readdir(localBackupDir)
      const result: Array<{ fileName: string; modifiedTime: string; size: number }> = []

      for (const file of files) {
        const filePath = path.join(localBackupDir, file)
        const stat = await fs.stat(filePath)

        if (stat.isFile() && file.endsWith('.zip')) {
          result.push({
            fileName: file,
            modifiedTime: stat.mtime.toISOString(),
            size: stat.size
          })
        }
      }

      // Sort by modified time, newest first
      return result.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error) {
      logger.error('[BackupManager] List local backup files failed:', error as Error)
      throw error
    }
  }

  /**
   * Delete a local backup file
   * @param _ - Electron IPC event
   * @param fileName - Name of the file to delete
   * @param localBackupDir - Directory where the backup file is located
   * @returns True if deletion was successful
   */
  async deleteLocalBackupFile(_: Electron.IpcMainInvokeEvent, fileName: string, localBackupDir: string) {
    try {
      const filePath = path.join(localBackupDir, fileName)

      if (!fs.existsSync(filePath)) {
        throw new Error(`Backup file not found: ${filePath}`)
      }

      await fs.remove(filePath)
      return true
    } catch (error) {
      logger.error('[BackupManager] Delete local backup file failed:', error as Error)
      throw error
    }
  }

  // ==================== Legacy & Temp Methods ====================
  // These methods are for legacy backup format and temporary file operations.

  /**
   * Create a legacy backup
   * Creates a lightweight backup (skipBackupFile=true) in the temp directory
   * Returns the path to the created ZIP file
   * @param data - JSON string data to backup
   * @param destinationPath - Path to save the backup
   */
  async createLanTransferBackup(
    _: Electron.IpcMainInvokeEvent,
    data: string,
    destinationPath?: string
  ): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 12)

    const fileName = `cherry-studio.${timestamp}.zip`
    const tempPath = path.join(app.getPath('temp'), 'cherry-studio', 'lan-transfer')
    const targetPath = destinationPath || tempPath

    // Ensure temp directory exists
    await fs.ensureDir(targetPath)

    // Create backup with skipBackupFile=true (no Data folder)
    const backupedFilePath = await this.backupLegacy(_, fileName, data, targetPath, true)

    logger.info(`[BackupManager] Created LAN transfer backup at: ${backupedFilePath}`)

    return backupedFilePath
  }

  /**
   * Delete a temporary backup file after LAN transfer completes
   */
  async deleteLanTransferBackup(_: Electron.IpcMainInvokeEvent, filePath: string): Promise<boolean> {
    try {
      // Security check: only allow deletion within temp directory
      const tempBase = path.normalize(path.join(app.getPath('temp'), 'cherry-studio', 'lan-transfer'))
      const resolvedPath = path.normalize(path.resolve(filePath))

      // Use normalized paths with trailing separator to prevent prefix attacks (e.g., /temp-evil)
      if (!resolvedPath.startsWith(tempBase + path.sep) && resolvedPath !== tempBase) {
        logger.warn(`[BackupManager] Attempted to delete file outside temp directory: ${filePath}`)
        return false
      }

      if (await fs.pathExists(resolvedPath)) {
        await fs.remove(resolvedPath)
        logger.info(`[BackupManager] Deleted temp backup: ${resolvedPath}`)
        return true
      }
      return false
    } catch (error) {
      logger.error('[BackupManager] Failed to delete temp backup:', error as Error)
      return false
    }
  }

  // ==================== S3 Methods ====================
  // These methods handle backup operations with S3-compatible storage.

  /**
   * Get S3Storage instance, reuses existing instance if connection config hasn't changed
   * Note: Only connection-related config changes will recreate the instance
   * Other config changes don't affect instance reuse
   * @param config - S3 configuration
   * @returns S3Storage instance
   */
  private getS3Storage(config: S3Config): S3Storage {
    // Check if core connection config has changed
    const configChanged = !this.isS3ConfigEqual(this.cachedS3ConnectionConfig, config)

    if (configChanged || !this.s3Storage) {
      this.s3Storage = new S3Storage(config)
      // Only cache connection-related config fields
      this.cachedS3ConnectionConfig = {
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        root: config.root
      }
      logger.debug('[BackupManager] Created new S3Storage instance')
    } else {
      logger.debug('[BackupManager] Reusing existing S3Storage instance')
    }

    return this.s3Storage
  }

  /**
   * Compare two S3 config objects for equality
   * Only compares core fields that affect client connection, ignores volatile fields like fileName
   * @param cachedConfig - The cached S3 configuration
   * @param config - The new S3 configuration to compare
   * @returns True if the configs are equal (connection-related fields only)
   */
  private isS3ConfigEqual(cachedConfig: typeof this.cachedS3ConnectionConfig, config: S3Config): boolean {
    if (!cachedConfig) return false

    return (
      cachedConfig.endpoint === config.endpoint &&
      cachedConfig.region === config.region &&
      cachedConfig.bucket === config.bucket &&
      cachedConfig.accessKeyId === config.accessKeyId &&
      cachedConfig.secretAccessKey === config.secretAccessKey &&
      cachedConfig.root === config.root
    )
  }

  /**
   * Check S3 connection
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration to test
   * @returns True if connection is successful
   */
  async checkS3Connection(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    const s3Client = this.getS3Storage(s3Config)
    return await s3Client.checkConnection()
  }

  /**
   * List backup files in S3 storage
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration
   * @returns Array of backup file info (name, modified time, size), sorted by newest first
   */
  listS3Files = async (_: Electron.IpcMainInvokeEvent, s3Config: S3Config) => {
    try {
      const s3Client = this.getS3Storage(s3Config)

      const objects = await s3Client.listFiles()
      const files = objects
        .filter((obj) => obj.key.endsWith('.zip'))
        .map((obj) => {
          const segments = obj.key.split('/')
          const fileName = segments[segments.length - 1]
          return {
            fileName,
            modifiedTime: obj.lastModified || '',
            size: obj.size
          }
        })

      return files.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error: any) {
      logger.error('Failed to list S3 files:', error)
      throw new Error(error.message || 'Failed to list backup files')
    }
  }

  /**
   * Delete a backup file from S3 storage
   * @param _ - Electron IPC event
   * @param fileName - Name of the file to delete
   * @param s3Config - S3 configuration
   * @returns Result from S3 operation
   */
  async deleteS3File(_: Electron.IpcMainInvokeEvent, fileName: string, s3Config: S3Config) {
    try {
      const s3Client = this.getS3Storage(s3Config)
      return await s3Client.deleteFile(fileName)
    } catch (error: any) {
      logger.error('Failed to delete S3 file:', error)
      throw new Error(error.message || 'Failed to delete backup file')
    }
  }
}

export { BackupManager }

export default BackupManager
