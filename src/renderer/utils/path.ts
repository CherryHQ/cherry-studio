/**
 * Pure-string path algebra for the renderer, which has no `node:path`.
 *
 * The comparison primitives below (`isSamePath` / `isPathInside` /
 * `getRelativePath`) are **lexical**: they never consult the filesystem, so
 * they resolve `.`/`..`, ignore Windows drive-letter case, and treat `/` and `\`
 * interchangeably **on Windows drive paths only** — on POSIX a backslash is an
 * ordinary filename character and is preserved. They are case-SENSITIVE on the
 * path body and do not honour a case-insensitive mount. They are not a security
 * or reachability primitive —
 * when true on-disk identity matters, use the main-process `fs.realpath` gate
 * (`WorkspaceFileGuard.resolveWorkspaceFile`) or `isSameFile`
 * (`src/main/utils/file/fs.ts`) instead.
 */

import type { AbsoluteFilePath } from '@shared/types/file'
import { canonicalizeFilePath, parseWindowsPath, type PosixRelativeFilePath } from '@shared/utils/file'

/**
 * A Windows drive path (`C:\…` / `C:/…`) — the only shape in which a backslash
 * is a separator. On POSIX a backslash is an ordinary filename character.
 */
const isWindowsDrivePath = (path: string) => /^[A-Za-z]:[/\\]/.test(path)
const isWindowsUncPath = (path: string) => path.startsWith('\\\\') || path.startsWith('//')

function resolvesToParsedRoot(segments: string[]): boolean {
  let depth = 0
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') {
      depth = Math.max(0, depth - 1)
      continue
    }
    depth += 1
  }
  return depth === 0
}

/** True iff `candidate` resolves to a POSIX, Windows drive, or UNC share root. */
export const isFilesystemRoot = (candidate: AbsoluteFilePath): boolean => {
  if (isWindowsDrivePath(candidate) || isWindowsUncPath(candidate)) {
    const parsed = parseWindowsPath(candidate.startsWith('//') ? `\\\\${candidate.slice(2)}` : candidate)
    return parsed.isAbsolute && resolvesToParsedRoot(parsed.segments)
  }
  return toPathKey(candidate) === '/'
}

/**
 * Byte-faithful canonical comparison form — or `null` when the path has no
 * canonical form we can trust.
 *
 * The `\` → `/` fold is applied to **Windows drive paths only**. It is not
 * redundant with `canonicalizeFilePath`, which normalizes Windows separators the
 * other way (to `\`); it bridges that form to the `/` form used by the tree
 * layer, `file://` URLs, and the relative paths returned below. It must NOT be
 * applied to POSIX paths: there a backslash is a legal filename character, so
 * folding it would make `/workspace/a\b.txt` — one file named `a\b.txt` — compare
 * equal to `/workspace/a/b.txt`, an entirely different file.
 * `canonicalizeFilePath` already draws this distinction (its POSIX branch splits
 * on `/` only); the job here is to preserve it, not undo it.
 *
 * Two shapes yield `null`, both meaning "not provably anything":
 *
 * - **UNC** (`\\server\share\…`) — a valid `AbsoluteFilePath` that
 *   `canonicalizeFilePath` rejects outright, since `\\server\share` is an
 *   indivisible root that `..` must not escape.
 * - **Leading `//`** — the forward-slash spelling of UNC on Windows, and
 *   implementation-defined on POSIX. `canonicalizeFilePath` collapses the
 *   leading `//` to `/`, so `//server/share/a.txt` would otherwise compare equal
 *   to the unrelated `/server/share/a.txt`. Checked here on the raw input,
 *   because the canonical form no longer carries the distinction. (Collapsing it
 *   inside `canonicalizeFilePath` is arguably the real defect, but that function
 *   produces the persisted `file_entry.externalPath` key and changing its output
 *   requires a paired migration — see its "Rule-evolution discipline". Tracked
 *   in #17429.)
 *
 * These are predicates, not parsers: a path we cannot canonicalize is simply not
 * provably the same as, or inside, anything. So degrade to `null` rather than
 * throwing out of a predicate and taking the caller down with it.
 *
 * Exported because a consumer needing a `Set`/`Map` key, or a comparison looser
 * than `isSamePath`, must reach the same form the primitives compare against —
 * and hand-rolling it is exactly how the conditional fold above gets lost. A
 * consumer that only asks "same?" or "inside?" should use those instead.
 */
