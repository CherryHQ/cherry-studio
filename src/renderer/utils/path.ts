/**
 * Pure-string path algebra for the renderer, which has no `node:path`.
 *
 * The comparison primitives below (`isSamePath` / `isPathInside` /
 * `getRelativePath`) are **lexical**: they never consult the filesystem, so
 * they are separator- and Windows-drive-case-insensitive and resolve `.`/`..`,
 * but they are case-SENSITIVE on the path body and do not honour a
 * case-insensitive mount. They are not a security or reachability primitive —
 * when true on-disk identity matters, use the main-process `fs.realpath` gate
 * (`WorkspaceFileGuard.resolveWorkspaceFile`) or `isSameFile`
 * (`src/main/utils/file/fs.ts`) instead.
 */

import type { AbsoluteFilePath } from '@shared/types/file'
import { canonicalizeFilePath } from '@shared/utils/file'

/**
 * Byte-faithful canonical, `/`-separated comparison form — or `null` when the
 * path has no canonical form at all.
 *
 * The `\` → `/` fold is NOT redundant with `canonicalizeFilePath`, which
 * normalizes Windows separators the other way (to `\`). It bridges that form to
 * the `/` form used by the tree layer, `file://` URLs, and the relative paths
 * returned below. Do not remove it. (See #17429 for the wider cleanup.)
 *
 * `canonicalizeFilePath` throws on input it cannot reduce — today that is UNC
 * (`\\server\share\…`), a valid `AbsoluteFilePath` with no defined canonical
 * root. These are predicates, not parsers: a path we cannot canonicalize is
 * simply not provably the same as, or inside, anything. So degrade to `null`
 * rather than throwing out of a predicate and taking the caller down with it.
 */
const toComparable = (path: AbsoluteFilePath): string | null => {
  try {
    return canonicalizeFilePath(path).replace(/\\/g, '/')
  } catch {
    return null
  }
}

/** Appends a separator unless `path` is a root, which already ends with one. */
const asPrefix = (path: string) => (path.endsWith('/') ? path : `${path}/`)

/** True iff `a` and `b` denote the same path. Un-canonicalizable input → `false`. */
export const isSamePath = (a: AbsoluteFilePath, b: AbsoluteFilePath): boolean => {
  const left = toComparable(a)
  return left !== null && left === toComparable(b)
}

/**
 * True iff `child` is a **proper** descendant of `parent` — equal paths are
 * `false`, matching the main-side `isPathInside` (`src/main/utils/file/path.ts`).
 * For "at or under", write `isSamePath(a, b) || isPathInside(a, b)`.
 * Un-canonicalizable input → `false`.
 */
export const isPathInside = (child: AbsoluteFilePath, parent: AbsoluteFilePath): boolean => {
  const childPath = toComparable(child)
  const parentPath = toComparable(parent)
  if (childPath === null || parentPath === null || childPath === parentPath) return false
  return childPath.startsWith(asPrefix(parentPath))
}

/**
 * `to` relative to `from`, `/`-separated — or `null` if `to` is neither `from`
 * itself nor a descendant of it. Equal paths give `''`. Never emits `../`
 * climbs, and never returns an absolute path. Un-canonicalizable input → `null`.
 */
export const getRelativePath = (from: AbsoluteFilePath, to: AbsoluteFilePath): string | null => {
  const fromPath = toComparable(from)
  const toPath = toComparable(to)
  if (fromPath === null || toPath === null) return null
  if (fromPath === toPath) return ''
  const prefix = asPrefix(fromPath)
  return toPath.startsWith(prefix) ? toPath.slice(prefix.length) : null
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
