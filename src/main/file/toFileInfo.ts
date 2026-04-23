/**
 * `toFileInfo(entry)` — project a managed `FileEntry` into a live, on-disk
 * `FileInfo` descriptor.
 *
 * Phase status: Phase 1a exports the signature only. The implementation
 * (resolve path via `resolvePhysicalPath`, stat the file, derive mime/type
 * from ext, preserve name) lands in Phase 1b.1 together with the read path.
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
 * - External entry whose file has been removed → `ENOENT` is surfaced. The
 *   entry becomes dangling; callers handle the `'missing'` DanglingState
 *   (queried via `getDanglingState`) and either surface the broken reference
 *   to the user or prompt for a new `ensureExternalEntry(newPath)`.
 * - Internal entry missing on disk → a bug (should never happen with a healthy
 *   userData dir). The error propagates for visibility.
 *
 * @see FileInfo (packages/shared/file/types/info.ts) for the data shape.
 * @see architecture.md §2 for the reference-vs-data-shape design.
 */

import type { FileEntry } from '@shared/data/types/file'
import type { FileInfo } from '@shared/file/types'

export async function toFileInfo(_entry: FileEntry): Promise<FileInfo> {
  throw new Error('toFileInfo: not implemented (Phase 1a skeleton, lands in Phase 1b.1)')
}
