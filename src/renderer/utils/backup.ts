import i18n from '@renderer/i18n/resolver'
import { formatFileSize } from '@renderer/utils/file'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { BackupExportSourceDiagnostic } from '@shared/ipc/schemas/backup'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_BACKGROUND_TASKS_ERROR_CODE,
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
  | 'backup.error.background_tasks'
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
  return resolveBackupErrorKey(error) ?? 'error.backup.file_format'
}

type BackupErrorCode = (typeof backupErrorCodes)[keyof typeof backupErrorCodes]

export interface BackupErrorMessage {
  readonly key: string
  readonly params?: { readonly path: string }
}

const UNEXPECTED_KEY = 'settings.data.backup_v2.error.unexpected'

// One sentence per IpcApi backup code, so adding a code without one fails to compile.
const BACKUP_ERROR_KEYS: Record<BackupErrorCode, string> = {
  [backupErrorCodes.BUSY]: 'settings.data.backup_v2.error.busy',
  // Only a window this app does not manage can hit it; there is nothing to tell a user.
  [backupErrorCodes.SENDER_NOT_ALLOWED]: UNEXPECTED_KEY,
  [backupErrorCodes.ARCHIVE_REJECTED]: 'settings.data.backup_v2.error.archive_rejected',
  [backupErrorCodes.RESTORE_REQUIRES_NEWER_APP]: 'settings.data.backup_v2.compatibility.ahead_title',
  [backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE]: 'settings.data.backup_v2.compatibility.fork_title',
  [backupErrorCodes.FORMAT_UNSUPPORTED]: 'settings.data.backup_v2.compatibility.format_title',
  [backupErrorCodes.RESTORE_STATE]: 'settings.data.backup_v2.error.restore_state',
  [backupErrorCodes.JOURNAL_UNREADABLE]: 'settings.data.backup_v2.error.journal_unreadable',
  [backupErrorCodes.ARM_FAILED]: 'settings.data.backup_v2.error.arm_failed',
  [backupErrorCodes.ROLLBACK_UNAVAILABLE]: 'settings.data.backup_v2.error.rollback_unavailable',
  [backupErrorCodes.RECOVERY_INCOMPLETE]: 'settings.data.backup_v2.error.recovery_incomplete',
  [backupErrorCodes.STORAGE_UNAVAILABLE]: 'settings.data.backup_v2.error.storage_unavailable',
  [backupErrorCodes.EXPORT_SOURCE]: 'settings.data.backup_v2.error.export_source',
  [backupErrorCodes.EXPORT_DESTINATION]: 'settings.data.backup_v2.error.export_destination',
  [backupErrorCodes.RESTORE_RESOURCES]: 'settings.data.backup_v2.error.restore_resources',
  [backupErrorCodes.DESTINATION_NOT_CONFIGURED]: 'settings.data.backup_v2.error.destination_not_configured'
}

function isBackupErrorCode(code: string): code is BackupErrorCode {
  return Object.hasOwn(BACKUP_ERROR_KEYS, code)
}

function isDiagnosticPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function exportSourceDiagnostic(data: unknown): BackupExportSourceDiagnostic | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value = data as Record<string, unknown>
  if (value.path !== undefined && !isDiagnosticPath(value.path)) return undefined

  switch (value.kind) {
    case 'source-changed':
    case 'non-regular':
      return value.path === undefined || isDiagnosticPath(value.path)
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    case 'unportable-path':
      return value.reason === 'invalid-path' || value.reason === 'name-collision'
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    case 'limit-exceeded':
      return ['entry-count', 'resource-entries', 'entry-bytes', 'total-bytes', 'manifest-bytes', 'unknown'].includes(
        String(value.limit)
      )
        ? (value as BackupExportSourceDiagnostic)
        : undefined
    default:
      return undefined
  }
}

function exportSourceMessage(data: unknown): BackupErrorMessage {
  const diagnostic = exportSourceDiagnostic(data)
  if (!diagnostic) return { key: BACKUP_ERROR_KEYS[backupErrorCodes.EXPORT_SOURCE] }
  const params = 'path' in diagnostic && diagnostic.path ? { path: diagnostic.path } : undefined

  switch (diagnostic.kind) {
    case 'source-changed':
      return params
        ? { key: 'settings.data.backup_v2.error.export_source_changed_path', params }
        : { key: 'settings.data.backup_v2.error.export_source_changed' }
    case 'non-regular':
      return params
        ? { key: 'settings.data.backup_v2.error.export_source_non_regular_path', params }
        : { key: 'settings.data.backup_v2.error.export_source_non_regular' }
    case 'unportable-path':
      if (diagnostic.reason === 'name-collision') {
        return params
          ? { key: 'settings.data.backup_v2.error.export_source_collision_path', params }
          : { key: 'settings.data.backup_v2.error.export_source_collision' }
      }
      return params
        ? { key: 'settings.data.backup_v2.error.export_source_unportable_path', params }
        : { key: 'settings.data.backup_v2.error.export_source_unportable' }
    case 'limit-exceeded':
      switch (diagnostic.limit) {
        case 'entry-count':
        case 'resource-entries':
          return { key: 'settings.data.backup_v2.error.export_source_limit_count' }
        case 'entry-bytes':
          return { key: 'settings.data.backup_v2.error.export_source_limit_entry' }
        case 'total-bytes':
          return { key: 'settings.data.backup_v2.error.export_source_limit_total' }
        case 'manifest-bytes':
          return { key: 'settings.data.backup_v2.error.export_source_limit_manifest' }
        case 'unknown':
          return { key: 'settings.data.backup_v2.error.export_source_limit' }
      }
  }
}

/** The one sentence (as an i18n key) a failed IpcApi backup call should show. */
export function backupErrorMessageKey(error: unknown): BackupErrorMessage {
  if (!(error instanceof IpcError)) return { key: UNEXPECTED_KEY }
  if (error.code === backupErrorCodes.EXPORT_SOURCE) return exportSourceMessage(error.data)
  return { key: isBackupErrorCode(error.code) ? BACKUP_ERROR_KEYS[error.code] : UNEXPECTED_KEY }
}
