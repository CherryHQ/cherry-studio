import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { CanonicalExternalPath } from '@shared/data/types/file'
import { canonicalizeAbsolutePath } from '@shared/file/canonicalize'
import type { FilePath } from '@shared/file/types'

const logger = loggerService.withContext('pathResolver')

/**
 * Minimal entry shape needed for path resolution. Mirrors the
 * discriminated-union shape of `FileEntry` so the same `origin`-driven
 * narrowing the BO exposes is preserved here — internal variant has no
 * `externalPath`, external variant has it as a non-null string.
 */
export type PathResolvableEntry =
  | { id: string; origin: 'internal'; ext: string | null }
  | { id: string; origin: 'external'; ext: string | null; externalPath: string }

/**
 * Get the file extension suffix (with dot) or empty string if null.
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a FileEntry.
 *
 * - `origin='internal'` → `{userData}/Data/Files/{id}{.ext}` (flat UUID-based storage)
 * - `origin='external'` → `externalPath` directly (user-provided absolute path)
 *
 * Returns a branded `FilePath` so callers can pass the result straight to
 * `@main/utils/file/fs` without a manual `as FilePath` cast — the brand
 * is sanctioned here because the function ran the null-byte + absolute-path
 * guards that make a string safe to treat as a `FilePath`.
 *
 * @throws If null bytes are detected (potential path-truncation attack) in
 *   entry id / ext / externalPath. Security-sensitive rejections are logged
 *   at `error` level — these inputs should never reach the resolver if
 *   upstream Zod validation runs; arriving here indicates either a
 *   parse-bypass or a data integrity problem worth investigating.
 */
export function resolvePhysicalPath(entry: PathResolvableEntry): FilePath {
  // Reject null bytes in any user-controlled path segments (path-truncation guard).
  if (entry.id.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    logger.error('Null byte detected in entry id/ext', { entryId: entry.id, origin: entry.origin })
    throw new Error('Entry id or extension contains null bytes')
  }

  if (entry.origin === 'internal') {
    return application.getPath('feature.files.data', `${entry.id}${getExtSuffix(entry.ext)}`) as FilePath
  }

  // entry.origin === 'external' — schema discriminator guarantees externalPath
  // is present (no null branch on ExternalEntrySchema), so the prior
  // defensive null-check is unreachable and has been removed.
  if (entry.externalPath.includes('\0')) {
    logger.error('Null byte detected in externalPath', { entryId: entry.id })
    throw new Error(`external entry ${entry.id} externalPath contains null bytes`)
  }
  return path.resolve(entry.externalPath) as FilePath
}

/**
 * Canonicalize a user-provided external path into the form stored in
 * `file_entry.externalPath`. This result is the **sole** key used for upsert
 * and lookup of external entries — `ensureExternalEntry` MUST call this
 * before any DB write or query, and `fileEntryService.findByExternalPath`
 * does the same at read boundaries.
 *
 * The return type is branded as `CanonicalExternalPath` so that downstream
 * surfaces filtering by `externalPath` (today: `findByExternalPath`; in future:
 * any new DataApi / service query on this column) cannot accept a raw user
 * path by mistake. New call sites gain compile-time guarding for free.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠️ RULE-EVOLUTION DISCIPLINE
 * ─────────────────────────────────────────────────────────────────────────
 * Modifying the normalization behavior of this function (adding / removing /
 * altering any step below) REQUIRES a paired Drizzle migration that
 * re-canonicalizes every existing `file_entry` row where `origin='external'`.
 *
 * Rationale: the canonical form is application-layer logic, not DB schema.
 * Existing rows were written under the **old** rule; new queries run under
 * the **new** rule. Without a re-canonicalization migration, historical rows
 * remain under the old rule and silently stop matching `findByExternalPath`
 * lookups — users experience "my file is in the library but the system says
 * it isn't".
 *
 * When a new rule also collapses previously-distinct strings to the same
 * canonical form (e.g. `fs.realpath` merging case-insensitive duplicates),
 * the migration additionally MUST merge the colliding rows. The winner
 * selection and file_ref re-pointing rules are defined in
 * `docs/references/file/file-manager-architecture.md §1.2 Rule evolution
 * discipline` — follow them exactly; do not improvise.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## Scope (this function's contract)
 *
 * Cheap, synchronous normalization — no FS IO, cross-platform uniform:
 *
 *   0. Reject null bytes (`\0`) — a null byte in the raw path is never a
 *      legal filesystem path; rejecting at canonicalization keeps the rest
 *      of the pipeline (ensureExternalEntry → findByExternalPath →
 *      resolvePhysicalPath) free to treat canonical paths as null-byte-free.
 *      Without this step, a malformed path could be persisted into
 *      `file_entry.externalPath` and only blow up later at use-time inside
 *      `resolvePhysicalPath`, leaving a poisoned row in the DB.
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
 * ## Deliberately NOT handled here
 *
 * The following are handled elsewhere, NOT by this function — `canonicalizeExternalPath`
 * stays sync / FS-IO-free so it can run from Zod refines and read paths without
 * paying `fs.*` cost on every call.
 *
 * - **Case-insensitive FS de-duplication** (macOS APFS / Windows NTFS):
 *   `/Users/me/FILE.pdf` vs `/Users/me/file.pdf` are byte-distinct after
 *   canonicalize and would still produce two rows under this function alone.
 *   Enforced at two layers downstream: (1) DB functional unique index
 *   `UNIQUE(lower(externalPath))` rejects the second row at INSERT, and
 *   (2) `ensureExternalEntry` runs `fs.realpath` on the colliding pair
 *   before INSERT and either reuses the existing row (same on-disk entity,
 *   case-insensitive FS) or throws `case-collision` (distinct files,
 *   case-sensitive FS). See `file-manager-architecture.md §1.2 Duplicate-entry
 *   detection on insert`.
 * - **Symlink resolution** (`realpath` target collapse): two symlinks to the
 *   same file remain distinct entries. Not enforced anywhere — symlink
 *   collapse would require unconditional `fs.realpath` on every canonicalize,
 *   trading the sync/cheap contract this function commits to.
 * - **Windows short-name (8.3) resolution**: `LONGNA~1` vs `longname` —
 *   requires WinAPI; low-priority edge case.
 * - **SMB / NFS mounts with FS-level case-sensitivity diverging from host**:
 *   out of scope; document as known limitation.
 *
 *
 * @param raw user-provided absolute (or resolvable) path
 * @returns canonical form stored in `file_entry.externalPath`
 * @throws if `raw` contains null bytes
 */
export function canonicalizeExternalPath(raw: string): CanonicalExternalPath {
  // Delegate to the shared pure-JS implementation so the FileEntry schema
  // can `refine` against the exact same rule on parse (S5). The brand cast
  // here is the sanctioned production-side factory site documented in the
  // `CanonicalExternalPath` JSDoc.
  return canonicalizeAbsolutePath(raw) as CanonicalExternalPath
}
