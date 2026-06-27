/**
 * Stored entity-image helpers (avatar / provider logo / mini-app logo).
 *
 * These images live as normalized 128×128 WebP files on disk; the DB/Preference
 * stores only the file-entry id. The renderer:
 * - resolves a stored id → a `file://…/{id}.webp` URL for `<img src>` display,
 *   passing through every other value form (emoji / `icon:<id>` / preset id /
 *   `http(s)` / `data:`) unchanged;
 * - normalizes uploads to a 128×128 WebP **here** (consumer side), then stores
 *   the bytes via the content-agnostic `file.put_entity_file` IpcApi route, which
 *   returns the new id. The main file layer carries no image knowledge.
 */

import { ipcApi } from '@renderer/ipc'
import { normalizeImageToWebp } from '@renderer/utils/image'
import type { FileRefSourceType } from '@shared/data/types/file'

/** file_entry ids are UUIDs (v7); anything else is an emoji / icon ref / url / preset id. */
const FILE_ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when `value` is a stored entity-image reference (a file-entry id). */
export function isStoredImageId(value?: string | null): value is string {
  return !!value && FILE_ENTRY_ID_RE.test(value)
}

/**
 * Resolve a stored value to something `<img src>` can render. A file-entry id
 * becomes a `file://{filesPath}/{id}.webp` URL; every other form (emoji /
 * `icon:<id>` / preset id / remote URL / data URL / empty) is returned
 * unchanged. `filesPath` is the cached `app.path.files` dir — pass it from
 * `useCache('app.path.files')` so the resolution stays reactive.
 */
export function resolveStoredImageSrc(value?: string | null, filesPath?: string): string | undefined {
  if (!value) return undefined
  if (!isStoredImageId(value)) return value
  if (!filesPath) return undefined
  return `file://${filesPath}/${value}.webp`
}

/**
 * Normalize an uploaded image to a 128×128 WebP and persist it in the entity
 * slot, returning the new file-entry id to store as the entity's reference.
 */
export async function putEntityImageFromFile(
  file: File,
  sourceType: FileRefSourceType,
  sourceId: string,
  role: string
): Promise<string> {
  const data = await normalizeImageToWebp(file)
  const { fileId } = await ipcApi.request('file.put_entity_file', { data, ext: 'webp', sourceType, sourceId, role })
  return fileId
}

/** Remove the entity's stored image (file + ref), if any. */
export async function clearEntityImage(sourceType: FileRefSourceType, sourceId: string, role: string): Promise<void> {
  await ipcApi.request('file.clear_entity_file', { sourceType, sourceId, role })
}
