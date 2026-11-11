import { createInstance } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import {
  BACKUP_ACTIVE_WRITERS_ERROR_CODE,
  BACKUP_BACKGROUND_TASKS_ERROR_CODE,
  BACKUP_DISK_FULL_ERROR_CODE
} from '@shared/types/backup'

import { getBackupErrorTitleKey, getLocalizedBackupErrorMessage, isBackupMigrationMismatch } from '../backup'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string, options?: { available?: string }) =>
    options?.available ? `localized:${key}:${options.available}` : `localized:${key}`
  )
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: mocks.t }
}))

describe('getLocalizedBackupErrorMessage', () => {
  it('maps a WebDAV upload size rejection after IPC without exposing the server response', () => {
    expect(
      getLocalizedBackupErrorMessage(new Error('Error invoking remote method: BACKUP_WEBDAV_TOO_LARGE: HTTP 413'))
    ).toBe('localized:backup.error.webdav_too_large')
  })

  it('maps the active-writer code without exposing the raw English error', () => {
    const result = getLocalizedBackupErrorMessage(
      new Error(`Error invoking remote method: ${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    expect(result).toBe('localized:backup.error.active_data_writers')
    expect(result).not.toContain(BACKUP_ACTIVE_WRITERS_ERROR_CODE)
    expect(result).not.toContain('conversation')
  })

  it.each(['message.backup.failed', 'message.restore.failed'] as const)(
    'explains unfinished background tasks instead of the generic %s fallback after IPC',
    (fallback) => {
      const error = new Error(
        `Error invoking remote method 'backup:backupToLocalDir': Error: ${BACKUP_BACKGROUND_TASKS_ERROR_CODE}: Background data writes did not quiesce in time.`
      )
      expect(getLocalizedBackupErrorMessage(error, fallback)).toBe('localized:backup.error.background_tasks')
    }
  )

  it.each([
    Object.assign(new Error('copy failed'), { code: 'ENOSPC' }),
    new Error('Error invoking remote method: ENOSPC: no space left on device')
  ])('maps disk-full failures to an actionable localized error', (error) => {
    expect(getLocalizedBackupErrorMessage(error)).toBe('localized:backup.error.disk_full')
  })

  it('includes the available space reported by the failing filesystem', () => {
    const error = new Error(`Error invoking remote method: ${BACKUP_DISK_FULL_ERROR_CODE}:536870912`)

    expect(getLocalizedBackupErrorMessage(error)).toBe('localized:backup.error.disk_full_with_available:512.0 MB')
  })

  it('uses the operation-neutral disk-full error for restore failures', () => {
    expect(
      getLocalizedBackupErrorMessage(
        new Error('Error invoking remote method: ENOSPC: no space left on device'),
        'message.restore.failed'
      )
    ).toBe('localized:backup.error.disk_full')
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
    expect(
      getLocalizedBackupErrorMessage(new Error('unable to get issuer certificate'), undefined, {
        tlsCertificateHint: true
      })
    ).toBe('localized:backup.error.webdav_tls_certificate')
    // Chain failure spelled without hyphens: both spellings occur in the wild.
    expect(
      getLocalizedBackupErrorMessage(new Error('self signed certificate in certificate chain'), undefined, {
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
    expect(
      getLocalizedBackupErrorMessage(new Error('deepest certificate expiration check failed'), undefined, {
        tlsCertificateHint: true
      })
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

describe('migration mismatch diagnostics', () => {
  afterEach(() => {
    mocks.t.mockImplementation((key: string, options?: { available?: string }) =>
      options?.available ? `localized:${key}:${options.available}` : `localized:${key}`
    )
  })

  const payload = {
    v: 1,
    backupAppVersion: '2.0.0',
    backupPlatform: 'darwin',
    backupArch: 'arm64',
    currentAppVersion: '2.0.0',
    appliedCount: 2,
    bundledCount: 3,
    firstDifferingIndex: 1,
    reason: 'hash',
    bundledTag: '0001_example'
  }
  const marker = 'BACKUP_MIGRATION_MISMATCH'
  const wrapped = (value: unknown) =>
    new Error(`Error invoking remote method 'backup:restore': Error: ${marker}:${JSON.stringify(value)}`)

  it('renders actual translated diagnostics from an Electron wrapper', async () => {
    const instance = createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    mocks.t.mockImplementation(instance.t.bind(instance))
    const result = getLocalizedBackupErrorMessage(wrapped(payload))
    expect(result).toContain('Backup app: 2.0.0 (darwin/arm64); current app: 2.0.0')
    expect(result).toContain("entry 2, this build's migration 0001_example; SQL checksum differs")
    expect(result).toContain('Restore stopped before replacing your data')
  })

  it('renders unknown metadata while preserving migration counts and the entry number', async () => {
    const instance = createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    mocks.t.mockImplementation(instance.t.bind(instance))
    const result = getLocalizedBackupErrorMessage(
      wrapped({ ...payload, backupAppVersion: null, backupPlatform: null, backupArch: null, bundledTag: null })
    )

    expect(result).toContain('Backup app: Unknown (Unknown/Unknown); current app: 2.0.0')
    expect(result).toContain('Applied migrations: 2; bundled migrations: 3')
    expect(result).toContain("First difference: entry 2, this build's migration Unknown; SQL checksum differs")
  })

  it.each([
    ['hash', 'SQL checksum differs'],
    ['timestamp', 'migration timestamp differs'],
    ['hash_and_timestamp', 'SQL checksum and migration timestamp differ']
  ])('renders the %s difference', async (reason, difference) => {
    const instance = createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    mocks.t.mockImplementation(instance.t.bind(instance))
    expect(getLocalizedBackupErrorMessage(wrapped({ ...payload, reason }))).toContain(difference)
  })

  it('renders an overflow with the first extra entry', async () => {
    const instance = createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    mocks.t.mockImplementation(instance.t.bind(instance))
    const result = getLocalizedBackupErrorMessage(
      wrapped({ ...payload, reason: 'count_overflow', bundledCount: 1, bundledTag: null })
    )
    expect(result).toContain('First extra entry: 2; this installation has no bundled migration at that position')
    expect(result).not.toContain('0001_example')
  })

  it.each([
    ':not-json',
    ':',
    ':{}',
    ':' + JSON.stringify({ ...payload, v: 2 }),
    ':' + JSON.stringify({ ...payload, appliedCount: '2' }),
    ':' + JSON.stringify({ ...payload, firstDifferingIndex: 2 }),
    ':' + 'x'.repeat(2048) + JSON.stringify(payload)
  ])('falls back safely for invalid payload %s', (suffix) => {
    const error = new Error(`${marker}${suffix} BACKUP_NEWER_VERSION`)
    expect(getLocalizedBackupErrorMessage(error)).toBe('localized:backup.error.migration_mismatch')
    expect(getBackupErrorTitleKey(error)).toBe('backup.error.migration_mismatch_title')
  })

  it('recognizes only a mismatch code at the start or immediately after the IPC wrapper', () => {
    const mismatch = new Error(`Error invoking remote method 'backup:restore': ${marker}:${JSON.stringify(payload)}`)
    expect(isBackupMigrationMismatch(mismatch)).toBe(true)
    expect(getBackupErrorTitleKey(mismatch)).toBe('backup.error.migration_mismatch_title')

    const pathError = new Error("ENOENT: no such file or directory, open '/tmp/BACKUP_MIGRATION_MISMATCH.zip'")
    const newer = new Error(
      'BACKUP_NEWER_VERSION: This backup was created by a newer version of Cherry Studio (backup version BACKUP_MIGRATION_MISMATCH) ...'
    )
    expect(isBackupMigrationMismatch(pathError)).toBe(false)
    expect(getLocalizedBackupErrorMessage(pathError)).toBe('localized:message.backup.failed')
    expect(isBackupMigrationMismatch(newer)).toBe(false)
    expect(getLocalizedBackupErrorMessage(newer)).toBe('localized:backup.error.newer_version')
  })

  it('rejects a payload exceeding the UTF-8 byte budget even when it fits in the character limit', () => {
    const json = `{"backupArch":"${'界'.repeat(700)}",${JSON.stringify(payload).slice(1)}`
    expect(json.length).toBeLessThan(2048)
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(2048)
    expect(getLocalizedBackupErrorMessage(new Error(`${marker}:${json}`))).toBe(
      'localized:backup.error.migration_mismatch'
    )
  })

  it('renders an unknown bundled tag when all other details are valid', async () => {
    const instance = createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    mocks.t.mockImplementation(instance.t.bind(instance))
    expect(getLocalizedBackupErrorMessage(wrapped({ ...payload, bundledTag: null }))).toContain(
      "First difference: entry 2, this build's migration Unknown; SQL checksum differs"
    )
  })

  it('does not recognize a lookalike marker', () => {
    const error = new Error('BACKUP_MIGRATION_MISMATCHED:secret')
    expect(getLocalizedBackupErrorMessage(error)).toBe('localized:message.backup.failed')
    expect(getBackupErrorTitleKey(error)).toBe('error.backup.file_format')
  })

  it('retains newer-version classification', () => {
    expect(getLocalizedBackupErrorMessage(new Error('BACKUP_NEWER_VERSION'))).toBe(
      'localized:backup.error.newer_version'
    )
  })
})
