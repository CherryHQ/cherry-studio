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
 *
 * ## Legacy fields dropped by this shim
 *
 * The v2 `FileEntry` model deliberately omits these v1 `FileMetadata` fields,
 * so the shim returns them as `undefined`:
 *
 * - `tokens?: number` — v1 cached the embedding token count per file row.
 *   v2 has no equivalent on `file_entry`; tokens become a per-use derivation
 *   (e.g. `knowledge_item` chunk metadata) and are no longer attached to the
 *   file itself.
 * - `purpose?: OpenAI.FilePurpose` — v1 cached the OpenAI Files API purpose
 *   used at upload time. v2 leaves this to the upload-side cache
 *   (`window.api.fileService.retrieve`) rather than duplicating it on the
 *   local entry.
 *
 * Live audit: only `fileProcessor.ts` reads `purpose` (compares against the
 * remote upload's `purpose`); shim-projected files compare `undefined` vs
 * the remote value, which currently degrades the OpenAI file de-dup check
 * — see the audit comment at that call site. No live consumer reads
 * `tokens` from a shim-projected `FileMetadata`. Both gaps will close
 * naturally when Batch A-E migrates those call sites off `FileMetadata`.
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
