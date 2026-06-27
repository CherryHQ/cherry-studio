/**
 * Entity-slot file storage — the generic mechanism behind the
 * `file.put_entity_file` / `file.clear_entity_file` IpcApi routes.
 *
 * Model: "one stored file per entity slot" `(sourceType, sourceId, role)` —
 * e.g. avatar / provider logo / mini-app logo. `put` stores the given bytes as
 * an internal FileEntry, points the slot's file_ref at it, and prunes any
 * superseded entry; `clear` empties the slot.
 *
 * **Content-agnostic**: the caller supplies the final bytes + `ext` and owns any
 * normalization (the avatar/logo consumer sends a pre-encoded 128×128 WebP). The
 * file layer carries no image — or any content-type — knowledge.
 *
 * Stateless; composes FileManager's primitives (`createInternalEntry` /
 * `permanentDelete`) + `fileRefService`. Neither part of the FileManager facade
 * nor the IPC adapter (handlers delegate here).
 */

import { application } from '@application'
import { fileRefService } from '@data/services/FileRefService'
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'

export interface PutEntitySlotFileParams {
  data: Uint8Array
  ext: string
  sourceType: FileRefSourceType
  sourceId: string
  role: string
}

export interface ClearEntitySlotParams {
  sourceType: FileRefSourceType
  sourceId: string
  role: string
}

/**
 * Prune the file entries occupying an entity slot, optionally keeping one
 * (`keepId`).
 *
 * `permanentDelete` removes the file_entry (CASCADE drops its file_ref) and
 * unlinks the on-disk file. Pass `keepId` to retain a just-created entry and drop
 * only the superseded one(s); omit it to empty the slot. Best-effort: a failed
 * unlink is swallowed so one stale entry can't block pruning the rest.
 */
async function pruneSlotEntries(
  sourceType: FileRefSourceType,
  sourceId: string,
  role: string,
  keepId?: FileEntryId
): Promise<void> {
  const refs = (await fileRefService.findBySource({ sourceType, sourceId })).filter((r) => r.role === role)
  for (const ref of refs) {
    if (ref.fileEntryId !== keepId) {
      await application
        .get('FileManager')
        .permanentDelete(ref.fileEntryId)
        .catch(() => undefined)
    }
  }
}

/** Store the given bytes in the slot, replacing any previously stored entry. */
export async function putEntitySlotFile(params: PutEntitySlotFileParams): Promise<{ fileId: FileEntryId }> {
  const { data, ext, sourceType, sourceId, role } = params
  const entry = await application
    .get('FileManager')
    .createInternalEntry({ source: 'bytes', data, name: sourceType, ext })
  await fileRefService.create({ fileEntryId: entry.id, sourceType, sourceId, role })
  await pruneSlotEntries(sourceType, sourceId, role, entry.id)
  return { fileId: entry.id }
}

/** Remove the file stored for a slot, if any. */
export async function clearEntitySlot(params: ClearEntitySlotParams): Promise<void> {
  await pruneSlotEntries(params.sourceType, params.sourceId, params.role)
}
