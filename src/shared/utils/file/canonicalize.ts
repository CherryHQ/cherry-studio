/**
 * Pure-JS canonicalization for absolute filesystem paths.
 *
 * Lives in shared (no `node:*` imports). This module owns the whole canonical
 * layer: the (module-private) canonicalization algorithm, the
 * `CanonicalFilePath` brand + `CanonicalFilePathSchema`, the
 * `isCanonicalFilePath` predicate, and the `canonicalizeFilePath` factory. The
 * schema is defined HERE, not in `types/file/common`, because it needs both
 * `AbsoluteFilePathSchema` and the algorithm — and only `utils → types` avoids an
 * import cycle. `AbsoluteFilePath` (`@shared/types/file/common`) is shape-validated
 * only — it does NOT canonicalize on parse. Canonicalization is applied
 * explicitly via `canonicalizeFilePath`, which produces the `CanonicalFilePath`
 * sub-brand, at the external-path persistence / lookup boundary.
 *
 * `CanonicalFilePath` is a **proper** subset of `AbsoluteFilePath`, and the gap
 * is not only unrepaired spelling: some absolute paths have no canonical form
 * here at all (UNC — see below), so `canonicalizeFilePath` is a partial
 * function over `AbsoluteFilePath` and throws rather than returning a key it
 * cannot compute.
 *
 * ## Scope (this function's contract)
 *
 *   0. Reject null bytes (`\0`) and UNC (`\\server\share\…`).
 *   1. Resolve segments (`.`, `..`, repeated separators).
 *   2. Strip trailing separator (except on a bare drive / POSIX root).
 *   3. Windows only: uppercase the drive letter, normalize separators to `\`.
 *
 * This is purely **lexical** cleanup — it never consults the filesystem. Two
 * caveats follow:
 *
 * - **Not a reachability/security primitive.** Collapsing `..` lexically is
 *   target-preserving only when no earlier segment is a symlink/junction:
 *   `/a/link/../b` becomes `/a/b`, but if `link` resolves elsewhere the two
 *   reach different files. When true on-disk target equivalence matters
 *   (containment checks, identity-based dedup), resolve with a filesystem-aware
 *   primitive (`fs.realpath`) at the main-process boundary — not this helper.
 * - **Byte-faithful.** Unicode (NFC) normalization is deliberately NOT
 *   performed, so a canonicalized path keeps the exact bytes the OS handed us
 *   and still reaches the real file on normalization-sensitive filesystems
 *   (Linux ext4/btrfs), where an NFC-rewritten path would not exist on disk.
 *   See `docs/references/file/file-manager-architecture.md §1.2 "Rejected:
 *   Unicode (NFC) normalization of externalPath"`.
 *
 * The input **must already be absolute**. POSIX absolute (`/…`) and Windows
 * absolute (`X:\…` or `X:/…`) are both accepted; mixed-platform input is
 * detected by path shape, not by `process.platform`, so the rule is
 * deterministic across renderer / main / test runners.
 *
 * UNC (`\\server\share\…`) is a valid `AbsoluteFilePath` but is **rejected
 * here**: `\\server\share` is an indivisible root that `..` must not escape,
 * and neither branch models that. The brand gates what is safe to hand to
 * `fs`; this function gates what is safe to persist as a dedup key, and those
 * are deliberately not the same set.
 *
 * ## Rule-evolution discipline
 *
 * Dropping the NFC step removed a *reachability* hazard, not the *desync* one:
 * this function's output is a byte-compare key persisted in
 * `file_entry.externalPath`, so ANY change that changes its output leaves
 * historical rows unreachable by new lookups — whether or not the changed step
 * touches the filesystem. Every step above is output-sensitive.
 *
 * **Rule**: modifying this function ≡ ship a paired Drizzle migration that
 * re-canonicalizes every `origin='external'` row in the same PR. The only
 * current exemption is that v2 has not shipped, so no such rows exist yet; it
 * expires with the first release. See
 * `docs/references/file/file-manager-architecture.md §1.2 "Rule-evolution
 * discipline"` for the full procedure (row merging, atomicity, cache
 * invalidation).
 */

import { AbsoluteFilePathSchema } from '@shared/types/file'
import type * as z from 'zod'

function canonicalizeAbsolutePath(raw: string): string {
  if (raw.includes('\0')) {
    throw new Error('canonicalizeAbsolutePath: input contains null byte')
  }
  // UNC is a valid `AbsoluteFilePath` (see `AbsoluteFilePathSchema`) but has no
  // defined canonical form here: `\\server\share` is an indivisible root that
  // `..` must not escape, which neither branch below models. Reject explicitly
  // — otherwise UNC falls through to `canonicalizePosix` and dies on the
  // misleading "path must be absolute".
  if (raw.startsWith('\\\\')) {
    throw new Error('canonicalizeAbsolutePath: UNC paths are not supported as canonical keys')
  }
  const isWindows = /^[A-Za-z]:[/\\]/.test(raw)
  const normalized = isWindows ? canonicalizeWindows(raw) : canonicalizePosix(raw)
  return normalized
}

