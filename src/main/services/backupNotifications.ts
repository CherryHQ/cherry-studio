import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { BackupAnalyticsTarget, BackupSizeBucket, TransferFailureReason } from '@shared/ipc/schemas/analytics'
import { BACKUP_DISK_FULL_ERROR_CODE, BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE } from '@shared/types/backup'

import { trackMainProductEvent, transferFailureReason } from './productAnalytics'

const logger = loggerService.withContext('BackupNotifications')

export function publishBackupResult(
  eventKey: string,
  status: 'succeeded' | 'warning' | 'failed',
  createdAt = Date.now()
): void {
  const outcome = status === 'succeeded' ? 'success' : status
  try {
    const title =
      status === 'succeeded'
        ? t('notification.center.backup_success')
        : status === 'warning'
          ? t('notification.center.backup_warning')
          : t('notification.center.backup_failed')
    void application
      .get('NotificationService')
      .publish(
        {
          eventKey,
          category: 'system',
          kind: `backup-${outcome}`,
          title,
          message: t('notification.center.backup_message'),
          createdAt,
          target: { kind: 'settings', tab: 'data' }
        },
        { source: 'backup' }
      )
      .catch((error) => logger.warn('Failed to publish backup notification', error as Error))
  } catch (error) {
    logger.warn('Failed to publish backup notification', error as Error)
  }
}

const MB = 1024 * 1024

function backupSizeBucket(sizeBytes: number): BackupSizeBucket {
  if (sizeBytes < 10 * MB) return 'under_10mb'
  if (sizeBytes < 100 * MB) return '10mb_to_100mb'
  return sizeBytes < 1024 * MB ? '100mb_to_1gb' : 'over_1gb'
}

function backupFailureReason(error: unknown): TransferFailureReason | 'too_large' {
  const message = error instanceof Error ? error.message : ''
  if (message.startsWith(BACKUP_DISK_FULL_ERROR_CODE)) return 'disk_full'
  if (message.startsWith(BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE)) return 'too_large'
  return transferFailureReason(error)
}

/** `error` names the failure (none when the upload just returned false); `sizeBytes` is the written archive. */
export function trackBackupRun(
  target: BackupAnalyticsTarget,
  mode: 'manual' | 'auto',
  status: 'succeeded' | 'warning' | 'failed',
  startedAt: number,
  detail: { error?: unknown; sizeBytes?: number } = {}
): void {
  trackMainProductEvent({
    event: 'backup_run',
    target,
    mode,
    status: status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'warning',
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(status === 'failed'
      ? { errorReason: backupFailureReason(detail.error) }
      : detail.sizeBytes !== undefined && { sizeBucket: backupSizeBucket(detail.sizeBytes) })
  })
}

export async function runManualBackup<T>(target: BackupAnalyticsTarget, operation: () => Promise<T>): Promise<T> {
  const eventKey = `backup:manual:${randomUUID()}`
  const startedAt = Date.now()
  try {
    const result = await operation()
    const workflow =
      result && typeof result === 'object'
        ? (result as { result?: unknown; cleanupError?: unknown; sizeBytes?: number })
        : undefined
    const status = workflow?.result === false ? 'failed' : workflow?.cleanupError ? 'warning' : 'succeeded'
    publishBackupResult(eventKey, status)
    trackBackupRun(target, 'manual', status, startedAt, { sizeBytes: workflow?.sizeBytes })
    return result
  } catch (error) {
    publishBackupResult(eventKey, 'failed')
    trackBackupRun(target, 'manual', 'failed', startedAt, { error })
    throw error
  }
}
