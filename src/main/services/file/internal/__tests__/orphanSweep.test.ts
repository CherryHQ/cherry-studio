import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { OrphanRefScanner } = await import('../orphanSweep')
const { tempSessionChecker } = await import('@data/services/orphan/FileRefCheckerRegistry')

describe('OrphanRefScanner', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  async function seedEntry(id: FileEntryId): Promise<void> {
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'n',
      ext: 'txt',
      size: 1,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  async function seedRef(refId: string, fileEntryId: FileEntryId, sourceId: string): Promise<void> {
    const now = Date.now()
    await dbh.db.insert(fileRefTable).values({
      id: refId,
      fileEntryId,
      sourceType: 'temp_session',
      sourceId,
      role: 'pending',
      createdAt: now,
      updatedAt: now
    })
  }

  describe('scanOneType', () => {
    it('deletes file_ref rows whose sourceId is no longer alive', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee01' as FileEntryId
      await seedEntry(entryId)
      await seedRef('22222222-2222-4222-8222-000000000001', entryId, 'sess-gone-1')
      await seedRef('22222222-2222-4222-8222-000000000002', entryId, 'sess-gone-2')

      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: tempSessionChecker }
      })

      const removed = await scanner.scanOneType('temp_session')
      expect(removed).toBe(2)

      const remaining = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entryId))
      expect(remaining).toEqual([])
    })

    it('preserves refs whose sourceId is reported alive by the checker', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee02' as FileEntryId
      await seedEntry(entryId)
      await seedRef('22222222-2222-4222-8222-000000000003', entryId, 'sess-alive')

      const aliveChecker = {
        sourceType: 'temp_session' as const,
        checkExists: async (ids: readonly string[]) => new Set(ids)
      }
      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: aliveChecker }
      })

      const removed = await scanner.scanOneType('temp_session')
      expect(removed).toBe(0)

      const remaining = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entryId))
      expect(remaining.length).toBe(1)
    })

    it('returns 0 when no refs exist for the sourceType', async () => {
      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: tempSessionChecker }
      })
      expect(await scanner.scanOneType('temp_session')).toBe(0)
    })
  })
})

function registryStub() {
  const allAlive = (sourceType: string) => ({
    sourceType,
    checkExists: async (ids: readonly string[]) => new Set(ids)
  })
  return {
    chat_message: allAlive('chat_message'),
    knowledge_item: allAlive('knowledge_item'),
    painting: allAlive('painting'),
    note: allAlive('note'),
    temp_session: allAlive('temp_session')
  } as never
}

describe('placeholder import — fileEntryService used by later tasks', () => {
  it('is wired', () => {
    expect(typeof fileEntryService.findUnreferenced).toBe('function')
  })
})