/**
 * True iff `p` is already in byte-faithful canonical form — i.e. canonicalizing
 * it is a no-op. Returns `false` (rather than throwing) for structurally
 * invalid input (non-absolute, null byte), so it is safe as a Zod refine
 * predicate. Backs both `CanonicalFilePathSchema` and the FileEntry
 * `externalPath` read-path assertion.
 */
export function isCanonicalFilePath(p: string): boolean {
  try {
    return p === canonicalizeAbsolutePath(p)
  } catch {
    return false
  }
}

/**
 * Zod schema + brand for `CanonicalFilePath`, mirroring how `AbsoluteFilePathSchema`
 * defines `AbsoluteFilePath` (both are `z.infer`-derived from their schema). Reuses
 * `AbsoluteFilePathSchema` for the absolute-shape refine, then ASSERTS byte-faithful
 * canonical form (via `isCanonicalFilePath`) and brands.
 *
 * `parse()` is assert-only, NOT repairing: it returns an already-canonical
 * input unchanged and REJECTS (ZodError) a non-canonical one. This is the "no
 * silent repair" contract the FileEntry `externalPath` read path depends on.
 * To canonicalize a raw path, use `canonicalizeFilePath` (which repairs, then
 * brands through this schema).
 */
export const CanonicalFilePathSchema = AbsoluteFilePathSchema.refine(
  isCanonicalFilePath,
  'must be in byte-faithful canonical form (produce it via canonicalizeFilePath)'
).brand<'CanonicalFilePath'>()

/**
 * An `AbsoluteFilePath` additionally proven canonical — the byte-faithful, lexically
 * resolved form (segment-resolve + trailing-strip + Windows drive-upcase), NOT
 * Unicode-normalized. This is the form persisted in `file_entry.externalPath`
 * and used as the dedup / lookup key. Inferred from `CanonicalFilePathSchema`,
 * so its definition style matches `AbsoluteFilePath`. A `CanonicalFilePath` IS a
 * `AbsoluteFilePath`, accepted anywhere an `AbsoluteFilePath` is.
 *
 * **The converse does not hold, and not merely by spelling.** It is tempting to
 * read the subset as "every `AbsoluteFilePath` is one `canonicalizeFilePath()`
 * call away from being canonical" — that was true when the only difference was
 * a repairable spelling (trailing separator, `./`/`../`, lowercase drive). It
 * is not true now: UNC (`\\server\share\…`) is a valid `AbsoluteFilePath` that
 * `canonicalizeFilePath` REJECTS, so it can never be mapped in at all. The two
 * brands answer different questions (safe for `fs` vs. safe as a persisted
 * dedup key) and the second is not a spelling-normalization of the first.
 *
 * Practical consequence for call sites: `canonicalizeFilePath(x)` on a value
 * already typed `AbsoluteFilePath` can still throw. Code that must stay total
 * has to handle that — see `accessiblePath.ts`, where containment degrades to
 * "not contained" rather than propagating. See
 * `docs/references/file/file-manager-architecture.md §1.2 "UNC paths"`.
 */
export type CanonicalFilePath = z.infer<typeof CanonicalFilePathSchema>

/**
 * The sole sanctioned producer of `CanonicalFilePath`: canonicalize a raw
 * absolute path (byte-faithful lexical resolve — segment-resolve +
 * trailing-strip + Windows drive-upcase, NOT Unicode-normalized) and brand the
 * result through `CanonicalFilePathSchema`. Callers needing a canonical
 * lookup/persistence key (external-entry write + `findByExternalPath`) go
 * through here.
 *
 * Not total over `AbsoluteFilePath`: a UNC input is a valid `AbsoluteFilePath`
 * and still throws here. Callers holding an already-branded value cannot
 * assume this call succeeds.
 *
 * @throws if `input` is not absolute / contains a null byte / is UNC
 *   (delegated to the canonicalization algorithm, before branding).
 */
export function canonicalizeFilePath(input: string): CanonicalFilePath {
  return CanonicalFilePathSchema.parse(canonicalizeAbsolutePath(input))
}

function canonicalizePosix(raw: string): string {
  if (!raw.startsWith('/')) {
    throw new Error('canonicalizeAbsolutePath: path must be absolute')
  }
  const segments = raw.slice(1).split('/')
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack.length === 0 ? '/' : '/' + stack.join('/')
}

function canonicalizeWindows(raw: string): string {
  // Drive letter is uppercased so `C:\Foo` and `c:\Foo` canonicalize to the
  // same string at the byte layer — case folding the path itself is
  // deliberately deferred: case-insensitive dedup is handled by the DB
  // `lower(externalPath)` unique index plus an `fs.realpath` collision probe
  // (see docs/references/file/file-manager-architecture.md §1.2
  // "Duplicate-entry detection on insert"), so no per-segment case-fold is
  // needed here.
  const drive = raw.slice(0, 2).toUpperCase()
  const segments = raw.slice(3).split(/[/\\]/)
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack.length === 0 ? `${drive}\\` : `${drive}\\${stack.join('\\')}`
}
