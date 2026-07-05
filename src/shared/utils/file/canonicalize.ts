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
 *   2. Unicode NFC normalize.
 *   3. Strip trailing separator (except on a bare drive / POSIX root).
 *
 * The input **must already be absolute**. POSIX absolute (`/…`) and Windows
 * absolute (`X:\…` or `X:/…`) are both accepted; mixed-platform input is
 * detected by path shape, not by `process.platform`, so the rule is
 * deterministic across renderer / main / test runners.
 *
 * ## Rule-evolution discipline
 *
 * Changing the normalization steps below desynchronizes historical rows
 * (written under the old rule) from new queries (running under the new
 * rule). Any such change MUST ship with a paired Drizzle migration that
 * re-canonicalizes every existing `file_entry.externalPath` and re-points
 * association rows whose canonical forms now collide. See
 * `docs/references/file/file-manager-architecture.md §1.2 Rule evolution
 * discipline`.
 */

import type { CanonicalFilePath } from '@shared/types/file/common'

export function canonicalizeAbsolutePath(raw: string): string {
  if (raw.includes('\0')) {
    throw new Error('canonicalizeAbsolutePath: input contains null byte')
  }
  const isWindows = /^[A-Za-z]:[/\\]/.test(raw)
  const normalized = isWindows ? canonicalizeWindows(raw) : canonicalizePosix(raw)
  return normalized.normalize('NFC')
}

/**
 * The sole sanctioned producer of `CanonicalFilePath`: run the pure-JS
 * canonicalization and brand the result. Callers needing a canonical
 * lookup/persistence key (external-entry write + `findByExternalPath`) go
 * through here instead of `as`-casting into the brand.
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
