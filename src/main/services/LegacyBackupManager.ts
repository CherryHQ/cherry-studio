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
import * as path from 'path'

import { ZipArchive } from 'archiver'
import { Mutex } from 'async-mutex'
import * as fs from 'fs-extra'

import { application } from '@application'
import { loggerService } from '@logger'
import { BACKUP_DISK_FULL_ERROR_CODE } from '@shared/types/backup'

const logger = loggerService.withContext('BackupManager')
const STALE_TEMP_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000
const BACKUP_OPERATION_DIR_PATTERN =
  /^(?:create|lan-create|extract|webdav-download|s3-download)-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const BACKUP_TEMP_ARCHIVE_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-.+\.zip$/i
// Backup archives hold every stored credential; the shared-OS-temp staging tree
// must not be readable by other local users (S8 hardening).
const BACKUP_ARCHIVE_FILE_MODE = 0o600
const BACKUP_TEMP_DIR_MODE = 0o700

class BackupManager {
  private readonly operationMutex = new Mutex()

  private get backupDir(): string {
    return application.getPath('feature.backup.temp')
  }

  async cleanupStaleTempArtifacts(): Promise<void> {
    const cutoff = Date.now() - STALE_TEMP_ARTIFACT_AGE_MS

    // Best-effort boot hardening: pre-existing 0755 roots are fixed even with
    // no operation running; ENOENT (never used yet) is expected and silent.
    // The restore-staging root seals crash-recovered trees too — 0700 on the
    // root blocks traversal into any pre-existing subtree.
    await this.hardenStagingRootBestEffort(this.backupDir)
    await this.hardenStagingRootBestEffort(application.getPath('feature.lan_transfer.temp'))
    await this.hardenStagingRootBestEffort(application.getPath('feature.backup.restore.staging'))

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
   * Legacy backup method (JSON format, used by LanTransfer)
   * Creates a backup in the old format with data.json and optional Data directory.
   * @param _ - Electron IPC event
   * @param fileName - Name of the backup file
   * @param data - JSON string data to backup
   * @param destinationPath - Path to save the backup (defaults to this.backupDir)
   * @param skipBackupFile - Whether to skip backing up the Data directory
   * @returns Path to the created backup file
   */
  private async backupLegacy(fileName: string, data: string, destinationPath: string): Promise<string> {
    return this.operationMutex.runExclusive(() => this.backupLegacyUnlocked(fileName, data, destinationPath))
  }

  private async backupLegacyUnlocked(fileName: string, data: string, destinationPath: string): Promise<string> {
    const workDir = await this.createOperationDir('lan-create')

    try {
      await fs.promises.writeFile(path.join(workDir, 'data.json'), data)
      // An empty `Data` directory is still required — restore fails without it.
      await fs.promises.mkdir(path.join(workDir, 'Data'))

      const backupedFilePath = path.join(destinationPath, fileName)
      // createWriteStream's mode only applies at file creation; pre-tighten an
      // existing target so an overwrite cannot keep a looser mode (S8).
      await fs.chmod(backupedFilePath, BACKUP_ARCHIVE_FILE_MODE).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error(`Failed to restrict backup archive permissions (${backupedFilePath}): ${String(error)}`)
        }
      })
      const output = fs.createWriteStream(backupedFilePath, { mode: BACKUP_ARCHIVE_FILE_MODE })

      // Create archiver instance, enable ZIP64 support
      const archive = new ZipArchive({
        zlib: { level: 1 }, // Lowest compression level: this runs on a LAN, speed wins
        zip64: true
      })

      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve())
        archive.on('error', reject)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            logger.warn('[BackupManager] Archive warning:', err)
          }
        })

        archive.pipe(output)
        archive.directory(workDir, false)
        archive.finalize()
      })

      logger.info('Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      logger.error('[BackupManager] Backup failed:', error as Error)
      throw error
    } finally {
      await fs.remove(workDir).catch(() => {})
    }
  }

  // ==================== File Utility Methods ====================
  // These are helper methods for file operations like size calculation,
  // directory copying with progress, and permission management.

  /** Staging dirs hold full-backup content (S8); a chmod failure aborts the
   * backup rather than writing payloads under looser permissions. */
  private async ensurePrivateDir(dir: string): Promise<void> {
    // 0700 at creation closes the ensureDir→chmod exposure window; 0700 has no
    // group/other bits, so umask cannot loosen it.
    await fs.ensureDir(dir, { mode: BACKUP_TEMP_DIR_MODE })
    await fs.chmod(dir, BACKUP_TEMP_DIR_MODE).catch((error) => {
      throw new Error(`Failed to restrict backup staging dir permissions (${dir}): ${String(error)}`)
    })
  }

  /** Boot-time variant: opportunistic, must never block startup (ENOENT silent). */
  private async hardenStagingRootBestEffort(dir: string): Promise<void> {
    await fs.chmod(dir, BACKUP_TEMP_DIR_MODE).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[cleanupStaleTempArtifacts] Failed to restrict backup staging dir permissions', { dir, error })
      }
    })
  }

  private async createOperationDir(prefix: string): Promise<string> {
    // Every sensitive flow (create/extract/webdav-download/...) passes through here, so the
    // staging root is hardened at the same choke point; chmod also fixes pre-existing 0755 dirs.
    await this.ensurePrivateDir(this.backupDir)
    const operationDir = path.join(this.backupDir, `${prefix}-${randomUUID()}`)
    try {
      await this.ensurePrivateDir(operationDir)
    } catch (error) {
      const reportedError = await this.withAvailableDiskSpace(error, this.backupDir)
      throw reportedError
    }
    return operationDir
  }

  // ==================== WebDAV Methods ====================
  // These methods handle backup operations with WebDAV servers.

  // ==================== Local Backup Methods ====================
  // These methods handle backup operations with local directories.

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

    // The LAN staging dir sits in the shared OS temp tree; keep it owner-only
    // when using the default (user-chosen destinations keep their own perms).
    if (targetPath === tempPath) {
      await this.ensurePrivateDir(targetPath)
    } else {
      await fs.ensureDir(targetPath)
    }

    // Create backup with skipBackupFile=true (no Data folder)
    const backupedFilePath = await this.backupLegacy(fileName, data, targetPath)

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

  private async withAvailableDiskSpace(error: unknown, fallbackDirectory: string): Promise<unknown> {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOSPC') {
      return error
    }

    const fileError = error as NodeJS.ErrnoException & { dest?: string }
    const failedPath = fileError.dest ?? fileError.path
    const probePath = failedPath ? path.dirname(failedPath) : fallbackDirectory

    try {
      const stats = await fs.promises.statfs(probePath)
      return new Error(`${BACKUP_DISK_FULL_ERROR_CODE}:${stats.bsize * stats.bavail}`)
    } catch (statError) {
      logger.warn('Failed to read available disk space after ENOSPC', { probePath, statError })
      return error
    }
  }
}

export { BackupManager }
export const legacyBackupManager = new BackupManager()

export default BackupManager
