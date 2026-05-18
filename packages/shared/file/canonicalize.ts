/**
 * Pure-JS canonicalization for absolute filesystem paths.
 *
 * Lives in shared (no `node:*` imports) so the FileEntry schema can `refine`
 * its `externalPath` field against the same canonicalization rule the main
 * process uses on write. That refine is what gives the `CanonicalFilePath`
 * brand on the BO real runtime backing — any value that survives parsing IS
 * canonical, not just typed as if it were.
 *
 * ## Scope (this function's contract)
 *
 * Same rules as the main-side `canonicalizeExternalPath` (see
 * `src/main/services/file/utils/pathResolver.ts`) — only the implementation
 * differs (this version does not depend on `node:path`):
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
 * `file_ref` rows whose canonical forms now collide. See
 * `docs/references/file/file-manager-architecture.md §1.2 Rule evolution
 * discipline`.
 */

export function canonicalizeAbsolutePath(raw: string): string {
  if (raw.includes('\0')) {
    throw new Error('canonicalizeAbsolutePath: input contains null byte')
  }
  const isWindows = /^[A-Za-z]:[/\\]/.test(raw)
  const normalized = isWindows ? canonicalizeWindows(raw) : canonicalizePosix(raw)
  return normalized.normalize('NFC')
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
  // deliberately deferred (see pathResolver.ts JSDoc for the rationale).
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
