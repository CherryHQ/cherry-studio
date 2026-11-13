import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'

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

export async function runManualBackup<T>(operation: () => Promise<T>): Promise<T> {
  const eventKey = `backup:manual:${randomUUID()}`
  try {
    const result = await operation()
    const workflow =
      result && typeof result === 'object' ? (result as { result?: unknown; cleanupError?: unknown }) : undefined
    publishBackupResult(
      eventKey,
      workflow?.result === false ? 'failed' : workflow?.cleanupError ? 'warning' : 'succeeded'
    )
    return result
  } catch (error) {
    publishBackupResult(eventKey, 'failed')
    throw error
  }
}
