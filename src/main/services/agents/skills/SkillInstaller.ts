import * as crypto from 'node:crypto'

import { loggerService } from '@logger'
import { pathExists } from '@main/utils/file'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
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
   */
  async install(sourceDir: string, destPath: string): Promise<void> {
    const backupPath = `${destPath}.bak`
    let hasBackup = false

    try {
      if (await pathExists(destPath)) {
        await this.safeRemoveDirectory(backupPath, 'stale backup')
        await fs.promises.rename(destPath, backupPath)
        hasBackup = true
        logger.debug('Backed up existing skill folder', { backupPath })
      }

      await copyDirectoryRecursive(sourceDir, destPath)
      logger.debug('Skill folder copied to destination', { destPath })

      if (hasBackup) {
        await this.safeRemoveDirectory(backupPath, 'backup skill folder')
      }
    } catch (error) {
      if (hasBackup) {
        await this.safeRemoveDirectory(destPath, 'partial skill folder')
        await this.safeRename(backupPath, destPath, 'skill folder backup')
      }
      throw error
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
    return crypto.createHash('sha256').update(content).digest('hex')
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
