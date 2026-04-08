import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import PQueue from 'p-queue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  createVectorStoreMock,
  deleteVectorStoreMock,
  embedManyMock,
  expandDirectoryOwnerToCreateItemsMock,
  expandSitemapOwnerToCreateItemsMock,
  getEmbedModelMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateMock,
  loadKnowledgeItemDocumentsMock,
  loggerErrorMock,
  loggerWarnMock,
  rerankKnowledgeSearchResultsMock,
  vectorStoreAddMock,
  vectorStoreDeleteMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  deleteVectorStoreMock: vi.fn(),
  embedManyMock: vi.fn(),
  expandDirectoryOwnerToCreateItemsMock: vi.fn(),
  expandSitemapOwnerToCreateItemsMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemUpdateMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  rerankKnowledgeSearchResultsMock: vi.fn(),
  vectorStoreAddMock: vi.fn(),
  vectorStoreDeleteMock: vi.fn()
}))

vi.mock('@main/core/application', () => ({
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

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getById: knowledgeItemGetByIdMock,
    update: knowledgeItemUpdateMock
  }
}))

vi.mock('ai', () => ({
  embedMany: embedManyMock
}))

vi.mock('../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
}))

vi.mock('../rerank/rerank', () => ({
  rerankKnowledgeSearchResults: rerankKnowledgeSearchResultsMock
}))

vi.mock('../utils/chunk', () => ({
  chunkDocuments: vi.fn((_, __, documents) => documents)
}))

vi.mock('../utils/embed', () => ({
  embedDocuments: vi.fn()
}))

vi.mock('../utils/model', () => ({
  getEmbedModel: getEmbedModelMock
}))

vi.mock('../utils/directory', () => ({
  expandDirectoryOwnerToCreateItems: expandDirectoryOwnerToCreateItemsMock
}))

vi.mock('../utils/sitemap', () => ({
  expandSitemapOwnerToCreateItems: expandSitemapOwnerToCreateItemsMock
}))

const { KnowledgeRuntimeService } = await import('../KnowledgeRuntimeService')

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
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

