import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase
} from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeAddQueue } from '../KnowledgeAddQueue'
import { DELETE_INTERRUPTED_REASON, SHUTDOWN_INTERRUPTED_REASON } from '../utils/taskRuntime'

const {
  appGetMock,
  createVectorStoreMock,
  deleteVectorStoreMock,
  embedManyMock,
  getEmbedModelMock,
  knowledgeItemGetCascadeIdsInBaseMock,
  knowledgeItemUpdateMock,
  loadKnowledgeItemDocumentsMock,
  loggerErrorMock,
  loggerWarnMock,
  rerankKnowledgeSearchResultsMock,
  vectorStoreAddMock,
  vectorStoreDeleteMock,
  vectorStoreQueryMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  deleteVectorStoreMock: vi.fn(),
  embedManyMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  knowledgeItemGetCascadeIdsInBaseMock: vi.fn(),
  knowledgeItemUpdateMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  rerankKnowledgeSearchResultsMock: vi.fn(),
  vectorStoreAddMock: vi.fn(),
  vectorStoreDeleteMock: vi.fn(),
  vectorStoreQueryMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: loggerWarnMock,
      error: loggerErrorMock,
      debug: vi.fn()
    })
  }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {
    ipcHandle = vi.fn()
  }

  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getCascadeIdsInBase: knowledgeItemGetCascadeIdsInBaseMock,
    update: knowledgeItemUpdateMock
  }
}))

vi.mock('ai', () => ({
  embedMany: embedManyMock
}))

vi.mock('../../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
}))

vi.mock('../../rerank/rerank', () => ({
  rerankKnowledgeSearchResults: rerankKnowledgeSearchResultsMock
}))

vi.mock('../../utils/chunk', () => ({
  chunkDocuments: vi.fn((_, __, documents) => documents)
}))

vi.mock('../../utils/embed', () => ({
  embedDocuments: vi.fn((_, chunks) => chunks)
}))

vi.mock('../../utils/model', () => ({
  getEmbedModel: getEmbedModelMock,
  getKnowledgeBaseEmbeddingModelMissingMessage: vi.fn(
    (baseId: string) =>
      `Knowledge base ${baseId} has no embedding model configured. Select a new embedding model before indexing or searching.`
  )
}))

