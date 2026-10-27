/**
 * Entry rename — change the display `name` (and FS basename for external).
 *
 * - Internal: physical path is UUID-based, so renaming is a DB-only update of
 *   `name` (and `ext` if the new name carries a different extension).
 * - External: `fs.rename(externalPath, newPath)` runs, then a single DB update
 *   atomically rewrites `externalPath` and `name`. If the FS rename fails
 *   (target exists, permission denied, etc.) the DB is **not** touched.
 */

import path from 'node:path'

import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import { exists, isSameFile, move as fsMove } from '@main/utils/file'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { SafeNameSchema } from '@shared/data/types/file'
import { canonicalizeFilePath } from '@shared/utils/file'

import { classifyFileFailure } from '../../failureFacts'
import { runPathMutationExclusive } from '../../pathMutationLock'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/rename')

export async function rename(deps: FileManagerDeps, id: FileEntryId, newName: string): Promise<FileEntry> {
  return deps.contentWriteLock.runExclusive(id, () => runPathMutationExclusive(() => renameLocked(deps, id, newName)))
}

async function renameLocked(deps: FileManagerDeps, id: FileEntryId, newName: string): Promise<FileEntry> {
  // Up-front name validation rejects path separators, `..`, null bytes, and
  // over-length input before any FS or DB side effect. Pairs with the
  // service-level guard in FileEntryService.update / setExternalPathAndName;
  // catching here also short-circuits the external-rename FS work for inputs
  // the service would reject anyway.
  SafeNameSchema.parse(newName)
  const entry = deps.fileEntryService.getById(id)
  if (entry.name === newName) return entry
  if (entry.origin === 'internal') {
    return deps.fileEntryService.update(id, { name: newName })
  }
  // entry.origin === 'external' from here on; the schema discriminator
  // guarantees externalPath is present as `AbsoluteFilePathSchema` (no `null`
  // branch exists on ExternalEntrySchema), so the prior defensive
  // `if (!entry.externalPath)` throw was unreachable and has been removed.
  const dir = path.dirname(entry.externalPath)
  const ext = entry.ext ? `.${entry.ext}` : ''
  // Canonicalize the target so the no-op check below tolerates trailing-
  // separator and `.`/`..` noise — `entry.externalPath` is already canonical
  // (byte-faithful, written through `ensureExternalEntry`), so string equality
  // here is a reliable "same byte path" test. Canonicalization is byte-faithful
  // (no NFC), so NFC and NFD spellings of a name are distinct targets.
  const oldPath = entry.externalPath
  const target = canonicalizeFilePath(path.join(dir, `${newName}${ext}`))
  // Defense in depth: `SafeNameSchema.parse(newName)` above already rejects
  // path separators and `..`, but a future regression in the schema (or any
  // canonicalization behaviour change) must not be able to relocate the
  // user's file outside `dir`.
  if (path.dirname(target) !== dir) {
    throw new Error(`rename: target escapes original directory: ${target}`)
  }
  if (target === entry.externalPath) {
    return entry
  }
  try {
    if (await exists(target)) {
      // Both names can resolve to the same inode on case-insensitive filesystems;
      // allow fsMove to apply that case-only rename.
      if (!(await isSameFile(target, oldPath))) {
        throw Object.assign(new Error(`rename: target path already exists: ${target}`), { code: 'EEXIST' })
      }
    }
    await fsMove(oldPath, target)
  } catch (error) {
    logFailure(logger, 'File rename failed', error, 'file.rename', classifyFileFailure(error, true))
    throw error
  }
  const canonical = target
  // Single atomic DB write — `setExternalPathAndName` is the only sanctioned
  // mutation site for `externalPath`. Doing both column changes in one
  // statement avoids the half-renamed state where the FS file is at the new
  // path but the DB row still carries the old `name` projection.
  //
  // FS-DB skew window: between fsMove (above) and the DB update below the
  // user's file is at `target` while the DB still points at `oldPath`. If
  // the DB write fails (typically a UNIQUE-conflict from a concurrent
  // rename hitting the same `externalPath`), best-effort move the file
  // back to `oldPath` so the entry stays self-consistent with its DB
  // projection. Rollback can itself fail (cross-device EXDEV, the source
  // dir disappeared, etc.); in that rare case warn-log both errors so an
  // operator can reconcile the orphan file at `target`, then propagate
  // the original DB error so the caller sees the real failure cause.
  let renamed: FileEntry
  try {
    renamed = deps.fileEntryService.setExternalPathAndName(id, canonical, newName)
  } catch (dbErr) {
    try {
      await fsMove(canonical, oldPath)
    } catch (rollbackErr) {
      logger.warn('rename: FS-DB skew — file moved to target but DB update failed, and rollback failed', {
        id,
        oldPath,
        target: canonical,
        dbErr,
        rollbackErr
      })
    }
    throw dbErr
  }
  // Invalidate the cached FileVersion: `fsMove` may have fallen back to
  // copy+unlink across devices (EXDEV), producing a new inode whose mtime
  // differs from the snapshot captured before the rename. A subsequent
  // `writeIfUnchanged(id, expectedVersion)` would otherwise OCC-compare
  // against a stale version and either spuriously succeed or fail.
  deps.versionCache.invalidate(id)
  // Reverse-index swap. The old path is fully invalidated; the new path
  // takes over with a fresh 'present' observation since fsMove just succeeded.
  deps.danglingCache.removeEntry(id, oldPath)
  deps.danglingCache.addEntry(id, canonical)
  deps.danglingCache.onFsEvent(canonical, 'present', 'ops')
  return renamed
}
