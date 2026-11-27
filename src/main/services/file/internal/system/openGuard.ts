import path from 'node:path'

import { getPathStatus } from '@main/utils/file'
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

/**
 * Reject a target the OS default app cannot be pointed at.
 *
 * Electron's Linux `shell.openPath()` forks a child, `chdir`s it into `dirname(path)` and only then
 * execs `xdg-open`; a failing chdir is a `RAW_CHECK` in a process neither Crashpad nor
 * `child-process-gone` can observe, so a bad input kills that child with SIGTRAP. A path that
 * exists always has a traversable parent, so the existence check also discharges that precondition.
 */
export async function assertOpenableTarget(physicalPath: AbsoluteFilePath): Promise<void> {
  const status = await getPathStatus(physicalPath)
  if (status.ok) return

  throw new IpcError(fileErrorCodes.OPEN_TARGET_UNAVAILABLE, `Refusing to open an unavailable path: ${physicalPath}`, {
    path: physicalPath,
    reason: status.reason
  })
}