const { KnowledgeRuntimeService } = await import('..')

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem() {
  return {
    id: 'dir-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'directory' as const,
    data: { name: 'docs', path: '/docs' },
    status: 'idle' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createSitemapItem() {
  return {
    id: 'sitemap-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'sitemap' as const,
    data: { url: 'https://example.com/sitemap.xml', name: 'Example Sitemap' },
    status: 'idle' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(id = 'note-1') {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note' as const,
    data: { content: `hello ${id}` },
    status: 'idle' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createSingleConcurrencyQueue(service: InstanceType<typeof KnowledgeRuntimeService>) {
  return new KnowledgeAddQueue(1, (entry) => {
    if ((service as any).isStopping) {
      throw new Error(SHUTDOWN_INTERRUPTED_REASON)
    }

    return (service as any).addRuntime.executeAdd(entry)
  })
}

describe('KnowledgeRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeVectorStoreService') {
        return {
          createStore: createVectorStoreMock,
          deleteStore: deleteVectorStoreMock,
          getStoreIfExists: createVectorStoreMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })
    createVectorStoreMock.mockResolvedValue({
      add: vectorStoreAddMock,
      delete: vectorStoreDeleteMock,
      query: vectorStoreQueryMock
    })
    deleteVectorStoreMock.mockResolvedValue(undefined)
    vectorStoreAddMock.mockResolvedValue(undefined)
    vectorStoreDeleteMock.mockResolvedValue(undefined)
    vectorStoreQueryMock.mockResolvedValue({
      nodes: [],
      similarities: [],
      ids: []
    })
    knowledgeItemGetCascadeIdsInBaseMock.mockImplementation(async (_baseId, itemIds: string[]) => [...new Set(itemIds)])
    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => dto)
    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => [
      { text: item.id, metadata: { itemId: item.id } }
    ])
    getEmbedModelMock.mockReturnValue({ provider: 'mock' })
    embedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2]] })
    rerankKnowledgeSearchResultsMock.mockImplementation(async (_base, _query, results) => results)
  })

  it('uses WhenReady phase and depends on KnowledgeVectorStoreService', () => {
    expect(getPhase(KnowledgeRuntimeService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeRuntimeService)).toEqual(['KnowledgeVectorStoreService'])
  })

  it('maps vector search results into knowledge search results with metadata and chunk ids', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const query = 'hello'
    const firstNode = {
      id_: 'chunk-1',
      metadata: {
        itemId: 'item-1',
        sourceUrl: 'https://example.com/1'
      },
      getContent: vi.fn(() => 'page one')
    }
    const secondNode = {
      id_: 'chunk-2',
      metadata: {
        itemId: '',
        sourceUrl: 'https://example.com/2'
      },
      getContent: vi.fn(() => 'page two')
    }

    embedManyMock.mockResolvedValueOnce({ embeddings: [[0.9, 0.1]] })
    vectorStoreQueryMock.mockResolvedValueOnce({
      nodes: [firstNode, secondNode],
      similarities: [0.8, 0.6],
      ids: ['chunk-1', 'chunk-2']
    })

    await expect(service.search(base, query)).resolves.toEqual([
      {
        pageContent: 'page one',
        score: 0.8,
        metadata: {
          itemId: 'item-1',
          sourceUrl: 'https://example.com/1'
        },
        itemId: 'item-1',
        chunkId: 'chunk-1'
      },
      {
        pageContent: 'page two',
        score: 0.6,
        metadata: {
          itemId: '',
          sourceUrl: 'https://example.com/2'
        },
        itemId: undefined,
        chunkId: 'chunk-2'
      }
    ])

    expect(getEmbedModelMock).toHaveBeenCalledWith(base)
    expect(embedManyMock).toHaveBeenCalledWith({
      model: { provider: 'mock' },
      values: [query]
    })
    expect(vectorStoreQueryMock).toHaveBeenCalledWith({
      queryStr: query,
      queryEmbedding: [0.9, 0.1],
      mode: 'default',
      similarityTopK: 10,
      alpha: undefined
    })
    expect(rerankKnowledgeSearchResultsMock).not.toHaveBeenCalled()
  })

  it('fails search when embedMany returns an empty embedding result', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()

    embedManyMock.mockResolvedValueOnce({ embeddings: [] })

    await expect(service.search(base, 'hello')).rejects.toThrow(
      'Failed to embed search query: model returned empty result'
    )

    expect(createVectorStoreMock).not.toHaveBeenCalled()
    expect(vectorStoreQueryMock).not.toHaveBeenCalled()
  })

  it('fails search with a clear error when the knowledge base has no embedding model configured', async () => {
    const service = new KnowledgeRuntimeService()
    const base = {
      ...createBase(),
      embeddingModelId: null
    }

    getEmbedModelMock.mockImplementationOnce(() => {
      throw new Error(
        'Knowledge base kb-1 has no embedding model configured. Select a new embedding model before indexing or searching.'
      )
    })

    await expect(service.search(base, 'hello')).rejects.toThrow(
      'Knowledge base kb-1 has no embedding model configured. Select a new embedding model before indexing or searching.'
    )

    expect(embedManyMock).not.toHaveBeenCalled()
    expect(createVectorStoreMock).not.toHaveBeenCalled()
  })

  it('marks directory items as failed instead of completed', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createDirectoryItem()

    await expect(service.addItems(base, [item])).rejects.toThrow(
      'Container knowledge items must be expanded into child items before indexing'
    )

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
    expect(createVectorStoreMock).not.toHaveBeenCalled()
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'pending',
      error: null
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: 'Container knowledge items must be expanded into child items before indexing'
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
  })

  it('fails items before reading documents when the knowledge base has no embedding model configured', async () => {
    const service = new KnowledgeRuntimeService()
    const base = {
      ...createBase(),
      embeddingModelId: null
    }
    const item = createNoteItem('note-no-model')

    getEmbedModelMock.mockImplementationOnce(() => {
      throw new Error(
        'Knowledge base kb-1 has no embedding model configured. Select a new embedding model before indexing or searching.'
      )
    })

    await expect(service.addItems(base, [item])).rejects.toThrow(
      'Knowledge base kb-1 has no embedding model configured. Select a new embedding model before indexing or searching.'
    )

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
    expect(createVectorStoreMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'pending',
      error: null
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error:
        'Knowledge base kb-1 has no embedding model configured. Select a new embedding model before indexing or searching.'
    })
  })

  it('marks sitemap items as failed instead of completed', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createSitemapItem()

    await expect(service.addItems(base, [item])).rejects.toThrow(
      'Container knowledge items must be expanded into child items before indexing'
    )

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
    expect(createVectorStoreMock).not.toHaveBeenCalled()
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'pending',
      error: null
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: 'Container knowledge items must be expanded into child items before indexing'
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
  })

  it('deduplicates add work for the same item', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-dup')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (currentItem) => {
      if (currentItem.id === item.id) {
        return await loadDeferred.promise
      }

      return [{ text: currentItem.id, metadata: { itemId: currentItem.id } }]
    })

    const firstAddPromise = service.addItems(base, [item])
    const secondAddPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledTimes(1)
    })

    loadDeferred.resolve([{ text: item.id, metadata: { itemId: item.id } }])

    await expect(Promise.all([firstAddPromise, secondAddPromise])).resolves.toEqual([[undefined], [undefined]])
    expect(vectorStoreAddMock).toHaveBeenCalledTimes(1)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
  })

  it('keeps add startup atomic per item when another item fails before enqueue', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const startedItem = createNoteItem('note-started')
    const failedItem = createNoteItem('note-failed')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    knowledgeItemUpdateMock.mockImplementation(async (id, dto) => {
      if (id === failedItem.id && dto.status === 'pending') {
        throw new Error('pending write failed')
      }

      return dto
    })
    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => {
      if (item.id === startedItem.id) {
        return await loadDeferred.promise
      }

      return [{ text: item.id, metadata: { itemId: item.id } }]
    })

    const addPromise = service.addItems(base, [startedItem, failedItem])
    const addPromiseAssertion = expect(addPromise).rejects.toThrow('pending write failed')

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(startedItem, expect.any(AbortSignal))
    })

    await addPromiseAssertion

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(failedItem)

    loadDeferred.resolve([{ text: startedItem.id, metadata: { itemId: startedItem.id } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(startedItem.id, {
        status: 'completed',
        error: null
      })
    })
  })

  it('removes pending items from the add queue before they start', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).addQueue = createSingleConcurrencyQueue(service)

    const base = createBase()
    const runningItem = createNoteItem('note-running')
    const pendingItem = createNoteItem('note-pending')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => {
      if (item.id === runningItem.id) {
        return await loadDeferred.promise
      }

      return [{ text: item.id, metadata: { itemId: item.id } }]
    })

    const addPromise = service.addItems(base, [runningItem, pendingItem])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(runningItem, expect.any(AbortSignal))
    })

    await expect(service.deleteItems(base, [pendingItem])).resolves.toBeUndefined()

    loadDeferred.resolve([{ text: runningItem.id, metadata: { itemId: runningItem.id } }])

    await expect(addPromise).rejects.toThrow(DELETE_INTERRUPTED_REASON)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(pendingItem)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(pendingItem.id)
  })

  it('interrupts running add work before deleting vectors', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-delete')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (currentItem) => {
      if (currentItem.id === item.id) {
        return await loadDeferred.promise
      }

      return [{ text: currentItem.id, metadata: { itemId: currentItem.id } }]
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(item, expect.any(AbortSignal))
    })

    let deleteResolved = false
    const deletePromise = service.deleteItems(base, [item]).then(() => {
      deleteResolved = true
    })

    expect(deleteResolved).toBe(false)

    loadDeferred.resolve([{ text: item.id, metadata: { itemId: item.id } }])

    await deletePromise

    await expect(addPromise).rejects.toThrow(DELETE_INTERRUPTED_REASON)
    expect(deleteResolved).toBe(true)
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: DELETE_INTERRUPTED_REASON
    })
  })

  it('interrupts running add work before deleting the base store', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-delete-base')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (currentItem) => {
      if (currentItem.id === item.id) {
        return await loadDeferred.promise
      }

      return [{ text: currentItem.id, metadata: { itemId: currentItem.id } }]
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(item, expect.any(AbortSignal))
    })

    let deleteResolved = false
    const deletePromise = service.deleteBase(base.id).then(() => {
      deleteResolved = true
    })

    expect(deleteResolved).toBe(false)

    loadDeferred.resolve([{ text: item.id, metadata: { itemId: item.id } }])

    await deletePromise

    await expect(addPromise).rejects.toThrow(DELETE_INTERRUPTED_REASON)
    expect(deleteResolved).toBe(true)
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(deleteVectorStoreMock).toHaveBeenCalledWith(base.id)
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: DELETE_INTERRUPTED_REASON
    })
  })

  it('deletes vectors for cascade descendants when only the owner is passed in', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const ownerItem = createDirectoryItem()
    const childItem = {
      ...createNoteItem('note-child'),
      groupId: ownerItem.id
    }

    knowledgeItemGetCascadeIdsInBaseMock.mockResolvedValue([ownerItem.id, childItem.id])

    await expect(service.deleteItems(base, [ownerItem])).resolves.toBeUndefined()

    expect(knowledgeItemGetCascadeIdsInBaseMock).toHaveBeenCalledWith(base.id, [ownerItem.id])
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(ownerItem.id)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(childItem.id)
  })

  it('deletes vectors when add already succeeded but completed status is still pending during delete', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-delete-after-add')
    const completedUpdateDeferred = createDeferred<unknown>()

    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => {
      if (dto.status === 'completed') {
        return await completedUpdateDeferred.promise
      }

      return dto
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(vectorStoreAddMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
        status: 'completed',
        error: null
      })
    })

    let deleteResolved = false
    const deletePromise = service.deleteItems(base, [item]).then(() => {
      deleteResolved = true
    })

    expect(deleteResolved).toBe(false)

    completedUpdateDeferred.resolve({
      status: 'completed',
      error: null
    })

    await deletePromise

    await expect(addPromise).rejects.toThrow(DELETE_INTERRUPTED_REASON)
    expect(deleteResolved).toBe(true)
    expect(vectorStoreAddMock).toHaveBeenCalledTimes(1)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
  })

  it('interrupts mixed running and pending add work before deleting vectors in one batch', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).addQueue = createSingleConcurrencyQueue(service)

    const base = createBase()
    const runningItem = createNoteItem('note-delete-running')
    const pendingItem = createNoteItem('note-delete-pending')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => {
      if (item.id === runningItem.id) {
        return await loadDeferred.promise
      }

      return [{ text: item.id, metadata: { itemId: item.id } }]
    })

    const addPromise = service.addItems(base, [runningItem, pendingItem])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(runningItem, expect.any(AbortSignal))
    })

    let deleteResolved = false
    const deletePromise = service.deleteItems(base, [runningItem, pendingItem]).then(() => {
      deleteResolved = true
    })

    expect(deleteResolved).toBe(false)

    loadDeferred.resolve([{ text: runningItem.id, metadata: { itemId: runningItem.id } }])

    await deletePromise

    await expect(addPromise).rejects.toThrow(DELETE_INTERRUPTED_REASON)
    expect(deleteResolved).toBe(true)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(pendingItem)
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(runningItem.id)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(pendingItem.id)
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(runningItem.id, {
      status: 'completed',
      error: null
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(pendingItem.id, {
      status: 'completed',
      error: null
    })
  })

  it('persists failed status even when vector cleanup throws', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('item-1')

    vectorStoreDeleteMock.mockRejectedValue(new Error('cleanup failed'))
    const store = {
      add: vi.fn().mockRejectedValue(new Error('vector add failed')),
      delete: vectorStoreDeleteMock,
      query: vi.fn()
    }
    createVectorStoreMock.mockResolvedValue(store)

    await expect(service.addItems(base, [item])).rejects.toThrow('vector add failed')

    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: 'vector add failed'
    })
    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to cleanup knowledge item vectors after add failure', {
      baseId: base.id,
      itemId: item.id,
      cleanupError: 'cleanup failed'
    })
    expect(store.add).toHaveBeenCalled()
  })

  it('keeps the original add error and still cleans up vectors when failed status persistence also fails', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('item-failed-status')

    const store = {
      add: vi.fn().mockResolvedValue(undefined),
      delete: vectorStoreDeleteMock,
      query: vi.fn()
    }
    createVectorStoreMock.mockResolvedValue(store)
    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => {
      if (dto.status === 'completed') {
        throw new Error('completed write failed')
      }

      if (dto.status === 'failed') {
        throw new Error('failed write failed')
      }

      return dto
    })

    await expect(service.addItems(base, [item])).rejects.toThrow('completed write failed')

    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: 'completed write failed'
    })
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist knowledge item failure state',
      expect.objectContaining({ message: 'failed write failed' }),
      expect.objectContaining({
        baseId: base.id,
        itemId: item.id,
        itemType: item.type,
        originalError: 'completed write failed'
      })
    )
  })

  it('continues stop cleanup when interrupted vector deletion fails', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).addQueue = createSingleConcurrencyQueue(service)

    const base = createBase()
    const runningItem = createNoteItem('note-stop-cleanup-running')
    const pendingItem = createNoteItem('note-stop-cleanup-pending')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => {
      if (item.id === runningItem.id) {
        return await loadDeferred.promise
      }

      return [{ text: item.id, metadata: { itemId: item.id } }]
    })

    vectorStoreDeleteMock.mockImplementation(async (itemId: string) => {
      if (itemId === pendingItem.id) {
        throw new Error('interrupted cleanup failed')
      }
    })

    const addPromise = service.addItems(base, [runningItem, pendingItem])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(runningItem, expect.any(AbortSignal))
    })

    const stopPromise = (service as any).onStop()

    loadDeferred.resolve([{ text: runningItem.id, metadata: { itemId: runningItem.id } }])

    await expect(stopPromise).resolves.toBeUndefined()
    await expect(addPromise).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(runningItem.id)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(pendingItem.id)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(runningItem.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(pendingItem.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to delete knowledge item vectors during interruption cleanup', {
      baseId: base.id,
      itemIds: [runningItem.id, pendingItem.id],
      succeededItemIds: [runningItem.id],
      failedItemIds: [pendingItem.id],
      cleanupError: `Failed to delete vectors for knowledge items in base ${base.id}: ${pendingItem.id}`
    })
  })

  it('deletes vectors on stop when add already succeeded but completed status is still pending', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-stop-after-add')
    const completedUpdateDeferred = createDeferred<unknown>()

    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => {
      if (dto.status === 'completed') {
        return await completedUpdateDeferred.promise
      }

      return dto
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(vectorStoreAddMock).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
        status: 'completed',
        error: null
      })
    })

    let stopResolved = false
    const stopPromise = (service as any).onStop().then(() => {
      stopResolved = true
    })

    expect(stopResolved).toBe(false)

    completedUpdateDeferred.resolve({
      status: 'completed',
      error: null
    })

    await stopPromise

    await expect(addPromise).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)
    expect(stopResolved).toBe(true)
    expect(vectorStoreAddMock).toHaveBeenCalledTimes(1)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
  })

  it('fails interrupted items on stop after deleting their vectors', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).addQueue = createSingleConcurrencyQueue(service)

    const base = createBase()
    const runningItem = createNoteItem('note-stop-running')
    const pendingItem = createNoteItem('note-stop-pending')
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()

    loadKnowledgeItemDocumentsMock.mockImplementation(async (item) => {
      if (item.id === runningItem.id) {
        return await loadDeferred.promise
      }

      return [{ text: item.id, metadata: { itemId: item.id } }]
    })

    const addPromise = service.addItems(base, [runningItem, pendingItem])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(runningItem, expect.any(AbortSignal))
    })

    let stopResolved = false
    const stopPromise = (service as any).onStop().then(() => {
      stopResolved = true
    })

    expect(stopResolved).toBe(false)

    loadDeferred.resolve([{ text: runningItem.id, metadata: { itemId: runningItem.id } }])

    await stopPromise

    await expect(addPromise).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)
    expect(stopResolved).toBe(true)
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(runningItem.id)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(pendingItem.id)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(runningItem.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(pendingItem.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(runningItem.id, {
      status: 'completed',
      error: null
    })
  })

  it('does not leave an item stuck in pending when stop happens during the pending write', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-stop-during-pending')
    const pendingUpdateDeferred = createDeferred<unknown>()

    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => {
      if (dto.status === 'pending') {
        return await pendingUpdateDeferred.promise
      }

      return dto
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
        status: 'pending',
        error: null
      })
    })

    let stopResolved = false
    const stopPromise = (service as any).onStop().then(() => {
      stopResolved = true
    })

    expect(stopResolved).toBe(false)

    pendingUpdateDeferred.resolve({
      status: 'pending',
      error: null
    })

    await stopPromise

    await expect(addPromise).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)
    expect(stopResolved).toBe(true)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(item, expect.any(AbortSignal))
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: SHUTDOWN_INTERRUPTED_REASON
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
  })

  it('deduplicates repeated item ids during delete', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-delete-dedupe')

    await expect(service.deleteItems(base, [item, item])).resolves.toBeUndefined()

    expect(vectorStoreDeleteMock).toHaveBeenCalledTimes(1)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
  })
})
