import { getRelativePath, isPathInside, isSamePath } from '@renderer/utils/path'
import type { AbsoluteFilePath } from '@shared/types/file'

/**
 * Agent-specific policy over the generic renderer path primitives: match a path
 * against a list of accessible bases. Path semantics (canonicalization, strict
 * containment, un-canonicalizable input) live in `@renderer/utils/path`.
 *
 * Neither helper is an access-control gate — the authoritative one is main-side
 * `WorkspaceFileGuard.resolveWorkspaceFile`.
 */

/** True iff `filePath` is one of `accessiblePaths` or a descendant of one. */
export const isPathWithinAccessiblePath = (
  filePath: AbsoluteFilePath,
  accessiblePaths: readonly AbsoluteFilePath[]
): boolean => accessiblePaths.some((base) => isSamePath(filePath, base) || isPathInside(filePath, base))

/** `filePath` relative to the accessible base that contains it, or `filePath` unchanged if none matches. */
export const getAccessiblePathRelativePath = (
  filePath: AbsoluteFilePath,
  accessiblePaths: readonly AbsoluteFilePath[]
): string => {
  for (const base of accessiblePaths) {
    const relative = getRelativePath(base, filePath)
    if (relative !== null) return relative
  }
  return filePath
}
