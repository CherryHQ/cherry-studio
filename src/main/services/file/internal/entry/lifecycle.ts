/**
 * Entry lifecycle — trash / restore / permanentDelete + batch variants.
 *
 * `trash` / `restore` are internal-only; passing an external id throws (the
 * `fe_external_no_delete` CHECK enforces this at the DB level for `trash`, and
 * `restore` uses an explicit early-throw because trashed external rows cannot
 * exist by definition).
 *
 * `permanentDelete` is the single entry point that crosses DB and FS:
 * - DB row removal is mandatory.
 * - For internal origin, the physical file is best-effort unlinked. Failure
 *   to unlink (already missing, permission denied, etc.) is logged but does
 *   not block DB deletion — the architecture doc prefers DB-FS convergence
 *   to "both gone" over "DB still has dangling row".
 * - For external origin, the user's file is **never** modified.
 */

import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { remove as fsRemove } from '@main/utils/file'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { BatchMutationResult } from '@shared/types/file'

import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/lifecycle')

function trashTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): void {
  deps.fileEntryService.updateTx(tx, id, { deletedAt: Date.now() })
}

export function trash(deps: FileManagerDeps, id: FileEntryId): void {
  deps.fileEntryService.update(id, { deletedAt: Date.now() })
}

function restoreTx(deps: FileManagerDeps, tx: DbOrTx, id: FileEntryId): FileEntry {
  const entry = deps.fileEntryService.getByIdTx(tx, id)
  if (entry.origin === 'external') {
    throw new Error(`restore: external entry ${id} cannot be trashed by definition; nothing to restore`)
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

async function cleanupDeletedEntry(deps: FileManagerDeps, entry: FileEntry): Promise<void> {
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
    }
  }
}

export async function permanentDelete(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  const entry = deps.fileEntryService.withWriteTx((tx) => permanentDeleteTx(deps, tx, id))
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

export async function batchPermanentDelete(
  deps: FileManagerDeps,
  ids: readonly FileEntryId[]
): Promise<BatchMutationResult> {
  const deletedEntries: FileEntry[] = []
  const result = aggregateWriteTx(deps, ids, (tx, id) => {
    const entry = permanentDeleteTx(deps, tx, id)
    deletedEntries.push(entry)
  })
  for (const entry of deletedEntries) {
    await cleanupDeletedEntry(deps, entry)
  }
  return result
}

export async function emptyTrash(deps: FileManagerDeps): Promise<BatchMutationResult> {
  const deletedEntries: FileEntry[] = []
  const succeeded: FileEntryId[] = []
  const failed: BatchMutationResult['failed'] = []

  deps.fileEntryService.withWriteTx((tx) => {
    const entries = deps.fileEntryService.findManyTx(tx, { origin: 'internal', inTrash: true })
    for (const entry of entries) {
      try {
        const deletedEntry = permanentDeleteTx(deps, tx, entry.id)
        deletedEntries.push(deletedEntry)
        succeeded.push(entry.id)
      } catch (err) {
        logger.warn('batch op item failed', { id: entry.id, err })
        failed.push({ id: entry.id, error: (err as Error).message })
      }
    }
  })

  for (const entry of deletedEntries) {
    await cleanupDeletedEntry(deps, entry)
  }

  return { succeeded, failed }
}
