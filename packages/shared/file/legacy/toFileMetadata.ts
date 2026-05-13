import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { getFileTypeByExt } from '@shared/file/types/fileType'

/**
 * Project a v2 `FileEntry` (plus its resolved physical path) onto the v1
 * `FileMetadata` shape so that Phase 2 Batch A-E consumers can keep reading
 * `FileMetadata`-typed values while writing through v2 IPC.
 *
 * - `physicalPath`: absolute FS path returned by `File:getPhysicalPath` IPC.
 *   For internal entries this is `{userData}/Data/Files/{id}.{ext}`;
 *   for external entries it is the `entry.externalPath` itself.
 * - `size`: internal entries carry authoritative bytes; external entries carry
 *   `0` because no snapshot is stored for externals (live value via `getMetadata`).
 * - `count`: always `1` — the v2 model has no reference-counting at the entry
 *   level (counts live on `file_ref` rows, per consumer).
 */
export function toFileMetadata(entry: FileEntry, physicalPath: string): FileMetadata {
  const ext = entry.ext != null ? `.${entry.ext}` : ''
  const name = entry.name
  const size = entry.origin === 'internal' ? entry.size : 0
  return {
    id: entry.id,
    name,
    origin_name: `${name}${ext}`,
    path: physicalPath,
    size,
    ext,
    type: getFileTypeByExt(entry.ext ?? ''),
    created_at: new Date(entry.createdAt).toISOString(),
    count: 1
  }
}
