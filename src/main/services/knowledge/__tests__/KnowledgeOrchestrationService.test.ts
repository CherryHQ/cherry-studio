import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  createBaseMock,
  deleteBaseMock,
  processKnowledgeSourcesMock,
  runtimeDeleteItemsMock,
  runtimeDeleteItemChunkMock,
  runtimeListItemChunksMock,
  runtimeSearchMock,
  knowledgeBaseGetByIdMock,
  knowledgeBaseDeleteMock,
  knowledgeItemCreateManyInBaseMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetByIdsInBaseMock,
  knowledgeItemUpdateStatusesMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  createBaseMock: vi.fn(),
  deleteBaseMock: vi.fn(),
  processKnowledgeSourcesMock: vi.fn(),
  runtimeDeleteItemsMock: vi.fn(),
  runtimeDeleteItemChunkMock: vi.fn(),
  runtimeListItemChunksMock: vi.fn(),
  runtimeSearchMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeItemCreateManyInBaseMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetByIdsInBaseMock: vi.fn(),
  knowledgeItemUpdateStatusesMock: vi.fn()
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
    getById: knowledgeBaseGetByIdMock,
    delete: knowledgeBaseDeleteMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    createManyInBase: knowledgeItemCreateManyInBaseMock,
    delete: knowledgeItemDeleteMock,
    getByIdsInBase: knowledgeItemGetByIdsInBaseMock,
    updateStatuses: knowledgeItemUpdateStatusesMock
  }
}))

