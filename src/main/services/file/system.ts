import { access, constants } from 'node:fs/promises'
import pathModule from 'node:path'

import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import { stat } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'
import { markReportingHandled } from '@shared/utils/errorReporting'
import { normalizeExt } from '@shared/utils/file'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { classifyFileFailure } from './failureFacts'
import { writeFileToClipboard } from './internal/system/clipboard'
import { assertOpenableTarget, assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'
import { isInsideManagedStorage } from './utils/managedStorageGuard'

const logger = loggerService.withContext('file/system')

export type DefaultOpenContext = {
  channel: 'file.open' | 'system.shell.open_path' | 'ai.agent.session.open_path' | 'external_app.target.open'
}

/** Open a path with the system default app after unsafe extension checks. */
export async function safeOpen(path: AbsoluteFilePath, context?: DefaultOpenContext): Promise<void> {
  assertSafePathForDefaultOpen(path)
  await assertOpenableTarget(path)
  const fields = {
    path,
    extension: normalizeExt(pathModule.extname(path.replace(/[\s.]+$/, ''))),
    platform: process.platform,
    channel: context?.channel ?? 'unknown',
    targetKind: 'system_default',
    targetApplication: 'unknown'
  }
  const startedAt = performance.now()
  try {
    await internalOpen(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
    try {
      logger.info('Default-app open handoff completed', {
        ...fields,
        outcome: 'failed',
        failureReason: redactSecretTokens(redactSecretText(reason)).slice(0, 500),
        durationMs: performance.now() - startedAt
      })
    } catch {
      // Logging must never change the outcome of opening a file.
    }
    throw error
  }
  try {
    logger.info('Default-app open handoff completed', {
      ...fields,
      outcome: 'accepted',
      durationMs: performance.now() - startedAt
    })
  } catch {
    // Logging must never change the outcome of opening a file.
  }
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Clipboard path probes catch arbitrary filesystem failures; only ENOENT/ENOTDIR prove a missing target.
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
