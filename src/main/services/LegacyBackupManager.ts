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

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { readRestoreJournal, type RestoreJournal, writeRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { isPathInside, resolveAndValidatePath } from '@main/utils/legacyFile'
import { IpcChannel } from '@shared/IpcChannel'
import type { S3Config, WebDavConfig } from '@shared/types/backup'
import { ZipArchive } from 'archiver'
import { Mutex } from 'async-mutex'
import Database from 'better-sqlite3'
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

interface DirectBackupMetadata {
  version: number
  timestamp: number
  appName: string
  appVersion: string
  platform: string
  arch: string
  resources: {
    database: true
    cache: true
    indexedDB: true
    localStorage: true
    appClaude: true
    data: boolean
  }
}

interface CopyDirOptions {
  dereferenceSymlinks: boolean
  excludeRelativePath?: (relativePath: string) => boolean
  sourceRootPath?: string
  sourceRootRealPath?: string
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

  /**
   * Backup metadata for direct backup format.
   *
   * Version 7 adds the v2 SQLite database and cache.json. Restore requires an
   * exact version match so v1's version 6 archives cannot overwrite v2 data.
   */
  private createDirectBackupMetadata(): DirectBackupMetadata {
    return {
      version: DIRECT_BACKUP_VERSION,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      resources: {
        database: true,
        cache: true,
        indexedDB: true,
        localStorage: true,
        appClaude: true,
        data: true
      }
    }
  }

  /**
   * Direct backup method - snapshots SQLite and copies cache.json plus the
   * retained IndexedDB and Local Storage directories.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @returns Path to the created backup file
   */
  async backup(_: Electron.IpcMainInvokeEvent, fileName: string, destinationPath?: string): Promise<string> {
    return this.operationMutex.runExclusive(() => this.backupDirect(fileName, destinationPath))
  }

  private async backupDirect(fileName: string, destinationPath: string | undefined): Promise<string> {
    const onProgress = this.onProgress(IpcChannel.BackupProgress, true)
    const workDir = await this.createOperationDir('create')
    const outputDirectory = destinationPath ?? this.backupDir
    const outputFileName = destinationPath ? fileName : `${randomUUID()}-${path.basename(fileName)}`
    const backupedFilePath = path.join(outputDirectory, outputFileName)
    let outputStarted = false

    try {
      await fs.ensureDir(outputDirectory)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      const userDataPath = application.getPath('app.userdata')
      onProgress({ stage: 'copying_database', progress: 15, total: 100 })
      logger.debug('[backupDirect] Capturing a consistent v2 data snapshot')

      const jobManager = application.get('JobManager')
      const quiesceHold = jobManager.pause('backup: capture consistent snapshot')
      try {
        await this.assertJobsDrained(jobManager)
        this.assertNoActiveDataWriters()

        const dbService = application.get('DbService')
        const liveDatabasePath = application.getPath('app.database.file')
        dbService.checkpointTruncate()
        const fingerprintBefore = await hashDbFile(liveDatabasePath)

        dbService.createSnapshot(path.join(workDir, 'cherrystudio.sqlite'))

        application.get('CacheService').flushPersistForBackup()
        const cacheSource = application.getPath('app.userdata', 'cache.json')
        if (!(await fs.pathExists(cacheSource))) {
          throw new Error('Failed to persist cache.json for backup')
        }
        await fs.copy(cacheSource, path.join(workDir, 'cache.json'))

        await this.copyDirectoryOrCreate(path.join(userDataPath, 'IndexedDB'), path.join(workDir, 'IndexedDB'))
        await this.copyDirectoryOrCreate(path.join(userDataPath, 'Local Storage'), path.join(workDir, 'Local Storage'))
        await this.copyAppClaudeState(path.join(workDir, '.claude'))

        onProgress({ stage: 'copying_database', progress: 50, total: 100 })

        const sourcePath = application.getPath('app.userdata.data')
        const tempDataDir = path.join(workDir, 'Data')

        if (await fs.pathExists(sourcePath)) {
          const copyOptions = this.createDataCopyOptions(sourcePath, true)
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

        await fs.writeJson(path.join(workDir, 'metadata.json'), this.createDirectBackupMetadata(), {
          spaces: 2
        })

        this.assertNoActiveDataWriters()
        dbService.checkpointTruncate()
        const fingerprintAfter = await hashDbFile(liveDatabasePath)
        if (fingerprintAfter !== fingerprintBefore) {
          throw new Error('Data changed while the backup snapshot was being captured. Please retry the backup.')
        }
      } finally {
        quiesceHold.dispose()
      }

      onProgress({ stage: 'compressing', progress: 80, total: 100 })

      const output = fs.createWriteStream(backupedFilePath)
      outputStarted = true
      const archive = new ZipArchive({
        zlib: { level: 1 },
        zip64: true
      })

      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve())
        output.on('error', reject)
        archive.on('error', reject)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            logger.warn('[backupDirect] Archive warning:', err)
          }
        })
        archive.pipe(output)
        archive.directory(workDir, false)
        archive.finalize()
      })

      onProgress({ stage: 'completed', progress: 100, total: 100 })
      logger.info('[backupDirect] Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[backupDirect] Backup failed:', error as Error)
      if (outputStarted) {
        await fs.remove(backupedFilePath).catch(() => {})
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
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    data: string,
    destinationPath: string = this.backupDir,
    skipBackupFile: boolean = false
  ): Promise<string> {
    return this.operationMutex.runExclusive(() =>
      this.backupLegacyUnlocked(fileName, data, destinationPath, skipBackupFile)
    )
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
  async backupToLocalDir(_: Electron.IpcMainInvokeEvent, fileName: string, localConfig: { localBackupDir?: string }) {
    try {
      const backupDir = localConfig.localBackupDir || this.backupDir
      await fs.ensureDir(backupDir)
      return await this.backup(_, fileName, backupDir)
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
    const backupedFilePath = await this.backup(_, filename)
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

    const backupedFilePath = await this.backup(_, filename)
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
   * Only the complete v2 direct format is accepted. Every v1 format — direct
   * version 6, metadata-less ZIP versions 1-5, and renderer-side .bak — is
   * intentionally incompatible with the v2 SQLite ownership model.
   * @param _ - Electron IPC event
   * @param backupPath - Path to the backup ZIP file
   */
  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<void> {
    return this.operationMutex.runExclusive(() => this.restoreUnlocked(backupPath))
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

      if (metadata.platform && metadata.platform !== process.platform) {
        logger.warn(
          `[restoreDirect] Cross-platform restore: backup from ${metadata.platform}, current is ${process.platform}`
        )
      }

      onProgress({ stage: 'validating', progress: 25, total: 100 })
      onProgress({ stage: 'restoring_database', progress: 30, total: 100 })

      const workDatabase = path.join(restoreDir, 'work.sqlite')
      const stagedCache = path.join(restoreDir, 'resources', 'cache.json')
      const stagedIndexedDB = path.join(restoreDir, 'resources', 'IndexedDB')
      const stagedLocalStorage = path.join(restoreDir, 'resources', 'Local Storage')
      const stagedData = path.join(restoreDir, 'resources', 'Data')
      const appClaudeDataPath = this.toDataRelative(application.getPath('feature.agents.claude.root'))
      const bundleClaudeWithData = metadata.resources.data && appClaudeDataPath !== null
      const stagedClaude = bundleClaudeWithData
        ? path.join(stagedData, appClaudeDataPath)
        : path.join(restoreDir, 'resources', '.claude')

      await this.assertArchiveFile(path.join(extractionDir, 'cherrystudio.sqlite'), 'SQLite database')
      await this.assertArchiveFile(path.join(extractionDir, 'cache.json'), 'cache.json')
      await fs.copy(path.join(extractionDir, 'cherrystudio.sqlite'), workDatabase)
      await fs.copy(path.join(extractionDir, 'cache.json'), stagedCache)

      await this.stageArchiveDirectory(path.join(extractionDir, 'IndexedDB'), stagedIndexedDB)
      await this.stageArchiveDirectory(path.join(extractionDir, 'Local Storage'), stagedLocalStorage)

      if (metadata.resources.data) {
        const dataSource = path.join(extractionDir, 'Data')
        await this.assertArchiveDirectory(dataSource, 'Data')
        const copyOptions = this.createDataCopyOptions(dataSource, false)
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
      await this.copyClaudeState(path.join(extractionDir, '.claude'), stagedClaude)

      const chain = this.validateStagedDatabase(workDatabase)
      onProgress({ stage: 'restoring_database', progress: 65, total: 100 })

      const fileResources: RestoreJournal['fileResources'] = []
      fileResources.push(
        await this.createJournalResource({
          restoreDir,
          stagingPath: stagedCache,
          livePath: application.getPath('app.userdata', 'cache.json'),
          directory: false
        }),
        await this.createJournalResource({
          restoreDir,
          stagingPath: stagedIndexedDB,
          livePath: path.join(userDataPath, 'IndexedDB'),
          directory: true
        }),
        await this.createJournalResource({
          restoreDir,
          stagingPath: stagedLocalStorage,
          livePath: path.join(userDataPath, 'Local Storage'),
          directory: true
        })
      )
      if (metadata.resources.data) {
        fileResources.push(...(await this.createDataJournalResources(restoreDir, stagedData)))
      }
      if (!bundleClaudeWithData) {
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
        logger.info('[restoreDirect] Restore journal committed, relaunching app to promote it', { restoreId })
        application.relaunch()
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
    if (raw.version !== DIRECT_BACKUP_VERSION) {
      throw new Error(
        `Unsupported backup version ${String(raw.version)}. Cherry Studio v2 can only restore backup version ${DIRECT_BACKUP_VERSION}.`
      )
    }

    const resources = raw.resources as Record<string, unknown> | undefined
    if (
      !resources ||
      resources.database !== true ||
      resources.cache !== true ||
      resources.indexedDB !== true ||
      resources.localStorage !== true ||
      resources.appClaude !== true ||
      typeof resources.data !== 'boolean'
    ) {
      throw new Error('Backup version 7 metadata is incomplete')
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

  private createDataCopyOptions(sourceRootPath: string, dereferenceSymlinks: boolean): CopyDirOptions {
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
      const fd = fs.openSync(entryPath, 'r')
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
    const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
    const webdavClient = this.getWebDavInstance(webdavConfig)
    const downloadDir = await this.createOperationDir('webdav-download')
    const backupedFilePath = path.join(downloadDir, path.basename(filename))
    try {
      const retrievedFile = await webdavClient.getFileContents(filename)

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
    } finally {
      await fs.remove(downloadDir).catch(() => {})
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
    const downloadDir = await this.createOperationDir('s3-download')
    const backupedFilePath = path.join(downloadDir, path.basename(filename))
    try {
      const retrievedFile = await s3Client.getFileContents(filename)
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(backupedFilePath)
        writeStream.write(retrievedFile)
        writeStream.end()
        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      logger.info(`S3 restore file downloaded successfully: ${filename}`)
      return await this.restore(_, backupedFilePath)
    } catch (error: any) {
      logger.error('[BackupManager] Failed to restore from S3:', error)
      throw new Error(error.message || 'Failed to restore backup file')
    } finally {
      await fs.remove(downloadDir).catch(() => {})
    }
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
    if (verdict.stragglerIds.length > 0 || verdict.startupRecoveryPending) {
      throw new Error('Background data writes did not quiesce in time. Please retry after current tasks finish.')
    }
  }

  private assertNoActiveDataWriters(): void {
    if (
      application.get('AiStreamManager').hasLiveStreams() ||
      application.get('AgentSessionRuntimeService').hasBusySessions()
    ) {
      throw new Error('A conversation is still running. Wait for it to finish, then retry the backup or restore.')
    }
  }

  private async copyDirectoryOrCreate(source: string, destination: string): Promise<void> {
    if (!(await fs.pathExists(source))) {
      await fs.ensureDir(destination)
      return
    }

    const stats = await fs.lstat(source)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Expected an application data directory: ${source}`)
    }
    await this.copyDirWithProgress(source, destination, () => {}, { dereferenceSymlinks: false })
  }

  private async copyAppClaudeState(destination: string): Promise<void> {
    const source = application.getPath('feature.agents.claude.root')
    if (!(await fs.pathExists(source))) {
      await fs.ensureDir(destination)
      return
    }
    await this.copyClaudeState(source, destination)
  }

  /**
   * Copy Cherry Studio's private CLAUDE_CONFIG_DIR while excluding the
   * generated `skills/` mirror. Never follows symlinks, so an archive cannot
   * pull in the user's external ~/.claude or another external tree.
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
        logger.warn('[backupDirect] Skipping symlink in application .claude state', { path: sourcePath })
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
  listWebdavFiles = async (_: Electron.IpcMainInvokeEvent, config: WebDavConfig) => {
    try {
      const client = this.getWebDavInstance(config)
      const files = await client.getDirectoryContents()

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
    onProgress: (size: number) => void,
    options: CopyDirOptions
  ): Promise<void> {
    const copyOptions = {
      ...options,
      sourceRootPath: options.sourceRootPath ?? source,
      sourceRootRealPath: options.sourceRootRealPath ?? (await fs.realpath(source))
    }
    const activeDirectoryRealPaths = new Set<string>()

    const copyDir = async (src: string, dest: string): Promise<void> => {
      const directoryRealPath = await this.enterDirectory(src, activeDirectoryRealPaths)

      if (!directoryRealPath) {
        return
      }

      try {
        await fs.ensureDir(dest)

        const items = await fs.readdir(src, { withFileTypes: true })

        for (const item of items) {
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
            if (entry.isSymlink) {
              await fs.copy(sourcePath, destPath, { dereference: true })
            } else {
              await fs.copy(sourcePath, destPath)
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
