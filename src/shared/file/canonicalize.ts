/**
 * Pure-JS canonicalization for absolute filesystem paths.
 *
 * Lives in shared (no `node:*` imports) so the FileEntry schema can `refine`
 * its `externalPath` field against the same canonicalization rule the main
 * process uses on write. That refine is what gives the `FilePath`
 * brand on the BO real runtime backing — any value that survives parsing IS
 * canonical, not just typed as if it were.
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
 * `file_ref` rows whose canonical forms now collide. See
 * `docs/references/file/file-manager-architecture.md §1.2 Rule evolution
 * discipline`.
 *
 * ## Deliberately NOT handled here
 *
 * The following are intentionally out of scope so this function stays sync,
 * FS-IO-free, and safe to run inside Zod refines / read paths:
 *
 * - **Case-insensitive FS de-duplication** (macOS APFS / Windows NTFS):
 *   `/Users/me/FILE.pdf` vs `/Users/me/file.pdf` are byte-distinct after
 *   canonicalize. Enforced downstream by the DB functional unique index
 *   `UNIQUE(lower(externalPath))` and the `ensureExternalEntry` `fs.realpath`
 *   peer-resolution path.
 * - **Symlink resolution** (`realpath` target collapse): symlinks remain
 *   distinct entries — collapse would require unconditional `fs.realpath`
 *   on every canonicalize call, trading the sync/cheap contract.
 * - **Windows short-name (8.3) resolution** (`LONGNA~1` vs `longname`):
 *   requires WinAPI, low-priority edge case.
 * - **SMB / NFS mounts with FS-level case-sensitivity diverging from host**:
 *   documented as known limitation.
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
  // deliberately deferred (see "Deliberately NOT handled here" above).
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
