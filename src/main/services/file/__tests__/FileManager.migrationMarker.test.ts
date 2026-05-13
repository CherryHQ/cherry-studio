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
