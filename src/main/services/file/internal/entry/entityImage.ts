/**
 * Entity image storage — `putEntityImage` / `clearEntityImage`.
 *
 * A small reusable primitive for "one normalized image per entity slot"
 * (avatar / provider logo / mini-app logo). Normalizes arbitrary upload bytes
 * to a 128×128 WebP, stores it as an internal FileEntry, and keeps a single
 * `file_ref` for the `(sourceType, sourceId, role)` slot — replacing and
 * deleting any previous image so the on-disk file and DB row stay in sync.
 *
 * Pure functions over `FileManagerDeps`, matching the rest of `internal/*`.
 */

import { normalizeToWebp } from '@main/utils/file/imageNormalize'
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'

import type { FileManagerDeps } from '../deps'
import { createInternal } from './create'
import { permanentDelete } from './lifecycle'

export interface PutEntityImageParams {
  data: Uint8Array
  sourceType: FileRefSourceType
  sourceId: string
  role: string
}

export interface ClearEntityImageParams {
  sourceType: FileRefSourceType
  sourceId: string
  role: string
}

export async function putEntityImage(
  deps: FileManagerDeps,
  params: PutEntityImageParams
): Promise<{ fileId: FileEntryId }> {
  const { data, sourceType, sourceId, role } = params
  const previous = (await deps.fileRefService.findBySource({ sourceType, sourceId })).filter((r) => r.role === role)

  const webp = await normalizeToWebp(data)
  const entry = await createInternal(deps, { source: 'bytes', data: webp, name: sourceType, ext: 'webp' })
  await deps.fileRefService.create({ fileEntryId: entry.id, sourceType, sourceId, role })

  // Delete the superseded image(s): permanentDelete removes the file_entry
  // (CASCADE drops its file_ref) and unlinks the on-disk file.
  for (const ref of previous) {
    if (ref.fileEntryId !== entry.id) {
      await permanentDelete(deps, ref.fileEntryId).catch(() => undefined)
    }
  }
  return { fileId: entry.id }
}

export async function clearEntityImage(deps: FileManagerDeps, params: ClearEntityImageParams): Promise<void> {
  const refs = (
    await deps.fileRefService.findBySource({ sourceType: params.sourceType, sourceId: params.sourceId })
  ).filter((r) => r.role === params.role)
  for (const ref of refs) {
    await permanentDelete(deps, ref.fileEntryId).catch(() => undefined)
  }
}
