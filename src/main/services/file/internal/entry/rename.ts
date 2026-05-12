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
import { exists, isSameFile, move as fsMove } from '@main/utils/file/fs'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { SafeNameSchema } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import { canonicalizeExternalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/rename')

export async function rename(deps: FileManagerDeps, id: FileEntryId, newName: string): Promise<FileEntry> {
  // Up-front name validation rejects path separators, `..`, null bytes, and
  // over-length input before any FS or DB side effect. Pairs with the
  // service-level guard in FileEntryService.update / setExternalPathAndName;
  // catching here also short-circuits the external-rename FS work for inputs
  // the service would reject anyway.
  SafeNameSchema.parse(newName)
  const entry = await deps.fileEntryService.getById(id)
  if (entry.origin === 'internal') {
    return deps.fileEntryService.update(id, { name: newName })
  }
  // entry.origin === 'external' from here on; the schema discriminator
  // guarantees externalPath is present as `AbsolutePathSchema` (no `null`
  // branch exists on ExternalEntrySchema), so the prior defensive
  // `if (!entry.externalPath)` throw was unreachable and has been removed.
  const dir = path.dirname(entry.externalPath)
  const ext = entry.ext ? `.${entry.ext}` : ''
  // Canonicalize the target so the no-op check below tolerates NFC/NFD,
  // trailing-separator, and `.`/`..` noise — `entry.externalPath` is already
  // canonical (written through `ensureExternalEntry`), so string equality
  // here is a reliable "same logical path" test.
  const oldPath = entry.externalPath as FilePath
  const target = canonicalizeExternalPath(path.join(dir, `${newName}${ext}`))
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
  if (await exists(target as FilePath)) {
    // On case-insensitive filesystems (macOS APFS / Windows NTFS) a
    // `Foo.pdf → foo.pdf` rename hits this branch because `exists` reports
    // the file under its on-disk case. If both paths resolve to the same
    // inode it's a legitimate case-only rename — fall through to `fsMove`,
    // which the OS treats as an in-place case fix.
    if (!(await isSameFile(target as FilePath, oldPath))) {
      throw new Error(`rename: target path already exists: ${target}`)
    }
  }
  await fsMove(oldPath, target as FilePath)
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
    renamed = await deps.fileEntryService.setExternalPathAndName(id, canonical, newName)
  } catch (dbErr) {
    try {
      await fsMove(canonical as FilePath, oldPath)
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
  deps.danglingCache.addEntry(id, canonical as FilePath)
  deps.danglingCache.onFsEvent(canonical as FilePath, 'present', 'ops')
  return renamed
}
