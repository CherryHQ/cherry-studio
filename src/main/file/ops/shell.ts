/**
 * System shell operations — open files/folders with OS defaults.
 */

import type { FilePath } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`ops.shell.${op}: not implemented (Phase 1a stub, implementation lands in Phase 1b)`)
}

/** Open a file or directory with the system default application. */
export async function open(_path: FilePath): Promise<void> {
  return notImplemented('open')
}

/** Reveal a file or directory in the system file manager. */
export async function showInFolder(_path: FilePath): Promise<void> {
  return notImplemented('showInFolder')
}
