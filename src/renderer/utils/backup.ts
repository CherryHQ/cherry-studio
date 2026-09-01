import i18n from '@renderer/i18n/resolver'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'

type BackupErrorFallbackKey =
  | 'error.backup.file_format'
  | 'message.backup.failed'
  | 'message.restore.failed'
  | 'settings.data.local.backup.manager.restore.error'
  | 'settings.data.nutstore.checkConnection.fail'
  | 'settings.data.webdav.backup.manager.restore.error'

// Closed set: every key this mapper can select, so a typo cannot compile.
type BackupMessageKey =
  | BackupErrorFallbackKey
  | 'backup.error.active_data_writers'
  | 'backup.error.remote_access_denied'
  | 'backup.error.remote_quota_exceeded'
  | 'backup.error.remote_file_too_large'
  | 'backup.error.remote_server_error'
  | 'backup.error.upload_stalled'

// Anchored on our `HTTP <code>` token and the webdav client's native
// `Invalid response: <code>` text; bare prose like "401 Unauthorized" must NOT classify.
const STATUS_PREFIX = '(?:HTTP|Invalid response:) ?'
const REMOTE_STATUS_MESSAGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; key: BackupMessageKey }> = [
  { pattern: new RegExp(`${STATUS_PREFIX}(?:401|403)\\b`), key: 'backup.error.remote_access_denied' },
  { pattern: new RegExp(`${STATUS_PREFIX}507\\b`), key: 'backup.error.remote_quota_exceeded' },
  { pattern: new RegExp(`${STATUS_PREFIX}413\\b`), key: 'backup.error.remote_file_too_large' },
  { pattern: new RegExp(`${STATUS_PREFIX}(?:500|502|503|504)\\b`), key: 'backup.error.remote_server_error' }
]

// IdleTimeoutController aborts stalled uploads with this DOMException message.
const UPLOAD_STALLED_PATTERN = /idle timeout exceeded/i

// Raw server text is kept for diagnosis (issue #10512) but capped so a
// pathological message cannot flood the toast.
const MAX_RAW_DETAIL_LENGTH = 200

function withRawDetail(messageKey: BackupMessageKey, error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (!raw) return i18n.t(messageKey)
  const detail = raw.length > MAX_RAW_DETAIL_LENGTH ? `${raw.slice(0, MAX_RAW_DETAIL_LENGTH)}…` : raw
  return `${i18n.t(messageKey)} (${detail})`
}

export function getLocalizedBackupErrorMessage(
  error: unknown,
  fallbackKey: BackupErrorFallbackKey = 'message.backup.failed'
): string {
  if (error instanceof Error && error.message.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)) {
    // Never leak the raw English message for blocked-backup states.
    return i18n.t('backup.error.active_data_writers')
  }

  let messageKey: BackupMessageKey = fallbackKey
  if (error instanceof Error) {
    const statusMatch = REMOTE_STATUS_MESSAGE_PATTERNS.find(({ pattern }) => pattern.test(error.message))
    if (statusMatch) {
      messageKey = statusMatch.key
    } else if (UPLOAD_STALLED_PATTERN.test(error.message)) {
      messageKey = 'backup.error.upload_stalled'
    }
  }

  return withRawDetail(messageKey, error)
}
