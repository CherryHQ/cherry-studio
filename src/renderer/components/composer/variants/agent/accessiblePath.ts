import { getRelativePath, isPathInside, isSamePath, toPathKey } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { PosixRelativeFilePath } from '@shared/utils/file'

/**
 * Agent-specific policy over the generic renderer path primitives: match a path
 * against a list of accessible bases. Path semantics (canonicalization, strict
 * containment, un-canonicalizable input) live in `@renderer/utils/path`.
 *
 * Nothing here is an access-control gate — the authoritative one is main-side
 * `WorkspaceFileGuard.resolveWorkspaceFile`.
 */

/** True iff `filePath` is one of `accessiblePaths` or a descendant of one. */
export const isPathWithinAccessiblePath = (
  filePath: AbsoluteFilePath,
  accessiblePaths: readonly AbsoluteFilePath[]
): boolean => accessiblePaths.some((base) => isSamePath(filePath, base) || isPathInside(filePath, base))

/**
 * `filePath` relative to the accessible base that contains it, or `filePath`
 * unchanged if none matches.
 *
 * The return type is a union because the two branches return genuinely
 * different things, and a caller that must tell them apart can now do so
 * instead of inferring it from whether a leading `/` happens to be there.
 * Today's caller wants neither — it renders the value — so the union costs it
 * nothing.
 */
export const getAccessiblePathRelativePath = (
  filePath: AbsoluteFilePath,
  accessiblePaths: readonly AbsoluteFilePath[]
): PosixRelativeFilePath | AbsoluteFilePath => {
  for (const base of accessiblePaths) {
    const relative = getRelativePath(base, filePath)
    if (relative !== null) return relative
  }
  return filePath
}

/**
 * UI-heuristic case folding for comparison keys only. Containment itself is
 * case-sensitive on every platform (the path primitives refuse to guess), so
 * this flag feeds nothing but `getPathComparisonKey`.
 */
const isCaseInsensitivePlatform = isMac || isWin

/**
 * A `Set`-able identity key for mention dedup — **deliberately looser than
 * `isSamePath`**, and not interchangeable with it.
 *
 * Case-folding here is a UI heuristic, not an identity claim. It is a per-mount
 * property that no string can decide, so the primitives in `@renderer/utils/path`
 * refuse to guess. This consumer can afford the guess because both error
 * directions are trivial: a folder that cannot be re-mentioned, or a duplicate
 * token. The reference-vs-inline decision above cannot — a false "same" there
 * sends the model a `file://` pointing at a different real file — which is why
 * the fold lives at this call site instead of in the shared primitive.
 *
 * The two folder-token sources spell the same path differently
 * (`listDirectoryEntries` inherits the workspace path's spelling, drag-and-drop
 * carries the OS's), so a case mismatch is genuinely reachable.
 *
 * Keying through `toPathKey` rather than folding separators here is what keeps
 * `/workspace/a\b.txt` — one POSIX file — from colliding with `/workspace/a/b.txt`:
 * it canonicalizes fine and never reaches the fallback below. Input that is not an
 * absolute path, or has no canonical form (UNC), keys on a separator-folded
 * spelling of itself — loose, but consistent across both spellings of one share,
 * which is what folder-token dedup needs.
 */
export const getPathComparisonKey = (value: string): string => {
  const parsed = AbsoluteFilePathSchema.safeParse(value)
  const canonical = parsed.success ? toPathKey(parsed.data) : null
  // Un-canonicalizable input (UNC): fold separators so the listing side's
  // normalized spelling and drag-and-drop's OS spelling of one share key
  // identically instead of producing two tokens for the same folder.
  // See https://github.com/CherryHQ/cherry-studio/issues/18631
  const key = canonical ?? value.replace(/\\/g, '/')
  return isCaseInsensitivePlatform ? key.toLowerCase() : key
}
