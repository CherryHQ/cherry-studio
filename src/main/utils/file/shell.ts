/* oxlint-disable no-unused-vars -- TODO(phase-2): stub exports deferred to Phase 2 alongside their consumer migrations; parameters shape the public signature but are unused until then. */

/**
 * System shell operations — open files/folders with OS defaults.
 *
 * File-module-internal consumers should use `services/file/internal/system/shell.ts`
 * (Phase 1) directly. This utils-layer surface is reserved for non-file-module
 * callers and stays a stub until those consumers migrate in Phase 2.
 */

import type { FilePath } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/shell.${op}: not implemented (deferred to Phase 2)`)
}

/** Open a file or directory with the system default application. */
export async function open(_path: FilePath): Promise<void> {
  return notImplemented('open')
}

/** Reveal a file or directory in the system file manager. */
export async function showInFolder(_path: FilePath): Promise<void> {
  return notImplemented('showInFolder')
}
