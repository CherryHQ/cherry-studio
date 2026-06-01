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
import { hashContent } from '@main/utils/file/contentHash'
import type { AtomicWriteStream } from '@main/utils/file/fs'
import {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  createAtomicWriteStream,
  hash,
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
      // Maintained-on-write: new content → recompute the detection hash. `data`
      // is already in memory, so this is a one-shot hash with no extra IO.
      await deps.fileEntryService.update(id, { size: version.size, contentHash: hashContent(data) })
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
      // Maintained-on-write: `data` is in memory → one-shot hash, no extra IO.
      await deps.fileEntryService.update(id, { size: next.size, contentHash: hashContent(data) })
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
        // Maintained-on-write. Streaming source (no in-memory bytes) → read the
        // just-written file back for the hash (page-cache warm), mirroring the
        // create.ts hybrid strategy.
        await deps.fileEntryService.update(id, { size: version.size, contentHash: await hash(physical) })
      }
      deps.versionCache.set(id, version)
    } catch (err) {
      // The file is committed on disk but the post-commit metadata sync (re-stat
      // + DB size/contentHash update + versionCache.set) failed. The stream does
      // NOT re-throw — the consumer has already observed `'finish'` — so on this
      // fire-and-forget path both synced columns are best-effort by design, and
      // observability is the only mitigation. Contract for the desync:
      //   - `size` / cached `FileVersion`: left stale until the next write. The
      //     module-level JSDoc warns against this; hence the `error` log below
      //     with a stable code so Sentry can group these for follow-up.
      //   - `contentHash`: left stale (a prior write's hash) or NULL (entry never
      //     hashed). A NULL row is repaired by the content-hash backfill job on
      //     the next startup (the NULL set is its work queue); a stale row
      //     self-corrects on the next successful write — the backfill job does
      //     NOT touch it (it scans `contentHash IS NULL` only). Because
      //     contentHash is a collision-tolerant DETECTION substrate (a wrong
      //     candidate is rejected by the consumer's secondary check), a transient
      //     stale value only degrades dedup detection — it never mis-serves bytes.
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
