import { createHash } from 'node:crypto'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { pathExists } from '@main/utils/legacyFile'
import { findSkillMdPath } from '@main/utils/markdownParser'
import { SKILL_DIRECTORY_CONTENT_HASH_PREFIX } from '@shared/utils/skillMarketplace'
import * as fs from 'fs'

const logger = loggerService.withContext('SkillInstaller')

export interface PreparedSkillInstall {
  commit(): Promise<void>
  rollback(): Promise<void>
}

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
    const prepared = await this.prepareInstall(sourceDir, destPath)
    try {
      await prepared.commit()
    } catch (error) {
      try {
        await prepared.rollback()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to commit and restore Skill folder: ${destPath}`)
      }
      throw error
    }
  }

  /** Publish verified files while keeping the prior directory available for rollback. */
  async prepareInstall(sourceDir: string, destPath: string): Promise<PreparedSkillInstall> {
    if (path.resolve(sourceDir) === path.resolve(destPath)) {
      logger.debug('Source equals destination, skipping copy', { destPath })
      return { commit: async () => undefined, rollback: async () => undefined }
    }

    const sourceHash = await this.computeDirectoryHash(sourceDir)
    await this.recoverInterruptedInstall(destPath)
    await this.removeCommittedCleanup(destPath)

    const backupPath = this.getBackupPath(destPath)
    let hasBackup = false
    let publishStarted = false

    try {
      if (await pathExists(destPath)) {
        await fs.promises.rename(destPath, backupPath)
        hasBackup = true
        publishStarted = true
        logger.debug('Backed up existing skill folder', { backupPath })
      }

      publishStarted = true
      await copyDirectoryRecursive(sourceDir, destPath)
      // Do not commit the replacement until every copied directory and regular file matches the
      // source. The shared copy helper deliberately skips a source file that disappears mid-copy;
      // the tree hash turns that partial copy into a failed publish instead of silently committing it.
      const installedHash = await this.computeDirectoryHash(destPath)
      if (installedHash !== sourceHash) {
        throw new Error(`Installed skill content did not match the source: ${destPath}`)
      }
      logger.debug('Skill folder copied to destination', { destPath })
    } catch (error) {
      if (!publishStarted) throw error
      try {
        await this.rollbackPublishedInstall(destPath, backupPath, hasBackup)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to publish and restore Skill folder: ${destPath}`)
      }
      throw error
    }

    let state: 'pending' | 'committed' | 'rolled_back' = 'pending'
    return {
      commit: async () => {
        if (state !== 'pending') return
        if (hasBackup) {
          const cleanupPath = this.getCleanupPath(destPath)
          await fs.promises.rename(backupPath, cleanupPath)
          hasBackup = false
          state = 'committed'
          await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
          return
        }
        state = 'committed'
      },
      rollback: async () => {
        if (state !== 'pending') return
        await this.rollbackPublishedInstall(destPath, backupPath, hasBackup)
        hasBackup = false
        state = 'rolled_back'
      }
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
      const backupMatch = entry.name.match(/^\.(.+)\.bak$/)
      if (backupMatch?.[1]) {
        await this.recoverInterruptedInstall(path.join(storageRoot, backupMatch[1]))
        continue
      }

      const cleanupMatch = entry.name.match(/^\.(.+)\.cleanup$/)
      if (cleanupMatch?.[1]) {
        await this.safeRemoveDirectory(path.join(storageRoot, entry.name), 'committed skill backup')
      }
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

  /** Compute the versioned full-directory hash persisted as the install baseline. */
  async computeContentHash(
    skillDir: string,
    options: { ignoredRelativePaths?: readonly string[] } = {}
  ): Promise<string> {
    return `${SKILL_DIRECTORY_CONTENT_HASH_PREFIX}${await this.computeDirectoryHash(skillDir, options)}`
  }

  /**
   * Compute a deterministic SHA-256 hash of every directory and regular file
   * that the installer copies. Symlinks and special files are skipped by both
   * this hash and `copyDirectoryRecursive`.
   */
  async computeDirectoryHash(
    skillDir: string,
    options: { ignoredRelativePaths?: readonly string[] } = {}
  ): Promise<string> {
    const skillMdPath = await findSkillMdPath(skillDir)
    if (!skillMdPath) {
      throw new Error(`SKILL.md not found in ${skillDir}`)
    }

    const hash = createHash('sha256')
    const ignored = new Set(options.ignoredRelativePaths ?? [])
    await this.updateDirectoryHash(hash, skillDir, '', ignored)
    return hash.digest('hex')
  }

  private async updateDirectoryHash(
    hash: ReturnType<typeof createHash>,
    directory: string,
    relativeDirectory: string,
    ignored: ReadonlySet<string>
  ): Promise<void> {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (ignored.has(relativePath)) continue

      const fullPath = path.join(directory, entry.name)
      const stats = await fs.promises.lstat(fullPath)
      if (stats.isSymbolicLink()) continue

      if (stats.isDirectory()) {
        hash.update(`D:${Buffer.byteLength(relativePath)}:`).update(relativePath)
        await this.updateDirectoryHash(hash, fullPath, relativePath, ignored)
      } else if (stats.isFile()) {
        const content = await fs.promises.readFile(fullPath)
        hash
          .update(`F:${Buffer.byteLength(relativePath)}:`)
          .update(relativePath)
          .update(`:${content.byteLength}:`)
          .update(content)
      }
    }
  }

  private getBackupPath(destPath: string): string {
    return path.join(path.dirname(destPath), `.${path.basename(destPath)}.bak`)
  }

  private getCleanupPath(destPath: string): string {
    return path.join(path.dirname(destPath), `.${path.basename(destPath)}.cleanup`)
  }

  private async removeCommittedCleanup(destPath: string): Promise<void> {
    const cleanupPath = this.getCleanupPath(destPath)
    try {
      const cleanupStats = await fs.promises.lstat(cleanupPath)
      if (!cleanupStats.isDirectory()) {
        throw new Error(`Committed skill cleanup marker is not a directory: ${cleanupPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    await deleteDirectoryRecursive(cleanupPath)
  }

  private async rollbackPublishedInstall(destPath: string, backupPath: string, hasBackup: boolean): Promise<void> {
    try {
      await deleteDirectoryRecursive(destPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!hasBackup) return
    await fs.promises.rename(backupPath, destPath)
    logger.debug('Restored skill folder backup', { backupPath, destPath })
  }

  private async safeRemoveDirectory(targetPath: string, label: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(targetPath)
    } catch (error) {
      logger.error(`Failed to remove ${label}`, {
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
