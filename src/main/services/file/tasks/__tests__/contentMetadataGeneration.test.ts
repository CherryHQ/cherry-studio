import { appStateTable } from '@data/db/schemas/appState'
import { fileEntryTable } from '@data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport, MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntryId } from '@shared/data/types/file'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { ensureContentMetadataGeneration } = await import('../contentMetadataGeneration')

const generationKey = 'fileManager:contentMetadataGeneration'

describe('ensureContentMetadataGeneration', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainDbServiceExport.dbService.withWriteTx.mockImplementation((fn) =>
      dbh.db.transaction(fn, { behavior: 'immediate' })
    )
  })

  function seedInternal(id: FileEntryId, contentHash: string | null, updatedAt: number): void {
    dbh.db
      .insert(fileEntryTable)
      .values({
        id,
        origin: 'internal',
        name: id.slice(-4),
        ext: 'bin',
        size: 7,
        contentHash,
        externalPath: null,
        deletedAt: null,
        createdAt: updatedAt,
        updatedAt
      })
      .run()
  }

  it('atomically invalidates only non-null internal hashes and preserves timestamps', () => {
    const hashedId = '019606a0-0000-7000-8000-000000000401' as FileEntryId
    const pendingId = '019606a0-0000-7000-8000-000000000402' as FileEntryId
    seedInternal(hashedId, 'xxh3-64:1111111111111111', 101)
    seedInternal(pendingId, null, 102)
    dbh.db
      .insert(fileEntryTable)
      .values({
        id: '019606a0-0000-7000-8000-000000000403',
        origin: 'external',
        name: 'external',
        ext: 'txt',
        size: null,
        contentHash: null,
        externalPath: '/tmp/external.txt',
        deletedAt: null,
        createdAt: 103,
        updatedAt: 103
      })
      .run()

    expect(ensureContentMetadataGeneration()).toEqual({ applied: true, invalidated: 1 })
    expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, hashedId)).get()).toMatchObject({
      contentHash: null,
      updatedAt: 101
    })
    expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, pendingId)).get()).toMatchObject({
      contentHash: null,
      updatedAt: 102
    })
    expect(dbh.db.select().from(appStateTable).where(eq(appStateTable.key, generationKey)).get()?.value).toEqual({
      version: 2
    })
  })

  it('is idempotent after the v2 marker is present', () => {
    seedInternal('019606a0-0000-7000-8000-000000000404', 'xxh3-64:2222222222222222', 104)
    expect(ensureContentMetadataGeneration()).toMatchObject({ applied: true })

    expect(ensureContentMetadataGeneration()).toEqual({ applied: false, invalidated: 0 })
  })

  it('treats a malformed marker as untrusted and rebuilds it', () => {
    const id = '019606a0-0000-7000-8000-000000000405' as FileEntryId
    seedInternal(id, 'xxh3-64:3333333333333333', 105)
    dbh.db.insert(appStateTable).values({ key: generationKey, value: 'corrupt', createdAt: 1, updatedAt: 1 }).run()

    expect(ensureContentMetadataGeneration()).toEqual({ applied: true, invalidated: 1 })
    expect(dbh.db.select().from(appStateTable).where(eq(appStateTable.key, generationKey)).get()?.value).toEqual({
      version: 2
    })
  })

  it('rolls back hash invalidation when writing the marker fails', () => {
    const id = '019606a0-0000-7000-8000-000000000406' as FileEntryId
    const contentHash = 'xxh3-64:4444444444444444'
    seedInternal(id, contentHash, 106)
    dbh.sqlite.exec(
      `CREATE TRIGGER content_generation_sabotage BEFORE INSERT ON app_state
       BEGIN SELECT RAISE(ABORT, 'generation sabotage'); END`
    )

    try {
      expect(() => ensureContentMetadataGeneration()).toThrow('generation sabotage')
      expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, id)).get()).toMatchObject({
        contentHash,
        updatedAt: 106
      })
      expect(dbh.db.select().from(appStateTable).where(eq(appStateTable.key, generationKey)).get()).toBeUndefined()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER content_generation_sabotage')
    }
  })
})
