/**
 * Entity-image file storage — the shared mechanism behind on-disk avatar /
 * provider-logo / mini-app-logo images.
 *
 * Each business owner (ProviderService, MiniAppService, the profile IPC handler)
 * holds a direct file-entry id reference and orchestrates the file + business
 * field update atomically. The renderer pre-encodes the image to 128×128 WebP
 * bytes; the file layer carries no image knowledge.
 *
 * Stateless; composes FileManager's primitives (`createInternalEntry` /
 * `permanentDelete`).
 */

import { application } from '@application'
import type { FileEntryId } from '@shared/data/types/file'

/** Store pre-encoded WebP bytes as an internal file_entry; returns its id. */
export async function storeEntityImage(data: Uint8Array, name: string): Promise<FileEntryId> {
  const entry = await application.get('FileManager').createInternalEntry({ source: 'bytes', data, name, ext: 'webp' })
  return entry.id
}

/** Best-effort delete of a superseded/cleared entity image file_entry. */
export async function deleteEntityImage(fileId: FileEntryId | null | undefined): Promise<void> {
  if (!fileId) return
  await application
    .get('FileManager')
    .permanentDelete(fileId)
    .catch(() => undefined)
}
