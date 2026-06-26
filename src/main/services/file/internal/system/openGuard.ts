import path from 'node:path'

import type { FileEntry } from '@shared/data/types/file'
import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FilePath } from '@shared/types/file'
import { isDangerExt, normalizeExt } from '@shared/utils/file/url'

function getEffectivePathExt(physicalPath: FilePath): string | null {
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

function getEffectiveExt(entry: FileEntry, physicalPath: FilePath): string | null {
  return normalizeExt(entry.ext) ?? getEffectivePathExt(physicalPath)
}

export function assertSafePathForDefaultOpen(physicalPath: FilePath): void {
  assertSafeExtForDefaultOpen(getEffectivePathExt(physicalPath))
}

export function assertSafeForDefaultOpen(entry: FileEntry, physicalPath: FilePath): void {
  assertSafeExtForDefaultOpen(getEffectiveExt(entry, physicalPath))
}
