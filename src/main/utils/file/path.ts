/* oxlint-disable no-unused-vars -- TODO(phase-2): stub exports deferred to Phase 2 alongside their consumer migrations; parameters shape the public signature but are unused until then. */

/**
 * Path utilities — validation and resolution helpers.
 */

import { access, constants } from 'node:fs/promises'
import path from 'node:path'

import { isMac, isWin } from '@main/core/platform'
import type { AbsoluteFilePath } from '@shared/types/file'

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/path.${op}: not implemented (deferred to Phase 2)`)
}

/** Resolve a relative path against a base directory. */
export function resolvePath(_base: string, _relative: string): string {
  return notImplemented('resolvePath')
}

function normalizePathForComparison(value: string): string {
  const resolved = path.resolve(value)
  return isMac || isWin ? resolved.toLowerCase() : resolved
}

/**
 * True iff `child` is a strict descendant of `parent`.
 *
 * Equality returns false (a directory is not "inside" itself).
 * Both paths are resolved before comparison so `..` segments behave correctly.
 *
 * Case-sensitivity tracks the host filesystem semantics: case-sensitive on
 * linux (and most server-class FS), case-insensitive on darwin (APFS
 * default) and win32 (NTFS default). Without this, a lexical containment
 * check could treat `/users/me/data/files` as outside
 * `/Users/me/Data/Files` on a default macOS install.
 *
 * Limitation: detection is platform-based, not per-mount. Edge cases like
 * a case-sensitive APFS volume mounted on macOS or a SMB share with
 * non-default case-folding still fall through to the platform default. A
 * `realpath`-based check would be the correct fix for those, but blocks on
 * the file existing — deferred until a consumer actually needs it.
 */
export function isPathInside(child: string, parent: string): boolean {
  const a = normalizePathForComparison(child)
  const b = normalizePathForComparison(parent)
  if (a === b) return false
  const rel = path.relative(b, a)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** True iff `candidate` equals `container` or is a descendant of it. */
export function isSameOrInside(candidate: string, container: string): boolean {
  return (
    normalizePathForComparison(candidate) === normalizePathForComparison(container) ||
    isPathInside(candidate, container)
  )
}

/** Check if a path is writable for the current process. */
export async function canWrite(target: AbsoluteFilePath): Promise<boolean> {
  try {
    await access(target, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Check if a directory is non-empty. */
export async function isNotEmptyDir(_path: AbsoluteFilePath): Promise<boolean> {
  return notImplemented('isNotEmptyDir')
}
