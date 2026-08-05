import i18n from '@renderer/i18n/resolver'

/**
 * Marker main puts in the error message when a backup is refused because data
 * writers are still active. Renderer-only: nothing in main reads it back, so it
 * stays out of `@shared` (shared-layer-architecture.md — cross-process is the
 * entry gate, not a description).
 */
export const BACKUP_ACTIVE_WRITERS_ERROR_CODE = 'BACKUP_ACTIVE_WRITERS'

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
