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
  const errorMessage = error instanceof Error ? error.message : ''
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  const messageKey = errorMessage.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
    ? 'backup.error.active_data_writers'
    : errorCode === 'ENOSPC' || errorMessage.includes('ENOSPC') || /no space left on device/i.test(errorMessage)
      ? 'backup.error.disk_full'
      : fallbackKey

  return i18n.t(messageKey)
}
