import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { fileRefService } = await import('../FileRefService')

describe('FileRefService', () => {
  const dbh = setupTestDatabase()
  let orderKeySeq = 0

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
    orderKeySeq = 0
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
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  async function seedPainting(id = uuidv4()): Promise<string> {
    orderKeySeq += 1
    await dbh.db.insert(paintingTable).values({
      id,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: `a${orderKeySeq}`
    })
    return id
  }

  async function seedChatMessage(topicId = uuidv4(), messageId = uuidv4()): Promise<string> {
    await dbh.db.insert(topicTable).values({ id: topicId, activeNodeId: messageId, orderKey: `t${orderKeySeq++}` })
    await dbh.db.insert(messageTable).values(
      withRoot(topicId, [
        {
          id: messageId,
          parentId: null,
          topicId,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] },
          status: 'success',
          createdAt: 10,
          updatedAt: 10
        }
      ])
    )
    return messageId
  }

  async function seedPaintingRef(fileEntryId: FileEntryId, sourceId: string, role: 'output' | 'input'): Promise<void> {
    await dbh.db.insert(paintingFileRefTable).values({ fileEntryId, sourceId, role })
  }

  async function seedChatRef(fileEntryId: FileEntryId, sourceId: string): Promise<void> {
    await dbh.db.insert(chatMessageFileRefTable).values({ fileEntryId, sourceId, role: 'attachment' })
  }

  describe('read aggregation', () => {
    it('findByEntryId returns refs across persistent tables and temp-session cache', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa01' as FileEntryId
      const paintingId = await seedPainting()
      const messageId = await seedChatMessage()
      await seedEntry(entryId)
      await seedPaintingRef(entryId, paintingId, 'output')
      await seedChatRef(entryId, messageId)
      await fileRefService.createTempSessionRef({ fileEntryId: entryId, sourceId: 'session-A', role: 'pending' })

      const refs = await fileRefService.findByEntryId(entryId)
      expect(refs).toHaveLength(3)
      expect(refs.every((r) => r.fileEntryId === entryId)).toBe(true)
      expect(refs.map((r) => r.sourceType).sort()).toEqual(['chat_message', 'painting', 'temp_session'])
    })

    it('findBySource reads persistent sources without owning their write path', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa02' as FileEntryId
      const paintingId = await seedPainting()
      await seedEntry(entryId)
      await seedPaintingRef(entryId, paintingId, 'input')

      await expect(fileRefService.findBySource({ sourceType: 'painting', sourceId: paintingId })).resolves.toEqual([
        expect.objectContaining({ fileEntryId: entryId, sourceType: 'painting', sourceId: paintingId, role: 'input' })
      ])
    })

    it('findBySource returns empty array when source key has no refs', async () => {
      await expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'no-such' })).resolves.toEqual(
        []
      )
    })
  })

  describe('temp-session writes', () => {
    it('creates a single temp ref and returns it parsed', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb01' as FileEntryId
      await seedEntry(entryId)

      const ref = await fileRefService.createTempSessionRef({
        fileEntryId: entryId,
        sourceId: 'session-K',
        role: 'pending'
      })

      expect(ref).toEqual(
        expect.objectContaining({
          fileEntryId: entryId,
          sourceType: 'temp_session',
          sourceId: 'session-K',
          role: 'pending'
        })
      )
    })

    it('throws on duplicate temp ref (entryId, sourceId, role)', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb02' as FileEntryId
      await seedEntry(entryId)
      const values = { fileEntryId: entryId, sourceId: 'dup', role: 'pending' }
      await fileRefService.createTempSessionRef(values)
      await expect(fileRefService.createTempSessionRef(values)).rejects.toThrow()
    })

    it('createManyTempSessionRefs skips conflicting rows and returns inserted ones', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb03' as FileEntryId
      await seedEntry(entryId)
      const base = { fileEntryId: entryId, role: 'pending' }
      await fileRefService.createTempSessionRef({ ...base, sourceId: 'one' })

      const result = await fileRefService.createManyTempSessionRefs([
        { ...base, sourceId: 'one' },
        { ...base, sourceId: 'two' },
        { ...base, sourceId: 'three' }
      ])

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.sourceId).sort()).toEqual(['three', 'two'])
    })

    it('cleanupTempSessionSource removes all temp refs owned by one source', async () => {
      const entryA = '019606a0-0000-7000-8000-00000000bb04' as FileEntryId
      const entryB = '019606a0-0000-7000-8000-00000000bb05' as FileEntryId
      await seedEntry(entryA)
      await seedEntry(entryB)
      await fileRefService.createManyTempSessionRefs([
        { fileEntryId: entryA, sourceId: 'cleanup-A', role: 'pending' },
        { fileEntryId: entryB, sourceId: 'cleanup-A', role: 'pending' }
      ])

      await expect(fileRefService.cleanupTempSessionSource('cleanup-A')).resolves.toBe(2)
      await expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'cleanup-A' })).resolves.toEqual(
        []
      )
    })

    it('cleanupTempSessionSources removes temp refs across multiple sourceIds', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb06' as FileEntryId
      await seedEntry(entryId)
      const make = (sourceId: string) => ({ fileEntryId: entryId, sourceId, role: 'pending' })
      await fileRefService.createManyTempSessionRefs([make('s1'), make('s2'), make('s3')])

      await expect(fileRefService.cleanupTempSessionSources(['s1', 's3'])).resolves.toBe(2)
      const remaining = await fileRefService.findByEntryId(entryId)
      expect(remaining.map((r) => r.sourceId)).toEqual(['s2'])
    })
  })

  describe('sweep helpers', () => {
    it('countByEntryIds counts refs per fileEntryId across persistent and temp refs', async () => {
      const idA = '019606a0-0000-7000-8000-00000000cc01' as FileEntryId
      const idB = '019606a0-0000-7000-8000-00000000cc02' as FileEntryId
      const idC = '019606a0-0000-7000-8000-00000000cc03' as FileEntryId
      const paintingId = await seedPainting()
      await seedEntry(idA)
      await seedEntry(idB)
      await seedEntry(idC)
      await fileRefService.createManyTempSessionRefs([
        { fileEntryId: idA, sourceId: 's1', role: 'pending' },
        { fileEntryId: idA, sourceId: 's2', role: 'pending' }
      ])
      await seedPaintingRef(idB, paintingId, 'output')

      const result = await fileRefService.countByEntryIds([idA, idB, idC])
      expect(result.get(idA)).toBe(2)
      expect(result.get(idB)).toBe(1)
      expect(result.has(idC)).toBe(false)
    })

    it('pruneMissingTempSessionRefs removes stale temp refs and keeps existing ones', async () => {
      const existing = '019606a0-0000-7000-8000-00000000cc04' as FileEntryId
      const missing = '019606a0-0000-7000-8000-00000000cc05' as FileEntryId
      await seedEntry(existing)
      await seedEntry(missing)
      await fileRefService.createManyTempSessionRefs([
        { fileEntryId: existing, sourceId: 's', role: 'pending' },
        { fileEntryId: missing, sourceId: 's', role: 'pending' }
      ])
      await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, missing))

      const removed = await fileRefService.pruneMissingTempSessionRefs(new Set([existing]))

      expect(removed).toBe(1)
      await expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 's' })).resolves.toEqual([
        expect.objectContaining({ fileEntryId: existing })
      ])
    })
  })
})