export const toPathKey = (path: AbsoluteFilePath): string | null => {
  if (path.startsWith('//')) return null
  let canonical: string
  try {
    canonical = canonicalizeFilePath(path)
  } catch {
    return null
  }
  return isWindowsDrivePath(canonical) ? canonical.replace(/\\/g, '/') : canonical
}

/** Appends a separator unless `path` is a root, which already ends with one. */
const asPrefix = (path: string) => (path.endsWith('/') ? path : `${path}/`)

/** True iff `a` and `b` denote the same path. Un-canonicalizable input → `false`. */
export const isSamePath = (a: AbsoluteFilePath, b: AbsoluteFilePath): boolean => {
  const left = toPathKey(a)
  return left !== null && left === toPathKey(b)
}

/**
 * True iff `child` is a **proper** descendant of `parent` — equal paths are
 * `false`, matching the main-side `isPathInside` (`src/main/utils/file/path.ts`).
 * For "at or under", write `isSamePath(a, b) || isPathInside(a, b)`.
 * Un-canonicalizable input → `false`.
 */
export const isPathInside = (child: AbsoluteFilePath, parent: AbsoluteFilePath): boolean => {
  const childPath = toPathKey(child)
  const parentPath = toPathKey(parent)
  if (childPath === null || parentPath === null || childPath === parentPath) return false
  return childPath.startsWith(asPrefix(parentPath))
}

/**
 * `to` relative to `from` — or `null` if `to` is neither `from` itself nor a
 * descendant of it. Equal paths give `'.'`. Never emits `../` climbs, and never
 * returns an absolute path. Un-canonicalizable input → `null`.
 *
 * Separators in the result follow the input: `/`-separated for Windows drive
 * paths, and verbatim for POSIX, where a backslash belongs to the filename.
 * That is why the result is branded POSIX on both branches — after the Windows
 * fold, `/` is the only separator left under either reading, and the POSIX
 * reading is the one that keeps a filename's backslash intact. It is the
 * `/`-separated in-app form, not a claim about where the path came from.
 *
 * The brand is asserted, not re-parsed. `PosixRelativeFilePathSchema` refuses
 * exactly: the empty string (hence `'.'` above, which also matches its reading
 * that `''` is the absence of a path), NUL — already refused by
 * `AbsoluteFilePathSchema` — a leading `/`, which slicing a proper prefix
 * cannot leave behind, and an empty segment, which canonicalization drops. No
 * branch can produce any of them; `path.test.ts` guards that claim per branch.
 */
export const getRelativePath = (from: AbsoluteFilePath, to: AbsoluteFilePath): PosixRelativeFilePath | null => {
  const fromPath = toPathKey(from)
  const toPath = toPathKey(to)
  if (fromPath === null || toPath === null) return null
  if (fromPath === toPath) return '.' as PosixRelativeFilePath
  const prefix = asPrefix(fromPath)
  return toPath.startsWith(prefix) ? (toPath.slice(prefix.length) as PosixRelativeFilePath) : null
}

/**
 * Joins a base path and a relative segment with a single separator, tolerating both `/` and `\`
 * and a trailing separator on `base`. Leading separators on `rel` are stripped so the result stays
 * anchored to `base`.
 */
// TOOD: Use AbsoluteFilePath as signature
export const joinPath = (base: string, rel: string): string => {
  const trimmed = rel.replace(/^[/\\]+/, '')
  if (!base) return trimmed
  return /[/\\]$/.test(base) ? `${base}${trimmed}` : `${base}/${trimmed}`
}
