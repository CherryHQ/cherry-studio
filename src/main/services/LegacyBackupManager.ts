/**
 * @deprecated LEGACY v1 CODE — removed when the v2 migration is dropped.
 * --------------------------------------------------------------------------
 * This is v1's BackupManager, retained as the active compatibility backup
 * engine while v2 backup is unfinished. Keep it aligned with v1 except for
 * the explicit v2 data and restore-safety integrations below.
 *
 * Rules:
 * - No unrelated v2 features or refactors.
 * - Do NOT rename the `BackupManager` class, its exports, or the logger
 *   context. The filename is intentionally `LegacyBackupManager.ts` while the
 *   class stays `BackupManager`, so this file remains a drop-in mirror of v1.
 * - When re-syncing from v1, re-apply this banner and the v2 integrations.
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
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { readRestoreJournal, type RestoreJournal, writeRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { type AtomicWriteStream, createAtomicWriteStream } from '@main/utils/file'
import { IdleTimeoutController } from '@main/utils/IdleTimeoutController'
import { isPathInside, resolveAndValidatePath } from '@main/utils/legacyFile'
import { getDeviceType, getHostname } from '@main/utils/system'
import { assertZipEntriesWithin } from '@main/utils/zipSafety'
import { IpcChannel } from '@shared/IpcChannel'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_NEWER_VERSION_ERROR_CODE,
  BACKUP_OPERATION_BUSY_ERROR_CODE,
  type LocalBackupConfig,
  type S3Config,
  type WebDavConfig
} from '@shared/types/backup'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { ZipArchive } from 'archiver'
import { Mutex, tryAcquire } from 'async-mutex'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { app } from 'electron'
import * as fs from 'fs-extra'
import StreamZip from 'node-stream-zip'
import * as path from 'path'
import type { CreateDirectoryOptions, FileStat } from 'webdav'

import S3Storage from './S3Storage'
import WebDav from './WebDav'

const logger = loggerService.withContext('BackupManager')
const DIRECT_BACKUP_VERSION = 7
const QUIESCE_TIMEOUT_MS = 30_000
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

interface DirectBackupMetadata {
  version: number
  timestamp: number
  appName: string
  appVersion: string
  platform: string
  arch: string
  resources: {
    database: boolean
    cache: true
    indexedDB: boolean
    localStorage: boolean
    appClaude: boolean
    data: boolean
  }
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
    super(`${BACKUP_OPERATION_BUSY_ERROR_CODE}: Another backup operation is already in progress.`)
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
   * Backup metadata for direct backup format.
   *
   * Version 7 archives store SQLite inside Data instead of as a standalone
   * resource. Full backups include all supported resources, while slim
   * backups include only Data/cherrystudio.sqlite and cache.json.
   */
  private createDirectBackupMetadata(slimBackup: boolean): DirectBackupMetadata {
    return {
      version: DIRECT_BACKUP_VERSION,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      resources: {
        database: false,
        cache: true,
        indexedDB: !slimBackup,
        localStorage: !slimBackup,
        appClaude: false,
        data: true
      }
    }
  }

  /**
   * Direct backup method - copies Data (excluding transient SQLite sidecars
   * and the internal restore journal) plus cache.json, IndexedDB, and Local Storage.
   * Slim backups keep only Data/cherrystudio.sqlite and cache.json.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @param slimBackup - Whether to omit browser storage and non-database Data files
   * @returns Path to the created backup file
   */
  async backup(
    _event: BackupInvocationEvent,
    fileName: string,
    destinationPath?: string,
    slimBackup: boolean = false
  ): Promise<string> {
    return this.runBackupWorkflow(() => this.backupDirect(fileName, destinationPath, slimBackup))
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

  private async backupDirect(
    fileName: string,
    destinationPath: string | undefined,
    slimBackup: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    signal?.throwIfAborted()
    this.assertNoActiveDataWriters()

    if (path.posix.basename(fileName) !== fileName || path.win32.basename(fileName) !== fileName) {
      throw new Error('Backup file name must not contain path separators')
    }

    const outputDirectory = destinationPath ?? this.backupDir
    const outputFileName = destinationPath ? fileName : `${randomUUID()}-${path.basename(fileName)}`
    const backupedFilePath = resolveAndValidatePath(outputDirectory, outputFileName)
    const onProgress = this.onProgress(IpcChannel.BackupProgress, true)
    const workDir = await this.createOperationDir('create')
    let output: AtomicWriteStream | undefined

    try {
      await fs.ensureDir(outputDirectory)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      const userDataPath = application.getPath('app.userdata')
      onProgress({ stage: 'copying_files', progress: 15, total: 100 })
      logger.debug('[backupDirect] Capturing v2 backup resources')

      const quiesceReason = 'backup: capture consistent snapshot'
      const channelManager = application.get('ChannelManager')
      const channelHold = channelManager.pause(quiesceReason)
      try {
        const channelVerdict = await channelManager.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS })
        signal?.throwIfAborted()
        this.assertWritersDrained([channelVerdict])

        const aiStreamManager = application.get('AiStreamManager')
        const agentSessionRuntime = application.get('AgentSessionRuntimeService')
        const agentSessionDelivery = application.get('AgentSessionDeliveryService')
        const jobManager = application.get('JobManager')
        const writerHolds: Array<{ dispose(): void }> = []
        try {
          writerHolds.push(aiStreamManager.pause(quiesceReason))
          writerHolds.push(agentSessionRuntime.pause(quiesceReason))
          writerHolds.push(agentSessionDelivery.pause(quiesceReason))
          writerHolds.push(jobManager.pause(quiesceReason))

          const writerVerdicts = await Promise.all([
            aiStreamManager.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
            agentSessionRuntime.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
            agentSessionDelivery.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS }),
            jobManager.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS })
          ])
          signal?.throwIfAborted()
          this.assertWritersDrained(writerVerdicts)

          const dbService = application.get('DbService')
          const liveDatabasePath = application.getPath('app.database.file')
          dbService.checkpointTruncate()
          const fingerprintBefore = await hashDbFile(liveDatabasePath)

          application.get('CacheService').flushPersistForBackup()
          const cacheSource = application.getPath('app.userdata', 'cache.json')
          if (!(await fs.pathExists(cacheSource))) {
            throw new Error('Failed to persist cache.json for backup')
          }
          await fs.copy(cacheSource, path.join(workDir, 'cache.json'))

          if (!slimBackup) {
            await this.copyDirectoryOrCreate(
              path.join(userDataPath, 'IndexedDB'),
              path.join(workDir, 'IndexedDB'),
              signal
            )
            await this.copyDirectoryOrCreate(
              path.join(userDataPath, 'Local Storage'),
              path.join(workDir, 'Local Storage'),
              signal
            )
          }

          onProgress({ stage: 'copying_files', progress: 50, total: 100 })

          const sourcePath = application.getPath('app.userdata.data')
          const tempDataDir = path.join(workDir, 'Data')
          const databaseDataPath = this.toDataRelative(liveDatabasePath)
          if (!databaseDataPath) {
            throw new Error('SQLite database is not inside the Data directory')
          }
          const restoreJournalDataPath = this.toDataRelative(application.getPath('feature.backup.restore.file'))

          if (await fs.pathExists(sourcePath)) {
            const copyOptions: CopyDirOptions = {
              dereferenceSymlinks: true,
              excludeRelativePath: (relativePath) => {
                const normalizedPath = path.normalize(relativePath)
                if (slimBackup) {
                  return normalizedPath !== databaseDataPath
                }
                return (
                  normalizedPath === `${databaseDataPath}-wal` ||
                  normalizedPath === `${databaseDataPath}-shm` ||
                  (restoreJournalDataPath !== null &&
                    (normalizedPath === restoreJournalDataPath || normalizedPath === `${restoreJournalDataPath}.tmp`))
                )
              },
              sourceRootPath: sourcePath,
              signal
            }
            const totalSize = await this.getDirSize(sourcePath, copyOptions)
            await this.copyDirWithProgress(
              sourcePath,
              tempDataDir,
              this.createCopyProgressHandler(totalSize, 52, 80, 'copying_files', onProgress),
              copyOptions
            )
          } else {
            await fs.ensureDir(tempDataDir)
          }

          await fs.writeJson(path.join(workDir, 'metadata.json'), this.createDirectBackupMetadata(slimBackup), {
            spaces: 2
          })

          const backupFingerprint = await hashDbFile(path.join(tempDataDir, databaseDataPath))
          if (backupFingerprint !== fingerprintBefore) {
            throw new Error(
              'The SQLite file copied into Data does not match the live database. Please retry the backup.'
            )
          }

          dbService.checkpointTruncate()
          const fingerprintAfter = await hashDbFile(liveDatabasePath)
          if (fingerprintAfter !== fingerprintBefore) {
            throw new Error('Data changed while backup resources were being captured. Please retry the backup.')
          }
        } finally {
          for (const hold of writerHolds.reverse()) {
            hold.dispose()
          }
        }
      } finally {
        channelHold.dispose()
      }

      onProgress({ stage: 'compressing', progress: 80, total: 100 })
      signal?.throwIfAborted()

      const atomicOutput = createAtomicWriteStream(AbsoluteFilePathSchema.parse(backupedFilePath))
      output = atomicOutput
      const archive = new ZipArchive({
        zlib: { level: 1 },
        zip64: true
      })

      await new Promise<void>((resolve, reject) => {
        function cleanup() {
          signal?.removeEventListener('abort', onAbort)
        }
        function complete() {
          cleanup()
          resolve()
        }
        function fail(error: unknown) {
          cleanup()
          reject(error)
        }
        function onAbort() {
          archive.abort()
          fail(signal?.reason)
        }

        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) {
          onAbort()
          return
        }
        atomicOutput.on('finish', complete)
        atomicOutput.on('error', fail)
        archive.on('error', fail)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            logger.warn('[backupDirect] Archive warning:', err)
          }
        })
        archive.pipe(atomicOutput)
        archive.directory(workDir, false)
        archive.finalize()
      })

      onProgress({ stage: 'completed', progress: 100, total: 100 })
      logger.info('[backupDirect] Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[backupDirect] Backup failed:', error as Error)
      if (output && !output.destroyed) {
        await output.abort()
      }
      throw error
    } finally {
      await fs.remove(workDir).catch(() => {})
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
   * Restore from a backup file
   * Only the complete v2 direct format is accepted. Every v1 format — direct
   * version 6, metadata-less ZIP versions 1-5, and renderer-side .bak — is
   * intentionally incompatible with the v2 SQLite ownership model.
   * @param _ - Electron IPC event
   * @param backupPath - Path to the backup ZIP file
   */
  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<void> {
    return this.runBackupWorkflow(async () => {
      await this.restoreUnlocked(backupPath)
      application.relaunch()
    })
  }

  private async restoreUnlocked(backupPath: string): Promise<void> {
    const onProgress = this.onProgress(IpcChannel.RestoreProgress, true)
    const extractionDir = await this.createOperationDir('extract')

    try {
      onProgress({ stage: 'preparing', progress: 0, total: 100 })
      logger.debug(`Extracting backup file into ${extractionDir}`)

      const zip = new StreamZip.async({ file: backupPath })
      try {
        onProgress({ stage: 'extracting', progress: 15, total: 100 })
        assertZipEntriesWithin(Object.keys(await zip.entries()), extractionDir)
        await zip.extract(null, extractionDir)
      } finally {
        await zip.close()
      }
      onProgress({ stage: 'extracted', progress: 20, total: 100 })

      if (!(await fs.pathExists(path.join(extractionDir, 'metadata.json')))) {
        throw new Error(
          `Unsupported v1 backup. Cherry Studio v2 can only restore backup version ${DIRECT_BACKUP_VERSION}.`
        )
      }

      await this.restoreDirect(extractionDir)
    } catch (error) {
      logger.error('Restore failed:', error as Error)
      throw error
    } finally {
      await fs.remove(extractionDir).catch(() => {})
    }
  }

  /**
   * Stage a complete version 7 restore journal. The preboot promotion gate
   * validates the live DB fingerprint and migration chain, then swaps the DB
   * and file resources with aside-first rollback semantics.
   */
  private async restoreDirect(extractionDir: string): Promise<void> {
    const onProgress = this.onProgress(IpcChannel.RestoreProgress, true)
    const userDataPath = application.getPath('app.userdata')
    const stagingRoot = application.getPath('feature.backup.restore.staging')
    const restoreId = randomUUID()
    const restoreDir = path.join(stagingRoot, restoreId)
    let journalCommitted = false

    const existingJournal = readRestoreJournal()
    if (existingJournal.kind === 'corrupt') {
      throw new Error('A corrupt restore journal already exists. Restart Cherry Studio before trying again.')
    }
    if (
      existingJournal.kind === 'ok' &&
      (existingJournal.journal.state === 'staged' || existingJournal.journal.state === 'promoting')
    ) {
      throw new Error('Another restore is already pending. Restart Cherry Studio before trying again.')
    }

    // No restore is pending: terminal journals have already released their
    // staging tree, and any remaining directory is an orphan from a crash
    // before the durable journal commit.
    await fs.remove(stagingRoot)
    await fs.ensureDir(restoreDir)

    try {
      const metadata = await this.readDirectBackupMetadata(extractionDir)
      const isSlimBackup = !metadata.resources.indexedDB && !metadata.resources.localStorage

      if (metadata.platform && metadata.platform !== process.platform) {
        logger.warn(
          `[restoreDirect] Cross-platform restore: backup from ${metadata.platform}, current is ${process.platform}`
        )
      }

      onProgress({ stage: 'validating', progress: 25, total: 100 })
      onProgress({ stage: 'restoring_data', progress: 30, total: 100 })

      const workDatabase = path.join(restoreDir, 'work.sqlite')
      const stagedCache = path.join(restoreDir, 'resources', 'cache.json')
      const stagedIndexedDB = path.join(restoreDir, 'resources', 'IndexedDB')
      const stagedLocalStorage = path.join(restoreDir, 'resources', 'Local Storage')
      const stagedData = path.join(restoreDir, 'resources', 'Data')

      await this.assertArchiveFile(path.join(extractionDir, 'cache.json'), 'cache.json')
      await fs.copy(path.join(extractionDir, 'cache.json'), stagedCache)

      if (metadata.resources.indexedDB) {
        await this.stageArchiveDirectory(path.join(extractionDir, 'IndexedDB'), stagedIndexedDB)
      }
      if (metadata.resources.localStorage) {
        await this.stageArchiveDirectory(path.join(extractionDir, 'Local Storage'), stagedLocalStorage)
      }

      if (metadata.resources.data) {
        const dataSource = path.join(extractionDir, 'Data')
        await this.assertArchiveDirectory(dataSource, 'Data')
        const copyOptions: CopyDirOptions = metadata.resources.database
          ? this.createLegacyDataCopyOptions(dataSource, false)
          : { dereferenceSymlinks: false, sourceRootPath: dataSource }
        await this.stageArchiveDirectory(
          dataSource,
          stagedData,
          this.createCopyProgressHandler(
            await this.getDirSize(dataSource, copyOptions),
            65,
            95,
            'restoring_data',
            onProgress
          ),
          copyOptions
        )
      }

      if (metadata.resources.database) {
        await this.assertArchiveFile(path.join(extractionDir, 'cherrystudio.sqlite'), 'SQLite database')
        await fs.copy(path.join(extractionDir, 'cherrystudio.sqlite'), workDatabase)
      } else {
        const databaseDataPath = this.toDataRelative(application.getPath('app.database.file'))
        if (!databaseDataPath) {
          throw new Error('SQLite database is not inside the Data directory')
        }
        const stagedDatabase = path.join(stagedData, databaseDataPath)
        await this.assertArchiveFile(stagedDatabase, 'SQLite database in Data')
        await fs.copy(stagedDatabase, workDatabase)
      }

      let bundleClaudeWithData = false
      let stagedClaude: string | null = null
      if (metadata.resources.appClaude) {
        const appClaudeDataPath = this.toDataRelative(application.getPath('feature.agents.claude.root'))
        if (metadata.resources.data && appClaudeDataPath !== null) {
          bundleClaudeWithData = true
          stagedClaude = path.join(stagedData, appClaudeDataPath)
        } else {
          stagedClaude = path.join(restoreDir, 'resources', '.claude')
        }
        await this.copyClaudeState(path.join(extractionDir, '.claude'), stagedClaude)
      }

      const chain = this.validateStagedDatabase(workDatabase)
      if (!this.isChainBundledPrefix(chain)) {
        throw new Error(
          `${BACKUP_NEWER_VERSION_ERROR_CODE}: This backup was created by a newer version of Cherry Studio (database is ahead of this version) and cannot be restored here. Please update Cherry Studio and try again. Backup appVersion: ${metadata.appVersion ?? 'unknown'}, current: ${app.getVersion()}.`
        )
      }
      onProgress({ stage: 'restoring_database', progress: 65, total: 100 })

      const fileResources: RestoreJournal['fileResources'] = []
      fileResources.push(
        await this.createJournalResource({
          restoreDir,
          stagingPath: stagedCache,
          livePath: application.getPath('app.userdata', 'cache.json'),
          directory: false
        })
      )
      if (metadata.resources.indexedDB) {
        fileResources.push(
          await this.createJournalResource({
            restoreDir,
            stagingPath: stagedIndexedDB,
            livePath: path.join(userDataPath, 'IndexedDB'),
            directory: true
          })
        )
      }
      if (metadata.resources.localStorage) {
        fileResources.push(
          await this.createJournalResource({
            restoreDir,
            stagingPath: stagedLocalStorage,
            livePath: path.join(userDataPath, 'Local Storage'),
            directory: true
          })
        )
      }
      if (metadata.resources.data && !isSlimBackup) {
        fileResources.push(...(await this.createDataJournalResources(restoreDir, stagedData)))
      }
      if (stagedClaude && !bundleClaudeWithData) {
        fileResources.push(
          await this.createJournalResource({
            restoreDir,
            stagingPath: stagedClaude,
            livePath: application.getPath('feature.agents.claude.root'),
            directory: true
          })
        )
      }

      // Flush both the staged contents and the staging root's restoreId
      // directory entry before publishing the durable journal.
      this.fsyncTree(stagingRoot)

      const jobManager = application.get('JobManager')
      const quiesceHold = jobManager.pause('backup restore: stage promotion journal')
      try {
        await this.assertJobsDrained(jobManager)
        this.assertNoActiveDataWriters()
        const dbService = application.get('DbService')
        dbService.checkpointTruncate()
        const fingerprint = await hashDbFile(application.getPath('app.database.file'))

        const journal: Extract<RestoreJournal, { state: 'staged' }> = {
          version: 1,
          restoreId,
          createdAt: new Date().toISOString(),
          state: 'staged',
          db: {
            promote: path.relative(userDataPath, workDatabase),
            aside: path.relative(userDataPath, path.join(restoreDir, 'aside', 'cherrystudio.sqlite')),
            fingerprint,
            chain
          },
          fileResources
        }
        writeRestoreJournal(journal)
        journalCommitted = true

        onProgress({ stage: 'completed', progress: 100, total: 100 })
        logger.info('[restoreDirect] Restore journal committed and ready for relaunch', { restoreId })
      } finally {
        if (!journalCommitted) {
          quiesceHold.dispose()
        }
      }
    } catch (error) {
      logger.error('[restoreDirect] Restore staging failed:', error as Error)
      throw error
    } finally {
      if (!journalCommitted) {
        await fs.remove(restoreDir).catch(() => {})
      }
    }
  }

  private async readDirectBackupMetadata(extractionDir: string): Promise<DirectBackupMetadata> {
    const raw = (await fs.readJson(path.join(extractionDir, 'metadata.json'))) as Record<string, unknown>

    if (!raw || typeof raw !== 'object' || raw.appName !== 'Cherry Studio') {
      throw new Error('This backup file is not from Cherry Studio and cannot be restored')
    }
    if (typeof raw.version === 'number' && raw.version > DIRECT_BACKUP_VERSION) {
      throw new Error(
        `${BACKUP_NEWER_VERSION_ERROR_CODE}: This backup was created by a newer version of Cherry Studio (backup version ${String(raw.version)}) and cannot be restored on this version (supports ${DIRECT_BACKUP_VERSION}). Please update Cherry Studio and try again.`
      )
    }
    if (raw.version !== DIRECT_BACKUP_VERSION) {
      throw new Error(
        `Unsupported backup version ${String(raw.version)}. Cherry Studio v2 can only restore backup version ${DIRECT_BACKUP_VERSION}.`
      )
    }

    const resources = raw.resources as Record<string, unknown> | undefined
    const hasCommonResources =
      resources?.cache === true &&
      typeof resources.indexedDB === 'boolean' &&
      resources.indexedDB === resources.localStorage &&
      typeof resources.data === 'boolean'
    const hasLegacyLayout =
      resources?.database === true &&
      resources.appClaude === true &&
      resources.indexedDB === true &&
      resources.localStorage === true
    const hasCompleteDataLayout =
      resources?.database === false && resources.appClaude === false && resources.data === true
    if (!resources || !hasCommonResources || (!hasLegacyLayout && !hasCompleteDataLayout)) {
      throw new Error(`Backup version ${String(raw.version)} metadata is incomplete`)
    }

    return raw as unknown as DirectBackupMetadata
  }

  private async assertArchiveFile(filePath: string, label: string): Promise<void> {
    let stats: Stats
    try {
      stats = await fs.lstat(filePath)
    } catch {
      throw new Error(`Backup is missing its ${label}`)
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Backup ${label} is not a regular file`)
    }
  }

  private async assertArchiveDirectory(directoryPath: string, label: string): Promise<void> {
    let stats: Stats
    try {
      stats = await fs.lstat(directoryPath)
    } catch {
      throw new Error(`Backup is missing its ${label} directory`)
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Backup ${label} is not a directory`)
    }
  }

  private async stageArchiveDirectory(
    source: string,
    destination: string,
    onProgress: (size: number) => void = () => {},
    options: CopyDirOptions = { dereferenceSymlinks: false }
  ): Promise<void> {
    await this.assertArchiveDirectory(source, path.basename(source))
    await this.copyDirWithProgress(source, destination, onProgress, options)
  }

  private validateStagedDatabase(databasePath: string): RestoreJournal['db']['chain'] {
    const sqlite = new Database(databasePath, { fileMustExist: true })
    let chain: RestoreJournal['db']['chain']
    try {
      checkpointTruncateAssert(sqlite)
      const integrity = String(sqlite.pragma('integrity_check', { simple: true }))
      if (integrity !== 'ok') {
        throw new Error(`Backup SQLite integrity check failed: ${integrity}`)
      }
      chain = readAppliedChain(sqlite)
      if (chain.length === 0) {
        throw new Error('Backup SQLite migration chain is empty')
      }
    } finally {
      sqlite.close()
    }

    if (fs.existsSync(`${databasePath}-wal`) || fs.existsSync(`${databasePath}-shm`)) {
      throw new Error('Backup SQLite database could not be sealed without WAL sidecars')
    }
    return chain
  }

  private isChainBundledPrefix(chain: RestoreJournal['db']['chain']): boolean {
    let bundled: ReturnType<typeof readMigrationFiles>
    try {
      bundled = readMigrationFiles({ migrationsFolder: application.getPath('app.database.migrations') })
    } catch (error) {
      logger.warn(
        '[restoreDirect] Failed to read bundled migrations for downgrade check, allowing promotion gate to decide',
        error as Error
      )
      return true
    }
    if (chain.length > bundled.length) {
      return false
    }
    return chain.every(
      (item, index) => item.folderMillis === bundled[index].folderMillis && item.hash === bundled[index].hash
    )
  }

  private async createJournalResource(input: {
    restoreDir: string
    stagingPath: string
    livePath: string
    directory: boolean
  }): Promise<RestoreJournal['fileResources'][number]> {
    const stagingPath = this.toUserDataRelative(input.stagingPath)
    const livePath = this.toUserDataRelative(input.livePath)

    if (!(await fs.pathExists(input.livePath))) {
      return {
        kind: input.directory ? 'dir-add' : 'blob-add',
        stagingPath,
        livePath
      }
    }

    return {
      kind: 'overwrite',
      stagingPath,
      livePath,
      asidePath: this.toUserDataRelative(path.join(input.restoreDir, 'aside', livePath))
    }
  }

  private async createDataJournalResources(
    restoreDir: string,
    stagedDataPath: string
  ): Promise<RestoreJournal['fileResources']> {
    const liveDataPath = application.getPath('app.userdata.data')
    const stagedNames = new Set(await fs.readdir(stagedDataPath))

    if (await fs.pathExists(liveDataPath)) {
      for (const name of await fs.readdir(liveDataPath)) {
        if (stagedNames.has(name) || this.isReservedDataRelativePath(name)) {
          continue
        }

        const livePath = path.join(liveDataPath, name)
        const stats = await fs.lstat(livePath)
        if (!stats.isSymbolicLink() && stats.isDirectory()) {
          await fs.ensureDir(path.join(stagedDataPath, name))
          stagedNames.add(name)
        }
      }
    }

    const resources: RestoreJournal['fileResources'] = []
    for (const name of [...stagedNames].sort()) {
      if (this.isReservedDataRelativePath(name)) {
        continue
      }

      const stagingPath = path.join(stagedDataPath, name)
      const stats = await fs.lstat(stagingPath)
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new Error(`Backup Data entry is not a regular file or directory: ${name}`)
      }
      resources.push(
        await this.createJournalResource({
          restoreDir,
          stagingPath,
          livePath: path.join(liveDataPath, name),
          directory: stats.isDirectory()
        })
      )
    }
    return resources
  }

  private toUserDataRelative(absolutePath: string): string {
    const userDataPath = application.getPath('app.userdata')
    const relativePath = path.relative(userDataPath, absolutePath)
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Restore path is outside userData: ${absolutePath}`)
    }
    return relativePath
  }

  private toDataRelative(absolutePath: string): string | null {
    const dataPath = application.getPath('app.userdata.data')
    const relativePath = path.relative(dataPath, absolutePath)
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null
    }
    return relativePath
  }

  private createLegacyDataCopyOptions(sourceRootPath: string, dereferenceSymlinks: boolean): CopyDirOptions {
    return {
      dereferenceSymlinks,
      excludeRelativePath: (relativePath) => this.isReservedDataRelativePath(relativePath),
      sourceRootPath
    }
  }

  private isReservedDataRelativePath(relativePath: string): boolean {
    const databasePath = this.toDataRelative(application.getPath('app.database.file'))
    const restoreJournalPath = this.toDataRelative(application.getPath('feature.backup.restore.file'))
    const appClaudePath = this.toDataRelative(application.getPath('feature.agents.claude.root'))
    const normalizedPath = path.normalize(relativePath)

    if (
      databasePath &&
      (normalizedPath === databasePath ||
        normalizedPath === `${databasePath}-wal` ||
        normalizedPath === `${databasePath}-shm`)
    ) {
      return true
    }
    if (
      restoreJournalPath &&
      (normalizedPath === restoreJournalPath ||
        normalizedPath === `${restoreJournalPath}.tmp` ||
        normalizedPath.startsWith(`${restoreJournalPath}.corrupt-`))
    ) {
      return true
    }
    return Boolean(
      appClaudePath && (normalizedPath === appClaudePath || normalizedPath.startsWith(`${appClaudePath}${path.sep}`))
    )
  }

  private fsyncTree(entryPath: string): void {
    const stats = fs.lstatSync(entryPath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to commit a symlink in restore staging: ${entryPath}`)
    }

    if (stats.isDirectory()) {
      for (const child of fs.readdirSync(entryPath)) {
        this.fsyncTree(path.join(entryPath, child))
      }
      if (process.platform !== 'win32') {
        const fd = fs.openSync(entryPath, 'r')
        try {
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
      }
      return
    }

    if (stats.isFile()) {
      const fd = fs.openSync(entryPath, process.platform === 'win32' ? 'r+' : 'r')
      try {
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
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
      try {
        await pipeline(webdavClient.createReadStream(filename), fs.createWriteStream(backupedFilePath))
        await this.restoreUnlocked(backupedFilePath)
      } catch (error: any) {
        logger.error('Failed to restore from WebDAV:', error)
        throw new Error(error.message || 'Failed to restore backup file')
      } finally {
        await fs.remove(downloadDir).catch(() => {})
      }
      application.relaunch()
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
      try {
        await pipeline(await s3Client.getFileStream(filename), fs.createWriteStream(backupedFilePath))

        logger.info(`S3 restore file downloaded successfully: ${filename}`)
        await this.restoreUnlocked(backupedFilePath)
      } catch (error: any) {
        logger.error('[BackupManager] Failed to restore from S3:', error)
        throw new Error(error.message || 'Failed to restore backup file')
      } finally {
        await fs.remove(downloadDir).catch(() => {})
      }
      application.relaunch()
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

  private async assertJobsDrained(jobManager: {
    drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[]; startupRecoveryPending: boolean }>
  }): Promise<void> {
    const verdict = await jobManager.drainInFlight({ timeoutMs: QUIESCE_TIMEOUT_MS })
    this.assertWritersDrained([verdict])
  }

  private assertWritersDrained(verdicts: Array<{ stragglerIds: string[]; startupRecoveryPending?: boolean }>): void {
    if (verdicts.some((verdict) => verdict.stragglerIds.length > 0 || verdict.startupRecoveryPending === true)) {
      throw new Error('Background data writes did not quiesce in time. Please retry after current tasks finish.')
    }
  }

  private assertNoActiveDataWriters(): void {
    if (
      application.get('AiStreamManager').hasLiveStreams() ||
      application.get('AgentSessionRuntimeService').hasBusySessions() ||
      application.get('AgentSessionDeliveryService').listActiveWork().length > 0
    ) {
      throw new Error(
        `${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running. Wait for it to finish, then retry the backup or restore.`
      )
    }
  }

  private async copyDirectoryOrCreate(source: string, destination: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!(await fs.pathExists(source))) {
      await fs.ensureDir(destination)
      return
    }

    const stats = await fs.lstat(source)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Expected an application data directory: ${source}`)
    }
    await this.copyDirWithProgress(source, destination, () => {}, { dereferenceSymlinks: false, signal })
  }

  /**
   * Restore the standalone CLAUDE_CONFIG_DIR resource used by earlier
   * version 7 archives. The generated `skills/` mirror is not restored.
   */
  private async copyClaudeState(source: string, destination: string): Promise<void> {
    const rootStats = await fs.lstat(source).catch(() => null)
    if (!rootStats || rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new Error('Backup is missing its application .claude directory')
    }

    await fs.ensureDir(destination)
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'skills') {
        continue
      }

      const sourcePath = path.join(source, entry.name)
      const destinationPath = path.join(destination, entry.name)
      const stats = await fs.lstat(sourcePath)
      if (stats.isSymbolicLink()) {
        logger.warn('[restoreDirect] Skipping symlink in application .claude state', { path: sourcePath })
        continue
      }
      if (stats.isDirectory()) {
        await this.copyDirWithProgress(sourcePath, destinationPath, () => {}, { dereferenceSymlinks: false })
      } else if (stats.isFile()) {
        await fs.copy(sourcePath, destinationPath)
      }
    }
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
