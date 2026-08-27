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

  it('classifies the webdav-native quota message and keeps the raw detail', () => {
    // Bug caught (issue #10512): the server's 507 verdict used to collapse
    // into the generic "backup failed" toast.
    const result = getLocalizedBackupErrorMessage(new Error('Invalid response: 507 Insufficient Storage'))

    expect(result).toBe('localized:backup.error.remote_quota_exceeded (Invalid response: 507 Insufficient Storage)')
  })

  it('classifies the enriched quota message from our WebDav layer (dual source)', () => {
    expect(
      getLocalizedBackupErrorMessage(new Error('WebDAV PUT /b/backup.zip failed: HTTP 507 (Insufficient Storage)'))
    ).toBe(
      'localized:backup.error.remote_quota_exceeded (WebDAV PUT /b/backup.zip failed: HTTP 507 (Insufficient Storage))'
    )
  })

  it('classifies the enriched access-denied message from our WebDav layer', () => {
    const result = getLocalizedBackupErrorMessage(
      new Error('WebDAV ensure directory /backups failed: HTTP 403 (Forbidden)')
    )

    expect(result).toBe(
      'localized:backup.error.remote_access_denied (WebDAV ensure directory /backups failed: HTTP 403 (Forbidden))'
    )
  })

  it('classifies the enriched too-large and generic server errors', () => {
    expect(getLocalizedBackupErrorMessage(new Error('WebDAV PUT /b/x.zip failed: HTTP 413 (Payload Too Large)'))).toBe(
      'localized:backup.error.remote_file_too_large (WebDAV PUT /b/x.zip failed: HTTP 413 (Payload Too Large))'
    )
    expect(getLocalizedBackupErrorMessage(new Error('Invalid response: 503 Service Unavailable'))).toBe(
      'localized:backup.error.remote_server_error (Invalid response: 503 Service Unavailable)'
    )
  })

  it('classifies the idle-timeout stall message', () => {
    const result = getLocalizedBackupErrorMessage(new Error('Idle timeout exceeded'))

    expect(result).toBe('localized:backup.error.upload_stalled (Idle timeout exceeded)')
  })

  it('keeps bare status prose on the generic fallback (prefix anchoring)', () => {
    // Bug caught: unanchored matching would misattribute any error whose text
    // happens to contain a status-code-shaped number.
    expect(getLocalizedBackupErrorMessage(new Error('401 Unauthorized during token refresh'))).toBe(
      'localized:message.backup.failed (401 Unauthorized during token refresh)'
    )
  })

  it('truncates pathological raw details in the appended parenthetical', () => {
    const result = getLocalizedBackupErrorMessage(new Error('x'.repeat(500)))

    expect(result).toBe(`localized:message.backup.failed (${'x'.repeat(200)}…)`)
  })

  it('uses the localized fallback with the raw detail for other errors', () => {
    expect(getLocalizedBackupErrorMessage(new Error('Disk is full'), 'message.restore.failed')).toBe(
      'localized:message.restore.failed (Disk is full)'
    )
  })
})
