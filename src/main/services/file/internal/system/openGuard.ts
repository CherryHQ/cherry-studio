import path from 'node:path'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'
import { isDangerExt, normalizeExt } from '@shared/utils/file'

function getEffectivePathExt(physicalPath: AbsoluteFilePath): string | null {
  const fallbackPath = physicalPath.replace(/[\s.]+$/, '')
  return normalizeExt(path.extname(fallbackPath))
}

function assertSafeExtForDefaultOpen(ext: string | null): void {
  if (!isDangerExt(ext)) return

  const displayExt = ext ? `.${ext}` : 'unknown'
  throw new IpcError(
    fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE,
    `Refusing to open ${displayExt} with the system default app`,
    {
      ext
    }
  )
}

export function assertSafePathForDefaultOpen(physicalPath: AbsoluteFilePath): void {
  assertSafeExtForDefaultOpen(getEffectivePathExt(physicalPath))
}
