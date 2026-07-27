import { createHash } from 'node:crypto'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { pathExists } from '@main/utils/legacyFile'
import { findSkillMdPath } from '@main/utils/markdownParser'
import * as fs from 'fs'

const logger = loggerService.withContext('SkillInstaller')

/**
 * Filesystem operations for the global skill registry.
 *
 * Handles copying skill directories to the global skills path,
 * backup-restore on failure, and content hash computation.
 */
export class SkillInstaller {
  /**
   * Install a skill folder to the destination path with backup-restore safety.
   *
   * If sourceDir and destPath resolve to the same location, the files are
   * already in place (in-place registration flow) and no copy is performed.
   */
  async install(sourceDir: string, destPath: string): Promise<void> {
    if (path.resolve(sourceDir) === path.resolve(destPath)) {
      logger.debug('Source equals destination, skipping copy', { destPath })
      return
    }

    const sourceHash = await this.computeContentHash(sourceDir)
    await this.recoverInterruptedInstall(destPath)

    const backupPath = this.getBackupPath(destPath)
    let hasBackup = false

    try {
      if (await pathExists(destPath)) {
        await fs.promises.rename(destPath, backupPath)
        hasBackup = true
        logger.debug('Backed up existing skill folder', { backupPath })
      }

      await copyDirectoryRecursive(sourceDir, destPath)
      // Do not commit the replacement until its required descriptor can be resolved and read.
      // A copy helper may return after a partial write (for example after an interrupted filesystem
      // operation); in that case keep the backup marker and restore the complete old directory.
      const installedHash = await this.computeContentHash(destPath)
      if (installedHash !== sourceHash) {
        throw new Error(`Installed skill content did not match the source: ${destPath}`)
      }
      logger.debug('Skill folder copied to destination', { destPath })

      if (hasBackup) {
        await deleteDirectoryRecursive(backupPath)
      }
    } catch (error) {
      await this.safeRemoveDirectory(destPath, 'partial skill folder')
      if (hasBackup) {
        await this.safeRename(backupPath, destPath, 'skill folder backup')
      }
      throw error
    }
  }

  /**
   * Restore the complete old directory when a process exited before deleting its
   * backup marker. The replacement is uncommitted while that marker exists.
   */
  async recoverInterruptedInstall(destPath: string): Promise<void> {
    const backupPath = this.getBackupPath(destPath)
    let backupStats: fs.Stats
    try {
      backupStats = await fs.promises.lstat(backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!backupStats.isDirectory()) {
      logger.warn('Ignoring non-directory skill backup marker', { backupPath })
      return
    }

    if (await pathExists(destPath)) {
      await this.safeRemoveDirectory(destPath, 'uncommitted skill folder')
    }

    await fs.promises.rename(backupPath, destPath)
    logger.info('Recovered interrupted skill install', { destPath, backupPath })
  }

  /** Restore every interrupted publish before reconcile considers pruning. */
  async recoverInterruptedInstalls(storageRoot: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(storageRoot, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(/^\.(.+)\.bak$/)
      if (!match?.[1]) continue
      await this.recoverInterruptedInstall(path.join(storageRoot, match[1]))
    }
  }

  /**
   * Remove a skill folder.
   */
  async uninstall(skillPath: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(skillPath)
      logger.info('Skill folder deleted', { skillPath })
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        throw error
      }
      logger.warn('Skill folder already deleted', { skillPath })
    }
  }

  /**
   * Compute SHA-256 hash of the SKILL.md content for change detection.
   */
  async computeContentHash(skillDir: string): Promise<string> {
    const skillMdPath = await findSkillMdPath(skillDir)
    if (!skillMdPath) {
      throw new Error(`SKILL.md not found in ${skillDir}`)
    }
    const content = await fs.promises.readFile(skillMdPath, 'utf-8')
    return createHash('sha256').update(content).digest('hex')
  }

  private getBackupPath(destPath: string): string {
    return path.join(path.dirname(destPath), `.${path.basename(destPath)}.bak`)
  }

  private async safeRename(from: string, to: string, label: string): Promise<void> {
    try {
      await fs.promises.rename(from, to)
      logger.debug(`Restored ${label}`, { from, to })
    } catch (error) {
      logger.error(`Failed to restore ${label}`, {
        from,
        to,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async safeRemoveDirectory(targetPath: string, label: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(targetPath)
    } catch (error) {
      logger.error(`Failed to rollback ${label}`, {
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
