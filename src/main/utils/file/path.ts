/* oxlint-disable no-unused-vars -- TODO(phase-2): stub exports deferred to Phase 2 alongside their consumer migrations; parameters shape the public signature but are unused until then. */

/**
 * Path utilities — validation and resolution helpers.
 */

import { access, constants } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { FilePath } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/path.${op}: not implemented (deferred to Phase 2)`)
}

/** Resolve a relative path against a base directory. */
export function resolvePath(_base: string, _relative: string): string {
  return notImplemented('resolvePath')
}

/**
 * True iff `child` is a strict descendant of `parent`.
 *
 * Equality returns false (a directory is not "inside" itself).
 * Both paths are resolved before comparison so `..` segments behave correctly.
 *
 * Case-sensitivity tracks the host filesystem semantics: case-sensitive on
 * linux (and most server-class FS), case-insensitive on darwin (APFS
 * default) and win32 (NTFS default). Without this, `isUnderInternalStorage`
 * would let `/users/me/data/files` slip past a check against
 * `/Users/me/Data/Files` on a default macOS install — a latent bypass for
 * any future Phase 2 caller that uses `isUnderInternalStorage` as a
 * permission gate.
 *
 * Limitation: detection is platform-based, not per-mount. Edge cases like
 * a case-sensitive APFS volume mounted on macOS or a SMB share with
 * non-default case-folding still fall through to the platform default. A
 * `realpath`-based check would be the correct fix for those, but blocks on
 * the file existing — deferred until a consumer actually needs it.
 */
export function isPathInside(child: string, parent: string): boolean {
  const childResolved = path.resolve(child)
  const parentResolved = path.resolve(parent)
  const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32'
  const a = caseInsensitive ? childResolved.toLowerCase() : childResolved
  const b = caseInsensitive ? parentResolved.toLowerCase() : parentResolved
  if (a === b) return false
  const rel = path.relative(b, a)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Guard: returns true iff `target` lives under `application.getPath('feature.files.data')`.
 *
 * Use to defensively reject raw paths that point at internal UUID storage —
 * callers should reach internal entries via `FileEntryHandle`, not paths.
 */
export function isUnderInternalStorage(target: string): boolean {
  const internalRoot = application.getPath('feature.files.data')
  if (!internalRoot) return false
  return isPathInside(target, internalRoot)
}

/** Check if a path is writable for the current process. */
export async function canWrite(target: FilePath): Promise<boolean> {
  try {
    await access(target, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Check if a directory is non-empty. */
export async function isNotEmptyDir(_path: FilePath): Promise<boolean> {
  return notImplemented('isNotEmptyDir')
}
