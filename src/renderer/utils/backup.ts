import i18n from '@renderer/i18n/resolver'
import { formatFileSize } from '@renderer/utils/file'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE, BACKUP_DISK_FULL_ERROR_CODE } from '@shared/types/backup'

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
  if (errorMessage.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)) {
    return i18n.t('backup.error.active_data_writers')
  }

  const diskFullDetails = errorMessage.match(new RegExp(`${BACKUP_DISK_FULL_ERROR_CODE}:(\\d+)`))
  if (diskFullDetails) {
    return i18n.t('backup.error.disk_full_with_available', {
      available: formatFileSize(Number(diskFullDetails[1]))
    })
  }

  if (errorCode === 'ENOSPC' || errorMessage.includes('ENOSPC') || /no space left on device/i.test(errorMessage)) {
    return i18n.t('backup.error.disk_full')
  }

  return i18n.t(fallbackKey)
}
