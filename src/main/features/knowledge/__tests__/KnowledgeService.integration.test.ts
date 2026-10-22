import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { groupTable } from '@data/db/schemas/group'
import { jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { jobService } from '@data/services/JobService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { runStartupRecovery } from '@main/core/job/runtime/recovery'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
} from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const {
  findIncompleteMaterialsMock,
  getIndexStoreMock,
  deleteStoreMock,
  enqueueMock,
  enqueueTxMock,
  listMock,
  registerHandlerMock
} = vi.hoisted(() => ({
  findIncompleteMaterialsMock: vi.fn(),
  getIndexStoreMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  enqueueTxMock: vi.fn(),
  listMock: vi.fn(),
  registerHandlerMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: vi.fn(),
      cancelMany: vi.fn(),
      enqueue: enqueueMock,
      enqueueTx: enqueueTxMock,
      list: listMock,
      registerHandler: registerHandlerMock
    },
    KnowledgeVectorStoreService: {
      findIncompleteMaterials: findIncompleteMaterialsMock,
      getIndexStore: getIndexStoreMock,
      deleteStore: deleteStoreMock,
      getIndexStoreIfExists: vi.fn()
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

const { KnowledgeService } = await import('../KnowledgeService')
const { KnowledgeIngestionService } = await import('../ingestion/KnowledgeIngestionService')
const { createReindexSubtreeJobHandler } = await import('../tasks/reindexSubtreeJobHandler')

const SOURCE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_GROUP_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_ROOT_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const SOURCE_CHILD_ITEM_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'

describe('KnowledgeService integration', () => {
  const dbh = setupTestDatabase()
  const embeddingModelId = createUniqueModelId('openai', 'text-embedding-3-small')

  beforeEach(async () => {
    vi.clearAllMocks()
    // KnowledgeService extends the lifecycle BaseService singleton; reset so each test
    // can `new KnowledgeService()` without tripping the already-instantiated guard.
    BaseService.resetInstances()
    getIndexStoreMock.mockResolvedValue({})
    findIncompleteMaterialsMock.mockReset().mockReturnValue([])
    deleteStoreMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    enqueueTxMock.mockReturnValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    listMock.mockResolvedValue([])

    const [providerOrderKey, embeddingModelOrderKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      orderKey: providerOrderKey
    })
    await dbh.db.insert(userModelTable).values({
      id: embeddingModelId,
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      presetModelId: 'text-embedding-3-small',
      name: 'text-embedding-3-small',
      isEnabled: true,
      isHidden: false,
      orderKey: embeddingModelOrderKey
    })
    await dbh.db.insert(groupTable).values({
      id: SOURCE_GROUP_ID,
      entityType: 'knowledge',
      name: 'Legacy group',
      orderKey: 'a0'
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      orderKey: 'a0',
      id: SOURCE_BASE_ID,
      name: 'Legacy KB',
      groupId: SOURCE_GROUP_ID,
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      documentCount: null
    })
    await dbh.db.insert(knowledgeItemTable).values([
      {
        id: SOURCE_ROOT_ITEM_ID,
        baseId: SOURCE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'source-root', content: 'root content' },
        status: 'processing',
        error: null
      },
      {
        id: SOURCE_CHILD_ITEM_ID,
        baseId: SOURCE_BASE_ID,
        groupId: SOURCE_ROOT_ITEM_ID,
        type: 'note',
        data: { source: 'source-child', content: 'child content' },
        status: 'processing',
        error: null
      }
    ])
  })

  describe('first embedding backfill recovery', () => {
    const patch = { embeddingModelId, dimensions: 1536 }

    beforeEach(() => {
      dbh.db.update(knowledgeBaseTable).set({ status: 'completed', error: null }).run()
      dbh.db.update(knowledgeItemTable).set({ status: 'completed', groupId: null }).run()
      enqueueTxMock.mockImplementation((tx, type, input, options) => {
        const snapshot = jobService.createTx(tx, {
          type,
          input,
          queue: options.queue,
          status: 'pending',
          scheduledAt: Date.now(),
          attempt: 0,
          maxAttempts: 1,
          metadata: {},
          cancelRequested: false
        })
        return { id: snapshot.id, snapshot, finished: Promise.resolve(snapshot) }
      })
    })

    it.each(['pending', 'running'] as const)(
      'recovers an abandoned %s backfill without losing completed items',
      async (status) => {
        const lock = new KeyedMutex()
        const ingestion = new KnowledgeIngestionService(lock)
        await ingestion.enableEmbeddingModel(SOURCE_BASE_ID, patch)
        expect(knowledgeItemService.getItemsByBaseId(SOURCE_BASE_ID).map((item) => item.status)).toEqual([
          'processing',
          'processing'
        ])
        dbh.db.update(jobTable).set({ status }).run()
        if (status === 'running') knowledgeItemService.updateStatus(SOURCE_ROOT_ITEM_ID, 'completed')

        runStartupRecovery(
          new Map([['knowledge.reindex-subtree', createReindexSubtreeJobHandler(lock, ingestion) as JobHandler]]),
          () => false
        )
        ingestion.recoverInterruptedItems()

        expect(jobService.list().map((job) => job.status)).toEqual(['cancelled'])
        expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID)).toMatchObject({
          status: 'failed',
          error: 'indexing_interrupted'
        })
        expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID).status).toBe(
          status === 'running' ? 'completed' : 'failed'
        )
        expect(dbh.db.select().from(knowledgeBaseTable).get()?.embeddingModelId).toBe(embeddingModelId)
      }
    )

    it('rolls back model, items and job when transactional enqueue fails', async () => {
      const enqueue = enqueueTxMock.getMockImplementation()!
      enqueueTxMock.mockImplementation((...args) => {
        enqueue(...args)
        throw new Error('synthetic enqueue failure')
      })
      await expect(new KnowledgeService().enableEmbeddingModel(SOURCE_BASE_ID, patch)).rejects.toThrow(
        'synthetic enqueue failure'
      )
      expect(dbh.db.select().from(knowledgeBaseTable).get()?.embeddingModelId).toBeNull()
      expect(knowledgeItemService.getItemsByBaseId(SOURCE_BASE_ID).every((item) => item.status === 'completed')).toBe(
        true
      )
      expect(jobService.list()).toEqual([])
    })

    it('rejects changes during admission without committing the model', async () => {
      const lock = new KeyedMutex()
      const gate = Promise.withResolvers<void>()
      const held = lock.runExclusive(SOURCE_BASE_ID, () => gate.promise)
      const enabling = new KnowledgeIngestionService(lock).enableEmbeddingModel(SOURCE_BASE_ID, patch)
      knowledgeItemService.updateStatus(SOURCE_CHILD_ITEM_ID, 'deleting')
      gate.resolve()
      await held
      await expect(enabling).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(dbh.db.select().from(knowledgeBaseTable).get()?.embeddingModelId).toBeNull()
      expect(jobService.list()).toEqual([])
    })

    it('rejects a repeated setup without creating another job', async () => {
      const service = new KnowledgeService()
      await service.enableEmbeddingModel(SOURCE_BASE_ID, patch)
      await expect(service.enableEmbeddingModel(SOURCE_BASE_ID, patch)).rejects.toThrow()
      expect(jobService.list()).toHaveLength(1)
    })

    it('sets up an empty base without a job and excludes deleting items', async () => {
      dbh.db.update(knowledgeItemTable).set({ status: 'deleting' }).run()
      const base = await new KnowledgeService().enableEmbeddingModel(SOURCE_BASE_ID, patch)
      expect(base.embeddingModelId).toBe(embeddingModelId)
      expect(jobService.list()).toEqual([])
      expect(
        dbh.db
          .select()
          .from(knowledgeItemTable)
          .all()
          .every((item) => item.status === 'deleting')
      ).toBe(true)
    })

    it('marks only completed leaves with incomplete embeddings and leaves successful and failed siblings alone', async () => {
      dbh.db.update(knowledgeBaseTable).set(patch).run()
      findIncompleteMaterialsMock.mockReturnValue([SOURCE_CHILD_ITEM_ID])
      const service = new KnowledgeService()
      expect(await service.checkEmbeddingIntegrity(SOURCE_BASE_ID)).toEqual({ status: 'checked', changedCount: 1 })
      expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID).status).toBe('completed')
      expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID)).toMatchObject({
        status: 'failed',
        error: 'embedding_index_incomplete'
      })
      expect(await service.checkEmbeddingIntegrity(SOURCE_BASE_ID)).toEqual({ status: 'checked', changedCount: 0 })
      expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID).status).toBe('failed')
    })

    it('does not scan BM25 bases or mark items failed while a job is still active', async () => {
      const service = new KnowledgeService()
      expect(await service.checkEmbeddingIntegrity(SOURCE_BASE_ID)).toEqual({
        status: 'not_applicable',
        changedCount: 0
      })
      await service.enableEmbeddingModel(SOURCE_BASE_ID, patch)
      knowledgeItemService.updateStatus(SOURCE_ROOT_ITEM_ID, 'completed')
      expect(await service.checkEmbeddingIntegrity(SOURCE_BASE_ID)).toEqual({ status: 'deferred', changedCount: 0 })
      expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID).status).toBe('completed')
      expect(findIncompleteMaterialsMock).not.toHaveBeenCalled()
    })

    it('leaves item states intact when the index cannot be inspected', async () => {
      dbh.db.update(knowledgeBaseTable).set(patch).run()
      findIncompleteMaterialsMock.mockImplementation(() => {
        throw new Error('unreadable index')
      })
      await expect(new KnowledgeService().checkEmbeddingIntegrity(SOURCE_BASE_ID)).rejects.toThrow('unreadable index')
      expect(knowledgeItemService.getItemsByBaseId(SOURCE_BASE_ID).every((item) => item.status === 'completed')).toBe(
        true
      )
    })
  })

  it('rolls up incomplete children without failing completed siblings', async () => {
    const siblingId = '0198f3f2-7d1c-7abc-8def-123456789abc'
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'completed', error: null, embeddingModelId, dimensions: 1536 })
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({ type: 'directory', status: 'completed', data: { source: '/synthetic-directory' } })
      .where(eq(knowledgeItemTable.id, SOURCE_ROOT_ITEM_ID))
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({ status: 'completed' })
      .where(eq(knowledgeItemTable.id, SOURCE_CHILD_ITEM_ID))
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: siblingId,
        baseId: SOURCE_BASE_ID,
        groupId: SOURCE_ROOT_ITEM_ID,
        type: 'note',
        data: { source: 'good', content: 'complete sibling' },
        status: 'completed'
      })
      .run()
    findIncompleteMaterialsMock.mockReturnValue([SOURCE_CHILD_ITEM_ID])
    await new KnowledgeService().checkEmbeddingIntegrity(SOURCE_BASE_ID)
    expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID).status).toBe('failed')
    expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID).status).toBe('failed')
    expect(knowledgeItemService.getById(siblingId).status).toBe('completed')
  })

  it('inspects every batch when the base has more than 500 completed leaves', async () => {
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'completed', error: null, embeddingModelId, dimensions: 1536 })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values(
        Array.from({ length: 501 }, (_, index) => ({
          id: `0198f3f2-7d1d-7abc-8def-${String(index).padStart(12, '0')}`,
          baseId: SOURCE_BASE_ID,
          type: 'note' as const,
          data: { source: `note-${index}`, content: 'synthetic text' },
          status: 'completed' as const
        }))
      )
      .run()
    findIncompleteMaterialsMock.mockImplementation((_baseId: string, ids: string[]) => ids)
    expect(await new KnowledgeService().checkEmbeddingIntegrity(SOURCE_BASE_ID)).toEqual({
      status: 'checked',
      changedCount: 501
    })
    expect(knowledgeItemService.getCompletedLeafIds(SOURCE_BASE_ID)).toEqual([])
    expect(findIncompleteMaterialsMock.mock.calls.every(([, ids]) => ids.length <= 500)).toBe(true)
  })

  it('settles only active members of an interrupted subtree', () => {
    dbh.db
      .update(knowledgeItemTable)
      .set({ type: 'directory', status: 'preparing', data: { source: '/synthetic-directory' } })
      .where(eq(knowledgeItemTable.id, SOURCE_ROOT_ITEM_ID))
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({ status: 'completed' })
      .where(eq(knowledgeItemTable.id, SOURCE_CHILD_ITEM_ID))
      .run()
    knowledgeItemService.failActiveSubtrees(SOURCE_BASE_ID, [SOURCE_ROOT_ITEM_ID], 'indexing_interrupted')
    expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID).status).toBe('failed')
    expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID).status).toBe('completed')
  })

  it('fails an activated backfill root when its source disappears before reset', async () => {
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'completed', error: null, embeddingModelId, dimensions: 1536 })
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({
        type: 'file',
        status: 'processing',
        data: { source: '/nonexistent-issue22365/source.txt', relativePath: 'source.txt' as PosixRelativeFilePath }
      })
      .where(eq(knowledgeItemTable.id, SOURCE_ROOT_ITEM_ID))
      .run()
    dbh.db
      .update(knowledgeItemTable)
      .set({ groupId: null, status: 'completed' })
      .where(eq(knowledgeItemTable.id, SOURCE_CHILD_ITEM_ID))
      .run()
    const lock = new KeyedMutex()
    const handler = createReindexSubtreeJobHandler(lock, new KnowledgeIngestionService(lock))
    await handler.execute({
      jobId: 'synthetic-reindex',
      input: { baseId: SOURCE_BASE_ID, rootItemIds: [SOURCE_ROOT_ITEM_ID] },
      attempt: 1,
      parentId: null,
      signal: new AbortController().signal,
      metadata: {},
      patchMetadata: vi.fn(),
      reportProgress: vi.fn(),
      logger: loggerService.withContext('backfill-test')
    })
    expect(knowledgeItemService.getById(SOURCE_ROOT_ITEM_ID)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Source is no longer available')
    })
    expect(knowledgeItemService.getById(SOURCE_CHILD_ITEM_ID).status).toBe('completed')
  })

  it('restores a failed base into a new base and enqueues indexing for restored roots', async () => {
    const service = new KnowledgeService()

    const { base: restoredBase, skippedMissingSourceCount } = await service.restoreBase({
      sourceBaseId: SOURCE_BASE_ID,
      name: 'Legacy KB_bak',
      embeddingModelId,
      dimensions: 1536
    })

    // All of this base's sources are present, so nothing is skipped.
    expect(skippedMissingSourceCount).toBe(0)
    expect(restoredBase).toMatchObject({
      name: 'Legacy KB_bak',
      groupId: SOURCE_GROUP_ID,
      dimensions: 1536,
      embeddingModelId,
      status: 'completed',
      error: null
    })
    expect(restoredBase.id).not.toBe(SOURCE_BASE_ID)
    expect(getIndexStoreMock).toHaveBeenCalledWith(expect.objectContaining({ id: restoredBase.id }))

    const [sourceBase] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, SOURCE_BASE_ID))
    expect(sourceBase).toMatchObject({
      id: SOURCE_BASE_ID,
      groupId: SOURCE_GROUP_ID,
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
    })

    const restoredItems = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, restoredBase.id))
    expect(restoredItems).toHaveLength(1)
    expect(restoredItems[0]).toMatchObject({
      baseId: restoredBase.id,
      groupId: null,
      type: 'note',
      data: { source: 'source-root', content: 'root content' },
      status: 'processing',
      error: null
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      { baseId: restoredBase.id, itemId: restoredItems[0].id },
      {
        idempotencyKey: `knowledge:${restoredBase.id}:${restoredItems[0].id}:index`,
        queue: `base.${restoredBase.id}`,
        parentId: undefined
      }
    )

    const sourceChildRows = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.id, SOURCE_CHILD_ITEM_ID))
    expect(sourceChildRows).toHaveLength(1)

    await expect(service.reindexItems(restoredBase.id, [restoredItems[0].id])).rejects.toMatchObject({
      message: 'Cannot reindex knowledge item until the entire subtree is completed or failed'
    })
    expect(enqueueMock).toHaveBeenCalledTimes(1)

    const ungroupedRestoredItems = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(isNull(knowledgeItemTable.groupId))
    expect(ungroupedRestoredItems.some((item) => item.baseId === restoredBase.id)).toBe(true)
  })

  it('rolls back the deleting status when enqueueTx fails inside deleteItems', async () => {
    const service = new KnowledgeService()
    enqueueTxMock.mockImplementationOnce(() => {
      throw new Error('enqueue failed')
    })

    await expect(service.deleteItems(SOURCE_BASE_ID, [SOURCE_ROOT_ITEM_ID])).rejects.toThrow('enqueue failed')

    const [rootRow] = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.id, SOURCE_ROOT_ITEM_ID))
    expect(rootRow.status).toBe('processing')
  })

  describe('addItems conflict resolution', () => {
    const COMPLETED_BASE_ID = '33333333-3333-4333-8333-333333333333'
    const EXISTING_NOTE_ID = '0198f3f2-7d2a-7abc-8def-123456789abc'

    const seedCompletedBaseWithNote = async () => {
      await dbh.db.insert(knowledgeBaseTable).values({
        orderKey: 'a0',
        id: COMPLETED_BASE_ID,
        name: 'Active KB',
        groupId: null,
        dimensions: 1536,
        embeddingModelId,
        status: 'completed',
        error: null,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
        documentCount: null
      })
      await dbh.db.insert(knowledgeItemTable).values({
        id: EXISTING_NOTE_ID,
        baseId: COMPLETED_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'Doc A', content: 'Doc A\noriginal body' },
        status: 'completed',
        error: null
      })
    }

    const noteInput = (content: string) => ({
      type: 'note' as const,
      data: { source: content.split('\n')[0], content }
    })

    // A note drafted in the dialog carries a title independent of its body, so the two can differ.
    const titledNoteInput = (title: string, content: string) => ({
      type: 'note' as const,
      data: { source: title, content }
    })

    const baseRows = () =>
      dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.baseId, COMPLETED_BASE_ID))

    it('detect reports a same-name conflict and adds nothing', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(COMPLETED_BASE_ID, [noteInput('Doc A\nnew body')], 'detect')

      expect(result).toEqual({ status: 'conflicts', conflicts: [{ type: 'note', title: 'Doc A' }] })
      const rows = await baseRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(EXISTING_NOTE_ID)
      expect(enqueueMock).not.toHaveBeenCalled()
    })

    it('detect adds the item when nothing collides', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(COMPLETED_BASE_ID, [noteInput('Doc B\nbody')], 'detect')

      expect(result).toEqual({ status: 'added' })
      expect(await baseRows()).toHaveLength(2)
    })

    it('replace purges the conflicting existing item and adds the incoming one', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(COMPLETED_BASE_ID, [noteInput('Doc A\nreplacement body')], 'replace')

      expect(result).toEqual({ status: 'added' })
      const rows = await baseRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).not.toBe(EXISTING_NOTE_ID)
      expect((rows[0].data as { content: string }).content).toBe('Doc A\nreplacement body')
    })

    it('does not collide when the titles differ, even though both bodies open with the same line', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(COMPLETED_BASE_ID, [titledNoteInput('Doc B', 'Doc A\nnew body')], 'detect')

      expect(result).toEqual({ status: 'added' })
      expect(await baseRows()).toHaveLength(2)
    })

    it('replace leaves a differently-titled note alone even when both bodies open with the same line', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(
        COMPLETED_BASE_ID,
        [titledNoteInput('Doc B', 'Doc A\nreplacement body')],
        'replace'
      )

      expect(result).toEqual({ status: 'added' })
      const rows = await baseRows()
      expect(rows).toHaveLength(2)
      // The whole point: "Doc A" must survive being told to replace "Doc B".
      expect(rows.some((row) => row.id === EXISTING_NOTE_ID)).toBe(true)
    })

    it('collides on a shared title even when the bodies open with different lines', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(
        COMPLETED_BASE_ID,
        [titledNoteInput('Doc A', 'a totally different opening line\nbody')],
        'detect'
      )

      expect(result).toEqual({ status: 'conflicts', conflicts: [{ type: 'note', title: 'Doc A' }] })
      expect(await baseRows()).toHaveLength(1)
    })

    it('replace purges the same-titled note even though the bodies open with different lines', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      // `detect` and `replace` read different halves of the resolution, so reporting the collision
      // does not prove the purge targets the right row.
      const result = await service.addItems(
        COMPLETED_BASE_ID,
        [titledNoteInput('Doc A', 'a totally different opening line\nreplacement body')],
        'replace'
      )

      expect(result).toEqual({ status: 'added' })
      const rows = await baseRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).not.toBe(EXISTING_NOTE_ID)
    })

    it('defaults to rename (keep all) when no strategy is given, adding alongside the existing item', async () => {
      await seedCompletedBaseWithNote()
      const service = new KnowledgeService()

      const result = await service.addItems(COMPLETED_BASE_ID, [noteInput('Doc A\nanother body')])

      expect(result).toEqual({ status: 'added' })
      const rows = await baseRows()
      expect(rows).toHaveLength(2)
      expect(rows.some((row) => row.id === EXISTING_NOTE_ID)).toBe(true)
    })
  })
})
