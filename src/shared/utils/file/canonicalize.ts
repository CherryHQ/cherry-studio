/**
 * Pure-JS canonicalization for absolute filesystem paths.
 *
 * Lives in shared (no `node:*` imports). This module owns the whole canonical
 * layer: the (module-private) canonicalization algorithm, the
 * `CanonicalFilePath` brand + `CanonicalFilePathSchema`, the
 * `isCanonicalFilePath` predicate, and the `canonicalizeFilePath` factory. The
 * schema is defined HERE, not in `types/file/common`, because it needs both
 * `FilePathSchema` and the algorithm — and only `utils → types` avoids an
 * import cycle. `FilePath` (`@shared/types/file/common`) is shape-validated
 * only — it does NOT canonicalize on parse. Canonicalization is applied
 * explicitly via `canonicalizeFilePath`, which produces the `CanonicalFilePath`
 * sub-brand, at the external-path persistence / lookup boundary.
 *
 * ## Scope (this function's contract)
 *
 *   0. Reject null bytes (`\0`).
 *   1. Resolve segments (`.`, `..`, repeated separators).
 *   2. Strip trailing separator (except on a bare drive / POSIX root).
 *   3. Windows only: uppercase the drive letter, normalize separators to `\`.
 *
 * This is reachability-safe **lexical** cleanup only: every step is a
 * filesystem no-op for *which file the path reaches* — the cleaned string
 * still resolves to the same on-disk entry on every platform. The result is
 * therefore **byte-faithful**: Unicode (NFC) normalization is deliberately
 * NOT performed, so a canonicalized path keeps the exact bytes the OS handed
 * us and always reaches the real file even on normalization-sensitive
 * filesystems (Linux ext4/btrfs), where an NFC-rewritten path would not exist
 * on disk. See `docs/references/file/file-manager-architecture.md §1.2
 * "Rejected: Unicode (NFC) normalization of externalPath"`.
 *
 * The input **must already be absolute**. POSIX absolute (`/…`) and Windows
 * absolute (`X:\…` or `X:/…`) are both accepted; mixed-platform input is
 * detected by path shape, not by `process.platform`, so the rule is
 * deterministic across renderer / main / test runners.
 *
 * ## Rule-evolution discipline
 *
 * The steps above are lexical only and do not depend on filesystem Unicode
 * semantics, so they do NOT carry the "changing the rule desyncs historical
 * rows, requiring a paired re-canonicalize migration" hazard that the removed
 * NFC step did. See `docs/references/file/file-manager-architecture.md §1.2
 * "Residual normalization discipline"`.
 */

import { FilePathSchema } from '@shared/types/file'
import type * as z from 'zod'

function canonicalizeAbsolutePath(raw: string): string {
  if (raw.includes('\0')) {
    throw new Error('canonicalizeAbsolutePath: input contains null byte')
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
 * Zod schema + brand for `CanonicalFilePath`, mirroring how `FilePathSchema`
 * defines `FilePath` (both are `z.infer`-derived from their schema). Reuses
 * `FilePathSchema` for the absolute-shape refine, then ASSERTS byte-faithful
 * canonical form (via `isCanonicalFilePath`) and brands.
 *
 * `parse()` is assert-only, NOT repairing: it returns an already-canonical
 * input unchanged and REJECTS (ZodError) a non-canonical one. This is the "no
 * silent repair" contract the FileEntry `externalPath` read path depends on.
 * To canonicalize a raw path, use `canonicalizeFilePath` (which repairs, then
 * brands through this schema).
 */
export const CanonicalFilePathSchema = FilePathSchema.refine(
  isCanonicalFilePath,
  'must be in byte-faithful canonical form (produce it via canonicalizeFilePath)'
).brand<'CanonicalFilePath'>()

/**
 * A `FilePath` additionally proven canonical — the byte-faithful, lexically
 * resolved form (segment-resolve + trailing-strip + Windows drive-upcase), NOT
 * Unicode-normalized. This is the form persisted in `file_entry.externalPath`
 * and used as the dedup / lookup key. Inferred from `CanonicalFilePathSchema`,
 * so its definition style matches `FilePath`. A `CanonicalFilePath` IS a
 * `FilePath`, accepted anywhere a `FilePath` is.
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
 * @throws if `input` is not absolute / contains a null byte (delegated to the
 *   canonicalization algorithm, before branding).
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
