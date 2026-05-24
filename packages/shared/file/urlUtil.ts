/**
 * URL formatting utilities for FileEntry paths — pure, cross-platform,
 * renderer-safe (no `node:*` imports).
 *
 * These helpers replace what the (now-removed) `getSafeUrl` / `batchGetSafeUrls`
 * IPC methods used to do. Path resolution itself still belongs to Main (via File
 * IPC `getPhysicalPath` / `batchGetPhysicalPaths`) — this module only handles the
 * **formatting / policy layer** on top of an already-resolved path string:
 *
 * ## Phase 1 migration status
 *
 * **Already shipped here**: the implementation, the test suite, and the
 * `architecture.md §3.3 / §3.6 / §5` contract that names this module as the
 * replacement for the removed IPCs.
 *
 * **Pending**: renderer-side call-site migration. Existing `<img src>` /
 * `<video src>` consumers still go through the legacy `getSafeUrl` path; they
 * flip to `getPhysicalPath(id) → toSafeFileUrl(path, ext)` as the v1 → v2
 * FileEntry consumer migration progresses (Phase 1b / Phase 2 PR series). The
 * absence of `src/` callers today is the migration not-yet-landed state, not
 * a speculative forward-looking surface — the contract is binding and the
 * code is the final form.
 *
 * 1. `isDangerExt(ext)` — which extensions count as "dangerous" for
 *    HTML-rendering contexts (should surface the containing directory
 *    instead of the file URL).
 * 2. `toFileUrl(path)` — encode an absolute filesystem path into a `file://`
 *    URL (Windows drive letters, URL-encoded segments, forward-slash normalized).
 * 3. `toSafeFileUrl(path, ext)` — the composition that used to live behind
 *    the `getSafeUrl` IPC: apply the danger-wrap then `toFileUrl`.
 *
 * ## Why "formatting" stays in a shared module, not behind an IPC
 *
 * - **Authority** (how `id + ext` maps to a physical path, where `userData`
 *   lives, whether storage becomes hash-bucketed) remains exclusively in
 *   Main's `resolvePhysicalPath`. Renderer never replicates this logic.
 * - **Formatting** (path → `file://` URL, danger-ext wrap) is a pure string
 *   transformation on a value renderer already holds. Duplicating it across
 *   the IPC boundary had no authority benefit and cost an IPC round-trip per
 *   `<img src>` composition.
 *
 * Keep additions to this module **pure**. Anything that needs FS IO, DB
 * access, or main-process singletons belongs in File IPC.
 */

import type { FilePath, FileURLString } from './types/common'

// ─── Danger extension policy ───

/**
 * Extensions treated as "dangerous" for HTML rendering contexts. Rendered as
 * dirname URLs (so hovering / dragging / double-clicking from the rendered
 * element does not auto-launch the underlying file through OS file
 * associations).
 *
 * This list is a starting point — extend as concrete misuse vectors surface.
 * Scope is **HTML rendering contexts only**; it is NOT a general-purpose
 * allowlist/denylist for path-safe operations.
 */
const DANGEROUS_EXTS = new Set([
  // Shell scripts
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'ksh',
  // Windows executable / script
  'exe',
  'com',
  'bat',
  'cmd',
  'msi',
  'scr',
  'pif',
  'cpl',
  'ps1',
  'psm1',
  'psd1',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'hta',
  'reg',
  // Windows shortcuts — can point at arbitrary targets, including remote scripts
  'lnk',
  'url',
  // macOS
  'app',
  'command',
  // Linux launchers — `.desktop` can exec arbitrary commands via the `Exec=` key
  'desktop',
  // Java — executable archives / Web Start
  'jar',
  'jnlp',
  // SVG — `<embed>` / `<object>` references can execute embedded script
  // (note: `<img src>` sandboxes SVG script, but toSafeFileUrl serves <embed> too)
  'svg',
  // Installer bundles that can launch executables
  'dmg',
  'pkg'
])

/**
 * Is this extension on the danger list? Case-insensitive; `null` returns `false`.
 */
export function isDangerExt(ext: string | null): boolean {
  if (!ext) return false
  return DANGEROUS_EXTS.has(ext.toLowerCase())
}

// ─── Path formatting ───

/**
 * Cross-platform dirname on a plain string — no `node:path` dependency, so it
 * works in renderer bundles. Treats both `/` and `\` as separators.
 *
 * `sepIdx === 0` is the POSIX-root case (`/payload.exe`): degrade to `'/'` so
 * the safety wrap in `toSafeFileUrl` still strips the filename. Returning the
 * original string here would defeat the entire danger-ext policy.
 */
function dirnameSimple(absolutePath: string): string {
  const sepIdx = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  if (sepIdx > 0) return absolutePath.slice(0, sepIdx)
  if (sepIdx === 0) return '/'
  return absolutePath
}

/**
 * Encode an absolute filesystem path into a `file://` URL.
 *
 * - Unix:    `/foo/bar baz.pdf`     → `file:///foo/bar%20baz.pdf`
 * - Windows: `C:\foo\bar baz.pdf`   → `file:///C:/foo/bar%20baz.pdf`
 *
 * Backslashes are normalized to forward slashes; each path segment is URL-encoded
 * (special chars like space, `#`, `?` become `%20` / `%23` / `%3F`). The Windows
 * drive letter segment (`C:`) is preserved unencoded because `%3A` would break
 * UNC / drive resolution in `<img src>` contexts.
 *
 * @param absolutePath Absolute filesystem path (Unix or Windows form).
 * @returns `file://` URL suitable for `<img src>` / `<video src>` / `<embed>`.
 */
export function toFileUrl(absolutePath: FilePath): FileURLString {
  let normalized: string = absolutePath.replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = '/' + normalized
  }
  const encoded = normalized
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file://${encoded}`
}

/**
 * `file://` URL with danger-file safety wrap.
 *
 * For `<img src>` / `<video src>` / `<embed>` synchronous rendering — if
 * `isDangerExt(ext)` returns `true`, the URL points at the containing
 * directory instead of the file, preventing accidental launch through OS file
 * associations on hover / drag / double-click of the rendered element.
 *
 * **Scope**: HTML rendering contexts only. Do NOT compose this URL into
 * command-line arguments or subprocess args — use the raw `FilePath` from
 * File IPC `getPhysicalPath` for those cases.
 *
 * @param absolutePath Absolute filesystem path (from `getPhysicalPath` IPC).
 * @param ext File extension without leading dot (from `FileEntry.ext`), or `null`.
 */
export function toSafeFileUrl(absolutePath: FilePath, ext: string | null): FileURLString {
  const effectivePath = isDangerExt(ext) ? dirnameSimple(absolutePath) : absolutePath
  return toFileUrl(effectivePath as FilePath)
}
