/**
 * @deprecated LEGACY v1 CODE — removed when the v2 migration is dropped.
 * --------------------------------------------------------------------------
 * This is v1's BackupManager, retained only as the compatibility transport
 * surface for existing local/WebDAV/S3 settings and the offline LAN handoff.
 * Normal archives and restores delegate to BackupService; only LAN's separate
 * data.json protocol still uses the legacy ZIP helper below.
 *
 * Rules:
 * - No unrelated v2 features or refactors.
 * - Do NOT rename the `BackupManager` class, its exports, or the logger
 *   context. The filename is intentionally `LegacyBackupManager.ts` while the
 *   class stays `BackupManager`, so this file remains a drop-in mirror of v1.
 * - When re-syncing from v1, preserve the BackupService delegation boundary.
 * --------------------------------------------------------------------------
 */
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { IdleTimeoutController } from '@main/utils/IdleTimeoutController'
import { isPathInside, resolveAndValidatePath } from '@main/utils/legacyFile'
import { getDeviceType, getHostname } from '@main/utils/system'
import { IpcChannel } from '@shared/IpcChannel'
import type { LocalBackupConfig, S3Config, WebDavConfig } from '@shared/types/backup'
import { ZipArchive } from 'archiver'
import { Mutex, tryAcquire } from 'async-mutex'
import dayjs from 'dayjs'
import * as fs from 'fs-extra'
import * as path from 'path'
import type { CreateDirectoryOptions, FileStat } from 'webdav'

import S3Storage from './S3Storage'
import WebDav from './WebDav'

const logger = loggerService.withContext('BackupManager')
const REMOTE_UPLOAD_IDLE_TIMEOUT_MS = 5 * 60_000
const STALE_TEMP_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000
const BACKUP_OPERATION_DIR_PATTERN =
  /^(?:create|lan-create|extract|webdav-download|s3-download)-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const BACKUP_TEMP_ARCHIVE_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-.+\.zip$/i
const WINDOWS_UV_EBUSY_ERRNO = -4082

const isSkippableLevelDbLockError = (sourcePath: string, error: unknown): error is NodeJS.ErrnoException => {
  const parentDirectory = path.basename(path.dirname(sourcePath)).toLowerCase()
  const isLevelDbDirectory = parentDirectory === 'leveldb' || parentDirectory.endsWith('.leveldb')
  if (path.basename(sourcePath) !== 'LOCK' || !isLevelDbDirectory || !(error instanceof Error)) return false
  const nodeError = error as NodeJS.ErrnoException
  return nodeError.code === 'EBUSY' || nodeError.errno === WINDOWS_UV_EBUSY_ERRNO
}

interface CopyDirOptions {
  dereferenceSymlinks: boolean
  excludeRelativePath?: (relativePath: string) => boolean
  sourceRootPath?: string
  sourceRootRealPath?: string
  signal?: AbortSignal
}

interface EffectiveEntryStats {
  isSymlink: boolean
  stats: Stats
}

interface ProgressData {
  stage: string
  progress: number
  total: number
}

interface BackupFileInfo {
  fileName: string
  modifiedTime: string
  size: number
}

interface BackupWorkflowResult<T> {
  result: T
  cleanupError: Error | null
}

type BackupInvocationEvent = Electron.IpcMainInvokeEvent | null

export class BackupOperationBusyError extends Error {
  constructor() {
    super('Another backup operation is already in progress.')
    this.name = 'BackupOperationBusyError'
  }
}

class BackupManager {
  private readonly operationMutex = new Mutex()

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

  private get backupDir(): string {
    return application.getPath('feature.backup.temp')
  }

  async cleanupStaleTempArtifacts(): Promise<void> {
    const cutoff = Date.now() - STALE_TEMP_ARTIFACT_AGE_MS

    try {
      const entries = await fs.readdir(this.backupDir, { withFileTypes: true })
      for (const entry of entries) {
        const isManagedDirectory = entry.isDirectory() && BACKUP_OPERATION_DIR_PATTERN.test(entry.name)
        const isManagedArchive = entry.isFile() && BACKUP_TEMP_ARCHIVE_PATTERN.test(entry.name)
        if (!isManagedDirectory && !isManagedArchive) {
          continue
        }

        const artifactPath = path.join(this.backupDir, entry.name)
        try {
          const stats = await fs.lstat(artifactPath)
          if (stats.mtimeMs >= cutoff) {
            continue
          }
          await fs.remove(artifactPath)
          logger.info('[cleanupStaleTempArtifacts] Removed stale backup artifact', { path: artifactPath })
        } catch (error) {
          logger.warn('[cleanupStaleTempArtifacts] Failed to remove stale backup artifact', {
            path: artifactPath,
            error
          })
        }
      }
    } catch (error) {
      logger.warn('[cleanupStaleTempArtifacts] Failed to inspect backup temp directory', error as Error)
    }
  }

