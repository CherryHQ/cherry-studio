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

import { canonicalizeExternalPath } from '@data/utils/pathResolver'
import { exists, move as fsMove } from '@main/utils/file/fs'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import type { FileManagerDeps } from '../deps'

export async function rename(deps: FileManagerDeps, id: FileEntryId, newName: string): Promise<FileEntry> {
  const entry = await deps.fileEntryService.getById(id)
  if (entry.origin === 'internal') {
    return deps.fileEntryService.update(id, { name: newName })
  }
  if (!entry.externalPath) {
    throw new Error(`rename: external entry ${id} has null externalPath (schema invariant violated)`)
  }
  const dir = path.dirname(entry.externalPath)
  const ext = entry.ext ? `.${entry.ext}` : ''
  const target = path.join(dir, `${newName}${ext}`)
  if (target === entry.externalPath) {
    return entry
  }
  if (await exists(target as FilePath)) {
    throw new Error(`rename: target path already exists: ${target}`)
  }
  const oldPath = entry.externalPath as FilePath
  await fsMove(oldPath, target as FilePath)
  const canonical = canonicalizeExternalPath(target)
  // Single atomic DB write — `setExternalPathAndName` is the only sanctioned
  // mutation site for `externalPath`. Doing both column changes in one
  // statement avoids the half-renamed state where the FS file is at the new
  // path but the DB row still carries the old `name` projection.
  const renamed = await deps.fileEntryService.setExternalPathAndName(id, canonical, newName)
  // Reverse-index swap. The old path is fully invalidated; the new path
  // takes over with a fresh 'present' observation since fsMove just succeeded.
  deps.danglingCache.removeEntry(id, oldPath)
  deps.danglingCache.addEntry(id, canonical as FilePath)
  deps.danglingCache.onFsEvent(canonical as FilePath, 'present', 'ops')
  return renamed
}
