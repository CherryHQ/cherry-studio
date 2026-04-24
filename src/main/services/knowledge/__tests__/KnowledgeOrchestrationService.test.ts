import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  createBaseMock,
  deleteBaseMock,
  runtimeAddItemsMock,
  runtimeDeleteItemsMock,
  runtimeSearchMock,
  expandDirectoryOwnerToCreateItemsMock,
  expandSitemapOwnerToCreateItemsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateManyMock,
  knowledgeItemGetByIdsInBaseMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  createBaseMock: vi.fn(),
  deleteBaseMock: vi.fn(),
  runtimeAddItemsMock: vi.fn(),
  runtimeDeleteItemsMock: vi.fn(),
  runtimeSearchMock: vi.fn(),
  expandDirectoryOwnerToCreateItemsMock: vi.fn(),
  expandSitemapOwnerToCreateItemsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateManyMock: vi.fn(),
  knowledgeItemGetByIdsInBaseMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
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
    createMany: knowledgeItemCreateManyMock,
    getByIdsInBase: knowledgeItemGetByIdsInBaseMock
  }
}))

vi.mock('../utils/directory', () => ({
  expandDirectoryOwnerToCreateItems: expandDirectoryOwnerToCreateItemsMock
}))

vi.mock('../utils/sitemap', () => ({
  expandSitemapOwnerToCreateItems: expandSitemapOwnerToCreateItemsMock
}))

const { KnowledgeOrchestrationService } = await import('../KnowledgeOrchestrationService')

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
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

