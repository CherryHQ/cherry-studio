import i18n from '@renderer/i18n/resolver'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'

type BackupErrorFallbackKey =
  | 'error.backup.file_format'
  | 'message.backup.failed'
  | 'message.restore.failed'
  | 'settings.data.local.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.restore.error'
  | 'settings.data.webdav.backup.manager.fetch.error'
  | 'settings.data.webdav.backup.manager.delete.error'

// Node TLS failures surface over IPC as plain Error messages (error.code is
// lost crossing the boundary), so match on message text instead of codes.
// Chain-trust failures only: expiry / not-yet-valid / hostname-mismatch need a
// certificate fix, not a verification bypass, and must not trigger this hint.
const TLS_CERTIFICATE_FAILURE_PATTERNS = [
  'unable to verify the first certificate',
  'unable to get local issuer certificate',
  'unable to get issuer certificate',
  'self-signed certificate',
  'self signed certificate',
  'depth_zero_self_signed_cert',
  'self_signed_cert_in_chain'
]

function isTlsCertificateFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) return false
  const message = error.message.toLowerCase()
  return TLS_CERTIFICATE_FAILURE_PATTERNS.some((pattern) => message.includes(pattern))
}

export function getLocalizedBackupErrorMessage(
  error: unknown,
  fallbackKey: BackupErrorFallbackKey = 'message.backup.failed',
  options?: { tlsCertificateHint?: boolean }
): string {
  let messageKey: Parameters<typeof i18n.t>[0] = fallbackKey
  if (error instanceof Error && error.message.includes(BACKUP_ACTIVE_WRITERS_ERROR_CODE)) {
    messageKey = 'backup.error.active_data_writers'
  } else if (options?.tlsCertificateHint === true && isTlsCertificateFailure(error)) {
    // Scoped to WebDAV callers: the guidance points at the WebDAV self-signed
    // switch, which does not exist for S3/local/nutstore transports.
    messageKey = 'backup.error.webdav_tls_certificate'
  }

  return i18n.t(messageKey)
}
