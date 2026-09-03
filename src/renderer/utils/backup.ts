import i18n from '@renderer/i18n/resolver'
import { formatFileSize } from '@renderer/utils/file'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_DISK_FULL_ERROR_CODE,
  BACKUP_NEWER_VERSION_ERROR_CODE,
  BACKUP_OPERATION_BUSY_ERROR_CODE
} from '@shared/types/backup'

type BackupErrorFallbackKey =
  | 'error.backup.file_format'
  | 'message.backup.failed'
  | 'message.restore.failed'
  | 'settings.data.local.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.fetch.error'
  | 'settings.data.webdav.backup.manager.delete.error'

// error.code is lost crossing IPC, so match on message text. Chain-trust
// failures only — expiry/hostname issues need a cert fix, not a bypass.
const TLS_CERTIFICATE_FAILURE_PATTERNS = [
  'unable to verify the first certificate',
  'unable to get local issuer certificate',
  'unable to get issuer certificate',
  'self-signed certificate',
  'self signed certificate'
]

function isTlsCertificateFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) return false
  const message = error.message.toLowerCase()
  return TLS_CERTIFICATE_FAILURE_PATTERNS.some((pattern) => message.includes(pattern))
}

// Closed set: every key this mapper can select, so a typo cannot compile.
type BackupMessageKey =
  | BackupErrorFallbackKey
  | 'backup.error.active_data_writers'
  | 'backup.error.disk_full'
  | 'backup.error.newer_version'
  | 'backup.error.operation_busy'
  | 'backup.error.webdav_tls_certificate'

function resolveBackupErrorKey(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  if (error.message.includes(BACKUP_NEWER_VERSION_ERROR_CODE)) {
    return 'backup.error.newer_version'
  }
  if (error.message.includes(BACKUP_OPERATION_BUSY_ERROR_CODE) || error.name === 'BackupOperationBusyError') {
    return 'backup.error.operation_busy'
  }
  if (error.message.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)) {
    return 'backup.error.active_data_writers'
  }
  return null
}

export function getLocalizedBackupErrorMessage(
  error: unknown,
  fallbackKey: BackupErrorFallbackKey = 'message.backup.failed',
  options?: { tlsCertificateHint?: boolean }
): string {
  const errorMessage = error instanceof Error ? error.message : ''
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined

  // Disk-full carries a parameterized payload, so it renders outside the key union.
  const diskFullDetails = errorMessage.match(new RegExp(`${BACKUP_DISK_FULL_ERROR_CODE}:(\\d+)`))
  if (diskFullDetails) {
    return i18n.t('backup.error.disk_full_with_available', {
      available: formatFileSize(Number(diskFullDetails[1]))
    })
  }

  const resolvedKey = resolveBackupErrorKey(error)
  if (resolvedKey) {
    return i18n.t(resolvedKey)
  }

  let messageKey: BackupMessageKey = fallbackKey
  if (
    errorCode === 'ENOSPC' ||
    errorMessage.includes('ENOSPC') ||
    /no space left on device/i.test(errorMessage)
  ) {
    messageKey = 'backup.error.disk_full'
  } else if (options?.tlsCertificateHint === true && isTlsCertificateFailure(error)) {
    // Scoped to WebDAV callers: the guidance points at the WebDAV self-signed
    // switch, which does not exist for S3/local/nutstore transports.
    messageKey = 'backup.error.webdav_tls_certificate'
  }

  return i18n.t(messageKey)
}

export function getBackupErrorTitleKey(error: unknown): string {
  return resolveBackupErrorKey(error) ?? 'error.backup.file_format'
}
