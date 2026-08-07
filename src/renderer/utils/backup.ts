import i18n from '@renderer/i18n/resolver'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'

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
