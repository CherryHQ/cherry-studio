import * as fs from 'fs'
import { createHash } from 'node:crypto'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { pathExists } from '@main/utils/legacyFile'
import { findSkillMdPath } from '@main/utils/markdownParser'
import {
  isSkillDirectoryContentHash,
  SKILL_DIRECTORY_CONTENT_HASH_PREFIX,
  SKILL_DIRECTORY_CONTENT_HASH_PREFIX_V2
} from '@shared/utils/skillMarketplace'

import { SkillImportError } from './SkillImportError'

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
  async prepareInstall(
    sourceDir: string,
    destPath: string,
    baselineHash?: string | null
  ): Promise<PreparedSkillInstall> {
    if (path.resolve(sourceDir) === path.resolve(destPath)) {
      logger.debug('Source equals destination, skipping copy', { destPath })
      return { commit: async () => undefined, rollback: async () => undefined }
    }

    const sourceHash = await this.computeDirectoryHash(sourceDir)
    if (baselineHash) {
      // Baseline-aware recovery keeps a committed replacement that already matches
      // the persisted hash instead of restoring an obsolete backup over it. The
      // generic fallback would resurrect the old tree and break the next update.
      await this.recoverInterruptedInstallWithBaseline(destPath, baselineHash)
    } else {
      await this.recoverInterruptedInstall(destPath)
    }
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

    // Never restore an incomplete backup over a complete replacement. A partial
    // `.bak` cleanup (e.g. SKILL.md deleted before the sweep) must not delete the
    // valid destination; drop the fragment instead and keep the installed tree.
    const backupDescriptor = await findSkillMdPath(backupPath)
    if (!backupDescriptor) {
      logger.warn('Ignoring incomplete skill backup without a descriptor; preserving installed tree', {
        destPath,
        backupPath
      })
      await this.safeRemoveDirectory(backupPath, 'incomplete skill backup')
      return
    }

    if (await pathExists(destPath)) {
      await this.safeRemoveDirectory(destPath, 'uncommitted skill folder')
    }

    await fs.promises.rename(backupPath, destPath)
    logger.info('Recovered interrupted skill install', { destPath, backupPath })
  }

  /**
   * Recover an interrupted publish by keeping whichever complete tree matches the
   * persisted install baseline. A crash after SQLite commits the new hash but before
   * `prepared.commit()` leaves new files with a `.bak` holding the old tree; the
   * default restore would resurrect the old tree against the new baseline and report
   * `up_to_date` with local changes while the old version is installed. Comparing
   * both trees to the baseline keeps the matching one: a new tree matching a new
   * baseline completes the commit, an old backup matching an old baseline rolls back.
   */
  async recoverInterruptedInstallWithBaseline(destPath: string, baselineHash: string | null): Promise<void> {
    const backupPath = this.getBackupPath(destPath)
    const cleanupPath = this.getCleanupPath(destPath)
    const [backupExists, cleanupExists] = await Promise.all([pathExists(backupPath), pathExists(cleanupPath)])
    if (!backupExists && !cleanupExists) return
    if (!baselineHash || !isSkillDirectoryContentHash(baselineHash)) {
      await this.recoverInterruptedInstall(destPath)
      if (cleanupExists) {
        await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      }
      return
    }

    const hashOf = async (target: string): Promise<string | null> => {
      try {
        const stats = await fs.promises.lstat(target)
        if (!stats.isDirectory()) return null
        return await this.computeContentHash(target)
      } catch {
        return null
      }
    }
    const [destHash, backupHash, cleanupHash] = await Promise.all([
      hashOf(destPath),
      backupExists ? hashOf(backupPath) : Promise.resolve(null),
      cleanupExists ? hashOf(cleanupPath) : Promise.resolve(null)
    ])

    if (destHash === baselineHash) {
      // The replacement is committed and matches the baseline: both markers hold
      // obsolete trees. Delete the backup via the cleanup marker first so a partial
      // deletion leaves a `.cleanup` (swept by deletion) rather than a `.bak`
      // (which the generic sweep would restore over the good replacement).
      if (cleanupExists) await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      if (backupExists) {
        try {
          await fs.promises.rename(backupPath, cleanupPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // Backup vanished between the existence check and the rename: nothing
            // obsolete remains, fall through to delete any staged cleanup.
          } else {
            // Keep the obsolete backup intact when staging fails. Deleting it in
            // place could leave a partial `.bak` (e.g. SKILL.md removed before
            // failure) that the generic sweep would restore over the valid
            // baseline-matching replacement. Preserve the replacement and retry
            // staging on the next startup; the baseline-aware sweep runs before
            // the generic one so the good tree survives.
            logger.warn('Failed to stage committed backup for cleanup; preserving replacement for retry', {
              destPath,
              backupPath,
              error: error instanceof Error ? error.message : String(error)
            })
            logger.info('Recovered interrupted skill install by keeping matching replacement', { destPath })
            return
          }
        }
        await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      }
      logger.info('Recovered interrupted skill install by keeping matching replacement', { destPath })
      return
    }
    if (backupHash === baselineHash) {
      try {
        await deleteDirectoryRecursive(destPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await fs.promises.rename(backupPath, destPath)
      if (cleanupExists) await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      logger.info('Recovered interrupted skill install by restoring matching backup', { destPath })
      return
    }
    if (cleanupHash === baselineHash) {
      try {
        await deleteDirectoryRecursive(destPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await fs.promises.rename(cleanupPath, destPath)
      if (backupExists) await this.safeRemoveDirectory(backupPath, 'uncommitted skill folder')
      logger.info('Recovered interrupted skill install by restoring matching cleanup', { destPath })
      return
    }

    await this.recoverInterruptedInstall(destPath)
    if (cleanupExists) {
      try {
        await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      } catch {
        // Best-effort: the default restore already preserved the old complete tree.
      }
    }
  }

  /** Restore every interrupted publish before reconcile considers pruning. */
  async recoverInterruptedInstalls(
    storageRoot: string,
    options: { skipFolderNames?: ReadonlySet<string> } = {}
  ): Promise<void> {
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
        // Baseline-aware recovery already handled catalogued skills before this
        // generic sweep. Skipping them preserves a baseline-matching replacement
        // when obsolete-backup staging failed and left the `.bak` behind for retry.
        if (options.skipFolderNames?.has(backupMatch[1])) continue
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
    return `${SKILL_DIRECTORY_CONTENT_HASH_PREFIX_V2}${await this.computeDirectoryHash(skillDir, options)}`
  }

  /**
   * Compute the pre-executability, pre-canonicalization baseline for skills installed
   * before mode bits entered the fingerprint. The released format sorted by raw name,
   * hashed the on-disk relative path (so `skill.md` stayed lowercase) and ignored
   * POSIX mode entirely. Non-executable skills hash identically under both formats;
   * executable helpers differ, so an untouched legacy install reports a false
   * `localChanges` unless the old fingerprint is consulted. Used only to decide
   * whether the managed tree is truly edited — never persisted as a new baseline.
   */
  async computeLegacyContentHash(
    skillDir: string,
    options: { ignoredRelativePaths?: readonly string[] } = {}
  ): Promise<string> {
    return `${SKILL_DIRECTORY_CONTENT_HASH_PREFIX}${await this.computeLegacyDirectoryHash(skillDir, options)}`
  }

  async computeLegacyDirectoryHash(
    skillDir: string,
    options: { ignoredRelativePaths?: readonly string[] } = {}
  ): Promise<string> {
    const skillMdPath = await findSkillMdPath(skillDir)
    if (!skillMdPath) {
      throw new SkillImportError('SKILL_DIRECTORY_NOT_FOUND', `SKILL.md not found in ${skillDir}`)
    }

    const hash = createHash('sha256')
    const ignored = new Set(options.ignoredRelativePaths ?? [])
    await this.updateLegacyDirectoryHash(hash, skillDir, '', ignored)
    return hash.digest('hex')
  }

  private async updateLegacyDirectoryHash(
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
        await this.updateLegacyDirectoryHash(hash, fullPath, relativePath, ignored)
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
      throw new SkillImportError('SKILL_DIRECTORY_NOT_FOUND', `SKILL.md not found in ${skillDir}`)
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
    // Sort by the canonical hash path so a top-level `skill.md` and its normalized
    // `SKILL.md` snapshot share the same order. Sorting by the raw name would place
    // `scripts` before lowercase `skill.md` but after uppercase `SKILL.md`, making a
    // stable source fail snapshot validation on case-sensitive filesystems.
    const canonicalSortKey = (name: string): string =>
      relativeDirectory === '' && name.toLowerCase() === 'skill.md' ? 'SKILL.md' : name
    entries.sort((a, b) => {
      const aKey = canonicalSortKey(a.name)
      const bKey = canonicalSortKey(b.name)
      if (aKey < bKey) return -1
      if (aKey > bKey) return 1
      if (a.name < b.name) return -1
      if (a.name > b.name) return 1
      return 0
    })

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
        // Canonicalize the top-level descriptor for hashing so `skill.md` and `SKILL.md`
        // with identical bytes share a baseline. The copy still preserves the on-disk
        // casing; snapshots normalize to `SKILL.md` before hashing/installing and
        // reconcile migrates the managed copy, so only pre-existing lowercase baselines
        // differ (handled by healing when the managed tree matches its source).
        const hashPath = relativeDirectory === '' && entry.name.toLowerCase() === 'skill.md' ? 'SKILL.md' : relativePath
        const content = await fs.promises.readFile(fullPath)
        // Include executability so a mode-only source change is an update and a managed
        // mode edit requires explicit overwrite. Non-executable files hash exactly as
        // before, so existing baselines without executable helpers need no migration.
        // The exact exec-bit value is hashed (not just a boolean) so removing only the
        // owner execute bit (0755 -> 0655) still changes the fingerprint.
        const execBits = stats.mode & 0o111
        if (execBits !== 0) {
          hash
            .update(`F:${Buffer.byteLength(hashPath)}:`)
            .update(hashPath)
            .update(`:exec-${execBits.toString(8)}:${content.byteLength}:`)
            .update(content)
        } else {
          hash
            .update(`F:${Buffer.byteLength(hashPath)}:`)
            .update(hashPath)
            .update(`:${content.byteLength}:`)
            .update(content)
        }
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
