/**
 * Pure-JS canonicalization for absolute filesystem paths.
 *
 * Lives in shared (no `node:*` imports). This module owns two things: the
 * canonicalization algorithm (`canonicalizeAbsolutePath`) and the branding
 * factory (`canonicalizeFilePath`). `FilePath` (`@shared/types/file/common`)
 * is shape-validated only — it does NOT canonicalize on parse. Canonicalization
 * is applied explicitly via `canonicalizeFilePath`, which produces the
 * `CanonicalFilePath` sub-brand, at the external-path persistence / lookup
 * boundary.
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

import type { CanonicalFilePath } from '@shared/types/file/common'

export function canonicalizeAbsolutePath(raw: string): string {
  if (raw.includes('\0')) {
    throw new Error('canonicalizeAbsolutePath: input contains null byte')
  }
  const isWindows = /^[A-Za-z]:[/\\]/.test(raw)
  const normalized = isWindows ? canonicalizeWindows(raw) : canonicalizePosix(raw)
  return normalized
}

/**
 * The sole sanctioned producer of `CanonicalFilePath`: run the pure-JS
 * canonicalization and brand the result. Callers needing a canonical
 * lookup/persistence key (external-entry write + `findByExternalPath`) go
 * through here instead of `as`-casting into the brand. The produced value is
 * the byte-faithful, lexically-resolved form (segment-resolve + trailing-strip
 * + Windows drive-upcase) — NOT Unicode-normalized.
 *
 * @throws if `input` is not absolute / contains a null byte (delegated to
 *   `canonicalizeAbsolutePath`).
 */
export function canonicalizeFilePath(input: string): CanonicalFilePath {
  return canonicalizeAbsolutePath(input) as CanonicalFilePath
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
