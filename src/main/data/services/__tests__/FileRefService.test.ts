import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { v4 as uuidv4 } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { fileRefService } = await import('../FileRefService')

describe('FileRefService', () => {
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

  describe('findByEntryId', () => {
    it('returns refs whose fileEntryId matches', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa01' as FileEntryId
      await seedEntry(entryId)
      const now = Date.now()
      await dbh.db.insert(fileRefTable).values([
        {
          id: uuidv4(),
          fileEntryId: entryId,
          sourceType: 'temp_session',
          sourceId: 'session-A',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        },
        {
          id: uuidv4(),
          fileEntryId: entryId,
          sourceType: 'temp_session',
          sourceId: 'session-B',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        }
      ])

      const refs = await fileRefService.findByEntryId(entryId)
      expect(refs).toHaveLength(2)
      expect(refs.every((r) => r.fileEntryId === entryId)).toBe(true)
    })

    it('returns empty array when entry has no refs', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa02' as FileEntryId
      await seedEntry(entryId)
      const refs = await fileRefService.findByEntryId(entryId)
      expect(refs).toEqual([])
    })
  })

  describe('findBySource', () => {
    it('returns refs for the given source key', async () => {
      const entryA = '019606a0-0000-7000-8000-00000000bb01' as FileEntryId
      const entryB = '019606a0-0000-7000-8000-00000000bb02' as FileEntryId
      await seedEntry(entryA)
      await seedEntry(entryB)
      const now = Date.now()
      await dbh.db.insert(fileRefTable).values([
        {
          id: uuidv4(),
          fileEntryId: entryA,
          sourceType: 'temp_session',
          sourceId: 'session-X',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        },
        {
          id: uuidv4(),
          fileEntryId: entryB,
          sourceType: 'temp_session',
          sourceId: 'session-X',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        },
        {
          id: uuidv4(),
          fileEntryId: entryA,
          sourceType: 'temp_session',
          sourceId: 'session-Y',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        }
      ])

      const refs = await fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'session-X' })
      expect(refs).toHaveLength(2)
      expect(refs.every((r) => r.sourceId === 'session-X')).toBe(true)
    })

    it('returns empty array when source key has no refs', async () => {
      const refs = await fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'no-such' })
      expect(refs).toEqual([])
    })
  })
})
