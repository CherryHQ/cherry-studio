/**
 * `toFileInfo(entry)` — project a managed `FileEntry` into a live, on-disk
 * `FileInfo` descriptor.
 *
 * Resolves the entry's physical path via `resolvePhysicalPath`, runs `fs.stat`
 * for live size/mtime, and derives mime/type from the entry's extension.
 *
 * ## Projection is one-way
 *
 * `FileEntry → FileInfo` is a snapshot-to-live projection — each call re-reads
 * `fs.stat`. There is no corresponding `FileInfo → FileEntry` conversion: the
 * reverse is a *state change* that must go through sanctioned FileManager
 * factories (`createInternalEntry` / `ensureExternalEntry`). The Zod brand on
 * `FileEntrySchema` enforces this at compile time.
 *
 * ## Failure modes
 *
 * - External entry whose file has been removed → `ENOENT` is surfaced. Callers
 *   that need the dangling cache to update should go through `FileManager`,
 *   which wraps this function.
 * - Internal entry missing on disk → a bug. The error propagates for visibility.
 *
 * @see FileInfo (packages/shared/file/types/info.ts) for the data shape.
 * @see architecture.md §2 for the reference-vs-data-shape design.
 */

import { stat as fsStat } from '@main/utils/file/fs'
import type { FileEntry } from '@shared/data/types/file'
import { type FileInfo, FileInfoSchema, getFileTypeByExt } from '@shared/file/types'
import mime from 'mime'

import { resolvePhysicalPath } from './utils/pathResolver'

export async function toFileInfo(entry: FileEntry): Promise<FileInfo> {
  const physicalPath = resolvePhysicalPath(entry)
  const s = await fsStat(physicalPath)
  const ext = entry.ext
  const inferredMime = ext ? (mime.getType(ext) ?? 'application/octet-stream') : 'application/octet-stream'
  // `FileInfoSchema.parse` rehydrates the `FileInfo` brand. Casting back to
  // `FileInfo` lets the `path` field carry the `FilePath` template-literal
  // type at the API surface (Zod can't express template literals); the
  // runtime shape check is otherwise identical.
  return FileInfoSchema.parse({
    path: physicalPath,
    name: entry.name,
    ext,
    size: s.size,
    mime: inferredMime,
    type: getFileTypeByExt(ext ?? ''),
    createdAt: s.createdAt || s.modifiedAt,
    modifiedAt: s.modifiedAt
  }) as FileInfo
}
