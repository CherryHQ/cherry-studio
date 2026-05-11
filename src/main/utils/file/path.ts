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
 */
export function isPathInside(child: string, parent: string): boolean {
  const childResolved = path.resolve(child)
  const parentResolved = path.resolve(parent)
  if (childResolved === parentResolved) return false
  const rel = path.relative(parentResolved, childResolved)
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
