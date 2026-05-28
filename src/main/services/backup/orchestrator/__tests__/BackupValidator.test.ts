import type { BackupManifest, ValidationResult } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, BackupDomain, ValidationErrorCode } from '@shared/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('validateBackupManifest', () => {
  let validateBackupManifest: (
    manifest: BackupManifest,
    errors: ValidationResult['errors'],
    warnings: ValidationResult['warnings']
  ) => void

  const baseManifest = {
    version: BACKUP_MANIFEST_VERSION,
    mode: 'full' as const,
    appVersion: '1.0.0',
    platform: 'darwin',
    arch: 'arm64',
    createdAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: { hash: 'abc', createdAt: 1 },
    domains: [BackupDomain.TOPICS],
    domainStats: {},
    checksums: {},
    sourceDevice: { hostname: 'test', os: 'darwin' }
  } satisfies BackupManifest

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../BackupValidator')
    validateBackupManifest = mod.validateBackupManifest
  })

  it('rejects manifest versions newer than BACKUP_MANIFEST_VERSION', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(
      { ...baseManifest, version: (BACKUP_MANIFEST_VERSION + 1) as typeof BACKUP_MANIFEST_VERSION },
      errors,
      warnings
    )

    expect(errors).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.COMPAT_VERSION_TOO_NEW,
        expected: BACKUP_MANIFEST_VERSION,
        actual: BACKUP_MANIFEST_VERSION + 1
      })
    ])
    expect(warnings).toHaveLength(0)
  })

  it('warns on manifest versions older than BACKUP_MANIFEST_VERSION', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(
      { ...baseManifest, version: (BACKUP_MANIFEST_VERSION - 1) as typeof BACKUP_MANIFEST_VERSION },
      errors,
      warnings
    )

    expect(errors).toHaveLength(0)
    expect(warnings).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.COMPAT_VERSION_TOO_OLD,
        expected: BACKUP_MANIFEST_VERSION,
        actual: BACKUP_MANIFEST_VERSION - 1
      })
    ])
  })

  it('passes current manifest version without errors or warnings', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(baseManifest, errors, warnings)

    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('rejects manifests with empty domains', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest({ ...baseManifest, domains: [] }, errors, warnings)

    expect(errors).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.MANIFEST_CORRUPTED,
        message: expect.stringContaining('no domains')
      })
    ])
  })

  it('rejects manifests with missing or non-numeric version', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(
      { ...baseManifest, version: undefined as unknown as typeof BACKUP_MANIFEST_VERSION },
      errors,
      warnings
    )

    expect(errors).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.MANIFEST_CORRUPTED,
        message: expect.stringContaining('invalid or missing version')
      })
    ])
  })

  it('rejects manifests with NaN version', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest({ ...baseManifest, version: NaN as typeof BACKUP_MANIFEST_VERSION }, errors, warnings)

    expect(errors).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.MANIFEST_CORRUPTED,
        message: expect.stringContaining('invalid or missing version')
      })
    ])
  })
})
