/**
 * Agent-specific policy over the generic renderer path primitives: derive the
 * accessible bases for a workspace, and match paths against them. Path
 * semantics (canonicalization, strict containment, un-canonicalizable input)
 * live in `@renderer/utils/path`.
 *
 * Nothing here is an access-control gate — the authoritative one is main-side
 * `WorkspaceFileGuard.resolveWorkspaceFile`.
 */

import { loggerService } from '@logger'
import { getRelativePath, isPathInside, isSamePath, toPathKey } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const logger = loggerService.withContext('accessiblePath')

/**
 * The accessible bases for an agent workspace path, or `[]` if it cannot serve
 * as one.
 *
 * `AgentWorkspacePathSchema` only guarantees a non-empty string, so the stored
 * path is checked here before it reaches the helpers below. The bar is the one
 * those helpers actually apply — a canonical form exists — not merely
 * `AbsoluteFilePathSchema`, which admits UNC paths that every containment test
 * then rejects. Returning `[]` is what already happened in that case; logging
 * is what makes it diagnosable.
 *
 * With no accessible bases, workspace attachments are internalized instead of
 * referenced: `buildFileParts` copies the bytes into Cherry storage and the
 * model receives a `file://` pointing at that copy, so an agent editing
 * workspace files in place sees a snapshot at a different path.
 */
export const toAccessiblePaths = (workspacePath: string | undefined): AbsoluteFilePath[] => {
  if (!workspacePath) return []
  const parsed = AbsoluteFilePathSchema.safeParse(workspacePath)
  if (!parsed.success || toPathKey(parsed.data) === null) {
    logger.warn('Ignoring agent workspace path that has no canonical form', { path: workspacePath })
    return []
  }
  return [parsed.data]
}

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
 * The default filesystem is case-insensitive on macOS/Windows (APFS/NTFS) and
 * case-sensitive on Linux. Used only by `getPathComparisonKey` below, whose
 * docstring explains why that consumer may act on this guess when the
 * containment helpers above may not.
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
 * Keying through `toPathKey` is what keeps `/workspace/a\b.txt` — one POSIX
 * file — from colliding with `/workspace/a/b.txt`.
 *
 * When there is no canonical form the fallback folds separators, because the
 * only reason two spellings reach here is that a UNC share arrives one way from
 * the listing (separator-normalized upstream) and another from drag-and-drop.
 * Matching them as strings is all dedup can do, and folding is how. The POSIX
 * hazard the primitives guard against does not apply: a POSIX path with a
 * backslash in its name canonicalizes fine and never reaches this branch. Only
 * a non-absolute input could, and the sole one produced here is `''`.
 */
export const getPathComparisonKey = (value: string): string => {
  const parsed = AbsoluteFilePathSchema.safeParse(value)
  const canonical = parsed.success ? toPathKey(parsed.data) : null
  const key = canonical ?? value.replace(/\\/g, '/')
  return isCaseInsensitivePlatform ? key.toLowerCase() : key
}
