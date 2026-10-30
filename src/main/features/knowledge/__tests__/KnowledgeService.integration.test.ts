import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { groupTable } from '@data/db/schemas/group'
import { jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { BaseService } from '@main/core/lifecycle'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  KnowledgeRelativePathSchema,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
} from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import type { PosixRelativeFilePath } from '@shared/utils/file'

import type * as KnowledgeItemsModule from '../items'
import type * as PathStorage from '../pathStorage'

const {
  getIndexStoreMock,
  getIndexStoreIfExistsMock,
  deleteMaterialsMock,
  deleteStoreMock,
  enqueueMock,
  enqueueTxMock,
  listMock,
  probeKnowledgeFileMock,
  registerHandlerMock,
  classifySourceMock
} = vi.hoisted(() => ({
  getIndexStoreMock: vi.fn(),
  getIndexStoreIfExistsMock: vi.fn(),
  deleteMaterialsMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  enqueueTxMock: vi.fn(),
  listMock: vi.fn(),
  probeKnowledgeFileMock: vi.fn(),
  registerHandlerMock: vi.fn(),
  classifySourceMock: vi.fn()
}))

// Runs the real source check unless a test holds it open.
vi.mock('../items', async (importOriginal) => {
  const actual = await importOriginal<typeof KnowledgeItemsModule>()
  classifySourceMock.mockImplementation(actual.classifyKnowledgeItemReacquireSource)
  return { ...actual, classifyKnowledgeItemReacquireSource: classifySourceMock }
})

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
      getIndexStore: getIndexStoreMock,
      deleteStore: deleteStoreMock,
      getIndexStoreIfExists: getIndexStoreIfExistsMock
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

vi.mock('../pathStorage', async () => ({
  ...(await vi.importActual<typeof PathStorage>('../pathStorage')),
  probeKnowledgeFile: probeKnowledgeFileMock
}))

const { KnowledgeService } = await import('../KnowledgeService')
const { knowledgeQueueName, toKnowledgeBaseId } = await import('../types')
const { knowledgeItemService } = await import('@data/services/KnowledgeItemService')
const { knowledgeBaseService } = await import('@data/services/KnowledgeBaseService')
const { jobService } = await import('@data/services/JobService')

const SOURCE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_GROUP_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_ROOT_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const SOURCE_CHILD_ITEM_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const EXTERNAL_CONNECTION_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const EXTERNAL_SOURCE_ID = '0198f3f2-7d1d-7abc-8def-123456789abc'
const EXTERNAL_ITEM_ID = '0198f3f2-7d1e-7abc-8def-123456789abc'
const EXTERNAL_DOCUMENT_ID = '0198f3f2-7d1f-7abc-8def-123456789abc'
const EXTERNAL_DIRECTORY_ID = '0198f3f2-7d20-7abc-8def-123456789abc'

