import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  type KnowledgeBase,
  type KnowledgeItemOf
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelManyMock,
  cancelMock,
  createStoreMock,
  deleteStoreMock,
  enqueueMock,
  getStoreIfExistsMock,
  knowledgeBaseCreateMock,
  knowledgeBaseDeleteMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetDeletingRootGroupsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetItemsByBaseIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  registerHandlerMock,
  vectorDeleteByIdAndExternalIdMock,
  vectorListByExternalIdMock,
  vectorQueryMock
} = vi.hoisted(() => ({
  cancelManyMock: vi.fn(),
  cancelMock: vi.fn(),
  createStoreMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  knowledgeBaseCreateMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetDeletingRootGroupsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  registerHandlerMock: vi.fn(),
  vectorDeleteByIdAndExternalIdMock: vi.fn(),
  vectorListByExternalIdMock: vi.fn(),
  vectorQueryMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      cancelMany: cancelManyMock,
      enqueue: enqueueMock,
      list: vi.fn().mockResolvedValue([]),
      registerHandler: registerHandlerMock
    },
    KnowledgeVectorStoreService: {
      createStore: createStoreMock,
      deleteStore: deleteStoreMock,
      getStoreIfExists: getStoreIfExistsMock
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

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {
    ipcHandle = vi.fn()
    registerDisposable = vi.fn((disposableOrFn: { dispose: () => void } | (() => void)) => {
      return typeof disposableOrFn === 'function' ? { dispose: disposableOrFn } : disposableOrFn
    })
  }

  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    create: knowledgeBaseCreateMock,
    delete: knowledgeBaseDeleteMock,
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    create: knowledgeItemCreateMock,
    delete: knowledgeItemDeleteMock,
    getDeletingRootGroups: knowledgeItemGetDeletingRootGroupsMock,
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock,
    getItemsByBaseId: knowledgeItemGetItemsByBaseIdMock,
    setSubtreeStatus: knowledgeItemSetSubtreeStatusMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('ai', () => ({
  embedMany: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })
}))

vi.mock('../utils/model/embedding', () => ({
  getEmbedModel: vi.fn(() => ({ modelId: 'mock-embed' }))
}))

vi.mock('../rerank/rerank', () => ({
  rerankKnowledgeSearchResults: vi.fn(async (_base, _query, results) => results)
}))

const { KnowledgeOrchestrationService } = await import('../KnowledgeOrchestrationService')

const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const DELETING_NOTE_ITEM_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const MISSING_NOTE_ITEM_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    emoji: '📁',
    dimensions: 3,
    embeddingModelId: 'provider::embed',
    rerankModelId: null,
    fileProcessorId: null,
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    threshold: undefined,
    documentCount: 10,
    searchMode: 'default',
    hybridAlpha: undefined,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

function createNoteItem(
  id = 'note-1',
  baseId = 'kb-1',
  groupId: string | null = null,
  status: KnowledgeItemOf<'note'>['status'] = 'idle'
): KnowledgeItemOf<'note'> {
  const lifecycle =
    status === 'failed' ? ({ status, error: `failed ${id}` } as const) : ({ status, error: null } as const)

  return {
    id,
    baseId,
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(id = 'dir-1', groupId: string | null = null): KnowledgeItemOf<'directory'> {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    status: 'idle',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function expectFailedBaseGuard(error: unknown, operation: string) {
  expect(isDataApiError(error)).toBe(true)
  expect(error).toMatchObject({
    code: ErrorCode.VALIDATION_ERROR,
    message: `Cannot ${operation} failed knowledge base`
  })
}

const createdItemBaseIds = new Map<string, string>()

describe('KnowledgeOrchestrationService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    createdItemBaseIds.clear()
    knowledgeBaseCreateMock.mockResolvedValue(createBase())
    knowledgeBaseDeleteMock.mockResolvedValue(undefined)
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemCreateMock.mockImplementation(async (baseId: string, input: { data: { source: string } }) => {
      createdItemBaseIds.set(input.data.source, baseId)
      return createNoteItem(input.data.source, baseId)
    })
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValue([])
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      return createNoteItem(id, createdItemBaseIds.get(id) ?? 'kb-1')
    })
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([])
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) =>
        options.leafOnly ? [createNoteItem('note-1')] : []
    )
    knowledgeItemSetSubtreeStatusMock.mockResolvedValue(['note-1'])
    knowledgeItemUpdateStatusMock.mockImplementation(async (id: string, status: KnowledgeItemOf<'note'>['status']) => {
      return createNoteItem(id, createdItemBaseIds.get(id) ?? 'kb-1', null, status)
    })
    enqueueMock.mockResolvedValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    createStoreMock.mockResolvedValue({
      deleteByIdAndExternalId: vectorDeleteByIdAndExternalIdMock,
      listByExternalId: vectorListByExternalIdMock,
      query: vectorQueryMock
    })
    vectorListByExternalIdMock.mockResolvedValue([])
    vectorQueryMock.mockResolvedValue({ nodes: [], similarities: [] })
  })

  it('uses WhenReady phase and depends on same-phase runtime services', () => {
    expect(getPhase(KnowledgeOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeOrchestrationService)).toEqual(['KnowledgeVectorStoreService', 'FileManager'])
  })

  it('registers formal knowledge job handlers and caller-facing IPC handlers', () => {
    const service = new KnowledgeOrchestrationService()

    ;(service as unknown as { onInit: () => void }).onInit()

    expect(registerHandlerMock.mock.calls.map((call) => call[0])).toEqual([
      'knowledge.prepare-root',
      'knowledge.index-documents',
      'knowledge.delete-subtree',
      'knowledge.reindex-subtree'
    ])
    expect(
      (service as unknown as { ipcHandle: ReturnType<typeof vi.fn> }).ipcHandle.mock.calls.map((call) => call[0])
    ).toEqual([
      IpcChannel.KnowledgeRuntime_CreateBase,
      IpcChannel.KnowledgeRuntime_RestoreBase,
      IpcChannel.KnowledgeRuntime_DeleteBase,
      IpcChannel.KnowledgeRuntime_AddItems,
      IpcChannel.KnowledgeRuntime_DeleteItems,
      IpcChannel.KnowledgeRuntime_ReindexItems,
      IpcChannel.KnowledgeRuntime_Search,
      IpcChannel.KnowledgeRuntime_ListItemChunks,
      IpcChannel.KnowledgeRuntime_DeleteItemChunk
    ])
  })

  it('recovers deleting roots by enqueueing delete cleanup jobs after all services are ready', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValueOnce([
      { baseId: 'kb-1', rootItemIds: ['note-1'] },
      { baseId: 'kb-2', rootItemIds: ['dir-1', 'note-2'] }
    ])

    await (service as unknown as { onAllReady: () => Promise<void> }).onAllReady()

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['note-1'] },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:note-1:delete',
        queue: 'base.kb-1'
      })
    )
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.delete-subtree',
      { baseId: 'kb-2', rootItemIds: ['dir-1', 'note-2'] },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-2:dir-1,note-2:delete',
        queue: 'base.kb-2'
      })
    )
  })

  it('recovers deleting roots in bounded chunks', async () => {
    const service = new KnowledgeOrchestrationService()
    const rootItemIds = Array.from({ length: 501 }, (_, index) => `note-${index + 1}`)
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValueOnce([{ baseId: 'kb-1', rootItemIds }])

    await (service as unknown as { onAllReady: () => Promise<void> }).onAllReady()

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock).toHaveBeenNthCalledWith(
      1,
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: rootItemIds.slice(0, 500) },
      expect.objectContaining({
        idempotencyKey: `knowledge:kb-1:${rootItemIds.slice(0, 500).sort().join(',')}:delete`,
        queue: 'base.kb-1'
      })
    )
    expect(enqueueMock).toHaveBeenNthCalledWith(
      2,
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['note-501'] },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:note-501:delete',
        queue: 'base.kb-1'
      })
    )
  })

  it('keeps recovering other deleting roots when one recovery enqueue fails', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValueOnce([
      { baseId: 'kb-1', rootItemIds: ['note-1'] },
      { baseId: 'kb-2', rootItemIds: ['note-2'] }
    ])
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed')).mockResolvedValueOnce({
      id: 'job-2',
      snapshot: {},
      finished: Promise.resolve({})
    })

    await expect((service as unknown as { onAllReady: () => Promise<void> }).onAllReady()).resolves.toBeUndefined()

    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })

  it('retries deleting recovery when the initial scan fails', async () => {
    vi.useFakeTimers()
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetDeletingRootGroupsMock
      .mockRejectedValueOnce(new Error('scan failed'))
      .mockResolvedValueOnce([{ baseId: 'kb-1', rootItemIds: ['note-1'] }])

    await (service as unknown as { onAllReady: () => Promise<void> }).onAllReady()
    expect(enqueueMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['note-1'] },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:note-1:delete',
        queue: 'base.kb-1'
      })
    )
  })

  it('retries deleting recovery when a cleanup enqueue fails', async () => {
    vi.useFakeTimers()
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValue([{ baseId: 'kb-1', rootItemIds: ['note-1'] }])
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed')).mockResolvedValueOnce({
      id: 'job-retry',
      snapshot: {},
      finished: Promise.resolve({})
    })

    await (service as unknown as { onAllReady: () => Promise<void> }).onAllReady()
    expect(enqueueMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock).toHaveBeenLastCalledWith(
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['note-1'] },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:note-1:delete',
        queue: 'base.kb-1'
      })
    )
  })

  it('creates vector artifacts after creating the base and rolls back on artifact failure', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase({ id: 'created-base' })
    knowledgeBaseCreateMock.mockResolvedValueOnce(base)

    await expect(service.createBase({ name: 'KB', dimensions: 3, embeddingModelId: 'provider::embed' })).resolves.toBe(
      base
    )
    expect(createStoreMock).toHaveBeenCalledWith(base)

    createStoreMock.mockRejectedValueOnce(new Error('store failed'))
    await expect(
      service.createBase({ name: 'KB', dimensions: 3, embeddingModelId: 'provider::embed' })
    ).rejects.toThrow('store failed')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
  })

  it('deletes base jobs, vector artifacts, and SQLite base under the mutation lock', async () => {
    const service = new KnowledgeOrchestrationService()

    await service.deleteBase('kb-1')

    expect(deleteStoreMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
  })

  it('restores a failed base by creating a new base and enqueueing restored root items', async () => {
    const service = new KnowledgeOrchestrationService()
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::new', dimensions: 6 })
    knowledgeBaseGetByIdMock
      .mockResolvedValueOnce(createBase({ id: 'source-kb', status: 'failed' }))
      .mockResolvedValueOnce(restoredBase)
      .mockResolvedValueOnce(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([createNoteItem('source-note', 'source-kb')])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::new',
        dimensions: 6
      })
    ).resolves.toBe(restoredBase)

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      expect.objectContaining({ baseId: 'restored-kb' }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('knowledge:restored-kb:') })
    )
  })

  it('schedules add, delete, and reindex through the new workflow jobs', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1'))

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello' } }])
    await service.deleteItems('kb-1', ['note-1'])
    await service.reindexItems('kb-1', ['note-1'])

    expect(enqueueMock.mock.calls.map((call) => call[0])).toEqual([
      'knowledge.index-documents',
      'knowledge.delete-subtree',
      'knowledge.reindex-subtree'
    ])
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['note-1'], 'deleting')
  })

  it('keeps items deleting when delete cleanup enqueue fails', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1'))
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(service.deleteItems('kb-1', ['note-1'])).rejects.toThrow('enqueue failed')

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['note-1'], 'deleting')
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith('kb-1', ['note-1'], 'failed', expect.anything())
  })

  it('collapses nested delete and reindex inputs to top-level roots', async () => {
    const service = new KnowledgeOrchestrationService()
    const parent = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'kb-1', 'dir-1')
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => (id === 'dir-1' ? parent : child))
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) =>
        !options.includeRoots && rootIds.includes('dir-1') ? [child] : []
    )

    await service.deleteItems('kb-1', ['dir-1', 'note-1'])
    await service.reindexItems('kb-1', ['dir-1', 'note-1'])

    expect(enqueueMock).toHaveBeenNthCalledWith(
      1,
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['dir-1'] },
      expect.any(Object)
    )
    expect(enqueueMock).toHaveBeenNthCalledWith(
      2,
      'knowledge.reindex-subtree',
      { baseId: 'kb-1', rootItemIds: ['dir-1'] },
      expect.any(Object)
    )
  })

  it('rejects runtime operations on failed bases before scheduling work', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValue(
      createBase({ status: 'failed', error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL })
    )

    try {
      await service.addItems('kb-1', [{ type: 'note', data: { source: 'x', content: 'x' } }])
      throw new Error('Expected addItems to fail')
    } catch (error) {
      expectFailedBaseGuard(error, 'addItems')
    }

    try {
      await service.reindexItems('kb-1', ['note-1'])
      throw new Error('Expected reindexItems to fail')
    } catch (error) {
      expectFailedBaseGuard(error, 'reindexItems')
    }
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('searches vector store results and applies relevance threshold', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ threshold: 0.5 }))
    vectorQueryMock.mockResolvedValueOnce({
      nodes: [
        {
          id_: 'chunk-1',
          metadata: { itemId: NOTE_ITEM_ID, itemType: 'note', source: 'note-1', chunkIndex: 0, tokenCount: 3 },
          getContent: () => 'hello world'
        },
        {
          id_: 'chunk-2',
          metadata: { itemId: NOTE_ITEM_ID, itemType: 'note', source: 'note-1', chunkIndex: 1, tokenCount: 3 },
          getContent: () => 'low score'
        }
      ],
      similarities: [0.8, 0.2]
    })

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      expect.objectContaining({ chunkId: 'chunk-1', itemId: NOTE_ITEM_ID, rank: 1, score: 0.8 })
    ])
  })

  it('filters search results for missing or deleting items', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      if (id === MISSING_NOTE_ITEM_ID) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }
      if (id === DELETING_NOTE_ITEM_ID) {
        return createNoteItem(id, 'kb-1', null, 'deleting')
      }
      return createNoteItem(id)
    })
    vectorQueryMock.mockResolvedValueOnce({
      nodes: [
        {
          id_: 'chunk-active',
          metadata: { itemId: NOTE_ITEM_ID, itemType: 'note', source: 'note-1', chunkIndex: 0, tokenCount: 3 },
          getContent: () => 'active'
        },
        {
          id_: 'chunk-deleting',
          metadata: {
            itemId: DELETING_NOTE_ITEM_ID,
            itemType: 'note',
            source: 'deleting-note',
            chunkIndex: 0,
            tokenCount: 3
          },
          getContent: () => 'deleting'
        },
        {
          id_: 'chunk-missing',
          metadata: {
            itemId: MISSING_NOTE_ITEM_ID,
            itemType: 'note',
            source: 'missing-note',
            chunkIndex: 0,
            tokenCount: 3
          },
          getContent: () => 'missing'
        }
      ],
      similarities: [0.9, 0.8, 0.7]
    })

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      expect.objectContaining({ chunkId: 'chunk-active', itemId: NOTE_ITEM_ID, rank: 1, score: 0.9 })
    ])
  })

  it('lists and deletes chunks after checking item ownership', async () => {
    const service = new KnowledgeOrchestrationService()
    vectorListByExternalIdMock.mockResolvedValueOnce([
      {
        id_: 'chunk-1',
        metadata: { itemId: NOTE_ITEM_ID, itemType: 'note', source: 'note-1', chunkIndex: 0, tokenCount: 2 },
        getContent: () => 'chunk text'
      }
    ])

    await expect(service.listItemChunks('kb-1', 'note-1')).resolves.toEqual([
      expect.objectContaining({ id: 'chunk-1', itemId: NOTE_ITEM_ID, content: 'chunk text' })
    ])
    await service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')

    expect(vectorDeleteByIdAndExternalIdMock).toHaveBeenCalledWith('chunk-1', 'note-1')
  })

  it('rejects chunk operations for deleting subtrees', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1'))
    knowledgeItemGetSubtreeItemsMock.mockResolvedValueOnce([
      createNoteItem('deleting-note', 'kb-1', 'dir-1', 'deleting')
    ])

    await expect(service.listItemChunks('kb-1', 'dir-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot list chunks for a deleting knowledge item'
    })
    expect(vectorListByExternalIdMock).not.toHaveBeenCalled()

    knowledgeItemGetByIdMock.mockResolvedValueOnce(createNoteItem('deleting-note', 'kb-1', null, 'deleting'))

    await expect(service.deleteItemChunk('kb-1', 'deleting-note', 'chunk-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot delete chunk for a deleting knowledge item'
    })
    expect(vectorDeleteByIdAndExternalIdMock).not.toHaveBeenCalled()
  })

  it('rejects manual chunk delete while the item or subtree is indexing', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createNoteItem('note-1', 'kb-1', null, 'embedding'))

    await expect(service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot delete chunk while knowledge item is indexing'
    })
    expect(vectorDeleteByIdAndExternalIdMock).not.toHaveBeenCalled()

    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1'))
    knowledgeItemGetSubtreeItemsMock.mockResolvedValueOnce([createNoteItem('note-1', 'kb-1', 'dir-1', 'processing')])

    await expect(service.deleteItemChunk('kb-1', 'dir-1', 'chunk-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot delete chunk while knowledge item is indexing'
    })
    expect(vectorDeleteByIdAndExternalIdMock).not.toHaveBeenCalled()
  })
})
