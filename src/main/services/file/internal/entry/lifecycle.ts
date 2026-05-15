/**
 * Entry lifecycle — trash / restore / permanentDelete + batch variants.
 *
 * `trash` / `restore` are internal-only; passing an external id throws (the
 * `fe_external_no_trash` CHECK enforces this at the DB level for `trash`, and
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

import { loggerService } from '@logger'
import { remove as fsRemove } from '@main/utils/file/fs'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { BatchMutationResult } from '@shared/file/types'

import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/lifecycle')

export async function trash(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  await deps.fileEntryService.update(id, { trashedAt: Date.now() })
}

export async function restore(deps: FileManagerDeps, id: FileEntryId): Promise<FileEntry> {
  const entry = await deps.fileEntryService.getById(id)
  if (entry.origin === 'external') {
    throw new Error(`restore: external entry ${id} cannot be trashed by definition; nothing to restore`)
  }
  return deps.fileEntryService.update(id, { trashedAt: null })
}

export async function permanentDelete(deps: FileManagerDeps, id: FileEntryId): Promise<void> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = entry.origin === 'internal' ? resolvePhysicalPath(entry) : undefined
  await deps.fileEntryService.delete(id)
  deps.versionCache.invalidate(id)
  if (entry.origin === 'external') {
    deps.danglingCache.removeEntry(id, entry.externalPath)
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
        id,
        physical,
        err
      })
    }
  }
}

async function aggregate<T>(
  ids: readonly FileEntryId[],
  op: (id: FileEntryId) => Promise<T>
): Promise<BatchMutationResult> {
  const succeeded: FileEntryId[] = []
  const failed: BatchMutationResult['failed'] = []
  for (const id of ids) {
    try {
      await op(id)
      succeeded.push(id)
    } catch (err) {
      // Wire format only carries `.message` (string), so the stack is lost in
      // BatchMutationResult. Side-channel through the logger keeps it
      // available for postmortem without changing the consumer-facing shape.
      logger.warn('batch op item failed', { id, err })
      failed.push({ id, error: (err as Error).message })
    }
  }
  return { succeeded, failed }
}

export function batchTrash(deps: FileManagerDeps, ids: readonly FileEntryId[]): Promise<BatchMutationResult> {
  return aggregate(ids, (id) => trash(deps, id))
}

export function batchRestore(deps: FileManagerDeps, ids: readonly FileEntryId[]): Promise<BatchMutationResult> {
  return aggregate(ids, (id) => restore(deps, id))
}

export function batchPermanentDelete(deps: FileManagerDeps, ids: readonly FileEntryId[]): Promise<BatchMutationResult> {
  return aggregate(ids, (id) => permanentDelete(deps, id))
}
