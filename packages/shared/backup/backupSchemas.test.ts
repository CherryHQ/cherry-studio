import { describe, expect, it } from 'vitest'

import {
  BACKUP_MANIFEST_VERSION,
  BackupDomain,
  BackupDomainSchema,
  BackupManifestSchema,
  BackupOptionsSchema,
  CompressionLevel,
  CompressionLevelSchema,
  ConflictStrategy,
  ConflictStrategySchema,
  RestoreOptionsSchema,
  ValidationErrorCode,
  ValidationErrorCodeSchema
} from './index'

describe('shared backup schemas', () => {
  it('preserves enum-style runtime values for const objects', () => {
    expect(BackupDomain.TOPICS).toBe('topics')
    expect(ConflictStrategy.RENAME).toBe('rename')
    expect(CompressionLevel.NORMAL).toBe(5)
    expect(ValidationErrorCode.MANIFEST_CORRUPTED).toBe('manifest_corrupted')
  })

  it('parses structurally valid manifest', () => {
    const result = BackupManifestSchema.parse({
      version: BACKUP_MANIFEST_VERSION,
      mode: 'full',
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      createdAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: { hash: 'abc', createdAt: 1 },
      domains: [BackupDomain.TOPICS],
      domainStats: {
        topics: { itemCount: 1, sizeBytes: 0 }
      },
      checksums: { 'backup.sqlite': 'deadbeef' },
      sourceDevice: { hostname: 'host', os: 'darwin 25' },
      selectiveBackupWarnings: [
        {
          table: 'topic',
          column: 'group_id',
          referencedDomain: BackupDomain.TAGS_GROUPS,
          action: 'SET_NULL'
        }
      ],
      sensitiveData: { included: true }
    })

    expect(result.version).toBe(BACKUP_MANIFEST_VERSION)
    expect(result.domains).toEqual([BackupDomain.TOPICS])
  })

  it('rejects non-numeric manifest version', () => {
    expect(() =>
      BackupManifestSchema.parse({
        version: 'not-a-number',
        mode: 'full',
        appVersion: '1.0.0',
        platform: 'darwin',
        arch: 'arm64',
        createdAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: { hash: 'abc', createdAt: 1 },
        domains: [BackupDomain.TOPICS],
        domainStats: {},
        checksums: {},
        sourceDevice: { hostname: 'host', os: 'darwin 25' }
      })
    ).toThrow()
  })

  it('accepts valid option schemas', () => {
    expect(BackupOptionsSchema.parse({ domains: [BackupDomain.TOPICS], includeSensitiveData: true })).toEqual({
      domains: [BackupDomain.TOPICS],
      includeSensitiveData: true
    })
    expect(RestoreOptionsSchema.parse({ conflictStrategy: ConflictStrategy.RENAME, validateOnly: true })).toEqual({
      conflictStrategy: ConflictStrategy.RENAME,
      validateOnly: true
    })
  })

  it('accepts exported enum schemas', () => {
    expect(BackupDomainSchema.parse(BackupDomain.TOPICS)).toBe(BackupDomain.TOPICS)
    expect(ConflictStrategySchema.parse(ConflictStrategy.SKIP)).toBe(ConflictStrategy.SKIP)
    expect(CompressionLevelSchema.parse(CompressionLevel.MAXIMUM)).toBe(CompressionLevel.MAXIMUM)
    expect(ValidationErrorCodeSchema.parse(ValidationErrorCode.FILE_HASH_MISMATCH)).toBe(
      ValidationErrorCode.FILE_HASH_MISMATCH
    )
  })
})
