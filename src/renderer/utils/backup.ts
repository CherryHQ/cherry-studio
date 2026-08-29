import i18n from '@renderer/i18n/resolver'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import dayjs from 'dayjs'

type BackupErrorFallbackKey =
  | 'error.backup.file_format'
  | 'message.backup.failed'
  | 'message.restore.failed'
  | 'settings.data.local.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.restore.error'

export function getLocalizedBackupErrorMessage(
  error: unknown,
  fallbackKey: BackupErrorFallbackKey = 'message.backup.failed'
): string {
  const messageKey =
    error instanceof Error && error.message.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
      ? 'backup.error.active_data_writers'
      : fallbackKey

  return i18n.t(messageKey)
}

/**
 * Format a last-sync timestamp for the backup settings panels.
 *
 * The timestamp survives restarts, so a bare clock time would read as "today"
 * for a sync that happened days ago. Only same-day values drop the date.
 */
export function formatBackupSyncTime(timestamp: number, now: number = Date.now()): string {
  const time = dayjs(timestamp)
  return time.isSame(now, 'day') ? time.format('HH:mm:ss') : time.format('YYYY-MM-DD HH:mm:ss')
}
