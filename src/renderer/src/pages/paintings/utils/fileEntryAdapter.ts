import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'

/**
 * Adapt a v2 `FileEntry` into the v1 `FileMetadata` the painting state +
 * Artboard renderer still consume. The physical path comes from a separate
 * `getPhysicalPath` IPC; call sites batch their lookups in `Promise.all`.
 *
 * Used by:
 *   - `paintingGenerationService.resolvePaintingFiles` (base64 branch)
 *   - `downloadImages` (url branch)
 *   - `recordToPaintingData` (history hydration)
 *
 * After the broader renderer v1→v2 file cutover this adapter goes away —
 * paintings should consume `FileEntry` directly.
 */
export async function fileEntryToMetadata(entry: FileEntry): Promise<FileMetadata> {
  const path = await window.api.file.getPhysicalPath({ id: entry.id })
  const dottedExt = entry.ext ? `.${entry.ext}` : ''
  const fullName = `${entry.name}${dottedExt}`
  // `size` only exists on the internal variant; external entries never carry
  // size in v2 (live values come from `getMetadata` on demand). Paintings
  // always create internal entries via `source: 'base64' | 'url'`, but
  // hydration from history may resolve a migrated external row, so handle
  // both branches.
  const size = entry.origin === 'internal' ? entry.size : 0
  return {
    id: entry.id,
    name: fullName,
    origin_name: fullName,
    path,
    size,
    ext: dottedExt,
    type: 'image',
    created_at: new Date(entry.createdAt).toISOString(),
    count: 1
  }
}
