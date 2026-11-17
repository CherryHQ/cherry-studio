import pathModule from 'node:path'

import { loggerService } from '@logger'
import { getPathStatus, probeReadable } from '@main/utils/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'
import { normalizeExt } from '@shared/utils/file'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { writeFileToClipboard } from './internal/system/clipboard'
import { assertOpenableTarget, assertSafePathForDefaultOpen } from './internal/system/openGuard'
import { open as internalOpen, showInFolder as internalShowInFolder } from './internal/system/shell'

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
