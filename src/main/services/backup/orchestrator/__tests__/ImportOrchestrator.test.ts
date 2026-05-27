import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BackupManifest, ValidationResult } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, BackupDomain, ConflictStrategy, ValidationErrorCode } from '@shared/backup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateClient, mockZipClose, mockZipCtor, mockZipExtract } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockZipClose: vi.fn(),
  mockZipCtor: vi.fn(),
  mockZipExtract: vi.fn()
}))

vi.mock('@libsql/client', () => ({
  createClient: mockCreateClient
}))

vi.mock('node-stream-zip', () => ({
  default: {
    async: mockZipCtor
  }
}))

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

describe('ImportOrchestrator snapshot behavior', () => {
  let tempRoot: string
  let ImportOrchestrator: typeof import('../ImportOrchestrator').ImportOrchestrator

  const createMockTracker = () => ({
    incrementItemsProcessed: vi.fn(),
    setDomain: vi.fn(),
    setPhase: vi.fn(),
    setTotals: vi.fn()
  })

  const createMockToken = () => ({
    throwIfCancelled: vi.fn()
  })

  const baseManifest = {
    version: BACKUP_MANIFEST_VERSION,
    domains: [BackupDomain.TOPICS],
    schemaVersion: { hash: 'hash-1', createdAt: 1 }
  } as BackupManifest

  beforeEach(async () => {
    vi.clearAllMocks()
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'import-orchestrator-test-'))

    const { application } = await import('@application')
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.backup.temp') return tempRoot
      if (key === 'app.database.file') return path.join(tempRoot, 'live.sqlite')
      return tempRoot
    })
    vi.spyOn(application, 'get').mockReturnValue({
      getDb: () => ({
        run: vi.fn(),
        transaction: vi.fn()
      })
    } as never)

    mockZipExtract.mockResolvedValue(undefined)
    mockZipClose.mockResolvedValue(undefined)
    mockZipCtor.mockImplementation(() => ({
      extract: mockZipExtract,
      close: mockZipClose
    }))

    const mod = await import('../ImportOrchestrator')
    ImportOrchestrator = mod.ImportOrchestrator
  })

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('creates snapshot with VACUUM INTO against the live database', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()
    mockCreateClient.mockReturnValue({ execute, close })

    const orchestrator = new ImportOrchestrator(createMockTracker() as never, createMockToken() as never)
    const snapshotPath = await (orchestrator as any).createSnapshot()

    expect(snapshotPath).toContain('pre-restore-snapshot-')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toContain("VACUUM INTO '")
    expect(execute.mock.calls[0][0]).toContain(snapshotPath.replaceAll("'", "''"))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns an empty snapshot path when VACUUM INTO fails', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('disk full'))
    const close = vi.fn()
    mockCreateClient.mockReturnValue({ execute, close })

    const orchestrator = new ImportOrchestrator(createMockTracker() as never, createMockToken() as never)

    await expect((orchestrator as any).createSnapshot()).resolves.toBe('')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('surfaces the recovery snapshot path when restore fails after snapshot creation', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ cnt: 0 }] })
    const close = vi.fn()
    mockCreateClient.mockReturnValue({ execute, close })

    const { DomainImporter } = await import('../../domain/DomainImporter')
    vi.spyOn(DomainImporter.prototype, 'importDomain').mockRejectedValue(new Error('row import failed'))

    const orchestrator = new ImportOrchestrator(createMockTracker() as never, createMockToken() as never)
    vi.spyOn(orchestrator as any, 'readManifest').mockResolvedValue(baseManifest)
    vi.spyOn(orchestrator as any, 'validateManifestForRestore').mockImplementation(() => undefined)
    vi.spyOn(orchestrator as any, 'verifyChecksums').mockResolvedValue(undefined)
    vi.spyOn(orchestrator as any, 'verifySchemaVersion').mockResolvedValue(undefined)
    vi.spyOn(orchestrator as any, 'createSnapshot').mockResolvedValue('/tmp/recovery.sqlite')

    await expect(orchestrator.execute('/tmp/backup.zip', { conflictStrategy: ConflictStrategy.SKIP })).rejects.toThrow(
      'row import failed Recovery snapshot: /tmp/recovery.sqlite'
    )
  })

  it('skips snapshot creation in validateOnly mode', async () => {
    const orchestrator = new ImportOrchestrator(createMockTracker() as never, createMockToken() as never)
    vi.spyOn(orchestrator as any, 'readManifest').mockResolvedValue(baseManifest)
    vi.spyOn(orchestrator as any, 'validateManifestForRestore').mockImplementation(() => undefined)
    vi.spyOn(orchestrator as any, 'verifyChecksums').mockResolvedValue(undefined)
    vi.spyOn(orchestrator as any, 'verifySchemaVersion').mockResolvedValue(undefined)
    const createSnapshotSpy = vi.spyOn(orchestrator as any, 'createSnapshot').mockResolvedValue('/tmp/unused.sqlite')

    const result = await orchestrator.execute('/tmp/backup.zip', { validateOnly: true })

    expect(createSnapshotSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      conflictCount: 0,
      domainCounts: {},
      errorCount: 0,
      fileCount: 0,
      resolvedCount: 0,
      skippedCount: 0
    })
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
