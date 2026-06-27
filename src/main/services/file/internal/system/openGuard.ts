import path from 'node:path'

import type { FileEntry } from '@shared/data/types/file'
import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FilePath } from '@shared/types/file'
import { isDangerExt } from '@shared/utils/file/url'

function getEffectiveExt(entry: FileEntry, physicalPath: FilePath): string | null {
  const fallbackPath = physicalPath.replace(/[\s.]+$/, '')
  const raw = entry.ext ?? path.extname(fallbackPath).replace(/^\./, '')
  const normalized = raw.replace(/[\s.]+$/, '').toLowerCase()
  return normalized || null
}

export function assertSafeForDefaultOpen(entry: FileEntry, physicalPath: FilePath): void {
  const ext = getEffectiveExt(entry, physicalPath)
  if (!isDangerExt(ext)) return

  throw new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE, `Refusing to open .${ext} with the system default app`, {
    ext
  })
}
