import type { BackupManifest, ValidationResult } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, BackupDomain, ValidationErrorCode } from '@shared/backup'
import { describe, expect, it } from 'vitest'

import { validateBackupManifest } from '../BackupValidator'

describe('validateBackupManifest backup warnings', () => {
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

  it('surfaces selective backup warnings during restore validation', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(
      {
        ...baseManifest,
        selectiveBackupWarnings: [
          {
            table: 'topic',
            column: 'group_id',
            referencedDomain: BackupDomain.TAGS_GROUPS,
            action: 'SET_NULL'
          }
        ]
      },
      errors,
      warnings
    )

    expect(errors).toHaveLength(0)
    expect(warnings).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.DATA_VALUE_INVALID,
        message: expect.stringContaining('topic.group_id')
      })
    ])
  })

  it('surfaces sensitive data presence during restore validation', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    validateBackupManifest(
      {
        ...baseManifest,
        sensitiveData: { included: true }
      },
      errors,
      warnings
    )

    expect(errors).toHaveLength(0)
    expect(warnings).toEqual([
      expect.objectContaining({
        code: ValidationErrorCode.DATA_VALUE_INVALID,
        message: expect.stringContaining('includes sensitive data')
      })
    ])
  })
})
