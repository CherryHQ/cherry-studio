/**
 * Stored entity-image helpers (avatar / provider logo / mini-app logo).
 *
 * These images live as normalized 128×128 WebP files on disk; each business
 * **owner** (the avatar Preference, the provider / mini-app row) holds the
 * file-entry id directly. The renderer pre-stores an upload via the generic
 * byte-store route ({@link storeImageUpload}) to get an opaque file-entry id,
 * then hands that id to the owner's own API (`profile.set_avatar`, the
 * provider / mini-app DataApi mutations), which writes the `file_ref` slot
 * server-side — the renderer never deals with `sourceType`/`sourceId`/`role`.
 * {@link resolveStoredImageSrc} resolves a stored id → a `file://…/{id}.webp`
 * URL for `<img src>`, passing through every other value form (emoji /
 * `icon:<id>` / preset id, plus the avatar's v1 base64 `data:` form) unchanged.
 */

import { ipcApi } from '@renderer/ipc'
import { normalizeImageToWebp } from '@renderer/utils/image'

/** file_entry ids are UUIDs (v7); anything else is an emoji / icon ref / preset id. */
const FILE_ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when `value` is a stored entity-image reference (a file-entry id). */
export function isStoredImageId(value?: string | null): value is string {
  return !!value && FILE_ENTRY_ID_RE.test(value)
}

/**
 * Resolve a stored value to something `<img src>` can render. A file-entry id
 * becomes a `file://{filesPath}/{id}.webp` URL; every other form (emoji /
 * `icon:<id>` / preset id / the avatar's v1 base64 data URL / empty) is
 * returned unchanged. `filesPath` is the cached `app.path.files` dir — pass it from
 * `useCache('app.path.files')` so the resolution stays reactive.
 */
export function resolveStoredImageSrc(value?: string | null, filesPath?: string): string | undefined {
  if (!value) return undefined
  if (!isStoredImageId(value)) return value
  if (!filesPath) return undefined
  return `file://${filesPath}/${value}.webp`
}

/**
 * Normalize an uploaded image to a 128×128 WebP and store it as an internal
 * file, returning the new file-entry id. The caller hands this id to the owning
 * entity's API (`profile.set_avatar`, provider / mini-app DataApi mutations),
 * which records the `file_ref` slot server-side.
 */
export async function storeImageUpload(file: Blob): Promise<string> {
  const data = await normalizeImageToWebp(file)
  const { succeeded, failed } = await ipcApi.request('file.batch_create_internal_entries', {
    items: [{ source: 'bytes', data, name: 'image', ext: 'webp' }]
  })
  const entry = succeeded[0]
  if (!entry) throw new Error(failed[0]?.error ?? 'Failed to store image upload')
  return entry.id
}
