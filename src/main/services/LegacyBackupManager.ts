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

import { application } from '@application'
import { loggerService } from '@logger'
import { ZipArchive } from 'archiver'
import { Mutex } from 'async-mutex'
import * as fs from 'fs-extra'
import * as path from 'path'

const logger = loggerService.withContext('BackupManager')

class BackupManager {
  private readonly operationMutex = new Mutex()

  private get backupDir(): string {
    return application.getPath('feature.backup.temp')
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
      const output = fs.createWriteStream(backupedFilePath)
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

  private async createOperationDir(prefix: string): Promise<string> {
    const operationDir = path.join(this.backupDir, `${prefix}-${randomUUID()}`)
    await fs.ensureDir(operationDir)
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

    // Ensure temp directory exists
    await fs.ensureDir(targetPath)

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
}

export { BackupManager }

export default BackupManager