  /**
   * Compatibility adapter for the retained local/WebDAV/S3 settings.
   *
   * Archive ownership belongs to BackupService. Keeping destination transport
   * here must not keep the retired v7 capture engine or its v1 restore journal
   * alive, so every compatibility destination receives the same v2 archive as
   * the native Backup settings.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @param _slimBackup - Retained IPC argument; v2 exports are always Full
   * @returns Path to the created backup file
   */
  async backup(
    _event: BackupInvocationEvent,
    fileName: string,
    destinationPath?: string,
    _slimBackup: boolean = false
  ): Promise<string> {
    void _slimBackup
    return this.runBackupWorkflow(async () => {
      const onProgress = this.onProgress(IpcChannel.BackupProgress, true)
      const outputDirectory = destinationPath ?? this.backupDir
      const outputFileName = destinationPath ? fileName : `${randomUUID()}-${path.basename(fileName)}`
      const outputPath = resolveAndValidatePath(outputDirectory, outputFileName)
      await fs.ensureDir(outputDirectory)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })
      try {
        const result = await application.get('BackupService').export(outputPath)
        onProgress({ stage: 'completed', progress: 100, total: 100 })
        logger.info('[BackupManager] Compatibility destination exported a v2 archive', {
          outputPath: result.outPath
        })
        return result.outPath
      } catch (error) {
        logger.error('[BackupManager] v2 export failed:', error as Error)
        throw error
      }
    })
  }

  private runBackupWorkflow<T>(operation: () => Promise<T>): Promise<T> {
    return tryAcquire(this.operationMutex, new BackupOperationBusyError()).runExclusive(operation)
  }

  private createBackupFileName(): string {
    return `cherry-studio.${dayjs().format('YYYYMMDDHHmmssSSS')}.${getHostname() || 'unknown'}.${getDeviceType() || 'unknown'}.zip`
  }

  private createRemoteCleanupSignal(signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(REMOTE_UPLOAD_IDLE_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  }

  private async cleanupOldBackups(
    maxBackups: number,
    listFiles: (signal?: AbortSignal) => Promise<BackupFileInfo[]>,
    deleteFile: (fileName: string, signal?: AbortSignal) => Promise<unknown>,
    signal?: AbortSignal,
    deleteAttempts = 1
  ): Promise<Error | null> {
    if (maxBackups <= 0) return null

    try {
      signal?.throwIfAborted()
      const suffix = `.${getHostname() || 'unknown'}.${getDeviceType() || 'unknown'}.zip`
      const files = (await listFiles(signal)).filter(
        (file) => file.fileName.startsWith('cherry-studio.') && file.fileName.endsWith(suffix)
      )
      for (const file of files.slice(maxBackups)) {
        await this.deleteWithRetry(file.fileName, deleteFile, signal, deleteAttempts)
      }
      return null
    } catch (error) {
      logger.error('Failed to clean up old backups', error as Error)
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  private async deleteWithRetry(
    fileName: string,
    deleteFile: (fileName: string, signal?: AbortSignal) => Promise<unknown>,
    signal: AbortSignal | undefined,
    maxAttempts: number
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        signal?.throwIfAborted()
        await deleteFile(fileName, signal)
        return
      } catch (error) {
        if (signal?.aborted || attempt === maxAttempts) throw error
        await delay(attempt * 1_000, undefined, { signal })
      }
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
    _event: Electron.IpcMainInvokeEvent,
    fileName: string,
    data: string,
    destinationPath: string = this.backupDir,
    skipBackupFile: boolean = false
  ): Promise<string> {
    return this.runBackupWorkflow(() => this.backupLegacyUnlocked(fileName, data, destinationPath, skipBackupFile))
  }

  private async backupLegacyUnlocked(
    fileName: string,
    data: string,
    destinationPath: string,
    skipBackupFile: boolean
  ): Promise<string> {
    const onProgress = this.onProgress(IpcChannel.BackupProgress, true)
    const workDir = await this.createOperationDir('lan-create')

    try {
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      // Write data.json using streaming
      const tempDataPath = path.join(workDir, 'data.json')

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
        const sourcePath = application.getPath('app.userdata.data')
        const tempDataDir = path.join(workDir, 'Data')

        // Get total size of source directory
        const totalSize = await this.getDirSize(sourcePath, { dereferenceSymlinks: true })

        // Use streaming copy
        await this.copyDirWithProgress(
          sourcePath,
          tempDataDir,
          this.createCopyProgressHandler(totalSize, 0, 50, 'copying_files', onProgress),
          { dereferenceSymlinks: true }
        )

        onProgress({ stage: 'preparing_compression', progress: 50, total: 100 })
      } else {
        logger.debug('Skip the backup of the file')
        await fs.promises.mkdir(path.join(workDir, 'Data')) // Creating empty Data dir is required, otherwise restore will fail
      }

      // Create output file stream
      const backupedFilePath = path.join(destinationPath, fileName)
      const output = fs.createWriteStream(backupedFilePath)

      // Create archiver instance, enable ZIP64 support
      const archive = new ZipArchive({
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

      await calculateTotals(workDir)

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
        archive.directory(workDir, false)

        // Finalize compression
        archive.finalize()
      })

      onProgress({ stage: 'completed', progress: 100, total: 100 })

      logger.info('Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[BackupManager] Backup failed:', error as Error)
      throw error
    } finally {
      await fs.remove(workDir).catch(() => {})
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
    event: BackupInvocationEvent,
    fileName: string | undefined,
    localConfig: LocalBackupConfig,
    signal?: AbortSignal
  ): Promise<BackupWorkflowResult<string>> {
    return this.runBackupWorkflow(async () => {
      const operationSignal = event === null ? signal : undefined
      operationSignal?.throwIfAborted()
      const backupDir = localConfig.localBackupDir || this.backupDir
      await fs.ensureDir(backupDir)
      const result = await this.backupDirect(
        fileName || this.createBackupFileName(),
        backupDir,
        localConfig.skipBackupFile ?? false,
        operationSignal
      )
      const cleanupError = await this.cleanupOldBackups(
        localConfig.maxBackups ?? 0,
        (cleanupSignal) => this.listLocalBackupFiles(null, backupDir, cleanupSignal),
        (oldFileName, cleanupSignal) => this.deleteLocalBackupFile(null, oldFileName, backupDir, cleanupSignal),
        operationSignal
      )
      return { result, cleanupError }
    })
  }

  /**
   * Direct backup to WebDAV
   * Creates a backup and uploads it to a WebDAV server.
   * @param _ - Electron IPC event
   * @param webdavConfig - WebDAV configuration including server URL, credentials, and options
   * @returns Result from WebDAV upload operation
   */
  async backupToWebdav(
    event: BackupInvocationEvent,
    webdavConfig: WebDavConfig,
    signal?: AbortSignal
  ): Promise<BackupWorkflowResult<boolean>> {
    return this.runBackupWorkflow(async () => {
      const operationSignal = event === null ? signal : undefined
      const filename = webdavConfig.fileName || this.createBackupFileName()
      const backupedFilePath = await this.backupDirect(
        filename,
        undefined,
        webdavConfig.skipBackupFile ?? false,
        operationSignal
      )
      const webdavClient = this.getWebDavInstance(webdavConfig)
      const idleTimeout = new IdleTimeoutController(REMOTE_UPLOAD_IDLE_TIMEOUT_MS)
      const uploadSignal = operationSignal ? AbortSignal.any([operationSignal, idleTimeout.signal]) : idleTimeout.signal
      let result: boolean

      try {
        uploadSignal.throwIfAborted()
        if (webdavConfig.disableStream) {
          const fileContent = await fs.promises.readFile(backupedFilePath, { signal: uploadSignal })
          idleTimeout.reset()
          result = await webdavClient.putFileContents(filename, fileContent, {
            overwrite: true,
            signal: uploadSignal,
            onUploadProgress: () => idleTimeout.reset()
          })
          uploadSignal.throwIfAborted()
        } else {
          const contentLength = (await fs.stat(backupedFilePath)).size
          const { stream, cleanup } = this.createUploadReadStream(backupedFilePath, uploadSignal, idleTimeout.reset)
          try {
            result = await webdavClient.putFileContents(filename, stream, {
              overwrite: true,
              contentLength,
              signal: uploadSignal,
              onUploadProgress: () => idleTimeout.reset()
            })
            uploadSignal.throwIfAborted()
          } finally {
            cleanup()
          }
        }
      } finally {
        idleTimeout.cleanup()
        await fs.remove(backupedFilePath).catch(() => {})
      }

      const cleanupSignal = this.createRemoteCleanupSignal(operationSignal)
      const cleanupError = await this.cleanupOldBackups(
        webdavConfig.maxBackups ?? 0,
        (currentSignal) => this.listWebdavFiles(null, webdavConfig, currentSignal),
        (oldFileName, currentSignal) => this.deleteWebdavFile(null, oldFileName, webdavConfig, currentSignal),
        cleanupSignal,
        3
      )
      return { result, cleanupError }
    })
  }

  /**
   * Direct backup to S3
   * Creates a backup and uploads it to an S3-compatible storage.
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration including endpoint, bucket, credentials, and options
   * @returns Result from S3 upload operation
   */
  async backupToS3(
    event: BackupInvocationEvent,
    s3Config: S3Config,
    signal?: AbortSignal
  ): Promise<BackupWorkflowResult<unknown>> {
    return this.runBackupWorkflow(async () => {
      const operationSignal = event === null ? signal : undefined
      const filename = s3Config.fileName || this.createBackupFileName()

      logger.debug(`[backupToS3] Starting S3 backup to ${filename}`)

      const backupedFilePath = await this.backupDirect(
        filename,
        undefined,
        s3Config.skipBackupFile ?? false,
        operationSignal
      )
      const s3Client = this.getS3Storage(s3Config)
      let result: unknown
      try {
        operationSignal?.throwIfAborted()
        const contentLength = (await fs.stat(backupedFilePath)).size
        result = await s3Client.putFileContents(filename, fs.createReadStream(backupedFilePath), contentLength, {
          signal: operationSignal
        })
        operationSignal?.throwIfAborted()
        logger.info(`S3 backup completed: ${filename}`)
      } finally {
        await fs.remove(backupedFilePath).catch(() => {})
      }

      const cleanupSignal = this.createRemoteCleanupSignal(operationSignal)
      const cleanupError = await this.cleanupOldBackups(
        s3Config.maxBackups,
        (currentSignal) => this.listS3Files(null, s3Config, currentSignal),
        (oldFileName, currentSignal) => this.deleteS3File(null, oldFileName, s3Config, currentSignal),
        cleanupSignal,
        3
      )
      return { result, cleanupError }
    })
  }

  private createUploadReadStream(
    filePath: string,
    signal: AbortSignal,
    onProgress: () => void
  ): { stream: Transform; cleanup: () => void } {
    const source = fs.createReadStream(filePath)
    const stream = new Transform({
      transform(chunk, _encoding, callback) {
        onProgress()
        callback(null, chunk)
      }
    })
    const onSourceError = (error: Error) => stream.destroy(error)
    const onAbort = () => {
      source.destroy()
      stream.destroy()
    }

    source.once('error', onSourceError)
    source.pipe(stream)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    return {
      stream,
      cleanup: () => {
        signal.removeEventListener('abort', onAbort)
        source.removeListener('error', onSourceError)
        if (!source.destroyed) source.destroy()
        if (!stream.destroyed) stream.destroy()
      }
    }
  }

  /**
   * Restore a v2 archive through BackupService while retaining the legacy IPC
   * surface used by local/WebDAV/S3 settings.
   */
  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<void> {
    return this.runBackupWorkflow(async () => {
      const restoreId = await this.stageRestore(backupPath)
      await application.get('BackupService').armRestore(restoreId)
    })
  }

  /**
   * Admission remains a separate step so downloaded archives can be removed
   * before callers arm the durable restore.
   */
  private async stageRestore(backupPath: string): Promise<string> {
    const preview = await application.get('BackupService').prepareRestore(backupPath)
    logger.info('[BackupManager] Compatibility restore prepared through BackupService', {
      restoreId: preview.restoreId
    })
    return preview.restoreId
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
      const backupPath = resolveAndValidatePath(localBackupDir, fileName)

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
    return this.runBackupWorkflow(async () => {
      const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
      const webdavClient = this.getWebDavInstance(webdavConfig)
      const downloadDir = await this.createOperationDir('webdav-download')
      const backupedFilePath = path.join(downloadDir, path.basename(filename))
      let restoreId: string
      try {
        await pipeline(webdavClient.createReadStream(filename), fs.createWriteStream(backupedFilePath))
        restoreId = await this.stageRestore(backupedFilePath)
      } catch (error: any) {
        logger.error('Failed to restore from WebDAV:', error)
        throw new Error(error.message || 'Failed to restore backup file')
      } finally {
        await fs.remove(downloadDir).catch(() => {})
      }
      await application.get('BackupService').armRestore(restoreId)
    })
  }

  /**
   * Restore from an S3 backup
   * Downloads the backup file from S3 storage and restores it.
   * @param _ - Electron IPC event
   * @param s3Config - S3 configuration including bucket, credentials, and file name
   * @returns Result from restore operation
   */
  async restoreFromS3(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    return this.runBackupWorkflow(async () => {
      const filename = s3Config.fileName || 'cherry-studio.backup.zip'

      logger.debug(`Starting restore from S3: ${filename}`)

      const s3Client = this.getS3Storage(s3Config)
      const downloadDir = await this.createOperationDir('s3-download')
      const backupedFilePath = path.join(downloadDir, path.basename(filename))
      let restoreId: string
      try {
        await pipeline(await s3Client.getFileStream(filename), fs.createWriteStream(backupedFilePath))

        logger.info(`S3 restore file downloaded successfully: ${filename}`)
        restoreId = await this.stageRestore(backupedFilePath)
      } catch (error: any) {
        logger.error('[BackupManager] Failed to restore from S3:', error)
        throw new Error(error.message || 'Failed to restore backup file')
      } finally {
        await fs.remove(downloadDir).catch(() => {})
      }
      await application.get('BackupService').armRestore(restoreId)
    })
  }

  // ==================== File Utility Methods ====================
  // These are helper methods for file operations like size calculation,
  // directory copying with progress, and permission management.

  private async createOperationDir(prefix: string): Promise<string> {
    const operationDir = path.join(this.backupDir, `${prefix}-${randomUUID()}`)
    await fs.ensureDir(operationDir)
    return operationDir
  }

  /**
   * Create a progress callback that sends IPC message and optionally logs.
   * copying_files stage is never logged as it generates too many logs.
   */
  private onProgress = (channel: IpcChannel, shouldLog: boolean) => {
    return (processData: ProgressData) => {
      application.get('WindowManager').broadcastToType(WindowType.Main, channel, processData)
      // Never log copying_files as it generates too many log entries
      if (shouldLog && processData.stage !== 'copying_files') {
        logger.info('Backup progress', processData)
      }
    }
  }

  private createCopyProgressHandler(
    totalSize: number,
    startProgress: number,
    endProgress: number,
    stage: string,
    onProgress: (processData: ProgressData) => void
  ) {
    let copiedSize = 0
    let lastReported = startProgress

    return (size: number) => {
      copiedSize += size
      const progress =
        totalSize > 0
          ? Math.min(endProgress, startProgress + Math.floor((copiedSize / totalSize) * (endProgress - startProgress)))
          : endProgress
      if (progress === lastReported && copiedSize < totalSize) {
        return
      }
      lastReported = progress
      onProgress({ stage, progress, total: 100 })
    }
  }

  /**
   * Calculate total size of a directory recursively
   * @param dirPath - Directory path to calculate size
   * @returns Total size in bytes
   */
  private async getDirSize(
    dirPath: string,
    options: CopyDirOptions,
    activeDirectoryRealPaths = new Set<string>()
  ): Promise<number> {
    options.signal?.throwIfAborted()
    const copyOptions = {
      ...options,
      sourceRootPath: options.sourceRootPath ?? dirPath,
      sourceRootRealPath: options.sourceRootRealPath ?? (await fs.realpath(dirPath))
    }
    const directoryRealPath = await this.enterDirectory(dirPath, activeDirectoryRealPaths)

    if (!directoryRealPath) {
      return 0
    }

    let size = 0

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true })

      for (const item of items) {
        copyOptions.signal?.throwIfAborted()
        const fullPath = path.join(dirPath, item.name)
        const relativePath = path.relative(copyOptions.sourceRootPath, fullPath)
        if (copyOptions.excludeRelativePath?.(relativePath)) {
          continue
        }
        const entry = await this.getEffectiveEntryStats(fullPath, copyOptions)

        if (!entry) {
          continue
        }

        if (entry.stats.isDirectory()) {
          if (entry.isSymlink) {
            try {
              size += await this.getDirSize(fullPath, copyOptions, activeDirectoryRealPaths)
            } catch (error) {
              this.logSkippedSymlink(fullPath, error)
            }
          } else {
            size += await this.getDirSize(fullPath, copyOptions, activeDirectoryRealPaths)
          }
        } else if (entry.stats.isFile()) {
          size += entry.stats.size
        }
      }
    } finally {
      activeDirectoryRealPaths.delete(directoryRealPath)
    }

    return size
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
  listWebdavFiles = async (_: BackupInvocationEvent, config: WebDavConfig, signal?: AbortSignal) => {
    try {
      const client = this.getWebDavInstance(config)
      const files = await client.getDirectoryContents(signal)

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
      if (signal?.aborted) throw signal.reason
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
    onProgress: (size: number) => void,
    options: CopyDirOptions
  ): Promise<void> {
    options.signal?.throwIfAborted()
    const copyOptions = {
      ...options,
      sourceRootPath: options.sourceRootPath ?? source,
      sourceRootRealPath: options.sourceRootRealPath ?? (await fs.realpath(source))
    }
    const activeDirectoryRealPaths = new Set<string>()

    const copyDir = async (src: string, dest: string): Promise<void> => {
      copyOptions.signal?.throwIfAborted()
      const directoryRealPath = await this.enterDirectory(src, activeDirectoryRealPaths)

      if (!directoryRealPath) {
        return
      }

      try {
        await fs.ensureDir(dest)

        const items = await fs.readdir(src, { withFileTypes: true })

        for (const item of items) {
          copyOptions.signal?.throwIfAborted()
          const sourcePath = path.join(src, item.name)
          const destPath = path.join(dest, item.name)
          const relativePath = path.relative(copyOptions.sourceRootPath, sourcePath)
          if (copyOptions.excludeRelativePath?.(relativePath)) {
            continue
          }
          const entry = await this.getEffectiveEntryStats(sourcePath, copyOptions)

          if (!entry) {
            continue
          }

          if (entry.stats.isDirectory()) {
            try {
              await copyDir(sourcePath, destPath)
            } catch (error) {
              if (!entry.isSymlink) {
                throw error
              }
              await fs.remove(destPath).catch(() => {})
              this.logSkippedSymlink(sourcePath, error)
            }
          } else if (entry.stats.isFile()) {
            if (copyOptions.signal) {
              try {
                await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(destPath), {
                  signal: copyOptions.signal
                })
                await fs.chmod(destPath, entry.stats.mode)
              } catch (error) {
                try {
                  await fs.remove(destPath)
                } catch {
                  throw error
                }
                if (isSkippableLevelDbLockError(sourcePath, error)) {
                  logger.warn('[BackupManager] Skipping locked file', { path: sourcePath })
                  continue
                }
                throw error
              }
            } else if (entry.isSymlink) {
              await fs.copy(sourcePath, destPath, { dereference: true })
            } else {
              try {
                await fs.copy(sourcePath, destPath)
              } catch (copyError) {
                // Skip files that are locked by another process (e.g., LevelDB LOCK file
                // in Local Storage held by the renderer). These files are not needed for
                // backup integrity and will be recreated on restore if needed.
                if (isSkippableLevelDbLockError(sourcePath, copyError)) {
                  logger.warn('[BackupManager] Skipping locked file', { path: sourcePath })
                  continue
                }
                throw copyError
              }
            }
            onProgress(entry.stats.size)
          } else if (entry.isSymlink) {
            logger.warn('[BackupManager] Skipping symlink to unsupported target', { path: sourcePath })
          }
        }
      } finally {
        activeDirectoryRealPaths.delete(directoryRealPath)
      }
    }

    await copyDir(source, destination)
  }

  private async enterDirectory(dirPath: string, activeDirectoryRealPaths: Set<string>): Promise<string | null> {
    const realPath = await fs.realpath(dirPath)

    if (activeDirectoryRealPaths.has(realPath)) {
      logger.warn('[BackupManager] Skipping circular symlink directory', { path: dirPath, realPath })
      return null
    }

    activeDirectoryRealPaths.add(realPath)
    return realPath
  }

  private async getEffectiveEntryStats(
    sourcePath: string,
    options: CopyDirOptions
  ): Promise<EffectiveEntryStats | null> {
    const stats = await fs.lstat(sourcePath)

    if (!stats.isSymbolicLink()) {
      return { isSymlink: false, stats }
    }

    const targetStats = await this.getSymlinkTargetStats(sourcePath, options)
    return targetStats ? { isSymlink: true, stats: targetStats } : null
  }

  private async getSymlinkTargetStats(sourcePath: string, options: CopyDirOptions): Promise<Stats | null> {
    if (!options.dereferenceSymlinks) {
      logger.warn('[BackupManager] Skipping symlink (dereferenceSymlinks=false)', { path: sourcePath })
      return null
    }

    try {
      const [targetStats, targetRealPath] = await Promise.all([fs.stat(sourcePath), fs.realpath(sourcePath)])
      const context = {
        path: sourcePath,
        sourceRootRealPath: options.sourceRootRealPath,
        targetRealPath
      }

      if (options.sourceRootRealPath && !isPathInside(targetRealPath, options.sourceRootRealPath)) {
        logger.warn('[BackupManager] Dereferencing symlink outside source root during backup copy', context)
      } else {
        logger.info('[BackupManager] Dereferencing symlink during backup copy', context)
      }
      return targetStats
    } catch (error) {
      this.logSkippedSymlink(sourcePath, error)
      return null
    }
  }

  private logSkippedSymlink(sourcePath: string, error: unknown) {
    logger.warn('[BackupManager] Skipping broken or unreadable symlink', { path: sourcePath, error })
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
  async deleteWebdavFile(_: BackupInvocationEvent, fileName: string, webdavConfig: WebDavConfig, signal?: AbortSignal) {
    try {
      const webdavClient = this.getWebDavInstance(webdavConfig)
      return await webdavClient.deleteFile(fileName, signal)
    } catch (error: any) {
      logger.error('Failed to delete WebDAV file:', error)
      if (signal?.aborted) throw signal.reason
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
  async listLocalBackupFiles(_: BackupInvocationEvent, localBackupDir: string, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted()
      const files = await fs.readdir(localBackupDir)
      const result: Array<{ fileName: string; modifiedTime: string; size: number }> = []

      for (const file of files) {
        signal?.throwIfAborted()
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
  async deleteLocalBackupFile(
    _: BackupInvocationEvent,
    fileName: string,
    localBackupDir: string,
    signal?: AbortSignal
  ) {
    try {
      signal?.throwIfAborted()
      const filePath = resolveAndValidatePath(localBackupDir, fileName)

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
      .slice(0, 14)

    const fileName = `cherry-studio.${timestamp}.zip`
    const tempPath = application.getPath('feature.lan_transfer.temp')
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
      const tempBase = path.normalize(application.getPath('feature.lan_transfer.temp'))
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
  listS3Files = async (_: BackupInvocationEvent, s3Config: S3Config, signal?: AbortSignal) => {
    try {
      const s3Client = this.getS3Storage(s3Config)

      const objects = await s3Client.listFiles('', signal)
      const files = objects
        .filter((obj) => obj.key.endsWith('.zip'))
        .map((obj) => ({
          fileName: obj.key,
          modifiedTime: obj.lastModified || '',
          size: obj.size
        }))

      return files.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error: any) {
      logger.error('Failed to list S3 files:', error)
      if (signal?.aborted) throw signal.reason
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
  async deleteS3File(_: BackupInvocationEvent, fileName: string, s3Config: S3Config, signal?: AbortSignal) {
    try {
      const s3Client = this.getS3Storage(s3Config)
      return await s3Client.deleteFile(fileName, signal)
    } catch (error: any) {
      logger.error('Failed to delete S3 file:', error)
      if (signal?.aborted) throw signal.reason
      throw new Error(error.message || 'Failed to delete backup file')
    }
  }
}

export { BackupManager }
export const legacyBackupManager = new BackupManager()

export default BackupManager
