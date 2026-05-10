/**
 * Entry rename — change the display `name` (and FS basename for external).
 *
 * - Internal: physical path is UUID-based, so renaming is a DB-only update of
 *   `name` (and `ext` if the new name carries a different extension).
 * - External: `fs.rename(externalPath, newPath)` runs, then DB updates both
 *   `externalPath` and `name`. If the FS rename fails (target exists,
 *   permission denied, etc.) the DB is **not** touched.
 */

import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { canonicalizeExternalPath } from '@data/utils/pathResolver'
import { exists, move as fsMove } from '@main/utils/file/fs'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { eq } from 'drizzle-orm'

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
  await fsMove(entry.externalPath as FilePath, target as FilePath)
  const canonical = canonicalizeExternalPath(target)
  // FileEntryService.update intentionally excludes `externalPath` from its
  // typed contract (immutable to outside callers). The rename flow is the
  // single sanctioned mutation site for that column, handled here directly.
  const db = application.get('DbService').getDb()
  await db.update(fileEntryTable).set({ externalPath: canonical }).where(eq(fileEntryTable.id, id))
  return deps.fileEntryService.update(id, { name: newName })
}
