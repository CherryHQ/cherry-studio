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

  describe('create / createMany', () => {
    it('inserts a single ref and returns it parsed', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000cc01' as FileEntryId
      await seedEntry(entryId)
      const ref = await fileRefService.create({
        fileEntryId: entryId,
        sourceType: 'temp_session',
        sourceId: 'session-K',
        role: 'pending'
      })
      expect(ref.fileEntryId).toBe(entryId)
      expect(ref.sourceType).toBe('temp_session')
      expect(ref.sourceId).toBe('session-K')
      expect(ref.role).toBe('pending')
    })

    it('throws on duplicate (entryId, sourceType, sourceId, role)', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000cc02' as FileEntryId
      await seedEntry(entryId)
      const values = {
        fileEntryId: entryId,
        sourceType: 'temp_session' as const,
        sourceId: 'dup',
        role: 'pending'
      }
      await fileRefService.create(values)
      await expect(fileRefService.create(values)).rejects.toThrow()
    })

    it('createMany skips conflicting rows and returns the inserted ones', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000cc03' as FileEntryId
      await seedEntry(entryId)
      const base = { fileEntryId: entryId, sourceType: 'temp_session' as const, role: 'pending' }
      await fileRefService.create({ ...base, sourceId: 'one' })

      const result = await fileRefService.createMany([
        { ...base, sourceId: 'one' },
        { ...base, sourceId: 'two' },
        { ...base, sourceId: 'three' }
      ])
      // 'one' already existed → skipped; 'two' and 'three' inserted
      expect(result).toHaveLength(2)
      const ids = result.map((r) => r.sourceId).sort()
      expect(ids).toEqual(['three', 'two'])
    })
  })

  describe('cleanupBySource / cleanupBySourceBatch', () => {
    it('removes all refs owned by a single source', async () => {
      const entryA = '019606a0-0000-7000-8000-00000000dd01' as FileEntryId
      const entryB = '019606a0-0000-7000-8000-00000000dd99' as FileEntryId
      await seedEntry(entryA)
      await seedEntry(entryB)
      await fileRefService.create({
        fileEntryId: entryA,
        sourceType: 'temp_session',
        sourceId: 'cleanup-A',
        role: 'pending'
      })
      await fileRefService.create({
        fileEntryId: entryB,
        sourceType: 'temp_session',
        sourceId: 'cleanup-A',
        role: 'pending'
      })
      const removed = await fileRefService.cleanupBySource({ sourceType: 'temp_session', sourceId: 'cleanup-A' })
      expect(removed).toBe(2)
      expect(await fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'cleanup-A' })).toEqual([])
    })

    it('cleanupBySource on missing source returns 0', async () => {
      const removed = await fileRefService.cleanupBySource({ sourceType: 'temp_session', sourceId: 'never' })
      expect(removed).toBe(0)
    })

    it('cleanupBySourceBatch removes refs across multiple sourceIds', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000dd02' as FileEntryId
      await seedEntry(entryId)
      const make = (sid: string) => ({
        fileEntryId: entryId,
        sourceType: 'temp_session' as const,
        sourceId: sid,
        role: 'pending'
      })
      await fileRefService.create(make('s1'))
      await fileRefService.create(make('s2'))
      await fileRefService.create(make('s3'))
      const removed = await fileRefService.cleanupBySourceBatch('temp_session', ['s1', 's3'])
      expect(removed).toBe(2)
      const remaining = await fileRefService.findByEntryId(entryId)
      expect(remaining.map((r) => r.sourceId)).toEqual(['s2'])
    })

    it('cleanupBySourceBatch chunks past the SQLite IN-list cap', async () => {
      // SQLITE_INARRAY_CHUNK = 500; 1200 ids forces three chunks (500/500/200)
      // and validates the per-chunk count summation. A bug that runs only the
      // first chunk would return ~500 instead of 1200.
      const entryId = '019606a0-0000-7000-8000-00000000ee01' as FileEntryId
      await seedEntry(entryId)
      const sids = Array.from({ length: 1200 }, (_, i) => `bulk-${String(i).padStart(4, '0')}`)
      const SEED_CHUNK = 200
      for (let i = 0; i < sids.length; i += SEED_CHUNK) {
        await fileRefService.createMany(
          sids.slice(i, i + SEED_CHUNK).map((sid) => ({
            fileEntryId: entryId,
            sourceType: 'temp_session' as const,
            sourceId: sid,
            role: 'pending'
          }))
        )
      }
      const removed = await fileRefService.cleanupBySourceBatch('temp_session', sids)
      expect(removed).toBe(1200)
      expect(await fileRefService.findByEntryId(entryId)).toEqual([])
    })
  })

  describe('listDistinctSourceIds', () => {
    it('returns distinct sourceIds for a sourceType (de-duplicates within source)', async () => {
      const entryA = '019606a0-0000-7000-8000-00000000dd10' as FileEntryId
      const entryB = '019606a0-0000-7000-8000-00000000dd11' as FileEntryId
      await seedEntry(entryA)
      await seedEntry(entryB)
      // Same sourceId 'sess-shared' referenced by two entries → must dedupe
      await fileRefService.create({
        fileEntryId: entryA,
        sourceType: 'temp_session',
        sourceId: 'sess-shared',
        role: 'pending'
      })
      await fileRefService.create({
        fileEntryId: entryB,
        sourceType: 'temp_session',
        sourceId: 'sess-shared',
        role: 'pending'
      })
      await fileRefService.create({
        fileEntryId: entryA,
        sourceType: 'temp_session',
        sourceId: 'sess-other',
        role: 'pending'
      })
      const ids = await fileRefService.listDistinctSourceIds('temp_session')
      expect(new Set(ids)).toEqual(new Set(['sess-shared', 'sess-other']))
    })

    it('returns empty array when no refs exist for the sourceType', async () => {
      expect(await fileRefService.listDistinctSourceIds('temp_session')).toEqual([])
    })

    it('scopes by sourceType — refs with a different sourceType are excluded', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000dd20' as FileEntryId
      await seedEntry(entryId)
      await fileRefService.create({
        fileEntryId: entryId,
        sourceType: 'temp_session',
        sourceId: 'in-temp',
        role: 'pending'
      })
      // The other registered sourceType (`knowledge_item`) is intentionally
      // not seeded — this test verifies that a query for it returns empty.
      expect(await fileRefService.listDistinctSourceIds('knowledge_item')).toEqual([])
      expect(await fileRefService.listDistinctSourceIds('temp_session')).toEqual(['in-temp'])
    })
  })

  describe('countByEntryIds', () => {
    it('returns an empty map for an empty input list', async () => {
      const result = await fileRefService.countByEntryIds([])
      expect(result.size).toBe(0)
    })

    it('counts refs per fileEntryId; entries without refs are absent from the map', async () => {
      const idA = '019606a0-0000-7000-8000-00000000ee01' as FileEntryId
      const idB = '019606a0-0000-7000-8000-00000000ee02' as FileEntryId
      const idC = '019606a0-0000-7000-8000-00000000ee03' as FileEntryId
      await seedEntry(idA)
      await seedEntry(idB)
      await seedEntry(idC)

      const now = Date.now()
      await dbh.db.insert(fileRefTable).values([
        {
          id: uuidv4(),
          fileEntryId: idA,
          sourceType: 'temp_session',
          sourceId: 's1',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        },
        {
          id: uuidv4(),
          fileEntryId: idA,
          sourceType: 'temp_session',
          sourceId: 's2',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        },
        {
          id: uuidv4(),
          fileEntryId: idB,
          sourceType: 'temp_session',
          sourceId: 's1',
          role: 'pending',
          createdAt: now,
          updatedAt: now
        }
      ])

      const result = await fileRefService.countByEntryIds([idA, idB, idC])
      expect(result.get(idA)).toBe(2)
      expect(result.get(idB)).toBe(1)
      // idC has no refs — absent from the map; handler treats missing as 0.
      expect(result.has(idC)).toBe(false)
    })
  })
})
