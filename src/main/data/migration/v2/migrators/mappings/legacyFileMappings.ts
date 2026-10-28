/**
 * Shape knowledge about v1 `files` rows, shared by `FileMigrator` (the `file_entry` table) and
 * `KnowledgeMappings` (knowledge `file` items) so the two cannot drift apart.
 */

import type { FileMetadata } from '@shared/data/types/legacyFile'

/**
 * Strip legacy leading dot and OS-ignored trailing dot/space from extension,
 * return null for empty/extensionless. Legacy v1 ext field looks like '.pdf'
 * or '.txt' or '' for extensionless.
 */
export function normalizeExt(ext: string | undefined | null): string | null {
  if (!ext || ext.trim() === '') return null
  const stripped = ext.startsWith('.') ? ext.slice(1) : ext
  const normalized = stripped.replace(/[\s.]+$/, '')
  return normalized.length > 0 ? normalized : null
}

/**
 * Candidate on-disk names for a v1 upload under `{userData}/Data/Files`, most trustworthy first
 * and deduped.
 *
 * Everything is derived from `id` (never corrupted) plus `ext`, and **never** from `row.name`:
 * `FileStorage.findDuplicateFile` writes a double-extension `name` (`{id}.pdf.pdf`) when the same
 * bytes are uploaded twice, which resolves to a path that does not exist. Trusting it makes such a
 * row look orphaned on a cross-platform restore (#15733, where the `path` column carries foreign
 * separators too), so the row is skipped and its physical file — now unreferenced — is reclaimed
 * by the scheduled FS orphan sweep.
 *
 * Two candidates rather than one, because v1 is not consistent about the leading dot:
 * 1. Canonical `{id}.{normalizedExt}` — what `uploadFile` ('.pdf'), `saveBase64Image` ('png') and
 *    the malformed dedup rows all actually wrote to disk, and what `FileMigrator.validate` and the
 *    v2 layout use.
 * 2. Raw `{id}{rawExt}` — differs whenever `rawExt` is not `.${normalized}`, e.g. a dotless ext
 *    ('png') or one carrying a trailing space or dot ('.exe '). Only the latter names a real file:
 *    on POSIX the on-disk name really does keep the trailing space. That is the one case the old
 *    `row.name` lookup covered and the canonical form does not, so dropping this candidate would
 *    trade one data-loss bug for another.
 *
 * Candidate safety is the caller's: `FileMigrator` clears `SafeExtSchema` first, so its `rawExt` is
 * at worst `{optional dot}{safe ext}{trailing dot/space}` — no separators, no NUL — and is safe to
 * join. `KnowledgeMappings` does not; `hasCompleteFileMetadata` only asserts `typeof ext ===
 * 'string'`, so a v1 row with a separator in `ext` produces a candidate that escapes the Files dir
 * when joined. That gap predates this helper (the hand-built `{id}{ext}` it replaced had the same
 * reach) and closing it means deciding skip semantics for the knowledge path too — do that
 * deliberately rather than by widening this function.
 */
export function legacyStorageNames(row: Pick<FileMetadata, 'id' | 'ext'>): string[] {
  const normalized = normalizeExt(row.ext)
  const canonical = normalized ? `${row.id}.${normalized}` : row.id
  const raw = `${row.id}${row.ext ?? ''}`
  return raw === canonical ? [canonical] : [canonical, raw]
}

/**
 * Whether this row's `origin_name` was overwritten with its internal storage name by v1's
 * duplicate-upload bug, permanently losing the name the user knew the file by.
 *
 * Two structural checks, both against the **raw** `ext`, because neither is safe alone:
 * - `origin_name === {id}{ext}` states the semantics ("the user-facing name became the storage
 *   name"), but `saveBase64Image` satisfies it by construction — a generated image never had a
 *   user filename, so nothing was lost — and only escapes this comparison because v1 happens to
 *   store its ext without the leading dot.
 * - `name === origin_name + ext` is the double-extension fingerprint only `findDuplicateFile`
 *   produces, but it degenerates to `name === origin_name` when `ext` is empty, which every
 *   `getFile`/`selectFile` row satisfies.
 *
 * Conjoined, each covers the other's blind spot. `count` is deliberately not used: in v1 it is a
 * reference count — the v1 *renderer*'s `FileManager.addFile` incremented it when a second message
 * attached the same file (not the v2 main-process `services/file/FileManager` of the same name) —
 * not an upload counter.
 */
export function hasLostOriginalFilename(row: Pick<FileMetadata, 'id' | 'name' | 'origin_name' | 'ext'>): boolean {
  const ext = row.ext ?? ''
  return row.origin_name === `${row.id}${ext}` && row.name === `${row.origin_name}${ext}`
}
