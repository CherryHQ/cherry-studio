/**
 * Write content to a managed FileEntry or a raw FilePath.
 *
 * Pure functions taking `FileManagerDeps` as the first argument. Each entry-
 * aware write goes through `atomicWriteFile` (or `atomicWriteIfUnchanged`)
 * and updates DB / versionCache accordingly:
 * - internal origin: DB `size` is updated to the new byte count
 * - external origin: DB `size` stays `null` (CHECK enforces) — only mtime
 *   changes are observable, so the row is left untouched
 *
 * `writeIfUnchanged` deliberately re-stats on every call; the cache is **not**
 * trusted for the OCC compare (file-manager-architecture.md §4.4 trust boundary).
 */

import { resolvePhysicalPath } from '@data/utils/pathResolver'
import { loggerService } from '@logger'
import type { AtomicWriteStream } from '@main/utils/file/fs'
import {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  createAtomicWriteStream,
  PathStaleVersionError,
  stat as fsStat
} from '@main/utils/file/fs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import { type FileVersion, StaleVersionError } from '../../FileManager'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('file/internal/write')

export async function write(deps: FileManagerDeps, id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry) as FilePath
  await atomicWriteFile(physical, data)
  const s = await fsStat(physical)
  const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
  if (entry.origin === 'internal') {
    await deps.fileEntryService.update(id, { size: version.size })
  }
  deps.versionCache.set(id, version)
  return version
}

export async function writeIfUnchanged(
  deps: FileManagerDeps,
  id: FileEntryId,
  data: string | Uint8Array,
  expected: FileVersion
): Promise<FileVersion> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry) as FilePath
  let next: FileVersion
  try {
    const out = await atomicWriteIfUnchanged(physical, data, expected)
    next = { mtime: out.mtime, size: out.size }
  } catch (err) {
    if (err instanceof PathStaleVersionError) {
      throw new StaleVersionError(id, expected, err.current)
    }
    throw err
  }
  if (entry.origin === 'internal') {
    await deps.fileEntryService.update(id, { size: next.size })
  }
  deps.versionCache.set(id, next)
  return next
}

export async function createWriteStream(deps: FileManagerDeps, id: FileEntryId): Promise<AtomicWriteStream> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry) as FilePath
  const stream = createAtomicWriteStream(physical)
  stream.once('finish', async () => {
    try {
      const s = await fsStat(physical)
      const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
      if (entry.origin === 'internal') {
        await deps.fileEntryService.update(id, { size: version.size })
      }
      deps.versionCache.set(id, version)
    } catch (err) {
      // post-commit metadata sync is best-effort: the file itself is already
      // on disk. Log so a stat failure (race with delete) or DB write failure
      // (file_entry.size out of sync with disk) is at least diagnosable.
      logger.warn('createWriteStream: post-commit metadata sync failed', {
        id,
        err: (err as Error).message
      })
    }
  })
  return stream
}

export async function writeByPath(_deps: FileManagerDeps, target: FilePath, data: string | Uint8Array): Promise<void> {
  await atomicWriteFile(target, data)
}

export async function writeIfUnchangedByPath(
  _deps: FileManagerDeps,
  target: FilePath,
  data: string | Uint8Array,
  expected: { mtime: number; size: number },
  expectedContentHash?: string
): Promise<{ mtime: number; size: number }> {
  return atomicWriteIfUnchanged(target, data, expected, expectedContentHash)
}
