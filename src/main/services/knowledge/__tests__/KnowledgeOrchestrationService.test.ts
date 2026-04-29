import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  runtimeAddItemsMock,
  runtimeCreateBaseMock,
  runtimeDeleteBaseMock,
  runtimeDeleteItemChunkMock,
  runtimeDeleteItemsMock,
  runtimeListItemChunksMock,
  runtimeReindexItemsMock,
  runtimeSearchMock,
  knowledgeBaseCreateMock,
  knowledgeBaseDeleteMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetDescendantItemsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetLeafDescendantItemsMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  runtimeAddItemsMock: vi.fn(),
  runtimeCreateBaseMock: vi.fn(),
  runtimeDeleteBaseMock: vi.fn(),
  runtimeDeleteItemChunkMock: vi.fn(),
  runtimeDeleteItemsMock: vi.fn(),
  runtimeListItemChunksMock: vi.fn(),
  runtimeReindexItemsMock: vi.fn(),
  runtimeSearchMock: vi.fn(),
  knowledgeBaseCreateMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetDescendantItemsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetLeafDescendantItemsMock: vi.fn()
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
    create: knowledgeBaseCreateMock,
    delete: knowledgeBaseDeleteMock,
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    delete: knowledgeItemDeleteMock,
    getDescendantItems: knowledgeItemGetDescendantItemsMock,
    getById: knowledgeItemGetByIdMock,
    getLeafDescendantItems: knowledgeItemGetLeafDescendantItemsMock
  }
}))

