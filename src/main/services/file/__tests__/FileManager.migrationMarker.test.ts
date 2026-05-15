/**
 * FileManager — migration completedAt read + skip-once DB sweep tests.
 *
 * Isolated from FileManager.integration.test.ts because:
 *   - The integration test does a top-level `await import('../FileManager')`, which
 *     means @main/data/bootConfig is already bound before any vi.mock() here.
 *   - These tests need fine-grained control over bootConfigService.get/set and
 *     the appStateTable to exercise the skip-once mechanic.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { BaseService } from '@main/core/lifecycle'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── bootConfig mock (must be declared before the module import below) ────────

const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: bootConfigGetMock,
    set: bootConfigSetMock,
    flush: vi.fn()
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('../FileManager')
const { danglingCache } = await import('../danglingCache')

describe('FileManager — migration completedAt read', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-migration-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    bootConfigGetMock.mockReturnValue(null)
    bootConfigSetMock.mockReturnValue(undefined)
    BaseService.resetInstances()
    danglingCache.clear()
    fm = new FileManager()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('reads app_state.migrationStatus.completedAt via private getMigrationCompletedAt()', async () => {
    const completedAt = 1700000000000
    const now = Date.now()
    await dbh.db.insert(appStateTable).values({
      key: 'migration_v2_status',
      value: { status: 'completed', completedAt, version: '2.0.0', error: null },
      description: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await (fm as any).getMigrationCompletedAt()
    expect(result).toBe(completedAt)
  })

  it('returns null when migrationStatus row is absent', async () => {
    const result = await (fm as any).getMigrationCompletedAt()
    expect(result).toBeNull()
  })

  it('returns null when migrationStatus row exists but has no completedAt', async () => {
    const now = Date.now()
    await dbh.db.insert(appStateTable).values({
      key: 'migration_v2_status',
      value: { status: 'in_progress' } as any,
      description: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await (fm as any).getMigrationCompletedAt()
    expect(result).toBeNull()
  })
})

describe('FileManager — skip-once DB sweep via marker comparison', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  async function seedMigrationStatus(completedAt: number) {
    const now = Date.now()
    await dbh.db.insert(appStateTable).values({
      key: 'migration_v2_status',
      value: { status: 'completed', completedAt, version: '2.0.0', error: null },
      description: null,
      createdAt: now,
      updatedAt: now
    })
  }

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-skiponce-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    bootConfigGetMock.mockReturnValue(null)
    bootConfigSetMock.mockReturnValue(undefined)
    BaseService.resetInstances()
    danglingCache.clear()
    fm = new FileManager()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('SKIP-1: no migration ever happened (completedAt null, marker null) — DB sweep runs', async () => {
    // No migrationStatus row seeded → completedAt = null
    // bootConfigGetMock returns null (the default set in beforeEach) → marker = null
    // Both null → no mismatch → DB sweep runs
    const spy = vi.spyOn(fm['deps'].fileEntryService, 'findUnreferenced')

    await fm.runStartupSweeps()

    expect(spy).toHaveBeenCalled()
    expect(fm.getOrphanReport().outcome).not.toBe('unknown')
    spy.mockRestore()
  })

  it('SKIP-2: first startup after migration (completedAt has value, marker null) — DB sweep skipped, marker updated', async () => {
    const completedAt = 1700000000000
    await seedMigrationStatus(completedAt)
    // marker stays null (default mock)
    const spy = vi.spyOn(fm['deps'].fileEntryService, 'findUnreferenced')

    await fm.runStartupSweeps()

    // DB sweep was NOT called
    expect(spy).not.toHaveBeenCalled()
    // report stays unknown (no sweep ran)
    expect(fm.getOrphanReport().outcome).toBe('unknown')
    // marker was updated to completedAt
    expect(bootConfigSetMock).toHaveBeenCalledWith('file.lastProcessedMigrationCompletedAt', completedAt)
    spy.mockRestore()
  })

  it('SKIP-3: subsequent startup (marker === completedAt) — DB sweep runs normally', async () => {
    const completedAt = 1700000000000
    await seedMigrationStatus(completedAt)
    // marker equals completedAt → no mismatch → DB sweep runs
    bootConfigGetMock.mockReturnValue(completedAt)
    const spy = vi.spyOn(fm['deps'].fileEntryService, 'findUnreferenced')

    await fm.runStartupSweeps()

    expect(spy).toHaveBeenCalled()
    expect(fm.getOrphanReport().outcome).not.toBe('unknown')
    // marker should NOT be re-set (already matching)
    expect(bootConfigSetMock).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('SKIP-4: after v2 backup restore (marker=1800000000000, completedAt rewound to 1700000000000) — DB sweep skipped, marker updated', async () => {
    const completedAtInBackup = 1700000000000
    const markerBeforeRestore = 1800000000000
    await seedMigrationStatus(completedAtInBackup)
    // marker from BootConfig is from before restore — different from restored app_state
    bootConfigGetMock.mockReturnValue(markerBeforeRestore)
    const spy = vi.spyOn(fm['deps'].fileEntryService, 'findUnreferenced')

    await fm.runStartupSweeps()

    // DB sweep skipped
    expect(spy).not.toHaveBeenCalled()
    expect(fm.getOrphanReport().outcome).toBe('unknown')
    // marker updated to new (restored) completedAt
    expect(bootConfigSetMock).toHaveBeenCalledWith('file.lastProcessedMigrationCompletedAt', completedAtInBackup)
    spy.mockRestore()
  })

  it('SKIP-5: FS sweep always runs regardless of marker state (skip scenario)', async () => {
    // Seed an orphan UUID file (old mtime) so the FS sweep has something to delete.
    const orphanId = '019606a0-0000-7000-8000-00000000fa30'
    const { writeFile, utimes } = await import('node:fs/promises')
    const orphanPath = `${internalRoot}/${orphanId}.txt`
    await writeFile(orphanPath, 'o')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(orphanPath, ancient, ancient)

    // First-startup-after-migration scenario: marker null, completedAt set → DB sweep skipped
    const completedAt = 1700000000000
    await seedMigrationStatus(completedAt)
    // marker stays null → skip DB sweep

    await fm.runStartupSweeps()

    // FS sweep ran and cleaned the orphan file
    const { stat } = await import('node:fs/promises')
    await expect(stat(orphanPath)).rejects.toThrow(/ENOENT/)
    // DB sweep was indeed skipped
    expect(fm.getOrphanReport().outcome).toBe('unknown')
  })
})
