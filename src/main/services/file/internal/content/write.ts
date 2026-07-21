/**
 * Write content to a managed FileEntry.
 *
 * Each write goes through `atomicWriteFile` (or
 * `atomicWriteIfUnchanged`) and updates DB / versionCache accordingly:
 * - internal origin: DB `size` is updated to the new byte count
 * - external origin: DB `size` stays `null` (CHECK enforces) — only mtime
 *   changes are observable, so the row is left untouched
 *
 * `writeIfUnchanged` deliberately re-stats on every call; the cache is **not**
 * trusted for the OCC compare (file-manager-architecture.md §4.4 trust boundary).
 */

import { loggerService } from '@logger'
import type { AtomicWriteStream } from '@main/utils/file'
import {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  createAtomicWriteStream,
  hash as fsHash,
  hashContent,
  PathStaleVersionError,
  stat as fsStat
} from '@main/utils/file'
import type { ContentHash, FileEntryId } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { type FileVersion, StaleVersionError } from '../../FileManager'
import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('file/internal/write')

export async function write(deps: FileManagerDeps, id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
  return deps.contentWriteLock.runExclusive(id, async () => {
    const entry = deps.fileEntryService.getById(id)
    const physical = resolvePhysicalPath(entry)
    await atomicWriteFile(physical, data)
    try {
      const s = await fsStat(physical)
      const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
      if (entry.origin === 'internal') {
        deps.fileEntryService.update(id, { size: version.size, contentHash: hashContent(data) })
      }
      deps.versionCache.set(id, version)
      return version
    } catch (err) {
      logger.error('write: post-commit metadata sync failed', { code: 'WRITE_DB_DESYNC', id, err })
      throw err
    }
  })
}

export async function writeIfUnchanged(
  deps: FileManagerDeps,
  id: FileEntryId,
  data: string | Uint8Array,
  expected: FileVersion,
  expectedContentHash?: ContentHash
): Promise<FileVersion> {
  return deps.contentWriteLock.runExclusive(id, async () => {
    const entry = deps.fileEntryService.getById(id)
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
    try {
      if (entry.origin === 'internal') {
        deps.fileEntryService.update(id, { size: next.size, contentHash: hashContent(data) })
      }
      deps.versionCache.set(id, next)
      return next
    } catch (err) {
      logger.error('writeIfUnchanged: post-commit metadata sync failed', { code: 'WRITE_DB_DESYNC', id, err })
      throw err
    }
  })
}

export async function createWriteStream(deps: FileManagerDeps, id: FileEntryId): Promise<AtomicWriteStream> {
  const release = await deps.contentWriteLock.acquire(id)
  try {
    const entry = deps.fileEntryService.getById(id)
    const physical = resolvePhysicalPath(entry)
    const stream = createAtomicWriteStream(physical)
    let finishStarted = false
    const releaseBeforeFinish = () => {
      if (!finishStarted) release()
    }
    stream.once('finish', () => {
      finishStarted = true
      void (async () => {
        try {
          const s = await fsStat(physical)
          const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
          if (entry.origin === 'internal') {
            deps.fileEntryService.update(id, { size: version.size, contentHash: await fsHash(physical) })
          }
          deps.versionCache.set(id, version)
        } catch (err) {
          logger.error('createWriteStream: post-commit metadata sync failed', {
            code: 'WRITE_STREAM_DB_DESYNC',
            id,
            err
          })
        } finally {
          release()
        }
      })()
    })
    stream.once('error', releaseBeforeFinish)
    stream.once('close', releaseBeforeFinish)
    return stream
  } catch (error) {
    release()
    throw error
  }
}

export async function writeByPath(
  _deps: FileManagerDeps,
  target: AbsoluteFilePath,
  data: string | Uint8Array
): Promise<void> {
  await atomicWriteFile(target, data)
}

export async function writeIfUnchangedByPath(
  _deps: FileManagerDeps,
  target: AbsoluteFilePath,
  data: string | Uint8Array,
  expected: { mtime: number; size: number },
  expectedContentHash?: ContentHash
): Promise<{ mtime: number; size: number }> {
  return atomicWriteIfUnchanged(target, data, expected, expectedContentHash)
}
