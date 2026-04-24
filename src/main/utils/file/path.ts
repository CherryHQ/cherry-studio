/* oxlint-disable no-unused-vars -- TODO(phase-1b): Phase 1a stub exports; parameters shape the public signature but are unused until implementations land. */

/**
 * Path utilities — validation and resolution helpers.
 */

import type { FilePath } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/path.${op}: not implemented (Phase 1a stub, implementation lands in Phase 1b)`)
}

/** Resolve a relative path against a base directory. */
export function resolvePath(_base: string, _relative: string): string {
  return notImplemented('resolvePath')
}

/** Check if a path is inside a given directory. */
export function isPathInside(_child: string, _parent: string): boolean {
  return notImplemented('isPathInside')
}

/** Check if a directory path is writable. */
export async function canWrite(_path: FilePath): Promise<boolean> {
  return notImplemented('canWrite')
}

/** Check if a directory is non-empty. */
export async function isNotEmptyDir(_path: FilePath): Promise<boolean> {
  return notImplemented('isNotEmptyDir')
}
