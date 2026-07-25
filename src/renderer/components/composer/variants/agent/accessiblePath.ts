// TODO(file-infra): Move the path-containment helpers below
// (`isPathWithinAccessiblePath` / `getAccessiblePathRelativePath`) into a
// renderer-safe, general-purpose `isPathInside` / `getRelativePath` in
// `@shared/utils/file` once that infra exists — the main-side `isPathInside`
// (`src/main/utils/file/path.ts`) can't be reused here because it depends on
// `node:path`. Generalizing needs relative inputs and per-mount
// case-insensitivity handling resolved first, so this module stays an
// agent-local stopgap until then. (UNC is settled: not canonicalizable, hence
// never contained — see `tryCanonicalize` below and
// `docs/references/file/file-manager-architecture.md §1.2 "UNC paths"`.)
import { isMac, isWin } from '@renderer/utils/platform'
import { canonicalizeFilePath } from '@shared/utils/file'

/**
 * Case-folding matches the main-side `isPathInside` (`src/main/utils/file/path.ts`):
 * case-insensitive on macOS/Windows (default APFS/NTFS), case-sensitive on Linux.
 */
const isCaseInsensitivePlatform = isMac || isWin

const toComparisonKey = (value: string) => (isCaseInsensitivePlatform ? value.toLowerCase() : value)

const normalizeSeparators = (value: string) => value.replace(/\\/g, '/')

const withTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`)

/**
 * `canonicalizeFilePath` throws on input it cannot reduce to a byte-faithful
 * canonical form — today that is UNC (`\\server\share\…`), which is a valid
 * `AbsoluteFilePath` but has no defined canonical root here. Containment is a
 * predicate, not a parser: a path we cannot canonicalize is simply not
 * provably inside anything, so degrade to `null` rather than throwing out of
 * `isPathWithinAccessiblePath` and taking the caller down with it.
 */
const tryCanonicalize = (value: string): string | null => {
  try {
    return canonicalizeFilePath(value)
  } catch {
    return null
  }
}

/** Canonicalized, `/`-separated form of an accessible base path, or null if the match fails. */
const findAccessibleBasePath = (filePath: string, accessiblePaths: readonly string[]): string | null => {
  const canonicalFilePath = tryCanonicalize(filePath)
  if (canonicalFilePath === null) return null
  const comparisonFilePath = toComparisonKey(normalizeSeparators(canonicalFilePath))

  for (const basePath of accessiblePaths) {
    const canonicalBasePath = tryCanonicalize(basePath)
    if (canonicalBasePath === null) continue
    const normalizedBasePath = normalizeSeparators(canonicalBasePath)
    const comparisonBasePath = toComparisonKey(normalizedBasePath)
    if (
      comparisonFilePath === comparisonBasePath ||
      comparisonFilePath.startsWith(toComparisonKey(withTrailingSlash(normalizedBasePath)))
    ) {
      return normalizedBasePath
    }
  }

  return null
}

/** True iff `filePath` is `accessiblePaths[i]` itself or a descendant of it. */
export const isPathWithinAccessiblePath = (filePath: string, accessiblePaths: readonly string[]): boolean =>
  findAccessibleBasePath(filePath, accessiblePaths) !== null

/** `filePath` relative to the accessible base path that contains it, or `filePath` unchanged if none matches. */
export const getAccessiblePathRelativePath = (filePath: string, accessiblePaths: readonly string[]): string => {
  const basePath = findAccessibleBasePath(filePath, accessiblePaths)
  if (basePath === null) return filePath
  // A non-null `basePath` proves `filePath` canonicalized above, so this
  // cannot throw.
  return normalizeSeparators(canonicalizeFilePath(filePath)).slice(withTrailingSlash(basePath).length)
}
