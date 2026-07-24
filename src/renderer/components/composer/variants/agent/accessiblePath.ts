// TODO(file-infra): Move the path-containment helpers below
// (`isPathWithinAccessiblePath` / `getAccessiblePathRelativePath`) into a
// renderer-safe, general-purpose `isPathInside` / `getRelativePath` in
// `@shared/utils/file` once that infra exists — the main-side `isPathInside`
// (`src/main/utils/file/path.ts`) can't be reused here because it depends on
// `node:path`. Generalizing needs UNC paths, relative inputs, and per-mount
// case-insensitivity handling resolved first, so this module stays an
// agent-local stopgap until then.
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

/** Canonicalized, `/`-separated form of an accessible base path, or null if the match fails. */
const findAccessibleBasePath = (filePath: string, accessiblePaths: readonly string[]): string | null => {
  const comparisonFilePath = toComparisonKey(normalizeSeparators(canonicalizeFilePath(filePath)))

  for (const basePath of accessiblePaths) {
    const normalizedBasePath = normalizeSeparators(canonicalizeFilePath(basePath))
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
  return normalizeSeparators(canonicalizeFilePath(filePath)).slice(withTrailingSlash(basePath).length)
}
