/**
 * Path utilities — validation and resolution helpers.
 */

import type { FilePath } from '@shared/file/types'

/** Resolve a relative path against a base directory. */
export function resolvePath(_base: string, _relative: string): string {
  throw new Error('Not implemented')
}

/** Check if a path is inside a given directory. */
export function isPathInside(_child: string, _parent: string): boolean {
  throw new Error('Not implemented')
}

/** Check if a directory path is writable. */
export async function canWrite(_path: FilePath): Promise<boolean> {
  throw new Error('Not implemented')
}

/** Check if a directory is non-empty. */
export async function isNotEmptyDir(_path: FilePath): Promise<boolean> {
  throw new Error('Not implemented')
}

/** Validate a directory path for use as the Notes mount basePath. */
export async function validateNotesPath(_dirPath: FilePath): Promise<boolean> {
  throw new Error('Not implemented')
}