const { KnowledgeOrchestrationService } = await import('../KnowledgeOrchestrationService')

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: 1024,
    chunkOverlap: 200,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(
  id = 'note-1',
  status: KnowledgeItem['status'] = 'idle',
  groupId: string | null = null
): KnowledgeItem {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    status,
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(
  id = 'dir-1',
  status: KnowledgeItem['status'] = 'idle',
  groupId: string | null = null
): KnowledgeItem {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'directory',
    data: { source: `/docs/${id}`, path: `/docs/${id}` },
    status,
    phase: null,
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
          addItems: runtimeAddItemsMock,
          createBase: runtimeCreateBaseMock,
          deleteBase: runtimeDeleteBaseMock,
          deleteItemChunk: runtimeDeleteItemChunkMock,
          deleteItems: runtimeDeleteItemsMock,
          listItemChunks: runtimeListItemChunksMock,
          reindexItems: runtimeReindexItemsMock,
          search: runtimeSearchMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })

    knowledgeBaseCreateMock.mockResolvedValue(createBase())
    knowledgeBaseDeleteMock.mockResolvedValue(undefined)
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([])
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem())
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([createNoteItem()])
    runtimeAddItemsMock.mockResolvedValue(undefined)
    runtimeCreateBaseMock.mockResolvedValue(undefined)
    runtimeDeleteBaseMock.mockResolvedValue(undefined)
    runtimeDeleteItemChunkMock.mockResolvedValue(undefined)
    runtimeDeleteItemsMock.mockResolvedValue(undefined)
    runtimeListItemChunksMock.mockResolvedValue([])
    runtimeReindexItemsMock.mockResolvedValue(undefined)
    runtimeSearchMock.mockResolvedValue([])
  })

  it('uses WhenReady phase and depends on KnowledgeRuntimeService', () => {
    expect(getPhase(KnowledgeOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeOrchestrationService)).toEqual(['KnowledgeRuntimeService'])
  })

  it('registers caller-facing knowledge IPC handlers', () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as unknown as { onInit: () => void }).onInit()

    const handlerCalls = (service as unknown as { ipcHandle: ReturnType<typeof vi.fn> }).ipcHandle.mock.calls.map(
      (call) => call[0]
    )
    expect(handlerCalls).toEqual([
      'knowledge-runtime:create-base',
      'knowledge-runtime:delete-base',
      'knowledge-runtime:add-items',
      'knowledge-runtime:delete-items',
      'knowledge-runtime:reindex-items',
      'knowledge-runtime:search',
      'knowledge-runtime:list-item-chunks',
      'knowledge-runtime:delete-item-chunk'
    ])
  })

  it('creates a base and initializes its runtime store', async () => {
    const service = new KnowledgeOrchestrationService()
    const input = {
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'ollama::nomic-embed-text'
    }

    await expect(service.createBase(input)).resolves.toEqual(createBase())

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith(input)
    expect(runtimeCreateBaseMock).toHaveBeenCalledWith('kb-1')
  })

  it('rolls back the SQLite base when runtime base initialization fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const createError = new Error('vector store initialization failed')
    runtimeCreateBaseMock.mockRejectedValueOnce(createError)

    await expect(
      service.createBase({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'ollama::nomic-embed-text'
      })
    ).rejects.toBe(createError)

    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
  })

  it('does not delete the SQLite base when runtime base deletion fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const deleteError = new Error('vector store deletion failed')
    runtimeDeleteBaseMock.mockRejectedValueOnce(deleteError)

    await expect(service.deleteBase('kb-1')).rejects.toBe(deleteError)

    expect(runtimeDeleteBaseMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
  })

  it('delegates caller-friendly add item inputs to runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    const input = [{ type: 'note' as const, content: 'hello', source: 'note-1' }]

    const result = await service.addItems('kb-1', input)

    expect(result).toBeUndefined()
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', input)
  })

  it('rejects addItems when runtime acceptance fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const runtimeError = new Error('runtime acceptance failed')
    runtimeAddItemsMock.mockRejectedValueOnce(runtimeError)

    await expect(service.addItems('kb-1', [{ type: 'note', content: 'hello', source: 'note-1' }])).rejects.toBe(
      runtimeError
    )
  })

  it('passes all add item variants through to runtime without normalizing in orchestration', async () => {
    const service = new KnowledgeOrchestrationService()
    const file = {
      id: 'file-meta-1',
      name: 'guide.md',
      origin_name: 'guide.md',
      path: '/docs/guide.md',
      created_at: '2026-04-08T00:00:00.000Z',
      size: 12,
      ext: '.md',
      type: 'text' as const,
      count: 1
    }
    const inputs = [
      { type: 'url' as const, url: ' https://example.com/page ' },
      { type: 'sitemap' as const, url: 'https://example.com/sitemap.xml' },
      { type: 'directory' as const, path: '/docs/reference/' },
      { type: 'file' as const, file }
    ]

    await expect(service.addItems('kb-1', inputs)).resolves.toBeUndefined()

    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', inputs)
  })

  it('asks runtime to delete roots before deleting SQLite roots', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createNoteItem('note-root')
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root)

    await expect(service.deleteItems('kb-1', [root.id])).resolves.toBeUndefined()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(root.id)
  })

  it('collapses nested delete inputs to top-level roots', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createDirectoryItem('dir-root')
    const child = createNoteItem('note-child', 'idle', root.id)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root).mockResolvedValueOnce(child)
    knowledgeItemGetDescendantItemsMock.mockResolvedValueOnce([child]).mockResolvedValueOnce([])

    await expect(service.deleteItems('kb-1', [root.id, child.id])).resolves.toBeUndefined()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledTimes(1)
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(root.id)
  })

  it('collapses deep descendant delete inputs even when the intermediate parent is not selected', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createDirectoryItem('dir-root')
    const intermediate = createDirectoryItem('dir-child', 'idle', root.id)
    const leaf = createNoteItem('note-leaf', 'idle', intermediate.id)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root).mockResolvedValueOnce(leaf)
    knowledgeItemGetDescendantItemsMock.mockResolvedValueOnce([intermediate, leaf]).mockResolvedValueOnce([])

    await expect(service.deleteItems('kb-1', [root.id, leaf.id])).resolves.toBeUndefined()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledTimes(1)
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(root.id)
  })

  it('keeps sibling delete inputs after top-level root normalization', async () => {
    const service = new KnowledgeOrchestrationService()
    const first = createNoteItem('note-1')
    const second = createNoteItem('note-2')
    knowledgeItemGetByIdMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([])

    await expect(service.deleteItems('kb-1', [first.id, second.id])).resolves.toBeUndefined()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith('kb-1', [first, second])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(first.id)
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(second.id)
  })

  it('does not delete SQLite roots when runtime delete fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createNoteItem('note-root')
    const runtimeError = new Error('vector cleanup failed')
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root)
    runtimeDeleteItemsMock.mockRejectedValueOnce(runtimeError)

    await expect(service.deleteItems('kb-1', [root.id])).rejects.toBe(runtimeError)

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).not.toHaveBeenCalled()
  })

  it('asks runtime to reindex roots without deleting SQLite rows', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createNoteItem('note-root')
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root)

    await expect(service.reindexItems('kb-1', [root.id])).resolves.toBeUndefined()

    expect(runtimeReindexItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).not.toHaveBeenCalled()
  })

  it('collapses nested reindex inputs to top-level roots', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createDirectoryItem('dir-root')
    const child = createNoteItem('note-child', 'idle', root.id)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(root).mockResolvedValueOnce(child)
    knowledgeItemGetDescendantItemsMock.mockResolvedValueOnce([child]).mockResolvedValueOnce([])

    await expect(service.reindexItems('kb-1', [root.id, child.id])).resolves.toBeUndefined()

    expect(runtimeReindexItemsMock).toHaveBeenCalledWith('kb-1', [root])
    expect(knowledgeItemDeleteMock).not.toHaveBeenCalled()
  })

  it('searches through runtime after resolving the base', async () => {
    const service = new KnowledgeOrchestrationService()
    const results = [
      {
        pageContent: 'hello',
        score: 0.9,
        metadata: {
          itemId: 'note-1',
          itemType: 'note',
          source: 'note-1',
          chunkIndex: 0,
          tokenCount: 1
        },
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ]
    runtimeSearchMock.mockResolvedValue(results)

    await expect(service.search('kb-1', 'hello')).resolves.toEqual(results)
    expect(runtimeSearchMock).toHaveBeenCalledWith('kb-1', 'hello')
  })

  it('lists and deletes item chunks after checking item ownership', async () => {
    const service = new KnowledgeOrchestrationService()
    const chunks = [
      {
        id: 'chunk-1',
        itemId: 'note-1',
        content: 'hello',
        metadata: {
          itemId: 'note-1',
          itemType: 'note',
          source: 'note-1',
          chunkIndex: 0,
          tokenCount: 1
        }
      }
    ]
    runtimeListItemChunksMock.mockResolvedValueOnce(chunks)

    await expect(service.listItemChunks('kb-1', 'note-1')).resolves.toEqual(chunks)
    await expect(service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')).resolves.toBeUndefined()

    expect(knowledgeItemGetByIdMock).toHaveBeenCalledWith('note-1')
    expect(runtimeListItemChunksMock).toHaveBeenCalledWith('kb-1', 'note-1')
    expect(runtimeDeleteItemChunkMock).toHaveBeenCalledWith('kb-1', 'note-1', 'chunk-1')
  })
})
