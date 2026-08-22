import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { describe, expect, it, vi } from 'vitest'

import { getLocalizedBackupErrorMessage } from '../backup'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => `localized:${key}`)
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: mocks.t }
}))

describe('getLocalizedBackupErrorMessage', () => {
  it('maps the active-writer code without exposing the raw English error', () => {
    const result = getLocalizedBackupErrorMessage(
      new Error(`Error invoking remote method: ${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    expect(result).toBe('localized:backup.error.active_data_writers')
    expect(result).not.toContain(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
    expect(result).not.toContain('conversation')
  })

  it('uses the localized fallback for other errors', () => {
    expect(getLocalizedBackupErrorMessage(new Error('Disk is full'), 'message.restore.failed')).toBe(
      'localized:message.restore.failed'
    )
  })

  it('maps Node TLS verification failures to the WebDAV self-signed guidance when hinted', () => {
    // Real message text Node emits for the certificate errors we claim to catch.
    expect(
      getLocalizedBackupErrorMessage(new Error('unable to verify the first certificate'), undefined, {
        tlsCertificateHint: true
      })
    ).toBe('localized:backup.error.webdav_tls_certificate')
    expect(
      getLocalizedBackupErrorMessage(new Error('DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate'), undefined, {
        tlsCertificateHint: true
      })
    ).toBe('localized:backup.error.webdav_tls_certificate')
    expect(
      getLocalizedBackupErrorMessage(new Error('unable to get local issuer certificate'), undefined, {
        tlsCertificateHint: true
      })
    ).toBe('localized:backup.error.webdav_tls_certificate')
  })

  it('does NOT advise the switch for expiry/hostname failures (they need a cert fix, not a bypass)', () => {
    expect(
      getLocalizedBackupErrorMessage(new Error('certificate has expired'), undefined, { tlsCertificateHint: true })
    ).toBe('localized:message.backup.failed')
    expect(
      getLocalizedBackupErrorMessage(
        new Error("Hostname/IP does not match certificate's altnames: example.com"),
        undefined,
        { tlsCertificateHint: true }
      )
    ).toBe('localized:message.backup.failed')
    expect(
      getLocalizedBackupErrorMessage(new Error('certificate is not yet valid'), undefined, { tlsCertificateHint: true })
    ).toBe('localized:message.backup.failed')
  })

  it('does NOT give WebDAV guidance without the hint (S3/local transports must not see it)', () => {
    expect(getLocalizedBackupErrorMessage(new Error('unable to verify the first certificate'))).toBe(
      'localized:message.backup.failed'
    )
    expect(
      getLocalizedBackupErrorMessage(
        new Error('self-signed certificate in certificate chain'),
        'message.restore.failed'
      )
    ).toBe('localized:message.restore.failed')
  })

  it('keeps TLS wording distinct from transport failures that are not certificate problems', () => {
    expect(getLocalizedBackupErrorMessage(new Error('ECONNREFUSED connection refused'))).toBe(
      'localized:message.backup.failed'
    )
    expect(getLocalizedBackupErrorMessage(new Error('401 Unauthorized'))).toBe('localized:message.backup.failed')
  })
})
