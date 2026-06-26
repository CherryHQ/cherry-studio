import path from 'node:path'

import type { FileEntry } from '@shared/data/types/file'
import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FilePath } from '@shared/types/file'
import { isDangerExt } from '@shared/utils/file/url'

function normalizeExt(raw: string | null | undefined): string | null {
  const normalized = (raw ?? '').replace(/[\s.]+$/, '').toLowerCase()
  return normalized || null
}

function getEffectivePathExt(physicalPath: FilePath): string | null {
  const fallbackPath = physicalPath.replace(/[\s.]+$/, '')
  return normalizeExt(path.extname(fallbackPath).replace(/^\./, ''))
}

function assertSafeExtForDefaultOpen(ext: string | null): void {
  if (!isDangerExt(ext)) return

  throw new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE, `Refusing to open .${ext} with the system default app`, {
    ext
  })
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
