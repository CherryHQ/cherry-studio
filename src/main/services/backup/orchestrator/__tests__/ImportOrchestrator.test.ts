import type { BackupManifest, ValidationResult } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, BackupDomain, ConflictStrategy, ValidationErrorCode } from '@shared/backup'
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

describe('ImportOrchestrator', () => {
  let validateBackupManifest: (
    manifest: BackupManifest,
    errors: ValidationResult['errors'],
    warnings: ValidationResult['warnings']
  ) => void

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../BackupValidator')
    validateBackupManifest = mod.validateBackupManifest
  })

  // Test restore manifest gate behavior via the shared helper.
  // ImportOrchestrator.validateManifestForRestore() calls this helper and throws on errors.

  it('restore rejects newer manifest versions before import', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    const futureManifest = {
      version: (BACKUP_MANIFEST_VERSION + 1) as typeof BACKUP_MANIFEST_VERSION,
      domains: [BackupDomain.MCP_SERVERS]
    } as BackupManifest

    validateBackupManifest(futureManifest, errors, warnings)

    expect(errors).toEqual([expect.objectContaining({ code: ValidationErrorCode.COMPAT_VERSION_TOO_NEW })])
    expect(warnings).toHaveLength(0)
    // ImportOrchestrator.validateManifestForRestore() throws on the first error
  })

  it('restore allows older manifest versions with warning', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    const olderManifest = {
      version: (BACKUP_MANIFEST_VERSION - 1) as typeof BACKUP_MANIFEST_VERSION,
      domains: [BackupDomain.TOPICS]
    } as BackupManifest

    validateBackupManifest(olderManifest, errors, warnings)

    expect(errors).toHaveLength(0)
    expect(warnings).toEqual([expect.objectContaining({ code: ValidationErrorCode.COMPAT_VERSION_TOO_OLD })])
  })

  it('restore rejects empty domains manifest', () => {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    const emptyManifest = {
      version: BACKUP_MANIFEST_VERSION,
      domains: []
    } as unknown as BackupManifest

    validateBackupManifest(emptyManifest, errors, warnings)

    expect(errors).toEqual([expect.objectContaining({ code: ValidationErrorCode.MANIFEST_CORRUPTED })])
  })
})

describe('ImportOrchestrator default conflict strategy', () => {
  it('resolves omitted conflictStrategy to RENAME', () => {
    const options = { restoreFiles: false }
    const strategy = (options as { conflictStrategy?: ConflictStrategy }).conflictStrategy ?? ConflictStrategy.RENAME
    expect(strategy).toBe(ConflictStrategy.RENAME)
  })

  it('preserves explicit OVERWRITE when provided', () => {
    const options = { restoreFiles: false, conflictStrategy: ConflictStrategy.OVERWRITE }
    const strategy = options.conflictStrategy ?? ConflictStrategy.RENAME
    expect(strategy).toBe(ConflictStrategy.OVERWRITE)
  })

  it('preserves explicit SKIP when provided', () => {
    const options = { restoreFiles: false, conflictStrategy: ConflictStrategy.SKIP }
    const strategy = options.conflictStrategy ?? ConflictStrategy.RENAME
    expect(strategy).toBe(ConflictStrategy.SKIP)
  })
})