function createFileItem(id = 'file-1', groupId: string | null = null) {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'file' as const,
    data: {
      file: {
        id: `${id}-meta`,
        name: `${id}.md`,
        origin_name: `${id}.md`,
        path: `/docs/${id}.md`,
        created_at: '2026-04-08T00:00:00.000Z',
        size: 10,
        ext: '.md',
        type: 'text',
        count: 1
      }
    },
    status: 'idle' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('KnowledgeOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeRuntimeService') {
        return {
          createBase: createBaseMock,
          deleteBase: deleteBaseMock,
          addItems: runtimeAddItemsMock,
          deleteItems: runtimeDeleteItemsMock,
          search: runtimeSearchMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })

    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([createNoteItem()])
    knowledgeItemCreateManyMock.mockResolvedValue({ items: [] })
    expandDirectoryOwnerToCreateItemsMock.mockResolvedValue([])
    expandSitemapOwnerToCreateItemsMock.mockResolvedValue([])
    createBaseMock.mockResolvedValue(undefined)
    deleteBaseMock.mockResolvedValue(undefined)
    runtimeAddItemsMock.mockResolvedValue(undefined)
    runtimeDeleteItemsMock.mockResolvedValue(undefined)
    runtimeSearchMock.mockResolvedValue([])
  })

  it('uses WhenReady phase and depends on KnowledgeRuntimeService', () => {
    expect(getPhase(KnowledgeOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeOrchestrationService)).toEqual(['KnowledgeRuntimeService'])
  })

  it('registers only the five caller-facing knowledge runtime IPC handlers', async () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as any).onInit()

    const handlerCalls = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])
    expect(handlerCalls).toEqual([
      'knowledge-runtime:create-base',
      'knowledge-runtime:delete-base',
      'knowledge-runtime:add-items',
      'knowledge-runtime:delete-items',
      'knowledge-runtime:search'
    ])
  })

  it('rejects invalid create-base IPC payloads before touching services', async () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as any).onInit()

    const createBaseHandlerCall = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'knowledge-runtime:create-base'
    )
    expect(createBaseHandlerCall).toBeDefined()
    const createBaseHandler = createBaseHandlerCall?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>

    await expect(createBaseHandler({}, { baseId: '' })).rejects.toThrow()
    await expect(createBaseHandler({}, { baseId: 'kb-1', extra: true })).rejects.toThrow()

    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(createBaseMock).not.toHaveBeenCalled()
  })

  it('rejects invalid add-items IPC payloads before touching services', async () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as any).onInit()

    const addItemsHandlerCall = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'knowledge-runtime:add-items'
    )
    expect(addItemsHandlerCall).toBeDefined()
    const addItemsHandler = addItemsHandlerCall?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>

    await expect(addItemsHandler({}, { baseId: 'kb-1', itemIds: [] })).rejects.toThrow()
    await expect(addItemsHandler({}, { baseId: 'kb-1', itemIds: ['note-1', ''] })).rejects.toThrow()

    expect(knowledgeItemGetByIdsInBaseMock).not.toHaveBeenCalled()
    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
  })

  it('rejects invalid search IPC payloads before touching services', async () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as any).onInit()

    const searchHandlerCall = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'knowledge-runtime:search'
    )
    expect(searchHandlerCall).toBeDefined()
    const searchHandler = searchHandlerCall?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>

    await expect(searchHandler({}, { baseId: 'kb-1', query: '' })).rejects.toThrow()
    await expect(searchHandler({}, { baseId: 'kb-1', query: 'hello', extra: true })).rejects.toThrow()

    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(runtimeSearchMock).not.toHaveBeenCalled()
  })

  it('forwards base lifecycle operations to runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase()
    knowledgeBaseGetByIdMock.mockResolvedValue(base)

    await expect(service.createBase(base.id)).resolves.toBeUndefined()
    await expect(service.deleteBase(base.id)).resolves.toBeUndefined()

    expect(createBaseMock).toHaveBeenCalledWith(base)
    expect(deleteBaseMock).toHaveBeenCalledWith(base.id)
  })

  it('expands container items, persists children, and only enqueues leaf items', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase()
    const directoryItem = createDirectoryItem()
    const noteItem = createNoteItem('note-leaf')
    const createdDirectoryItem = {
      ...createDirectoryItem(),
      id: 'dir-child',
      groupId: directoryItem.id,
      data: { name: 'nested', path: '/docs/nested' }
    }
    const createdFileItem = createFileItem('file-child', directoryItem.id)

    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([directoryItem, noteItem])
    expandDirectoryOwnerToCreateItemsMock.mockResolvedValue([
      {
        groupId: directoryItem.id,
        type: 'directory',
        data: { name: 'nested', path: '/docs/nested' }
      },
      {
        groupId: directoryItem.id,
        type: 'file',
        data: createdFileItem.data
      }
    ])
    knowledgeItemCreateManyMock.mockResolvedValue({
      items: [createdDirectoryItem, createdFileItem]
    })

    await expect(service.addItems(base.id, [directoryItem.id, noteItem.id])).resolves.toBeUndefined()

    expect(expandDirectoryOwnerToCreateItemsMock).toHaveBeenCalledWith(directoryItem)
    expect(knowledgeItemCreateManyMock).toHaveBeenCalledWith(base.id, {
      items: [
        {
          groupId: directoryItem.id,
          type: 'directory',
          data: { name: 'nested', path: '/docs/nested' }
        },
        {
          groupId: directoryItem.id,
          type: 'file',
          data: createdFileItem.data
        }
      ]
    })
    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [noteItem, createdFileItem])
  })

  it('searches through runtime after resolving the base', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase()
    const results = [
      {
        pageContent: 'hello',
        score: 0.9,
        metadata: { itemId: 'note-1' },
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ]
    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    runtimeSearchMock.mockResolvedValue(results)

    await expect(service.search(base.id, 'hello')).resolves.toEqual(results)
    expect(runtimeSearchMock).toHaveBeenCalledWith(base, 'hello')
  })

  it('expands sitemap items into urls before enqueueing leaf items', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase()
    const sitemapItem = createSitemapItem()
    const createdUrlItem = {
      id: 'url-child',
      baseId: base.id,
      groupId: sitemapItem.id,
      type: 'url' as const,
      data: { url: 'https://example.com/page-1', name: 'https://example.com/page-1' },
      status: 'idle' as const,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }

    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([sitemapItem])
    expandSitemapOwnerToCreateItemsMock.mockResolvedValue([
      {
        groupId: sitemapItem.id,
        type: 'url',
        data: { url: 'https://example.com/page-1', name: 'https://example.com/page-1' }
      }
    ])
    knowledgeItemCreateManyMock.mockResolvedValue({ items: [createdUrlItem] })

    await expect(service.addItems(base.id, [sitemapItem.id])).resolves.toBeUndefined()

    expect(expandSitemapOwnerToCreateItemsMock).toHaveBeenCalledWith(sitemapItem)
    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [createdUrlItem])
  })

  it('does not create expanded child items until all expansions succeed', async () => {
    const service = new KnowledgeOrchestrationService()
    const base = createBase()
    const directoryItem = createDirectoryItem()
    const sitemapItem = createSitemapItem()

    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([directoryItem, sitemapItem])
    expandDirectoryOwnerToCreateItemsMock.mockResolvedValue([
      {
        groupId: directoryItem.id,
        type: 'file',
        data: createFileItem('file-child', directoryItem.id).data
      }
    ])
    expandSitemapOwnerToCreateItemsMock.mockRejectedValue(new Error('sitemap expansion failed'))

    await expect(service.addItems(base.id, [directoryItem.id, sitemapItem.id])).rejects.toThrow(
      'sitemap expansion failed'
    )

    expect(knowledgeItemCreateManyMock).not.toHaveBeenCalled()
    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
  })
})
