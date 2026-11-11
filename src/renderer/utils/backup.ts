import i18n from '@renderer/i18n/resolver'
import { formatFileSize } from '@renderer/utils/file'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_BACKGROUND_TASKS_ERROR_CODE,
  BACKUP_DISK_FULL_ERROR_CODE,
  BACKUP_MIGRATION_MISMATCH_ERROR_CODE,
  BACKUP_NEWER_VERSION_ERROR_CODE,
  type BackupMigrationMismatchDetails,
  BACKUP_OPERATION_BUSY_ERROR_CODE,
  BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE
} from '@shared/types/backup'

const mismatchMarker = new RegExp(`(?<![A-Za-z0-9_])${BACKUP_MIGRATION_MISMATCH_ERROR_CODE}(?![A-Za-z0-9_])`)
const mismatchKeys = [
  'v',
  'backupAppVersion',
  'backupPlatform',
  'backupArch',
  'currentAppVersion',
  'appliedCount',
  'bundledCount',
  'firstDifferingIndex',
  'reason',
  'bundledTag'
]

function parseMismatch(message: string): BackupMigrationMismatchDetails | null {
  const match = mismatchMarker.exec(message)
  if (!match) return null
  const tail = message.slice(match.index + match[0].length, match.index + match[0].length + 2048)
  const end = tail.indexOf('}')
  if (!tail.startsWith(':') || end < 0) return null
  try {
    const value: unknown = JSON.parse(tail.slice(1, end + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const data = value as Record<string, unknown>
    if (Object.keys(data).length !== mismatchKeys.length || !mismatchKeys.every((key) => Object.hasOwn(data, key)))
      return null
    const identifier = (item: unknown, pattern: RegExp) =>
      item === null || (typeof item === 'string' && pattern.test(item))
    if (
      data.v !== 1 ||
      !identifier(data.backupAppVersion, /^[0-9][A-Za-z0-9.+_-]{0,63}$/) ||
      !identifier(data.currentAppVersion, /^[0-9][A-Za-z0-9.+_-]{0,63}$/) ||
      !identifier(data.backupPlatform, /^[a-z0-9_-]{1,32}$/) ||
      !identifier(data.backupArch, /^[a-z0-9_-]{1,32}$/) ||
      !identifier(data.bundledTag, /^[A-Za-z0-9_-]{1,96}$/)
    )
      return null
    const { appliedCount, bundledCount, firstDifferingIndex, reason, bundledTag } = data
    if (
      typeof appliedCount !== 'number' ||
      !Number.isSafeInteger(appliedCount) ||
      appliedCount < 1 ||
      typeof bundledCount !== 'number' ||
      !Number.isSafeInteger(bundledCount) ||
      bundledCount < 0 ||
      typeof firstDifferingIndex !== 'number' ||
      !Number.isSafeInteger(firstDifferingIndex) ||
      firstDifferingIndex < 0 ||
      firstDifferingIndex >= appliedCount
    )
      return null
    if (reason === 'count_overflow') {
      if (appliedCount <= bundledCount || firstDifferingIndex !== bundledCount || bundledTag !== null) return null
    } else if (
      !['hash', 'timestamp', 'hash_and_timestamp'].includes(reason as string) ||
      firstDifferingIndex >= bundledCount
    )
      return null
    return data as BackupMigrationMismatchDetails
  } catch {
    return null
  }
}

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
  | 'backup.error.background_tasks'
  | 'backup.error.disk_full'
  | 'backup.error.newer_version'
  | 'backup.error.operation_busy'
  | 'backup.error.webdav_tls_certificate'

function resolveBackupErrorKey(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  if (error.message.includes(BACKUP_WEBDAV_TOO_LARGE_ERROR_CODE)) {
    return 'backup.error.webdav_too_large'
  }
  if (error.message.includes(BACKUP_NEWER_VERSION_ERROR_CODE)) {
    return 'backup.error.newer_version'
  }
  if (error.message.includes(BACKUP_OPERATION_BUSY_ERROR_CODE) || error.name === 'BackupOperationBusyError') {
    return 'backup.error.operation_busy'
  }
  if (error.message.includes(BACKUP_BACKGROUND_TASKS_ERROR_CODE)) {
    return 'backup.error.background_tasks'
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

  if (mismatchMarker.test(errorMessage)) {
    const details = parseMismatch(errorMessage)
    if (!details) return i18n.t('backup.error.migration_mismatch')
    const unknown = i18n.t('common.unknown')
    const difference =
      details.reason === 'count_overflow'
        ? ''
        : i18n.t(
            {
              hash: 'backup.error.migration_difference_hash',
              timestamp: 'backup.error.migration_difference_timestamp',
              hash_and_timestamp: 'backup.error.migration_difference_hash_and_timestamp'
            }[details.reason]
          )
    return i18n.t(
      details.reason === 'count_overflow'
        ? 'backup.error.migration_mismatch_overflow'
        : 'backup.error.migration_mismatch_content',
      {
        backupAppVersion: details.backupAppVersion ?? unknown,
        backupPlatform: details.backupPlatform ?? unknown,
        backupArch: details.backupArch ?? unknown,
        currentAppVersion: details.currentAppVersion ?? unknown,
        appliedCount: details.appliedCount,
        bundledCount: details.bundledCount,
        entryNumber: details.firstDifferingIndex + 1,
        bundledTag: details.bundledTag ?? unknown,
        difference
      }
    )
  }

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
  if (errorCode === 'ENOSPC' || errorMessage.includes('ENOSPC') || /no space left on device/i.test(errorMessage)) {
    messageKey = 'backup.error.disk_full'
  } else if (options?.tlsCertificateHint === true && isTlsCertificateFailure(error)) {
    // Scoped to WebDAV callers: the guidance points at the WebDAV self-signed
    // switch, which does not exist for S3/local/nutstore transports.
    messageKey = 'backup.error.webdav_tls_certificate'
  }

  return i18n.t(messageKey)
}

export function getBackupErrorTitleKey(error: unknown): string {
  if (error instanceof Error && mismatchMarker.test(error.message)) return 'backup.error.migration_mismatch_title'
  return resolveBackupErrorKey(error) ?? 'error.backup.file_format'
}
