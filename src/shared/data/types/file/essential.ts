import * as z from 'zod'

/** Millisecond epoch timestamp (non-negative integer) */
export const TimestampSchema = z.int().nonnegative()

/**
 * Name schema with security validations.
 *
 * Threat model: names flow from user input or external snapshots into FS path
 * composition (`{dir}/{name}.{ext}`) and can be passed to `fs.*` syscalls.
 * Without sanitization, a caller-controlled name could:
 *   - `..` / `../...` → traverse out of the intended directory
 *   - `a/b` / `a\\b`  → redirect writes to an unintended subdirectory
 *   - `\0`            → truncate C-string APIs mid-path (classic null-byte bypass)
 *   - `'   '`         → produce empty-looking files that break UX and tooling
 *
 * This schema rejects all of the above. The ≤255-byte cap matches the strictest
 * common FS limit (ext4/HFS+/NTFS path segments).
 */
export const SafeNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0'), 'Name must not contain null bytes')
  .refine((s) => !/[/\\]/.test(s), 'Name must not contain path separators')
  .refine((s) => !/^\.\.?$/.test(s), 'Name must not be . or ..')
  .refine((s) => s.trim().length > 0, 'Name must not be all whitespace')

/**
 * Extension schema with path-safety validations.
 *
 * Threat model: internal-entry writes persist files as `{id}.{ext}` under a
 * Cherry-owned directory. The extension therefore becomes part of a path
 * segment passed to `application.getPath(..., filename)`. If callers can pass
 * separators or null bytes here, they can break the "single relative segment"
 * invariant and escape the managed directory.
 *
 * Design intent:
 * - `ext` is the bare suffix only (`pdf`, `md`, `gz`) — never `.pdf`
 * - multi-part names like `archive.tar.gz` split as `name='archive.tar'`,
 *   `ext='gz'`
 * - extensionless files should use `null`, not empty string / whitespace
 */
export const SafeExtSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0'), 'Extension must not contain null bytes')
  .refine((s) => !/[/\\]/.test(s), 'Extension must not contain path separators')
  .refine((s) => !s.startsWith('.'), 'Extension must be bare (no leading dot), e.g. "pdf" not ".pdf"')
  .refine((s) => s.trim().length > 0, 'Extension must not be all whitespace')

/**
 * Content-hash schema for the dedup detection substrate.
 *
 * Stored / transported as `{algo}:{hex}` (e.g. `xxh3-64:24ccc9acaa9f65e4`) —
 * the algorithm tag is part of the contract, so a future algorithm change can
 * coexist with old values via incremental migration instead of a flag-day
 * re-hash. This validates the *shape* only (lowercase `{algo}:{hex}`), never
 * hash correctness: `contentHash` is a detection substrate, not an identity
 * (see file-manager-architecture.md).
 */
/**
 * Canonical content-hash format pattern: `{algo}:{hex}`, anchored, lowercase.
 * Single source of truth for the shape — the two capture groups are
 * `(algo)(hex)`, which `parseContentHash` (`@main/utils/file/contentHash`) uses
 * to decompose a stored hash. `ContentHashSchema` only `.test()`s it (capture
 * groups are inert for `.regex()`); the flag-free regex carries no `lastIndex`
 * state, so sharing one instance between `.test()` and `.exec()` is safe.
 */
export const CONTENT_HASH_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]+)$/

export const ContentHashSchema = z
  .string()
  .regex(CONTENT_HASH_PATTERN, 'contentHash must be `{algo}:{hex}` (e.g. "xxh3-64:…")')
