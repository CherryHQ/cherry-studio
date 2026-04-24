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
  runtimeSearchMock,
  knowledgeBaseGetByIdMock,
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
  runtimeSearchMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
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
    getById: knowledgeBaseGetByIdMock
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
          search: runtimeSearchMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })

    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemCreateManyInBaseMock.mockResolvedValue({ items: [] })
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemGetByIdsInBaseMock.mockResolvedValue([createNoteItem()])
    knowledgeItemUpdateStatusesMock.mockResolvedValue([])
    createBaseMock.mockResolvedValue(undefined)
    deleteBaseMock.mockResolvedValue(undefined)
    processKnowledgeSourcesMock.mockResolvedValue(undefined)
    runtimeDeleteItemsMock.mockResolvedValue(undefined)
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
      'knowledge-runtime:search'
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

  it('searches through runtime after resolving the base', async () => {
    const service = new KnowledgeOrchestrationService()
    const results = [
      {
        pageContent: 'hello',
        score: 0.9,
        metadata: { itemId: 'note-1' },
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ]
    runtimeSearchMock.mockResolvedValue(results)

    await expect(service.search('kb-1', 'hello')).resolves.toEqual(results)
    expect(runtimeSearchMock).toHaveBeenCalledWith(createBase(), 'hello')
  })
})