function createNoteItem() {
  return {
    id: 'note-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'note' as const,
    data: { content: 'hello world' },
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

describe('KnowledgeRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeVectorStoreService') {
        return {
          createStore: createVectorStoreMock,
          deleteStore: deleteVectorStoreMock,
          clear: vi.fn()
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })
    createVectorStoreMock.mockResolvedValue({
      add: vectorStoreAddMock,
      delete: vectorStoreDeleteMock,
      query: vi.fn()
    })
    deleteVectorStoreMock.mockResolvedValue(undefined)
    vectorStoreAddMock.mockResolvedValue(undefined)
    vectorStoreDeleteMock.mockResolvedValue(undefined)
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => dto)
    getEmbedModelMock.mockReturnValue({ provider: 'mock' })
    embedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2]] })
    expandDirectoryOwnerToCreateItemsMock.mockResolvedValue([
      {
        groupId: 'dir-1',
        type: 'file',
        data: {
          file: {
            id: 'file-1',
            name: 'a.md',
            origin_name: 'a.md',
            path: '/docs/a.md',
            created_at: '2026-04-08T00:00:00.000Z',
            size: 10,
            ext: '.md',
            type: 'text',
            count: 1
          }
        }
      }
    ])
    expandSitemapOwnerToCreateItemsMock.mockResolvedValue([
      {
        groupId: 'sitemap-1',
        type: 'url',
        data: { url: 'https://example.com/page-1', name: 'https://example.com/page-1' }
      }
    ])
    rerankKnowledgeSearchResultsMock.mockImplementation(async (_base, _query, results) => results)
  })

  it('uses WhenReady phase and declares DbService dependency', () => {
    expect(getPhase(KnowledgeRuntimeService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeRuntimeService)).toEqual(['DbService', 'KnowledgeVectorStoreService'])
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

  it('rehydrates base and items from ids in runtime IPC handlers', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).onInit()

    const handlerCalls = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls
    const addItemsHandler = handlerCalls.find((call) => call[0] === 'knowledge-runtime:add-items')?.[1]
    const searchHandler = handlerCalls.find((call) => call[0] === 'knowledge-runtime:search')?.[1]
    const expandDirectoryItemHandler = handlerCalls.find(
      (call) => call[0] === 'knowledge-runtime:expand-directory-item'
    )?.[1]
    const expandSitemapItemHandler = handlerCalls.find(
      (call) => call[0] === 'knowledge-runtime:expand-sitemap-item'
    )?.[1]

    const base = createBase()
    const item = createDirectoryItem()
    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    knowledgeItemGetByIdMock.mockResolvedValue(item)

    await expect(addItemsHandler({}, { baseId: base.id, itemIds: [item.id] })).rejects.toThrow(
      'Container knowledge items must be expanded into child items before indexing'
    )

    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith(base.id)
    expect(knowledgeItemGetByIdMock).toHaveBeenCalledWith(item.id)

    const mockQuery = vi.fn().mockResolvedValue({ nodes: [], similarities: [] })
    createVectorStoreMock.mockResolvedValue({
      add: vectorStoreAddMock,
      delete: vectorStoreDeleteMock,
      query: mockQuery
    })

    await expect(searchHandler({}, { baseId: base.id, query: 'hello' })).resolves.toEqual([])
    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith(base.id)
    expect(mockQuery).toHaveBeenCalled()

    await expect(expandDirectoryItemHandler({}, { baseId: base.id, itemId: item.id })).resolves.toEqual({
      items: [
        {
          groupId: 'dir-1',
          type: 'file',
          data: {
            file: {
              id: 'file-1',
              name: 'a.md',
              origin_name: 'a.md',
              path: '/docs/a.md',
              created_at: '2026-04-08T00:00:00.000Z',
              size: 10,
              ext: '.md',
              type: 'text',
              count: 1
            }
          }
        }
      ]
    })
    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith(base.id)
    expect(knowledgeItemGetByIdMock).toHaveBeenCalledWith(item.id)
    expect(expandDirectoryOwnerToCreateItemsMock).toHaveBeenCalledWith(item)

    const sitemapItem = createSitemapItem()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(sitemapItem)

    await expect(expandSitemapItemHandler({}, { baseId: base.id, itemId: sitemapItem.id })).resolves.toEqual({
      items: [
        {
          groupId: 'sitemap-1',
          type: 'url',
          data: { url: 'https://example.com/page-1', name: 'https://example.com/page-1' }
        }
      ]
    })
    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith(base.id)
    expect(knowledgeItemGetByIdMock).toHaveBeenCalledWith(sitemapItem.id)
    expect(expandSitemapOwnerToCreateItemsMock).toHaveBeenCalledWith(sitemapItem)
  })

  it('persists failed status even when vector cleanup throws', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = {
      id: 'item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'note' as const,
      data: { content: 'hello world' },
      status: 'idle' as const,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }

    loadKnowledgeItemDocumentsMock.mockResolvedValue([{ text: 'doc', metadata: { itemId: item.id } }])
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

  it('waits for running tasks to settle on stop and prevents completed overwrite', async () => {
    const service = new KnowledgeRuntimeService()
    ;(service as any).queue = new PQueue({ concurrency: 1 })

    const base = createBase()
    const item = createNoteItem()
    const loadDeferred = createDeferred<Array<{ text: string; metadata: { itemId: string } }>>()
    const failedPersistDeferred = createDeferred<unknown>()

    loadKnowledgeItemDocumentsMock.mockReturnValue(loadDeferred.promise)
    knowledgeItemUpdateMock.mockImplementation(async (_id, dto) => {
      if (dto.status === 'failed') {
        return await failedPersistDeferred.promise
      }

      return dto
    })

    const addPromise = service.addItems(base, [item])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(item)
    })

    let stopResolved = false
    const stopPromise = (service as any).onStop().then(() => {
      stopResolved = true
    })

    expect(stopResolved).toBe(false)
    expect(knowledgeItemUpdateMock).toHaveBeenCalledTimes(1)

    loadDeferred.resolve([{ text: 'doc', metadata: { itemId: item.id } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
        status: 'failed',
        error: 'Knowledge task interrupted by service shutdown'
      })
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(item.id, {
      status: 'completed',
      error: null
    })
    expect(stopResolved).toBe(false)

    failedPersistDeferred.resolve({ status: 'failed' })

    await Promise.allSettled([addPromise, stopPromise])

    expect(stopResolved).toBe(true)
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(item.id, {
      status: 'failed',
      error: 'Knowledge task interrupted by service shutdown'
    })
  })
})
