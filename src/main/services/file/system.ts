import { getPathStatus, probeReadable } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'

import { writeFileToClipboard } from './internal/system/clipboard'
import { assertOpenableTarget, assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'

/** Open a path with the system default app after unsafe extension checks. */
export async function safeOpen(path: AbsoluteFilePath): Promise<void> {
  assertSafePathForDefaultOpen(path)
  await assertOpenableTarget(path)
  return internalOpen(path)
}

/** Reveal a path in the system file manager. */
export async function showInFolder(path: AbsoluteFilePath): Promise<void> {
  return internalShowInFolder(path)
}

export type ClipboardCopyStatus = { ok: true } | { ok: false; reason: 'missing' | 'inaccessible' }

export async function getClipboardCopyStatus(path: AbsoluteFilePath): Promise<ClipboardCopyStatus> {
  const status = await getPathStatus(path)
  if (!status.ok) return { ok: false, reason: status.reason }
  const readable = await probeReadable(path)
  return readable === 'readable'
    ? { ok: true }
    : { ok: false, reason: readable === 'missing' ? 'missing' : 'inaccessible' }
}

export async function copyFileToClipboard(path: AbsoluteFilePath): Promise<void> {
  const status = await getClipboardCopyStatus(path)
  if (!status.ok)
    throw new IpcError(fileErrorCodes.COPY_TARGET_UNAVAILABLE, 'The file is unavailable for copying', {
      path,
      reason: status.reason
    })
  await writeFileToClipboard(path)
}
