/**
 * Entry lifecycle — trash / restore / delete actions + batch variants.
 *
 * `trash` / `restore` are internal-only and state-conditional: only an active
 * internal entry can be trashed, and only a trashed internal entry can be restored.
 *
 * The general `permanentDelete` operation crosses DB and FS:
 * - DB row removal is mandatory.
 * - For internal origin, the physical file is best-effort unlinked. Failure
 *   to unlink (already missing, permission denied, etc.) is logged but does
 *   not block DB deletion — the architecture doc prefers DB-FS convergence
 *   to "both gone" over "DB still has dangling row".
 * - For external origin, the user's file is **never** modified.
 *
 * Renderer-backed delete actions use narrower contracts:
 * - `permanentDeleteFromTrash` accepts only unreferenced trashed internal rows.
 * - `removeExternalFromLibrary` accepts only unreferenced external rows and
 *   never removes their user-owned paths.
 */

import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { remove as fsRemove } from '@main/utils/file'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { BatchMutationResult } from '@shared/types/file'

import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/lifecycle')

function trashTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): void {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  if (entry.origin !== 'internal' || entry.deletedAt != null) {
    throw DataApiErrorFactory.notFound('FileEntry', id)
  }
  deps.fileEntryService.updateTx(tx, id, { deletedAt: Date.now() })
}

export function trash(deps: FileManagerDeps, id: FileEntryId): void {
  deps.fileEntryService.withWriteTx((tx) => trashTx(deps, tx, id))
}

function restoreTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): FileEntry {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  if (entry.origin !== 'internal' || entry.deletedAt == null) {
    throw DataApiErrorFactory.notFound('FileEntry', id)
  }
  return deps.fileEntryService.updateTx(tx, id, { deletedAt: null })
}

export async function restore(deps: FileManagerDeps, id: FileEntryId): Promise<FileEntry> {
  return deps.fileEntryService.withWriteTx((tx) => restoreTx(deps, tx, id))
}

function permanentDeleteTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): FileEntry {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  deps.fileEntryService.deleteTx(tx, id)
  return entry
}

export async function cleanupDeletedEntry(deps: FileManagerDeps, entry: FileEntry): Promise<{ unlinkFailed: boolean }> {
  const physical = entry.origin === 'internal' ? resolvePhysicalPath(entry) : undefined
  deps.versionCache.invalidate(entry.id)
  if (entry.origin === 'external') {
    deps.danglingCache.removeEntry(entry.id, entry.externalPath)
  }
  if (physical !== undefined) {
    try {
      await fsRemove(physical)
    } catch (err) {
      // Include `physical` so operators can grep / `ls` the leak directly.
      // The DB row is already gone by this point, so without the path here
      // the only way to locate the orphan blob is to reconstruct it from
      // `id` + the (since-removed) DB row's `ext` — exactly the dance the
      // operator would otherwise have to do at incident time.
      logger.warn('permanentDelete: failed to unlink internal physical file (DB row already removed)', {
        id: entry.id,
        physical,
        err
      })
      return { unlinkFailed: true }
    }
  }
  return { unlinkFailed: false }
}

export async function permanentDelete(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  const entry = deps.fileEntryService.withWriteTx((tx) => permanentDeleteTx(deps, tx, id))
  await cleanupDeletedEntry(deps, entry)
}

function assertUnreferenced(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId, operation: string): void {
  if (deps.fileRefService.countPersistentRefsByEntryIdTx(tx, id) > 0) {
    throw DataApiErrorFactory.invalidOperation(operation, `File entry ${id} is still referenced`)
  }
}

function permanentDeleteFromTrashTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): FileEntry {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  if (entry.origin !== 'internal' || entry.deletedAt == null) {
    throw DataApiErrorFactory.invalidOperation(
      'permanently delete file from Trash',
      `File entry ${id} must be an internal file in the Recycle Bin`
    )
  }
  assertUnreferenced(deps, tx, id, 'permanently delete file from Trash')
  deps.fileEntryService.deleteTx(tx, id)
  return entry
}

export async function permanentDeleteFromTrash(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  const entry = deps.fileEntryService.withWriteTx((tx) => permanentDeleteFromTrashTx(deps, tx, id))
  await cleanupDeletedEntry(deps, entry)
}

function removeExternalFromLibraryTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): FileEntry {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  if (entry.origin !== 'external') {
    throw DataApiErrorFactory.invalidOperation('remove file from library', `File entry ${id} must be an external file`)
  }
  assertUnreferenced(deps, tx, id, 'remove file from library')
  deps.fileEntryService.deleteTx(tx, id)
  return entry
}

export async function removeExternalFromLibrary(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  const entry = deps.fileEntryService.withWriteTx((tx) => removeExternalFromLibraryTx(deps, tx, id))
  await cleanupDeletedEntry(deps, entry)
}

function aggregateWriteTx<T>(
  deps: FileManagerDeps,
  ids: readonly FileEntryId[],
  op: (tx: DbOrTx, id: FileEntryId) => T
): BatchMutationResult {
  const succeeded: FileEntryId[] = []
  const failed: BatchMutationResult['failed'] = []
  deps.fileEntryService.withWriteTx((tx) => {
    for (const id of ids) {
      try {
        op(tx, id)
        succeeded.push(id)
      } catch (err) {
        // Wire format only carries `.message` (string), so the stack is lost in
        // BatchMutationResult. Side-channel through the logger keeps it
        // available for postmortem without changing the consumer-facing shape.
        logger.warn('batch op item failed', { id, err })
        failed.push({ id, error: (err as Error).message })
      }
    }
  })
  return { succeeded, failed }
}

export function batchTrash(deps: FileManagerDeps, ids: readonly FileEntryId[]): BatchMutationResult {
  return aggregateWriteTx(deps, ids, (tx, id) => trashTx(deps, tx, id))
}

export function batchRestore(deps: FileManagerDeps, ids: readonly FileEntryId[]): BatchMutationResult {
  return aggregateWriteTx(deps, ids, (tx, id) => restoreTx(deps, tx, id))
}

async function aggregatePerEntry(
  ids: readonly FileEntryId[],
  op: (id: FileEntryId) => Promise<void>
): Promise<BatchMutationResult> {
  const succeeded: FileEntryId[] = []
  const failed: BatchMutationResult['failed'] = []
  for (const id of ids) {
    try {
      await op(id)
      succeeded.push(id)
    } catch (err) {
      logger.warn('batch op item failed', { id, err })
      failed.push({ id, error: (err as Error).message })
    }
  }
  return { succeeded, failed }
}

export function batchPermanentDeleteFromTrash(
  deps: FileManagerDeps,
  ids: readonly FileEntryId[]
): Promise<BatchMutationResult> {
  return aggregatePerEntry(ids, (id) => permanentDeleteFromTrash(deps, id))
}

export function batchRemoveFromLibrary(
  deps: FileManagerDeps,
  ids: readonly FileEntryId[]
): Promise<BatchMutationResult> {
  return aggregatePerEntry(ids, (id) => removeExternalFromLibrary(deps, id))
}
