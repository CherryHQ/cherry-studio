import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, jobFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { jobTable } from '@data/db/schemas/job'
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

  function fileEntryId(seed: number): FileEntryId {
    return `019606a0-0000-7000-8000-${seed.toString(16).padStart(12, '0')}`
  }

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

  async function seedJob(id = uuidv4()): Promise<string> {
    await dbh.db.insert(jobTable).values({
      id,
      type: 'image-generation.generate',
      status: 'running',
      queue: 'image-generation.test',
      scheduledAt: Date.now(),
      input: {}
    })
    return id
  }

  async function seedJobRef(fileEntryId: FileEntryId, sourceId: string, role: 'input' | 'mask'): Promise<void> {
    await dbh.db.insert(jobFileRefTable).values({ fileEntryId, sourceId, role })
  }

  describe('read aggregation', () => {
    it('findByEntryId returns refs across persistent tables and temp-session cache', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa01' as FileEntryId
      const paintingId = await seedPainting()
      const messageId = await seedChatMessage()
      await seedEntry(entryId)
      await seedPaintingRef(entryId, paintingId, 'output')
      await seedChatRef(entryId, messageId)
      fileRefService.createTempSessionRef({ fileEntryId: entryId, sourceId: 'session-A', role: 'pending' })

      const refs = fileRefService.findByEntryId(entryId)
      expect(refs).toHaveLength(3)
      expect(refs.every((r) => r.fileEntryId === entryId)).toBe(true)
      expect(refs.map((r) => r.sourceType).sort()).toEqual(['chat_message', 'painting', 'temp_session'])
    })

    it('findBySource reads persistent sources without owning their write path', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa02' as FileEntryId
      const paintingId = await seedPainting()
      await seedEntry(entryId)
      await seedPaintingRef(entryId, paintingId, 'input')

      expect(fileRefService.findBySource({ sourceType: 'painting', sourceId: paintingId })).toEqual([
        expect.objectContaining({ fileEntryId: entryId, sourceType: 'painting', sourceId: paintingId, role: 'input' })
      ])
    })

    it('findBySource returns empty array when source key has no refs', async () => {
      expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'no-such' })).toEqual([])
    })

    it('aggregates job refs (findByEntryId / findBySource) so job-held inputs are visible', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000aa03' as FileEntryId
      const jobId = await seedJob()
      await seedEntry(entryId)
      await seedJobRef(entryId, jobId, 'input')

      expect(fileRefService.findByEntryId(entryId)).toEqual([
        expect.objectContaining({ fileEntryId: entryId, sourceType: 'job', sourceId: jobId, role: 'input' })
      ])
      expect(fileRefService.findBySource({ sourceType: 'job', sourceId: jobId })).toEqual([
        expect.objectContaining({ fileEntryId: entryId, sourceType: 'job', sourceId: jobId, role: 'input' })
      ])
    })
  })

  describe('temp-session writes', () => {
    it('creates a single temp ref and returns it parsed', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb01' as FileEntryId
      await seedEntry(entryId)

      const ref = fileRefService.createTempSessionRef({
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

    it('rejects temp refs for missing file_entry rows', async () => {
      const missing = '019606a0-0000-7000-8000-00000000bb08' as FileEntryId

      expect(() =>
        fileRefService.createTempSessionRef({ fileEntryId: missing, sourceId: 'missing-entry', role: 'pending' })
      ).toThrow(`FileEntry not found: ${missing}`)
    })

    it('throws on duplicate temp ref (entryId, sourceId, role)', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb02' as FileEntryId
      await seedEntry(entryId)
      const values = { fileEntryId: entryId, sourceId: 'dup', role: 'pending' as const }
      fileRefService.createTempSessionRef(values)
      expect(() => fileRefService.createTempSessionRef(values)).toThrow()
    })

    it('createManyTempSessionRefs skips conflicting rows and returns inserted ones', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb03' as FileEntryId
      await seedEntry(entryId)
      const base = { fileEntryId: entryId, role: 'pending' as const }
      fileRefService.createTempSessionRef({ ...base, sourceId: 'one' })

      const result = fileRefService.createManyTempSessionRefs([
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
      fileRefService.createManyTempSessionRefs([
        { fileEntryId: entryA, sourceId: 'cleanup-A', role: 'pending' },
        { fileEntryId: entryB, sourceId: 'cleanup-A', role: 'pending' }
      ])

      expect(fileRefService.cleanupTempSessionSource('cleanup-A')).toBe(2)
      expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 'cleanup-A' })).toEqual([])
    })

    it('cleanupTempSessionSources removes temp refs across multiple sourceIds', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000bb06' as FileEntryId
      await seedEntry(entryId)
      const make = (sourceId: string) => ({ fileEntryId: entryId, sourceId, role: 'pending' as const })
      fileRefService.createManyTempSessionRefs([make('s1'), make('s2'), make('s3')])

      expect(fileRefService.cleanupTempSessionSources(['s1', 's3'])).toBe(2)
      const remaining = fileRefService.findByEntryId(entryId)
      expect(remaining.map((r) => r.sourceId)).toEqual(['s2'])
    })
  })

  describe('sweep helpers', () => {
    it('countByEntryIds counts refs across chat, painting, job, and temp-session sources', async () => {
      const idA = '019606a0-0000-7000-8000-00000000cc01' as FileEntryId
      const idB = '019606a0-0000-7000-8000-00000000cc02' as FileEntryId
      const idC = '019606a0-0000-7000-8000-00000000cc03' as FileEntryId
      const idD = '019606a0-0000-7000-8000-00000000cc06' as FileEntryId
      const idE = '019606a0-0000-7000-8000-00000000cc07' as FileEntryId
      const paintingId = await seedPainting()
      const secondPaintingId = await seedPainting()
      const messageId = await seedChatMessage()
      const jobId = await seedJob()
      await seedEntry(idA)
      await seedEntry(idB)
      await seedEntry(idC)
      await seedEntry(idD)
      await seedEntry(idE)
      fileRefService.createManyTempSessionRefs([
        { fileEntryId: idA, sourceId: 's1', role: 'pending' },
        { fileEntryId: idA, sourceId: 's2', role: 'pending' }
      ])
      await seedPaintingRef(idB, paintingId, 'output')
      await seedChatRef(idD, messageId)
      await seedPaintingRef(idD, secondPaintingId, 'input')
      await seedJobRef(idE, jobId, 'input')

      const result = fileRefService.countByEntryIds([idA, idB, idC, idD, idE])
      expect(result.get(idA)).toBe(2)
      expect(result.get(idB)).toBe(1)
      expect(result.has(idC)).toBe(false)
      expect(result.get(idD)).toBe(2)
      expect(result.get(idE)).toBe(1)
    })

    it('countByEntryIds chunks batches above the SQLite IN parameter cap', async () => {
      const ids = Array.from({ length: 501 }, (_, index) => fileEntryId(0xdd0000 + index))
      const firstId = ids[0]
      const boundaryId = ids[500]
      const paintingId = await seedPainting()
      const messageId = await seedChatMessage()
      await seedEntry(firstId)
      await seedEntry(boundaryId)
      await seedPaintingRef(firstId, paintingId, 'output')
      await seedChatRef(boundaryId, messageId)

      const result = fileRefService.countByEntryIds(ids)
      expect(result.get(firstId)).toBe(1)
      expect(result.get(boundaryId)).toBe(1)
      expect(result.size).toBe(2)
    })

    it('pruneMissingTempSessionRefs removes stale temp refs and keeps existing ones', async () => {
      const existing = '019606a0-0000-7000-8000-00000000cc04' as FileEntryId
      const missing = '019606a0-0000-7000-8000-00000000cc05' as FileEntryId
      await seedEntry(existing)
      await seedEntry(missing)
      fileRefService.createManyTempSessionRefs([
        { fileEntryId: existing, sourceId: 's', role: 'pending' },
        { fileEntryId: missing, sourceId: 's', role: 'pending' }
      ])
      await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, missing))

      const removed = fileRefService.pruneMissingTempSessionRefs(new Set([existing]))

      expect(removed).toBe(1)
      expect(fileRefService.findBySource({ sourceType: 'temp_session', sourceId: 's' })).toEqual([
        expect.objectContaining({ fileEntryId: existing })
      ])
    })
  })

  describe('countPersistentRefsByEntryIdTx', () => {
    it('counts across all persistent tables inside a tx', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee01' as FileEntryId
      const paintingId = await seedPainting()
      const messageId = await seedChatMessage()
      await seedEntry(entryId)
      await seedPaintingRef(entryId, paintingId, 'output')
      await seedChatRef(entryId, messageId)

      const n = application
        .get('DbService')
        .withWriteTx((tx) => fileRefService.countPersistentRefsByEntryIdTx(tx, entryId))

      expect(n).toBe(2)
    })

    it('returns 0 for an entry with no persistent refs', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee02' as FileEntryId
      await seedEntry(entryId)

      const n = application
        .get('DbService')
        .withWriteTx((tx) => fileRefService.countPersistentRefsByEntryIdTx(tx, entryId))

      expect(n).toBe(0)
    })
  })
})
