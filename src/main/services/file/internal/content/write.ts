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
import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('file/internal/write')

export async function write(deps: FileManagerDeps, id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry)
  await atomicWriteFile(physical, data)
  // The atomic write committed; everything below is post-commit metadata
  // sync. A failure here (EIO on re-stat, SQLITE_BUSY on update, entry
  // deleted concurrently between read and update, …) silently desyncs
  // `file_entry.size` and the cached `FileVersion` from disk. Mirror
  // `createWriteStream`'s `WRITE_STREAM_DB_DESYNC` pattern — surface
  // the desync at `error` with a stable code, then rethrow so the
  // awaiting caller still sees the failure.
  try {
    const s = await fsStat(physical)
    const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
    if (entry.origin === 'internal') {
      await deps.fileEntryService.update(id, { size: version.size })
    }
    deps.versionCache.set(id, version)
    return version
  } catch (err) {
    logger.error('write: post-commit metadata sync failed', { code: 'WRITE_DB_DESYNC', id, err })
    throw err
  }
}

export async function writeIfUnchanged(
  deps: FileManagerDeps,
  id: FileEntryId,
  data: string | Uint8Array,
  expected: FileVersion,
  expectedContentHash?: string
): Promise<FileVersion> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry)
  let next: FileVersion
  try {
    const out = await atomicWriteIfUnchanged(physical, data, expected, expectedContentHash)
    next = { mtime: out.mtime, size: out.size }
  } catch (err) {
    if (err instanceof PathStaleVersionError) {
      throw new StaleVersionError(id, expected, err.current)
    }
    throw err
  }
  // Same post-commit metadata-sync wrap as `write` above — a desync here
  // means the FS write succeeded but the DB / cache lag, so the
  // observability layer must distinguish this from "the write itself
  // failed".
  try {
    if (entry.origin === 'internal') {
      await deps.fileEntryService.update(id, { size: next.size })
    }
    deps.versionCache.set(id, next)
    return next
  } catch (err) {
    logger.error('writeIfUnchanged: post-commit metadata sync failed', { code: 'WRITE_DB_DESYNC', id, err })
    throw err
  }
}

export async function createWriteStream(deps: FileManagerDeps, id: FileEntryId): Promise<AtomicWriteStream> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry)
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
      // The file is committed on disk but the metadata sync (re-stat + DB
      // size update + versionCache.set) failed. This silently desyncs
      // `file_entry.size` and any cached `FileVersion` from disk, which the
      // module-level JSDoc explicitly warns against — surface it at `error`
      // with a stable code so Sentry can group these for follow-up. The
      // stream itself does NOT re-throw because the consumer has already
      // observed `'finish'`; the only mitigation is observability.
      logger.error('createWriteStream: post-commit metadata sync failed', {
        code: 'WRITE_STREAM_DB_DESYNC',
        id,
        err
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
