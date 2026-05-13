/**
 * Shell wrappers — `open` (system default app) and `showInFolder` (reveal in
 * the OS file manager). Thin pass-throughs to Electron's `shell` API.
 *
 * `shell.openPath` returns an empty string on success and a localized error
 * message on failure, so we treat any non-empty return as a failure.
 */

import type { FilePath } from '@shared/file/types'
import { shell } from 'electron'

export async function open(target: FilePath): Promise<void> {
  const errorMessage = await shell.openPath(target)
  if (errorMessage) {
    throw new Error(`shell.open(${target}) failed: ${errorMessage}`)
  }
}

export async function showInFolder(target: FilePath): Promise<void> {
  shell.showItemInFolder(target)
}
