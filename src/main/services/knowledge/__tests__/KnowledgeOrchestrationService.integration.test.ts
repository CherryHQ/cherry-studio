import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_EMOJI,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
} from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createStoreMock, deleteStoreMock, enqueueMock, listMock, registerHandlerMock } = vi.hoisted(() => ({
  createStoreMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
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
      list: listMock,
      registerHandler: registerHandlerMock
    },
    KnowledgeVectorStoreService: {
      createStore: createStoreMock,
      deleteStore: deleteStoreMock,
      getStoreIfExists: vi.fn()
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

const { KnowledgeOrchestrationService } = await import('../KnowledgeOrchestrationService')

describe('KnowledgeOrchestrationService integration', () => {
  const dbh = setupTestDatabase()
  const embeddingModelId = createUniqueModelId('openai', 'text-embedding-3-small')

  beforeEach(async () => {
    vi.clearAllMocks()
    createStoreMock.mockResolvedValue({})
    deleteStoreMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
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
      id: 'group-1',
      entityType: 'knowledge',
      name: 'Legacy group',
      orderKey: 'a0'
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: 'source-kb',
      name: 'Legacy KB',
      groupId: 'group-1',
      emoji: DEFAULT_KNOWLEDGE_BASE_EMOJI,
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      threshold: null,
      documentCount: null,
      searchMode: DEFAULT_KNOWLEDGE_SEARCH_MODE,
      hybridAlpha: null
    })
    await dbh.db.insert(knowledgeItemTable).values([
      {
        id: 'source-root',
        baseId: 'source-kb',
        groupId: null,
        type: 'note',
        data: { source: 'source-root', content: 'root content' },
        status: 'idle',
        error: null
      },
      {
        id: 'source-child',
        baseId: 'source-kb',
        groupId: 'source-root',
        type: 'note',
        data: { source: 'source-child', content: 'child content' },
        status: 'idle',
        error: null
      }
    ])
  })

  it('restores a failed base into a new base and enqueues indexing for restored roots', async () => {
    const service = new KnowledgeOrchestrationService()

    const restoredBase = await service.restoreBase({
      sourceBaseId: 'source-kb',
      name: 'Legacy KB_bak',
      embeddingModelId,
      dimensions: 1536
    })

    expect(restoredBase).toMatchObject({
      name: 'Legacy KB_bak',
      groupId: 'group-1',
      dimensions: 1536,
      embeddingModelId,
      status: 'completed',
      error: null
    })
    expect(restoredBase.id).not.toBe('source-kb')
    expect(createStoreMock).toHaveBeenCalledWith(expect.objectContaining({ id: restoredBase.id }))

    const [sourceBase] = await dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, 'source-kb'))
    expect(sourceBase).toMatchObject({
      id: 'source-kb',
      groupId: 'group-1',
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
      { baseId: restoredBase.id, itemId: restoredItems[0].id, parentJobId: null },
      {
        idempotencyKey: `knowledge:${restoredBase.id}:${restoredItems[0].id}:index`,
        queue: `base.${restoredBase.id}`,
        parentId: undefined
      }
    )

    const sourceChildRows = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.id, 'source-child'))
    expect(sourceChildRows).toHaveLength(1)

    await service.reindexItems(restoredBase.id, [restoredItems[0].id])

    expect(enqueueMock).toHaveBeenLastCalledWith(
      'knowledge.reindex-subtree',
      { baseId: restoredBase.id, rootItemIds: [restoredItems[0].id] },
      {
        idempotencyKey: `knowledge:${restoredBase.id}:${restoredItems[0].id}:reindex`,
        queue: `base.${restoredBase.id}`
      }
    )

    const ungroupedRestoredItems = await dbh.db
      .select()
      .from(knowledgeItemTable)
      .where(isNull(knowledgeItemTable.groupId))
    expect(ungroupedRestoredItems.some((item) => item.baseId === restoredBase.id)).toBe(true)
  })
})
