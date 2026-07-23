import type { FilePath } from '@shared/types/file'

import { assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'

/** Open a path with the system default app after unsafe extension checks. */
export async function safeOpen(path: FilePath): Promise<void> {
  assertSafePathForDefaultOpen(path)
  return internalOpen(path)
}

/** Reveal a path in the system file manager. */
export async function showInFolder(path: FilePath): Promise<void> {
  return internalShowInFolder(path)
}
