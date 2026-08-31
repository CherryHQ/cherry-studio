import i18n from '@renderer/i18n/resolver'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_NEWER_VERSION_ERROR_CODE,
  BACKUP_OPERATION_BUSY_ERROR_CODE
} from '@shared/types/backup'

type BackupErrorFallbackKey =
  | 'error.backup.file_format'
  | 'message.backup.failed'
  | 'message.restore.failed'
  | 'settings.data.local.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.restore.error'

function resolveBackupErrorKey(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  if (error.message.includes(BACKUP_NEWER_VERSION_ERROR_CODE)) {
    return 'backup.error.newer_version'
  }
  if (
    error.message.includes(BACKUP_OPERATION_BUSY_ERROR_CODE) ||
    (error as Error).name === 'BackupOperationBusyError'
  ) {
    return 'backup.error.operation_busy'
  }
  if (error.message.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)) {
    return 'backup.error.active_data_writers'
  }
  return null
}

export function getLocalizedBackupErrorMessage(
  error: unknown,
  fallbackKey: BackupErrorFallbackKey = 'message.backup.failed'
): string {
  const messageKey = resolveBackupErrorKey(error) ?? fallbackKey
  return i18n.t(messageKey)
}

export function getBackupErrorTitleKey(error: unknown): string {
  return resolveBackupErrorKey(error) ?? 'error.backup.file_format'
}
