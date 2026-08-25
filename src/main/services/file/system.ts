import type { AbsoluteFilePath } from '@shared/types/file'

import { assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'

/** Open a path with the system default app after unsafe extension checks. */
export async function safeOpen(path: AbsoluteFilePath): Promise<void> {
  assertSafePathForDefaultOpen(path)
  return internalOpen(path)
}

/** Reveal a path in the system file manager. */
export async function showInFolder(path: AbsoluteFilePath): Promise<void> {
  return internalShowInFolder(path)
}
