/**
 * Write content to a managed FileEntry.
 *
 * Each write prepares a durable same-directory tmp file, then commits it and
 * updates DB / versionCache accordingly:
 * - internal origin: DB `size` / `contentHash` are derived from the prepared
 *   byte stream and committed through the recoverable metadata protocol
 * - external origin: DB `size` stays `null` (CHECK enforces) — only mtime
 *   changes are observable, so the row is left untouched
 *
 * `writeIfUnchanged` deliberately re-stats on every call; the cache is **not**
 * trusted for the OCC compare (file-manager-architecture.md §4.4 trust boundary).
 */

import { loggerService } from '@logger'
import type { AtomicWriteStream } from '@main/utils/file'
import {
  assertPathVersionUnchanged,
  atomicWriteFile,
  atomicWriteIfUnchanged,
  createPreparedAtomicWriteStream,
  PathStaleVersionError,
  prepareAtomicWrite,
  type PreparedAtomicWrite
} from '@main/utils/file'
import type { ContentHash, FileEntryId } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { ContentCommittedMetadataPendingError, type FileVersion, StaleVersionError } from '../../FileManager'
import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('file/internal/write')

async function commitPreparedForEntry(
  deps: FileManagerDeps,
  id: FileEntryId,
  origin: 'internal' | 'external',
  prepared: PreparedAtomicWrite
): Promise<FileVersion> {
  const snapshot = origin === 'internal' ? deps.fileEntryService.beginInternalContentCommit(id, Date.now()) : undefined

  let version: FileVersion
  try {
    version = await prepared.commit()
  } catch (error) {
    if (snapshot) {
      try {
        if (!deps.fileEntryService.restoreInternalContentAfterFailedCommit(id, snapshot)) {
          logger.error('content commit: metadata restore did not match a pending internal entry', {
            code: 'WRITE_DB_RESTORE_FAILED',
            id
          })
        }
      } catch (restoreError) {
        logger.error('content commit: failed to restore metadata after filesystem commit failure', {
          code: 'WRITE_DB_RESTORE_FAILED',
          id,
          restoreError
        })
      }
    }
    throw error
  }

  try {
    if (
      origin === 'internal' &&
      !deps.fileEntryService.completeInternalContentCommit(id, {
        size: prepared.size,
        contentHash: prepared.contentHash
      })
    ) {
      throw new Error(`Internal entry ${id} vanished or content metadata was no longer pending`)
    }
  } catch (error) {
    deps.versionCache.set(id, version)
    logger.error('content commit: bytes committed but metadata finalize failed', {
      code: 'WRITE_DB_DESYNC',
      id,
      error
    })
    throw new ContentCommittedMetadataPendingError(id, version, { cause: error })
  }

  deps.versionCache.set(id, version)
  return version
}

export async function write(deps: FileManagerDeps, id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
  return deps.contentWriteLock.runExclusive(id, async () => {
    const entry = deps.fileEntryService.getById(id)
    const physical = resolvePhysicalPath(entry)
    const prepared = await prepareAtomicWrite(physical, data)
    try {
      return await commitPreparedForEntry(deps, id, entry.origin, prepared)
    } catch (error) {
      await prepared.abort()
      throw error
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
    const prepared = await prepareAtomicWrite(physical, data)
    try {
      await assertPathVersionUnchanged(physical, expected, expectedContentHash)
    } catch (err) {
      await prepared.abort()
      if (err instanceof PathStaleVersionError) {
        throw new StaleVersionError(id, expected, err.current)
      }
      throw err
    }
    try {
      return await commitPreparedForEntry(deps, id, entry.origin, prepared)
    } catch (error) {
      await prepared.abort()
      throw error
    }
  })
}

export async function createWriteStream(deps: FileManagerDeps, id: FileEntryId): Promise<AtomicWriteStream> {
  const release = await deps.contentWriteLock.acquire(id)
  try {
    const entry = deps.fileEntryService.getById(id)
    const physical = resolvePhysicalPath(entry)
    const stream = createPreparedAtomicWriteStream(physical, async (prepared) => {
      await commitPreparedForEntry(deps, id, entry.origin, prepared)
    })
    let released = false
    const releaseOnce = () => {
      if (released) return
      released = true
      release()
    }
    stream.once('finish', releaseOnce)
    stream.once('error', releaseOnce)
    stream.once('close', releaseOnce)
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
