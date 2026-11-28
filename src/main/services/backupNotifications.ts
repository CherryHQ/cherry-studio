import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { BackupAnalyticsTarget } from '@shared/ipc/schemas/analytics'

import { trackMainProductEvent } from './productAnalytics'

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

export function trackBackupRun(
  target: BackupAnalyticsTarget,
  mode: 'manual' | 'auto',
  status: 'succeeded' | 'warning' | 'failed',
  startedAt: number
): void {
  trackMainProductEvent({
    event: 'backup_run',
    target,
    mode,
    status: status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'warning',
    durationMs: Math.max(0, Date.now() - startedAt)
  })
}

export async function runManualBackup<T>(target: BackupAnalyticsTarget, operation: () => Promise<T>): Promise<T> {
  const eventKey = `backup:manual:${randomUUID()}`
  const startedAt = Date.now()
  try {
    const result = await operation()
    const workflow =
      result && typeof result === 'object' ? (result as { result?: unknown; cleanupError?: unknown }) : undefined
    const status = workflow?.result === false ? 'failed' : workflow?.cleanupError ? 'warning' : 'succeeded'
    publishBackupResult(eventKey, status)
    trackBackupRun(target, 'manual', status, startedAt)
    return result
  } catch (error) {
    publishBackupResult(eventKey, 'failed')
    trackBackupRun(target, 'manual', 'failed', startedAt)
    throw error
  }
}
