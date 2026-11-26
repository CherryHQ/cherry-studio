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
    // A previous retry may have stashed a preserved `.bak` aside and then crashed
    // before publishing. The stash (`<backup>.stash-*`) is the only complete copy
    // while `.bak` is missing, but the startup sweep only looks for `.bak`/`.cleanup`.
    // Restore it to the rollback slot before freeing that slot again.
    await this.restoreStashedBackup(destPath)
    await this.removeCommittedCleanup(destPath)

    const backupPath = this.getBackupPath(destPath)
    // A previous baseline-aware recovery may have preserved an obsolete `.bak` because
    // neither tree matched the baseline and completeness was uncertain (a truncated helper
    // passes path coverage, so paths alone cannot prove the replacement complete). POSIX
    // `rename(dest, backup)` fails when `backup` is occupied, leaving a broken partial
    // install in place. Stash the preserved marker aside so the next publish has a free
    // rollback slot; the stash is deleted only after the new verified install commits
    // (durable publish state), and restored to `.bak` if the retry fails.
    // An obsolete `.bak` is superseded and must never be stashed: stashing would leave
    // its `<backup>.obsolete` record behind while the edited tree moved from `dest`
    // reuses the `.bak` path, so a crash after `rename(dest, .bak)` would look
    // obsolete and delete the only copy of the edits. Retire the obsolete tree and
    // its record before reusing the slot instead.
    let stashedBackupPath: string | null = null
    if (await pathExists(backupPath)) {
      let backupIsObsolete = false
      try {
        backupIsObsolete = await this.isMarkedObsolete(backupPath)
      } catch {
        backupIsObsolete = false
      }
      if (backupIsObsolete) {
        await this.retireAndRemoveMarker(backupPath, 'obsolete skill backup')
        if (await pathExists(backupPath)) {
          throw new Error(`Cannot reuse skill backup slot while obsolete backup cannot be retired: ${destPath}`)
        }
        // Verified absence: a stale `<backup>.obsolete` left behind (e.g. retirement
        // succeeded but marker removal was denied) would mis-mark the new `.bak`
        // created below as obsolete, so a crash after `rename(dest, .bak)` would delete
        // the only copy of the edits. Abort before the rename when the record cannot
        // be cleared and verified gone.
        await this.ensureObsoleteMarkerCleared(backupPath)
      } else {
        stashedBackupPath = `${backupPath}.stash-${Date.now()}-${process.pid}`
        try {
          await fs.promises.rename(backupPath, stashedBackupPath)
          logger.info('Stashed preserved skill backup to free rollback slot', {
            destPath,
            backupPath,
            stashedBackupPath
          })
        } catch (error) {
          stashedBackupPath = null
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        // The marker belongs to the previous generation: a stale `<backup>.obsolete`
        // left by an earlier crash must not mis-mark the new `.bak` created below.
        await this.ensureObsoleteMarkerCleared(backupPath)
      }
    } else {
      // No backup directory, but a stale `<backup>.obsolete` from an earlier
      // generation would mis-mark the new `.bak`; drop it before reusing the slot.
      await this.ensureObsoleteMarkerCleared(backupPath)
    }
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
      if (!publishStarted) {
        if (stashedBackupPath) {
          try {
            await fs.promises.rename(stashedBackupPath, backupPath)
          } catch {
            // Best-effort: the stash remains for manual recovery.
          }
        }
        throw error
      }
      try {
        await this.rollbackPublishedInstall(destPath, backupPath, hasBackup)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Failed to publish and restore Skill folder: ${destPath}`)
      }
      if (stashedBackupPath) {
        try {
          await fs.promises.rename(stashedBackupPath, backupPath)
          logger.info('Restored stashed skill backup after failed publish', { destPath, backupPath })
        } catch {
          logger.warn('Preserving stashed skill backup after failed publish', { destPath, stashedBackupPath })
        }
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
          if (stashedBackupPath) {
            stashedBackupPath = null
          }
          // The retry may have left older `.bak.stash-*` copies from earlier
          // crashes (only the newest is stashed per attempt). They are all
          // obsolete once the verified replacement commits; remove them so a
          // later crash cannot strand an undiscoverable copy.
          await this.removeAllStashedBackups(destPath)
          return
        }
        if (stashedBackupPath) {
          stashedBackupPath = null
        }
        // No rollback slot was used, but a previous crash may still have left
        // stash markers behind (e.g. stash succeeded, publish never started).
        // The verified install is committed, so those markers are obsolete.
        await this.removeAllStashedBackups(destPath)
        state = 'committed'
      },
      rollback: async () => {
        if (state !== 'pending') return
        await this.rollbackPublishedInstall(destPath, backupPath, hasBackup)
        hasBackup = false
        state = 'rolled_back'
        if (stashedBackupPath) {
          try {
            await fs.promises.rename(stashedBackupPath, backupPath)
          } catch {
            logger.warn('Preserving stashed skill backup after rollback', { destPath, stashedBackupPath })
            return
          }
          stashedBackupPath = null
        }
      }
    }
  }

  /**
   * Restore the complete old directory when a process exited before deleting its
   * backup marker. The replacement is uncommitted while that marker exists.
   */
  async recoverInterruptedInstall(destPath: string): Promise<void> {
    // A retry that stashed `.bak` aside and then crashed leaves the only complete
    // copy under `.bak.stash-*` with no `.bak` for the sweep to find. Promote it
    // back to the rollback slot before deciding between destination and backup.
    // Obsolete-marked stashes are never promoted (see restoreStashedBackup).
    await this.restoreStashedBackup(destPath)
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
    // A `.bak` left behind after a verified commit is superseded: retirement
    // failed (both rename and removal denied) and left a durable `.obsolete`
    // record. Never restore it over a fresh edit or after uninstall; retry
    // deletion instead so the edit survives and uninstall stays effective.
    try {
      if (await this.isMarkedObsolete(backupPath)) {
        await this.retireAndRemoveMarker(backupPath, 'obsolete skill backup')
        return
      }
    } catch {
      // Best-effort: fall through to descriptor checks on marker-read failure.
    }

    // Never restore an incomplete backup over a complete replacement. A partial
    // `.bak` cleanup (e.g. SKILL.md deleted before the sweep) must not delete the
    // valid destination; drop the fragment instead and keep the installed tree.
    // Distinguish a truly missing descriptor (both casings ENOENT) from a transient
    // read failure (EACCES/EIO): the latter must preserve the backup for retry instead
    // of deleting a complete tree. When no verified replacement exists (destination
    // missing), restore even an incomplete backup to preserve helper files and keep
    // the catalog row plus per-agent enablement instead of pruning.
    const backupDescriptorState = await this.getBackupDescriptorState(backupPath)
    if (backupDescriptorState === 'error') {
      if (!(await pathExists(destPath))) {
        // No verified replacement and descriptor readability is uncertain: restore the backup
        // to preserve helper files and keep the catalog row plus per-agent enablement instead
        // of pruning. Reconcile keeps present folders even with unreadable descriptors.
        try {
          await fs.promises.rename(backupPath, destPath)
          logger.info('Recovered skill backup with unreadable descriptor to preserve files and registration', {
            destPath,
            backupPath
          })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        return
      }
      logger.warn('Skill backup descriptor unreadable; preserving backup for retry', {
        destPath,
        backupPath
      })
      return
    }
    if (backupDescriptorState === 'missing') {
      if (!(await pathExists(destPath))) {
        try {
          await fs.promises.rename(backupPath, destPath)
          logger.info('Recovered incomplete skill backup to preserve files and registration', {
            destPath,
            backupPath
          })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        return
      }
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
   * Distinguish a truly missing backup descriptor (both `SKILL.md` casings ENOENT)
   * from a transient read failure (EACCES/EIO). `findSkillMdPath` swallows all
   * errors to null, so a failed `stat` would incorrectly delete a complete backup;
   * this three-state check preserves the backup for retry on read errors.
   */
  private async getBackupDescriptorState(backupPath: string): Promise<'found' | 'missing' | 'error'> {
    let sawError = false
    for (const variant of ['SKILL.md', 'skill.md']) {
      try {
        await fs.promises.stat(path.join(backupPath, variant))
        return 'found'
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sawError = true
      }
    }
    return sawError ? 'error' : 'missing'
  }

  /**
   * Check whether the destination covers every file present in an obsolete marker
   * with identical bytes. A descriptor-only or path-only check treats a truncated
   * helper (`SKILL.md` present with the same paths but shortened bytes) as complete
   * and would delete the only complete tree; requiring identical content keeps the
   * backup until a baseline match or a verified publish establishes completeness.
   * Any listing or read failure preserves (returns false) so an unreadable tree
   * never justifies deletion.
   */
  private async isDestCoveringMarker(destPath: string, markerPath: string): Promise<boolean> {
    try {
      const [destFiles, markerFiles] = await Promise.all([
        this.collectCanonicalFileMap(destPath),
        this.collectCanonicalFileMap(markerPath)
      ])
      for (const [canonical, markerFullPath] of markerFiles) {
        const destFullPath = destFiles.get(canonical)
        if (!destFullPath) return false
        const [destStats, markerStats] = await Promise.all([
          fs.promises.lstat(destFullPath),
          fs.promises.lstat(markerFullPath)
        ])
        if (!destStats.isFile() || !markerStats.isFile()) return false
        if ((destStats.mode & 0o111) !== (markerStats.mode & 0o111)) return false
        const [destContent, markerContent] = await Promise.all([
          fs.promises.readFile(destFullPath),
          fs.promises.readFile(markerFullPath)
        ])
        if (!destContent.equals(markerContent)) return false
      }
      return true
    } catch {
      return false
    }
  }

  private async collectCanonicalFileMap(root: string): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    const walk = async (dir: string, relativeDir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        const fullPath = path.join(dir, entry.name)
        const stats = await fs.promises.lstat(fullPath)
        if (stats.isSymbolicLink()) continue
        if (stats.isDirectory()) {
          await walk(fullPath, relativePath)
        } else if (stats.isFile()) {
          const canonical = this.canonicalRelativePath(relativePath)
          if (!files.has(canonical)) files.set(canonical, fullPath)
        }
      }
    }
    await walk(root, '')
    return files
  }

  /**
   * Canonicalize the top-level descriptor for coverage comparison so a casing-only
   * difference (`skill.md` vs `SKILL.md`) does not look like a missing file. This
   * matches the hash canonicalization in `updateDirectoryHash`.
   */
  private canonicalRelativePath(relativePath: string): string {
    const slash = relativePath.indexOf('/')
    const top = slash === -1 ? relativePath : relativePath.slice(0, slash)
    if (slash === -1 && top.toLowerCase() === 'skill.md') return 'SKILL.md'
    return relativePath
  }

  /**
   * Recover an interrupted publish by keeping whichever complete tree matches the
   * persisted install baseline. A crash after SQLite commits the new hash but before
   * `prepared.commit()` leaves new files with a `.bak` holding the old tree; the
   * default restore would resurrect the old tree against the new baseline and report
   * `up_to_date` with local changes while the old version is installed. Comparing
   * both trees to the baseline keeps the matching one: a new tree matching a new
   * baseline completes the commit, an old backup matching an old baseline rolls back.
   * Baselines are compared in their own format: a `directory-sha256:` baseline never
   * equals a `directory-sha256-v2:` hash, so legacy installs use the legacy digest;
   * otherwise an untouched legacy backup would never match and fall through to the
   * obsolete-cleanup path that deletes the only complete copy.
   */
  async recoverInterruptedInstallWithBaseline(destPath: string, baselineHash: string | null): Promise<void> {
    // A stashed `.bak.stash-*` is the only complete copy when a retry crashed
    // right after freeing the rollback slot. Promote it before the baseline
    // comparison so neither the partial destination nor a missing `.bak` hides it.
    await this.restoreStashedBackup(destPath)
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

    const baselineIsLegacy =
      baselineHash.startsWith(SKILL_DIRECTORY_CONTENT_HASH_PREFIX) &&
      !baselineHash.startsWith(SKILL_DIRECTORY_CONTENT_HASH_PREFIX_V2)
    const hashOf = async (target: string): Promise<string | null> => {
      try {
        const stats = await fs.promises.lstat(target)
        if (!stats.isDirectory()) return null
        return baselineIsLegacy ? await this.computeLegacyContentHash(target) : await this.computeContentHash(target)
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
      // Stashes from earlier retries are superseded once the destination matches
      // the committed baseline: promoting one later would overwrite a fresh edit
      // or resurrect the skill after uninstall, so retire them here.
      if (cleanupExists) await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      if (backupExists) {
        try {
          await fs.promises.rename(backupPath, cleanupPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // Backup vanished between the existence check and the rename: nothing
            // obsolete remains, fall through to delete any staged cleanup.
            await this.clearObsoleteMarker(backupPath)
          } else {
            // Keep the obsolete backup intact when staging fails. Deleting it in
            // place could leave a partial `.bak` (e.g. SKILL.md removed before
            // failure) that the generic sweep would restore over the valid
            // baseline-matching replacement. Preserve the replacement and retry
            // staging on the next startup; the baseline-aware sweep runs before
            // the generic one so the good tree survives.
            // Record supersession durably: both staging and a later direct
            // removal may fail, leaving a promotable `.bak`. The `.obsolete`
            // sibling ensures a later sweep never restores it over a fresh edit
            // or after uninstall, even if its hash still matches the baseline.
            logger.warn('Failed to stage committed backup for cleanup; preserving replacement for retry', {
              destPath,
              backupPath,
              error: error instanceof Error ? error.message : String(error)
            })
            try {
              await this.markObsolete(backupPath)
            } catch {
              // Best-effort: the next sweep retries retirement before promoting.
            }
            await this.removeAllStashedBackups(destPath)
            logger.info('Recovered interrupted skill install by keeping matching replacement', { destPath })
            return
          }
        }
        await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
        await this.clearObsoleteMarker(backupPath)
      }
      await this.removeAllStashedBackups(destPath)
      logger.info('Recovered interrupted skill install by keeping matching replacement', { destPath })
      return
    }
    if (backupHash === baselineHash) {
      // A backup already known to be superseded (durable `.obsolete` record from
      // a failed retirement after a verified commit) must never be restored over
      // a fresh edit or after uninstall, even when its hash still matches the
      // committed baseline. Retry deletion instead and preserve the destination.
      try {
        if (await this.isMarkedObsolete(backupPath)) {
          await this.retireAndRemoveMarker(backupPath, 'obsolete skill backup')
          if (cleanupExists) await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
          await this.removeAllStashedBackups(destPath)
          logger.info('Preserved skill destination over obsolete matching backup', { destPath })
          return
        }
      } catch {
        // Best-effort: fall through to hash-matched restore on marker-read failure.
      }
      try {
        await deleteDirectoryRecursive(destPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await fs.promises.rename(backupPath, destPath)
      await this.clearObsoleteMarker(backupPath)
      if (cleanupExists) await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
      await this.removeAllStashedBackups(destPath)
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
      await this.removeAllStashedBackups(destPath)
      logger.info('Recovered interrupted skill install by restoring matching cleanup', { destPath })
      return
    }

    // No tree matches the persisted baseline (e.g., `.bak` → `.cleanup` staging failed
    // earlier, then the user edited the replacement before the next sweep). Preserve an
    // existing destination instead of restoring an obsolete `.bak` over it: the generic
    // restore would erase the intervening edit. Only restore when the destination is
    // missing entirely or definitively incomplete (no descriptor in either casing),
    // to avoid pruning the catalog row and its per-agent enablement.
    // A crash before SQLite commits can also land here when the backup holds managed
    // edits or the baseline is legacy (neither tree matches): the replacement may be
    // partial while `.bak` is the only complete tree. A descriptor-only check cannot
    // prove completeness — an interrupted copy can leave `SKILL.md` present while a
    // helper is still missing — so obsolete markers are deleted only when the
    // destination covers their file set. Otherwise both trees are preserved.
    // A transient descriptor read failure (EACCES/EIO) preserves both trees as well:
    // restoring an obsolete backup over an edited replacement would erase the edit.
    if (!(await pathExists(destPath))) {
      await this.recoverInterruptedInstall(destPath)
    } else {
      const destState = await this.getBackupDescriptorState(destPath).catch(() => 'error' as const)
      if (destState === 'missing') {
        // Partial or unreadable replacement with no baseline match: the backup may be
        // the only complete copy (interrupted copy before the database commit). Restore
        // it via the generic path instead of keeping the partial tree and deleting the
        // backup below.
        await this.recoverInterruptedInstall(destPath)
      } else if (destState === 'error') {
        logger.warn('Skill destination descriptor unreadable; preserving both trees for retry', {
          destPath,
          backupPath
        })
        return
      }
      // 'found' keeps the existing destination to preserve any intervening edit.
    }
    const destStateAfter = await this.getBackupDescriptorState(destPath).catch(() => 'error' as const)
    if (destStateAfter === 'error') {
      logger.warn('Skill destination descriptor unreadable; preserving both trees for retry', {
        destPath,
        backupPath
      })
      return
    }
    const destComplete = destStateAfter === 'found'
    // The generic restore above may have renamed `.bak` → dest (backup no longer exists);
    // re-check before best-effort cleanup so a successful restore isn't logged as a removal failure.
    const [backupStillExists, cleanupStillExists] = await Promise.all([
      backupExists ? pathExists(backupPath) : Promise.resolve(false),
      cleanupExists ? pathExists(cleanupPath) : Promise.resolve(false)
    ])
    if (backupStillExists && backupHash !== baselineHash) {
      // A descriptor or path set alone cannot prove the replacement is complete: an
      // interrupted copy can leave `SKILL.md` present while a helper is still missing,
      // and a truncated helper passes path coverage with the same paths but shortened
      // bytes. Deleting the only complete tree would lose managed edits, so require
      // byte-identical coverage before treating the marker as obsolete; otherwise the
      // next verified publish stashes this marker aside and deletes it only on commit.
      if (destComplete && (await this.isDestCoveringMarker(destPath, backupPath))) {
        // Retire out of the recoverable namespace before deletion so a swallowed
        // EACCES cannot leave a promotable `.bak` behind for the generic sweep.
        await this.retireAndRemoveMarker(backupPath, 'obsolete skill backup')
      } else {
        logger.warn('Preserving skill backup: replacement incomplete and no tree matches baseline', {
          destPath,
          backupPath
        })
      }
    }
    if (cleanupStillExists && cleanupHash !== baselineHash) {
      if (destComplete && (await this.isDestCoveringMarker(destPath, cleanupPath))) {
        try {
          await this.safeRemoveDirectory(cleanupPath, 'committed skill backup')
        } catch {
          // Best-effort: the destination (with any intervening edit) is already preserved.
        }
      } else {
        logger.warn('Preserving committed skill backup: replacement incomplete and no tree matches baseline', {
          destPath,
          cleanupPath
        })
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

    const entryNames = new Set(entries.map((entry) => entry.name))
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

      // A `.bak.stash-*` with no `.bak` is the only complete copy after a retry
      // crashed right after `rename(.bak, .bak.stash-*)`. The sweep only looked
      // for `.bak`/`.cleanup`, so that copy was stranded. Promote it and run the
      // generic restore; catalogued folders are still skipped here because their
      // baseline-aware pass already restores stashes.
      const stashMatch = entry.name.match(/^\.(.+)\.bak\.stash-.*$/)
      if (stashMatch?.[1]) {
        if (options.skipFolderNames?.has(stashMatch[1])) continue
        const folderName = stashMatch[1]
        if (entryNames.has(`.${folderName}.bak`)) continue
        const destPath = path.join(storageRoot, folderName)
        await this.restoreStashedBackup(destPath)
        // Only run the generic restore for uncatalogued folders; catalogued ones
        // were handled (including their stashes) by the baseline-aware pass.
        if (!options.skipFolderNames || options.skipFolderNames.size === 0) {
          await this.recoverInterruptedInstall(destPath)
        } else if (!options.skipFolderNames.has(folderName)) {
          await this.recoverInterruptedInstall(destPath)
        }
        continue
      }

      const cleanupMatch = entry.name.match(/^\.(.+)\.cleanup$/)
      if (cleanupMatch?.[1]) {
        await this.safeRemoveDirectory(path.join(storageRoot, entry.name), 'committed skill backup')
        continue
      }

      // Retired markers (`.bak.retired-*`) are inert: no recovery sweep promotes
      // them. They are left behind only when retirement succeeded but the
      // follow-up recursive deletion failed (EACCES swallowed). Clean them
      // best-effort so they do not accumulate; never promote them.
      // Never ends with `.bak` (retired markers end with `.retire-<ts>-<pid>`);
      // excluding `.bak` keeps this unambiguous when a longer-named skill's
      // backup (e.g. `.writer.bak.retired-notes.bak`) shares the prefix.
      const retiredMatch = entry.name.match(/^\.(.+)\.bak\.retired-.*$/)
      if (retiredMatch?.[1] && !entry.name.endsWith('.bak')) {
        await this.safeRemoveDirectory(path.join(storageRoot, entry.name), 'retired skill backup')
        continue
      }
    }
  }

  /**
   * Remove a skill folder.
   *
   * Recovery markers (`.bak`, `.cleanup`, `.bak.stash-*`) are removed as well so
   * a later startup sweep cannot promote a stale copy over a fresh install or
   * resurrect the skill after uninstall. The backup is retired out of the
   * recoverable namespace before deletion: `safeRemove` swallows `EACCES`, so a
   * failed in-place deletion would leave a promotable `.bak` behind.
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
    await this.retireAndRemoveMarker(this.getBackupPath(skillPath), 'obsolete skill backup')
    await this.safeRemoveDirectory(this.getCleanupPath(skillPath), 'committed skill backup')
    await this.removeAllStashedBackups(skillPath)
    await this.removeRetiredMarkers(skillPath)
    // A failed retirement leaves a durable `.obsolete` sibling so a later sweep
    // never promotes the superseded marker over a fresh install or after
    // uninstall. Once the marker itself is gone, its record is inert (ignored
    // by every sweep, which only processes directories); clear it best-effort.
    await this.clearObsoleteMarker(this.getBackupPath(skillPath))
    await this.clearObsoleteMarker(this.getCleanupPath(skillPath))
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

  /**
   * List stranded `.bak.stash-*` copies for a destination. The stash frees the
   * rollback slot when a preserved `.bak` would otherwise block
   * `rename(dest, .bak)` on POSIX. If the process exits right after
   * `rename(.bak, .bak.stash-*)`, the stash is the only complete copy while
   * `.bak` is missing, so startup recovery must promote it back instead of
   * leaving it undiscoverable. Returns sorted paths (oldest first by timestamp
   * name) so the newest can be promoted; tolerant of mocked/unreadable roots.
   */
  private async listStashedBackupPaths(destPath: string): Promise<string[]> {
    const backupPath = this.getBackupPath(destPath)
    const dir = path.dirname(destPath)
    const prefix = `${path.basename(backupPath)}.stash-`
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      if (!Array.isArray(entries)) return []
      const matches: string[] = []
      for (const entry of entries) {
        try {
          if (typeof entry.name !== 'string' || !entry.name.startsWith(prefix)) continue
          // A backup for a longer-named skill (e.g. `.writer.bak.stash-foo.bak`
          // for skill `writer.bak.stash-foo`) shares the stash prefix but always
          // ends with `.bak`; stashes never do. Excluding `.bak` keeps uninstall
          // and retirement scoped to this skill's own markers.
          if (entry.name.endsWith('.bak')) continue
          if (typeof entry.isDirectory === 'function' && !entry.isDirectory()) continue
        } catch {
          continue
        }
        matches.push(path.join(dir, entry.name))
      }
      matches.sort()
      return matches
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      // Unreadable roots must not block recovery; the stash stays for retry.
      return []
    }
  }

  /**
   * Promote the newest `.bak.stash-*` back to `.bak` when the rollback slot is
   * empty. Called at the start of every recovery path and before a new publish
   * frees the slot again, so a crash between `rename(.bak, stash)` and the next
   * `rename(dest, .bak)` cannot strand the only complete tree.
   */
  private async restoreStashedBackup(destPath: string): Promise<void> {
    const backupPath = this.getBackupPath(destPath)
    try {
      if (await pathExists(backupPath)) return
    } catch {
      return
    }
    const stashes = await this.listStashedBackupPaths(destPath)
    if (stashes.length === 0) return
    // Never promote a stash already known to be superseded: retirement failed
    // after a verified commit (both rename and removal denied), leaving a
    // durable `.obsolete` record. Promoting it later would overwrite a fresh
    // edit or resurrect the skill after uninstall. Retry deletion instead.
    for (const stashPath of [...stashes].reverse()) {
      try {
        if (await this.isMarkedObsolete(stashPath)) {
          await this.retireAndRemoveMarker(stashPath, 'obsolete stashed skill backup')
          continue
        }
      } catch {
        // Best-effort: fall through to promotion check below.
      }
    }
    const remaining = await this.listStashedBackupPaths(destPath)
    // Re-check after obsolete cleanup: all stashes may have been superseded.
    const promotable: string[] = []
    for (const stashPath of remaining) {
      try {
        if (await this.isMarkedObsolete(stashPath)) continue
      } catch {
        // Treat unreadable marker state as promotable to avoid stranding.
      }
      promotable.push(stashPath)
    }
    if (promotable.length === 0) return
    const newest = promotable[promotable.length - 1]
    try {
      await fs.promises.rename(newest, backupPath)
      logger.info('Recovered stashed skill backup to rollback slot', { destPath, backupPath, stashed: newest })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /**
   * Best-effort removal of every `.bak.stash-*` marker once a verified install
   * commits. Only the committing publish knows the replacement is durable, so
   * older stashes from earlier crashes are obsolete here as well.
   *
   * Each stash is first renamed out of the recoverable namespace
   * (`.bak.stash-*` → `.bak.retired-*`) before recursive deletion. `safeRemove`
   * swallows `EACCES`, so deleting in place would leave a promotable marker that
   * a later reconcile could restore over a fresh edit or after uninstall. A
   * failed deletion after the rename leaves an inert `.bak.retired-*` copy that
   * no recovery sweep promotes.
   */
  private async removeAllStashedBackups(destPath: string): Promise<void> {
    const stashes = await this.listStashedBackupPaths(destPath)
    for (const stashPath of stashes) {
      await this.retireAndRemoveMarker(stashPath, 'stashed skill backup')
    }
    await this.removeRetiredMarkers(destPath)
  }

  /**
   * Retirement path outside every recovery pattern (`^\.(.+)\.bak$`,
   * `^\.(.+)\.bak\.stash-.*$`, `^\.(.+)\.cleanup$`). `.bak.stash-*` markers are
   * matched by prefix, so appending a suffix is not enough: the `.bak.stash-`
   * infix itself is replaced. Plain `.bak`/`.cleanup` markers use an appended
   * suffix, which already breaks their exact-match patterns.
   */
  private getRetirementPath(markerPath: string): string {
    const dir = path.dirname(markerPath)
    const base = path.basename(markerPath)
    if (base.includes('.bak.stash-')) {
      const retiredBase = base.replace('.bak.stash-', '.bak.retired-')
      return path.join(dir, `${retiredBase}.retire-${Date.now()}-${process.pid}`)
    }
    return `${markerPath}.retired-${Date.now()}-${process.pid}`
  }

  private async retireAndRemoveMarker(markerPath: string, label: string): Promise<void> {
    let retiredPath: string | null = null
    try {
      retiredPath = this.getRetirementPath(markerPath)
      await fs.promises.rename(markerPath, retiredPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.clearObsoleteMarker(markerPath)
        return
      }
      logger.warn(`Failed to retire ${label} before removal; attempting direct removal`, {
        markerPath,
        error: error instanceof Error ? error.message : String(error)
      })
      await this.safeRemoveDirectory(markerPath, label)
      // Both retirement rename and direct removal failed (e.g. swallowed EACCES):
      // the marker is still promotable. Record its obsolete status durably so a
      // later sweep never promotes it over a fresh edit or after uninstall. The
      // marker file is a best-effort sibling write; it succeeds when only the
      // marker itself is denied, and a later retry deletes both together.
      try {
        if (await pathExists(markerPath)) {
          await this.markObsolete(markerPath)
        } else {
          await this.clearObsoleteMarker(markerPath)
        }
      } catch {
        // Best-effort: the next sweep retries retirement before promoting.
      }
      return
    }
    await this.safeRemoveDirectory(retiredPath, label)
    await this.clearObsoleteMarker(markerPath)
  }

  /**
   * Durable obsolete record for a marker whose retirement rename and direct
   * removal both failed. The sibling `<marker>.obsolete` file is outside every
   * recovery pattern (it never ends with `.bak` and never contains the
   * `.bak.stash-`/`.bak.retired-` promotable infixes as a directory), so the
   * generic sweep ignores it while `restoreStashedBackup` and the baseline
   * sweep use it to skip promotion and retry deletion instead.
   */
  private getObsoleteMarkerPath(markerPath: string): string {
    return `${markerPath}.obsolete`
  }

  private async markObsolete(markerPath: string): Promise<void> {
    try {
      await fs.promises.writeFile(this.getObsoleteMarkerPath(markerPath), `obsolete:${Date.now()}`, 'utf-8')
    } catch {
      // Best-effort: without the record the next sweep retries retirement first.
    }
  }

  private async isMarkedObsolete(markerPath: string): Promise<boolean> {
    try {
      return await pathExists(this.getObsoleteMarkerPath(markerPath))
    } catch {
      return false
    }
  }

  private async clearObsoleteMarker(markerPath: string): Promise<void> {
    try {
      await fs.promises.rm(this.getObsoleteMarkerPath(markerPath), { force: true })
    } catch {
      // Best-effort: a leftover `.obsolete` file is inert and ignored by recovery.
    }
  }

  /**
   * Strict marker cleanup for backup-slot reuse. `clearObsoleteMarker` swallows
   * removal failures, which is safe for post-commit best-effort cleanup but not
   * before `rename(dest, .bak)`: a surviving `<backup>.obsolete` would mis-mark
   * the fresh `.bak` (edited tree) as obsolete, so a crash before the replacement
   * copy would let recovery delete the only copy of the edits. Require verified
   * absence and abort the publish before the rename when the record cannot be
   * cleared.
   */
  private async ensureObsoleteMarkerCleared(markerPath: string): Promise<void> {
    const obsoletePath = this.getObsoleteMarkerPath(markerPath)
    try {
      await fs.promises.rm(obsoletePath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error(
        `Cannot reuse skill backup slot while obsolete marker cannot be cleared: ${markerPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    try {
      await fs.promises.lstat(obsoletePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error(
        `Cannot reuse skill backup slot while obsolete marker cannot be verified as cleared: ${markerPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    throw new Error(`Cannot reuse skill backup slot while obsolete marker still exists: ${markerPath}`)
  }

  private async listRetiredMarkerPaths(destPath: string): Promise<string[]> {
    const dir = path.dirname(destPath)
    const folder = path.basename(destPath)
    const prefix = `.${folder}.bak.retired-`
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      if (!Array.isArray(entries)) return []
      const matches: string[] = []
      for (const entry of entries) {
        try {
          if (typeof entry.name !== 'string' || !entry.name.startsWith(prefix)) continue
          // A backup for a longer-named skill (e.g. `.writer.bak.retired-notes.bak`
          // for skill `writer.bak.retired-notes`) shares the retired prefix but
          // always ends with `.bak`; retired markers never do (they end with
          // `.retire-<ts>-<pid>`). Excluding `.bak` keeps uninstall scoped to this
          // skill's own retired markers and preserves the other skill's backup.
          if (entry.name.endsWith('.bak')) continue
          if (typeof entry.isDirectory === 'function' && !entry.isDirectory()) continue
        } catch {
          continue
        }
        matches.push(path.join(dir, entry.name))
      }
      // Also catch `*.retire-*` suffix variants (retirement of a retirement never
      // happens, but a previous crash could leave the suffixed name).
      matches.sort()
      return matches
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      return []
    }
  }

  private async removeRetiredMarkers(destPath: string): Promise<void> {
    const retired = await this.listRetiredMarkerPaths(destPath)
    for (const retiredPath of retired) {
      await this.safeRemoveDirectory(retiredPath, 'retired skill backup')
    }
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
