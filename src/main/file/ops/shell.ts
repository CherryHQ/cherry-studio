/**
 * System shell operations — open files/folders with OS defaults.
 */

import type { FilePath } from '@shared/file/types'

/** Open a file or directory with the system default application. */
export async function open(_path: FilePath): Promise<void> {
  throw new Error('Not implemented')
}

/** Reveal a file or directory in the system file manager. */
export async function showInFolder(_path: FilePath): Promise<void> {
  throw new Error('Not implemented')
}
