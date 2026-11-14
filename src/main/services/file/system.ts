import { access, constants } from 'node:fs/promises'

import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import { stat } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'
import { markReportingHandled } from '@shared/utils/errorReporting'

import { classifyFileFailure } from './failureFacts'
import { writeFileToClipboard } from './internal/system/clipboard'
import { assertOpenableTarget, assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'
import { isInsideManagedStorage } from './utils/managedStorageGuard'

const logger = loggerService.withContext('file/system')

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

async function assertClipboardTarget(path: AbsoluteFilePath): Promise<void> {
  await stat(path)
  await access(path, constants.R_OK)
}

function clipboardFailureReason(error: unknown): 'missing' | 'inaccessible' {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'inaccessible'
}

export async function getClipboardCopyStatus(path: AbsoluteFilePath): Promise<ClipboardCopyStatus> {
  try {
    await assertClipboardTarget(path)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: clipboardFailureReason(error) }
  }
}

export async function copyFileToClipboard(path: AbsoluteFilePath, externalPath?: boolean): Promise<void> {
  try {
    await assertClipboardTarget(path)
  } catch (error) {
    // Unverifiable raw paths retain reporting eligibility instead of hiding a managed-storage fault.
    const external = externalPath ?? !(await isInsideManagedStorage(path).catch(() => true))
    logFailure(
      logger,
      'Clipboard target unavailable',
      error,
      'file.copy_to_clipboard',
      classifyFileFailure(error, external)
    )
    const failure = new IpcError(fileErrorCodes.COPY_TARGET_UNAVAILABLE, 'The file is unavailable for copying', {
      path,
      reason: clipboardFailureReason(error)
    })
    markReportingHandled(failure)
    throw failure
  }
  await writeFileToClipboard(path)
}
