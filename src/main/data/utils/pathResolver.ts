import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileEntryOrigin } from '@shared/data/types/file'

const logger = loggerService.withContext('pathResolver')

/**
 * Minimal entry shape needed for path resolution.
 */
export interface PathResolvableEntry {
  id: string
  origin: FileEntryOrigin
  ext: string | null
  externalPath: string | null
}

/**
 * Get the file extension suffix (with dot) or empty string if null.
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a FileEntry.
 *
 * - `origin='internal'` → `{userData}/files/{id}{.ext}` (flat UUID-based storage)
 * - `origin='external'` → `externalPath` directly (user-provided absolute path)
 *
 * @throws If null bytes are detected (potential path-truncation attack) or
 *   if `origin='external'` but `externalPath` is null (schema invariant violated).
 *   Security-sensitive rejections are logged at `error` level — these paths
 *   should never reach the resolver if upstream Zod validation runs; arriving
 *   here indicates either a parse-bypass or a data integrity problem worth
 *   investigating.
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): string {
  // Reject null bytes in any user-controlled path segments (path-truncation guard).
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    logger.error('Null byte detected in entry id/ext', { entryId: entry.id, origin: entry.origin })
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return application.getPath('feature.files.data', `${entry.id}${getExtSuffix(entry.ext)}`)
  }

  // external
  if (!entry.externalPath) {
    logger.error('External entry has null externalPath (schema invariant violated)', { entryId: entry.id })
    throw new Error(`external entry ${entry.id} has null externalPath (schema invariant violated)`)
  }
  if (entry.externalPath.includes('\0')) {
    logger.error('Null byte detected in externalPath', { entryId: entry.id })
    throw new Error(`external entry ${entry.id} externalPath contains null bytes`)
  }
  return path.resolve(entry.externalPath)
}

/**
 * Canonicalize a user-provided external path into the form stored in
 * `file_entry.externalPath`. This result is the **sole** key used for upsert
 * and lookup of external entries — `ensureExternalEntry` MUST call this
 * before any DB write or query, and `fileEntryService.findByExternalPath`
 * does the same at read boundaries.
 *
 * ## Phase 1b scope (this function's contract)
 *
 * Cheap, synchronous normalization — no FS IO, cross-platform uniform:
 *
 *   1. `path.resolve(raw)` — make absolute, resolve `./` and `../`
 *   2. Unicode NFC normalization — defends against NFC-vs-NFD mismatch
 *      (macOS filesystems can surface either form depending on API; this
 *      is the most common duplicate-entry trigger for CJK-filename users)
 *   3. Strip trailing separator — `/foo/bar/` → `/foo/bar`
 *
 * This subset covers the dominant sources of `externalPath` inputs in Cherry
 * (Electron `showOpenDialog` and drag-drop, both of which return OS-canonical
 * paths with correct case already).
 *
 * ## Deliberately NOT handled
 *
 * - **Case-insensitive FS de-duplication** (macOS APFS / Windows NTFS):
 *   `/Users/me/FILE.pdf` vs `/Users/me/file.pdf` can still produce two
 *   entries. Requires `fs.realpath()` (async, FS-IO-backed, requires file
 *   existence) — deferred until real user reports materialize.
 * - **Symlink resolution** (`realpath` target collapse): two symlinks to
 *   the same file remain distinct entries. Same rationale as above.
 * - **Windows short-name (8.3) resolution**: `LONGNA~1` vs `longname` —
 *   requires WinAPI; low-priority edge case.
 * - **SMB / NFS mounts with FS-level case-sensitivity diverging from host**:
 *   out of scope; document as known limitation.
 *
 * ## Upgrade path
 *
 * If user reports of "same file, two entries" materialize, extend this
 * function with `fs.realpath` (making the signature `Promise<string>`) and
 * ship a one-off migration that re-canonicalizes existing rows and merges
 * file_ref targets. See `rfc-file-manager.md §11` risks.
 *
 * @param raw user-provided absolute (or resolvable) path
 * @returns canonical form stored in `file_entry.externalPath`
 */
export function canonicalizeExternalPath(_raw: string): string {
  throw new Error('canonicalizeExternalPath: not implemented (Phase 1a stub, cheap-subset impl lands in Phase 1b)')
}