vi.mock('../processKnowledgeSources', () => ({
  processKnowledgeSources: processKnowledgeSourcesMock
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

function createNoteItem(id = 'note-1') {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note' as const,
    data: { content: `hello ${id}` },
    status: 'pending' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

async function flushBackgroundTasks() {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('KnowledgeOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeRuntimeService') {
        return {
          createBase: createBaseMock,
          deleteBase: deleteBaseMock,
          deleteItems: runtimeDeleteItemsMock,
          deleteItemChunk: runtimeDeleteItemChunkMock,
          listItemChunks: runtimeListItemChunksMock,
          search: runtimeSearchMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })

    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeBaseDeleteMock.mockResolvedValue(undefined)
    knowledgeItemCreateManyInBaseMock.mockResolvedValue({ items: [] })
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([createNoteItem()])
    knowledgeItemUpdateStatusesMock.mockResolvedValue([])
    createBaseMock.mockResolvedValue(undefined)
    deleteBaseMock.mockResolvedValue(undefined)
    processKnowledgeSourcesMock.mockResolvedValue(undefined)
    runtimeDeleteItemsMock.mockResolvedValue(undefined)
    runtimeDeleteItemChunkMock.mockResolvedValue(undefined)
    runtimeListItemChunksMock.mockResolvedValue([])
    runtimeSearchMock.mockResolvedValue([])
  })

  it('uses WhenReady phase and depends on KnowledgeRuntimeService', () => {
    expect(getPhase(KnowledgeOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeOrchestrationService)).toEqual(['KnowledgeRuntimeService'])
  })

  it('registers the caller-facing knowledge runtime IPC handlers', () => {
    const service = new KnowledgeOrchestrationService()
    ;(service as any).onInit()

    const handlerCalls = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])
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

  it('creates top-level sources as pending, starts background processing, and returns item ids', async () => {
    const service = new KnowledgeOrchestrationService()
    const createdNote = createNoteItem()
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [createdNote] })

    const result = await service.addSources('kb-1', [{ type: 'note', data: { content: 'hello note-1' } }])
    await flushBackgroundTasks()

    expect(result).toEqual({ itemIds: [createdNote.id] })
    expect(knowledgeItemCreateManyInBaseMock).toHaveBeenCalledWith(
      'kb-1',
      [{ type: 'note', data: { content: 'hello note-1' } }],
      { status: 'pending' }
    )
    expect(processKnowledgeSourcesMock).toHaveBeenCalledWith(createBase(), [createdNote])
  })

  it('marks accepted pending sources failed when background processing rejects', async () => {
    const service = new KnowledgeOrchestrationService()
    const createdNote = createNoteItem()
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [createdNote] })
    processKnowledgeSourcesMock.mockRejectedValueOnce(new Error('background failed'))

    await expect(service.addSources('kb-1', [{ type: 'note', data: { content: 'hello note-1' } }])).resolves.toEqual({
      itemIds: [createdNote.id]
    })
    await flushBackgroundTasks()

    expect(knowledgeItemUpdateStatusesMock).toHaveBeenCalledWith([createdNote.id], {
      status: 'failed',
      error: 'background failed'
    })
  })

  it('deletes runtime data and SQLite roots through orchestration', async () => {
    const service = new KnowledgeOrchestrationService()
    const note = createNoteItem()
    knowledgeItemGetByIdsInBaseMock.mockResolvedValueOnce([note])

    await expect(service.deleteItems('kb-1', [note.id])).resolves.toBeUndefined()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith(createBase(), [note])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(note.id)
  })

  it('deletes base runtime data before deleting the SQLite base', async () => {
    const service = new KnowledgeOrchestrationService()

    await expect(service.deleteBase('kb-1')).resolves.toBeUndefined()

    expect(deleteBaseMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(deleteBaseMock.mock.invocationCallOrder[0]).toBeLessThan(knowledgeBaseDeleteMock.mock.invocationCallOrder[0])
  })

  it('does not delete the SQLite base when runtime base deletion fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const deleteError = new Error('vector cleanup failed')
    deleteBaseMock.mockRejectedValueOnce(deleteError)

    await expect(service.deleteBase('kb-1')).rejects.toBe(deleteError)

    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
  })

  it('reindexes existing items by deleting them before recreating pending sources', async () => {
    const service = new KnowledgeOrchestrationService()
    const existingNote = createNoteItem('note-1')
    const recreatedNote = createNoteItem('note-2')
    knowledgeItemGetByIdsInBaseMock.mockResolvedValueOnce([existingNote])
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [recreatedNote] })

    await expect(service.reindexItems('kb-1', [existingNote.id])).resolves.toEqual({ itemIds: [recreatedNote.id] })
    await flushBackgroundTasks()

    expect(runtimeDeleteItemsMock).toHaveBeenCalledWith(createBase(), [existingNote])
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith(existingNote.id)
    expect(knowledgeItemCreateManyInBaseMock).toHaveBeenCalledWith(
      'kb-1',
      [{ type: 'note', groupId: null, data: existingNote.data }],
      { status: 'pending' }
    )
    expect(processKnowledgeSourcesMock).toHaveBeenCalledWith(createBase(), [recreatedNote])
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
          name: 'hello',
          chunkIndex: 0,
          tokenCount: 1
        },
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ]
    runtimeSearchMock.mockResolvedValue(results)

    await expect(service.search('kb-1', 'hello')).resolves.toEqual(results)
    expect(runtimeSearchMock).toHaveBeenCalledWith(createBase(), 'hello')
  })

  it('lists item chunks through runtime after resolving base and item ownership', async () => {
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
          name: 'hello',
          chunkIndex: 0,
          tokenCount: 1
        }
      }
    ]
    runtimeListItemChunksMock.mockResolvedValueOnce(chunks)

    await expect(service.listItemChunks('kb-1', 'note-1')).resolves.toEqual(chunks)

    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeItemGetByIdsInBaseMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(runtimeListItemChunksMock).toHaveBeenCalledWith(createBase(), 'note-1')
  })

  it('deletes an item chunk through runtime after resolving base and item ownership', async () => {
    const service = new KnowledgeOrchestrationService()

    await expect(service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')).resolves.toBeUndefined()

    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeItemGetByIdsInBaseMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(runtimeDeleteItemChunkMock).toHaveBeenCalledWith(createBase(), 'note-1', 'chunk-1')
  })
})