describe('KnowledgeService integration', () => {
  const dbh = setupTestDatabase()
  const embeddingModelId = createUniqueModelId('openai', 'text-embedding-3-small')

  beforeEach(async () => {
    vi.clearAllMocks()
    // KnowledgeService extends the lifecycle BaseService singleton; reset so each test
    // can `new KnowledgeService()` without tripping the already-instantiated guard.
    BaseService.resetInstances()
    getIndexStoreMock.mockResolvedValue({})
    getIndexStoreIfExistsMock.mockReturnValue({ deleteMaterials: deleteMaterialsMock })
    deleteMaterialsMock.mockResolvedValue(undefined)
    deleteStoreMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    enqueueTxMock.mockReturnValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    listMock.mockResolvedValue([])
    probeKnowledgeFileMock.mockResolvedValue('readable')

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

  const seedExternalItem = async (options: {
    owned: boolean
    sourceState?: 'active' | 'paused'
    groupId?: string | null
    baseId?: string
  }) => {
    const baseId = options.baseId ?? SOURCE_BASE_ID
    await dbh.db.insert(knowledgeItemTable).values({
      id: EXTERNAL_ITEM_ID,
      baseId,
      groupId: options.groupId ?? null,
      type: 'external',
      data: {
        source: 'feishu://document/doc-1',
        title: 'External doc',
        relativePath: KnowledgeRelativePathSchema.parse('external/doc-1.md')
      },
      status: 'completed',
      error: null
    })

    if (!options.owned) return

    await dbh.db.insert(externalKnowledgeConnectionTable).values({
      id: EXTERNAL_CONNECTION_ID,
      provider: 'feishu',
      appId: 'cli_example',
      appCredentialSource: 'personal-agent',
      authorizationStatus: 'pending-authorization',
      credentialReference: 'cred_delete_enforcement'
    })
    await dbh.db.insert(externalKnowledgeSourceTable).values({
      id: EXTERNAL_SOURCE_ID,
      baseId,
      connectionId: EXTERNAL_CONNECTION_ID,
      provider: 'feishu',
      tenantId: 'tenant-delete',
      spaceId: 'space-delete',
      scope: { kind: 'space' },
      name: 'Delete enforcement source',
      state: options.sourceState ?? 'active',
      revision: 0
    })
    await dbh.db.insert(externalKnowledgeDocumentTable).values({
      id: EXTERNAL_DOCUMENT_ID,
      sourceId: EXTERNAL_SOURCE_ID,
      remoteObjectId: 'doc-1',
      title: 'External doc',
      originalUrl: 'https://example.feishu.cn/wiki/node-1',
      remoteRevision: '1',
      contentHash: 'hash-1',
      lastSeenAt: 1,
      availability: 'active',
      knowledgeItemId: EXTERNAL_ITEM_ID,
      currentWarning: null
    })
  }

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

  it.each([
    { scenario: 'disabling embeddings', targetModelId: null, dimensions: null },
    {
      scenario: 'switching embedding models',
      targetModelId: createUniqueModelId('openai', 'text-embedding-3-large'),
      dimensions: 3072
    }
  ])('preserves custom chunking when restoring after $scenario', async ({ targetModelId, dimensions }) => {
    if (targetModelId) {
      dbh.db
        .insert(userModelTable)
        .values({
          id: targetModelId,
          providerId: 'openai',
          modelId: 'text-embedding-3-large',
          presetModelId: 'text-embedding-3-large',
          name: 'text-embedding-3-large',
          orderKey: 'a2'
        })
        .run()
    }
    dbh.db
      .update(knowledgeBaseTable)
      .set({
        status: 'completed',
        error: null,
        embeddingModelId,
        dimensions: 1536,
        chunkStrategy: 'delimiter',
        chunkSeparator: '##',
        chunkSize: 777,
        chunkOverlap: 77
      })
      .where(eq(knowledgeBaseTable.id, SOURCE_BASE_ID))
      .run()
    dbh.db.update(knowledgeItemTable).set({ status: 'completed' }).run()
    const sourceBase = knowledgeBaseService.getById(SOURCE_BASE_ID)
    const service = new KnowledgeService()

    const { base: restoredBase } = await service.restoreBase({
      sourceBaseId: SOURCE_BASE_ID,
      name: 'Configured KB copy',
      embeddingModelId: targetModelId,
      dimensions
    })

    expect(knowledgeBaseService.getById(restoredBase.id)).toMatchObject({
      embeddingModelId: targetModelId,
      dimensions,
      chunkStrategy: 'delimiter',
      chunkSeparator: '##',
      chunkSize: 777,
      chunkOverlap: 77
    })
    expect(restoredBase.id).not.toBe(SOURCE_BASE_ID)
    expect(knowledgeItemService.getRootItemsByBaseId(restoredBase.id)).toHaveLength(1)
    expect(knowledgeBaseService.getById(SOURCE_BASE_ID)).toEqual(sourceBase)
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

  it('rejects deleting an external item with an active document owner', async () => {
    await seedExternalItem({ owned: true })
    const service = new KnowledgeService()

    await expect(service.deleteItems(SOURCE_BASE_ID, [EXTERNAL_ITEM_ID])).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    const [item] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, EXTERNAL_ITEM_ID))
    expect(item.status).toBe('completed')
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('keeps active document ownership blocking while the source is paused', async () => {
    await seedExternalItem({ owned: true, sourceState: 'paused' })
    const service = new KnowledgeService()

    await expect(service.deleteItems(SOURCE_BASE_ID, [EXTERNAL_ITEM_ID])).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('allows deleting an ownerless completed external item as static external content', async () => {
    await seedExternalItem({ owned: false })
    const service = new KnowledgeService()

    await expect(service.deleteItems(SOURCE_BASE_ID, [EXTERNAL_ITEM_ID])).resolves.toBeUndefined()

    const [item] = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, EXTERNAL_ITEM_ID))
    expect(item.status).toBe('deleting')
    expect(enqueueTxMock).toHaveBeenCalledTimes(1)
  })

  it('rolls back every selected item when a mixed delete contains managed external content', async () => {
    await seedExternalItem({ owned: true })
    const service = new KnowledgeService()

    await expect(service.deleteItems(SOURCE_BASE_ID, [SOURCE_ROOT_ITEM_ID, EXTERNAL_ITEM_ID])).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    const rows = await dbh.db
      .select({ id: knowledgeItemTable.id, status: knowledgeItemTable.status })
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, SOURCE_BASE_ID))
    const statusById = new Map(rows.map((row) => [row.id, row.status]))
    expect(statusById.get(SOURCE_ROOT_ITEM_ID)).toBe('processing')
    expect(statusById.get(SOURCE_CHILD_ITEM_ID)).toBe('processing')
    expect(statusById.get(EXTERNAL_ITEM_ID)).toBe('completed')
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  it('rejects deleting a directory whose subtree contains managed external content', async () => {
    await dbh.db.insert(knowledgeItemTable).values({
      id: EXTERNAL_DIRECTORY_ID,
      baseId: SOURCE_BASE_ID,
      groupId: null,
      type: 'directory',
      data: { source: '/external' },
      status: 'completed',
      error: null
    })
    await seedExternalItem({ owned: true, groupId: EXTERNAL_DIRECTORY_ID })
    const service = new KnowledgeService()

    await expect(service.deleteItems(SOURCE_BASE_ID, [EXTERNAL_DIRECTORY_ID])).rejects.toMatchObject({
      code: 'INVALID_OPERATION',
      message:
        'Invalid operation: deleteItems - Cannot delete 1 selected knowledge subtree containing content managed by an active document owner'
    })

    const rows = await dbh.db
      .select({ id: knowledgeItemTable.id, status: knowledgeItemTable.status })
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, SOURCE_BASE_ID))
    const statusById = new Map(rows.map((row) => [row.id, row.status]))
    expect(statusById.get(EXTERNAL_DIRECTORY_ID)).toBe('completed')
    expect(statusById.get(EXTERNAL_ITEM_ID)).toBe('completed')
    expect(enqueueTxMock).not.toHaveBeenCalled()
  })

  describe('reindex ownership admission', () => {
    const REINDEX_BASE_ID = '77777777-7777-4777-8777-777777777777'

    const seedReindexBase = async () => {
      await dbh.db.insert(knowledgeBaseTable).values({
        orderKey: 'a0',
        id: REINDEX_BASE_ID,
        name: 'Reindex KB',
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
    }

    it('allows reindexing an active-owned external leaf from its pinned snapshot', async () => {
      await seedReindexBase()
      await seedExternalItem({ owned: true, baseId: REINDEX_BASE_ID })
      const service = new KnowledgeService()

      await expect(service.reindexItems(REINDEX_BASE_ID, [EXTERNAL_ITEM_ID])).resolves.toBeUndefined()

      expect(probeKnowledgeFileMock).toHaveBeenCalled()
      expect(enqueueMock).toHaveBeenCalledWith(
        'knowledge.reindex-subtree',
        { baseId: REINDEX_BASE_ID, rootItemIds: [EXTERNAL_ITEM_ID] },
        expect.objectContaining({ queue: `base.${REINDEX_BASE_ID}` })
      )
    })

    it('allows reindexing an ownerless static external item', async () => {
      await seedReindexBase()
      await seedExternalItem({ owned: false, baseId: REINDEX_BASE_ID })
      const service = new KnowledgeService()

      await expect(service.reindexItems(REINDEX_BASE_ID, [EXTERNAL_ITEM_ID])).resolves.toBeUndefined()

      expect(probeKnowledgeFileMock).toHaveBeenCalled()
      expect(enqueueMock).toHaveBeenCalledWith(
        'knowledge.reindex-subtree',
        { baseId: REINDEX_BASE_ID, rootItemIds: [EXTERNAL_ITEM_ID] },
        expect.objectContaining({ queue: `base.${REINDEX_BASE_ID}` })
      )
    })
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

    it('rejects replacing a root whose subtree contains active-owned external content before artifact cleanup', async () => {
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
        id: EXTERNAL_DIRECTORY_ID,
        baseId: COMPLETED_BASE_ID,
        groupId: null,
        type: 'directory',
        data: { source: '/external', relativePath: KnowledgeRelativePathSchema.parse('external') },
        status: 'completed',
        error: null
      })
      await seedExternalItem({ owned: true, groupId: EXTERNAL_DIRECTORY_ID, baseId: COMPLETED_BASE_ID })
      const service = new KnowledgeService()

      await expect(
        service.addItems(COMPLETED_BASE_ID, [{ type: 'directory', data: { source: '/external' } }], 'replace')
      ).rejects.toMatchObject({ code: 'INVALID_OPERATION' })

      const rows = await baseRows()
      const statusById = new Map(rows.map(({ id, status }) => [id, status]))
      expect(statusById.get(EXTERNAL_DIRECTORY_ID)).toBe('completed')
      expect(statusById.get(EXTERNAL_ITEM_ID)).toBe('completed')
      expect(deleteMaterialsMock).not.toHaveBeenCalled()
      expect(enqueueMock).not.toHaveBeenCalled()
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
  describe('enableEmbeddingModel backfill', () => {
    const BM25_BASE_ID = '44444444-4444-4444-8444-444444444444'
    const FILE_ID = '0198f3f2-7d3a-7abc-8def-123456789abc'
    const NOTE_ID = '0198f3f2-7d3b-7abc-8def-123456789abc'
    const URL_ID = '0198f3f2-7d3c-7abc-8def-123456789abc'
    const DIR_ID = '0198f3f2-7d3d-7abc-8def-123456789abc'
    const CHILD_ID = '0198f3f2-7d3e-7abc-8def-123456789abc'
    const FAILED_URL_ID = '0198f3f2-7d3f-7abc-8def-123456789abc'
    const DELETING_NOTE_ID = '0198f3f2-7d40-7abc-8def-123456789abc'
    const LEAF_IDS = [FILE_ID, NOTE_ID, URL_ID, CHILD_ID]

    // Originals live under a path that does not exist, as if the user had moved them after importing.
    const seedBm25Base = async () => {
      await dbh.db.insert(knowledgeBaseTable).values({
        orderKey: 'a1',
        id: BM25_BASE_ID,
        name: 'BM25 KB',
        groupId: null,
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        rerankModelId: null,
        fileProcessorId: 'paddleocr',
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
        documentCount: null
      })
      const path = (value: string) => value as PosixRelativeFilePath
      const row = (id: string, fields: Omit<typeof knowledgeItemTable.$inferInsert, 'id' | 'baseId'>) => ({
        id,
        baseId: BM25_BASE_ID,
        ...fields
      })
      const completed = { status: 'completed', error: null } as const
      const rows: Array<typeof knowledgeItemTable.$inferInsert> = [
        row(FILE_ID, {
          ...completed,
          type: 'file',
          data: {
            source: '/moved/report.pdf',
            relativePath: path('report.pdf'),
            indexedRelativePath: path('report.md')
          }
        }),
        row(NOTE_ID, {
          ...completed,
          type: 'note',
          data: { source: 'Note', content: 'Note\nbody', relativePath: path('Note.md') }
        }),
        row(URL_ID, {
          ...completed,
          type: 'url',
          data: { source: 'https://example.com', url: 'https://example.com', relativePath: path('example.md') }
        }),
        row(DIR_ID, { ...completed, type: 'directory', data: { source: '/moved/docs', relativePath: path('docs') } }),
        row(CHILD_ID, {
          ...completed,
          groupId: DIR_ID,
          type: 'file',
          data: { source: '/moved/docs/a.md', relativePath: path('docs/a.md') }
        }),
        // Its first fetch failed, so it never captured a snapshot.
        row(FAILED_URL_ID, {
          status: 'failed',
          error: 'fetch failed',
          type: 'url',
          data: { source: 'https://unreachable.example', url: 'https://unreachable.example' }
        }),
        row(DELETING_NOTE_ID, {
          status: 'deleting',
          error: null,
          type: 'note',
          data: { source: 'Gone', content: 'Gone\nbody' }
        })
      ]
      await dbh.db.insert(knowledgeItemTable).values(rows)
    }

    const statusOf = async (id: string) =>
      (await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)))[0]
    const enqueuedTypes = () => enqueueMock.mock.calls.map(([type]) => type)
    const indexedItemIds = () =>
      enqueueMock.mock.calls
        .filter(([type]) => type === 'knowledge.index-documents')
        .map(([, payload]) => (payload as { itemId: string }).itemId)
    const enable = (service: InstanceType<typeof KnowledgeService>) =>
      service.enableEmbeddingModel(BM25_BASE_ID, { embeddingModelId, dimensions: 1536 })

    it('takes every completed leaf out of completed with the model, then indexes each from the in-base copy', async () => {
      await seedBm25Base()
      const service = new KnowledgeService()

      const updated = await enable(service)

      expect(updated.embeddingModelId).toBe(embeddingModelId)
      for (const id of [...LEAF_IDS, DIR_ID]) {
        expect((await statusOf(id)).status).toBe('processing')
      }
      expect((await statusOf(DELETING_NOTE_ID)).status).toBe('deleting')
      // Scheduling the snapshotless url would fetch it; a failed leaf keeps its own error instead.
      expect(await statusOf(FAILED_URL_ID)).toMatchObject({ status: 'failed', error: 'fetch failed' })
      // One regular indexing job per leaf, even though every original is gone; nothing re-acquires
      // from the originals and the pinned processed artifact is indexed without reprocessing.
      expect([...indexedItemIds()].sort()).toEqual([...LEAF_IDS].sort())
      expect(enqueuedTypes().every((type) => type === 'knowledge.index-documents')).toBe(true)
    })

    it('leaves no leaf completed without vectors when the app quits mid-backfill', async () => {
      await seedBm25Base()
      const service = new KnowledgeService()
      await enable(service)
      // One leaf finished indexing before the quit.
      await dbh.db.update(knowledgeItemTable).set({ status: 'completed' }).where(eq(knowledgeItemTable.id, NOTE_ID))

      // The next start's boot sweep (recoverInterruptedItems).
      knowledgeItemService.failInterruptedItems(KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED)

      expect((await statusOf(NOTE_ID)).status).toBe('completed')
      for (const id of [FILE_ID, URL_ID, CHILD_ID]) {
        expect(await statusOf(id)).toMatchObject({ status: 'failed', error: KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED })
      }
    })

    it('commits neither the model nor any status when activating the leaves fails', async () => {
      await seedBm25Base()
      const service = new KnowledgeService()
      const activate = vi.spyOn(knowledgeItemService, 'activateCompletedLeavesTx').mockImplementationOnce(() => {
        throw new Error('activation failed')
      })

      await expect(enable(service)).rejects.toThrow('activation failed')

      const [base] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, BM25_BASE_ID))
      expect(base.embeddingModelId).toBeNull()
      expect((await statusOf(FILE_ID)).status).toBe('completed')
      expect(enqueueMock).not.toHaveBeenCalled()
      activate.mockRestore()
    })

    it('fails only the leaf whose indexing job cannot be scheduled', async () => {
      await seedBm25Base()
      const service = new KnowledgeService()
      enqueueMock.mockImplementation((_type: string, payload: { itemId?: string }) => {
        if (payload.itemId === URL_ID) throw new Error('queue unavailable')
        return { id: 'job-1', snapshot: {}, finished: Promise.resolve({}) }
      })

      await enable(service)

      expect(await statusOf(URL_ID)).toMatchObject({
        status: 'failed',
        error: 'Failed to schedule knowledge item job: queue unavailable'
      })
      expect(indexedItemIds()).toEqual(expect.arrayContaining([FILE_ID, NOTE_ID, CHILD_ID]))
    })

    it('rejects while an item of the base is still running, before committing the model', async () => {
      await seedBm25Base()
      await dbh.db.update(knowledgeItemTable).set({ status: 'embedding' }).where(eq(knowledgeItemTable.id, NOTE_ID))
      const service = new KnowledgeService()

      await expect(enable(service)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      const [base] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, BM25_BASE_ID))
      expect(base.embeddingModelId).toBeNull()
      expect((await statusOf(FILE_ID)).status).toBe('completed')
      expect(enqueueMock).not.toHaveBeenCalled()
    })

    // A refresh's items stay `completed` until its job resets them, so the backfill must see the job itself.
    it('rejects while a reindex of the base is pending, and enables once it settles', async () => {
      await seedBm25Base()
      listMock.mockImplementation(async (filter) => jobService.list(filter))
      const reindexJob = (baseId: string) => ({
        type: 'knowledge.reindex-subtree',
        status: 'pending',
        queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
        scheduledAt: Date.now(),
        input: { baseId, rootItemIds: [FILE_ID] }
      })
      const [pending] = await dbh.db.insert(jobTable).values(reindexJob(BM25_BASE_ID)).returning()
      const service = new KnowledgeService()

      await expect(enable(service)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      const [base] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, BM25_BASE_ID))
      expect(base.embeddingModelId).toBeNull()
      expect((await statusOf(FILE_ID)).status).toBe('completed')
      expect(enqueueMock).not.toHaveBeenCalled()

      // Once it settles, a reindex pending on another base does not block this one.
      await dbh.db.update(jobTable).set({ status: 'completed' }).where(eq(jobTable.id, pending.id))
      await dbh.db.insert(jobTable).values(reindexJob(SOURCE_BASE_ID))
      await expect(enable(service)).resolves.toMatchObject({ embeddingModelId })
    })

    // Reindex awaits its source check before taking the lock, so the backfill can land in between.
    it('rejects a reindex whose items a backfill activated while their sources were checked', async () => {
      await seedBm25Base()
      let finishSourceCheck!: () => void
      classifySourceMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSourceCheck = () => resolve('rebuildable')
          })
      )
      const service = new KnowledgeService()

      const reindex = service.reindexItems(BM25_BASE_ID, [NOTE_ID])
      await enable(service)
      finishSourceCheck()

      await expect(reindex).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(enqueuedTypes()).not.toContain('knowledge.reindex-subtree')
    })

    it('rejects when an add starts an item while enabling waits for the base lock', async () => {
      await seedBm25Base()
      let finishPurge: (() => void) | undefined
      // A replace add holds the lock while it purges the old note's index entries.
      getIndexStoreIfExistsMock.mockReturnValueOnce({
        deleteMaterials: () =>
          new Promise<void>((resolve) => {
            finishPurge = resolve
          })
      })
      const service = new KnowledgeService()

      const add = service.addItems(
        BM25_BASE_ID,
        [{ type: 'note', data: { source: 'Note', content: 'Note\nnew' } }],
        'replace'
      )
      await vi.waitFor(() => expect(finishPurge).toBeDefined())
      const enabling = enable(service)
      finishPurge?.()
      await add

      await expect(enabling).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      const [base] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, BM25_BASE_ID))
      expect(base.embeddingModelId).toBeNull()
      expect((await statusOf(FILE_ID)).status).toBe('completed')
    })

    it('rejects a failed base before committing the model', async () => {
      const service = new KnowledgeService()

      await expect(
        service.enableEmbeddingModel(SOURCE_BASE_ID, { embeddingModelId, dimensions: 1536 })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Cannot enableEmbeddingModel failed knowledge base'
      })

      const [base] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, SOURCE_BASE_ID))
      expect(base.embeddingModelId).toBeNull()
      expect(enqueueMock).not.toHaveBeenCalled()
    })
  })
})
