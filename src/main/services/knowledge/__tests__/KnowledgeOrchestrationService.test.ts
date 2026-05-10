import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL, type KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runtimeAddItemsMock,
  runtimeCreateBaseMock,
  runtimeDeleteBaseArtifactsMock,
  runtimeDeleteBaseMock,
  runtimeDeleteItemChunkMock,
  runtimeDeleteItemsMock,
  runtimeListItemChunksMock,
  runtimeReindexItemsMock,
  runtimeSearchMock,
  failItemsMock,
  knowledgeBaseCreateMock,
  knowledgeBaseDeleteMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetDescendantItemsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetItemsByBaseIdMock,
  knowledgeItemGetLeafDescendantItemsMock
} = vi.hoisted(() => ({
  runtimeAddItemsMock: vi.fn(),
  runtimeCreateBaseMock: vi.fn(),
  runtimeDeleteBaseArtifactsMock: vi.fn(),
  runtimeDeleteBaseMock: vi.fn(),
  runtimeDeleteItemChunkMock: vi.fn(),
  runtimeDeleteItemsMock: vi.fn(),
  runtimeListItemChunksMock: vi.fn(),
  runtimeReindexItemsMock: vi.fn(),
  runtimeSearchMock: vi.fn(),
  failItemsMock: vi.fn(),
  knowledgeBaseCreateMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetDescendantItemsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  knowledgeItemGetLeafDescendantItemsMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeRuntimeService: {
      addItems: runtimeAddItemsMock,
      createBase: runtimeCreateBaseMock,
      deleteBase: runtimeDeleteBaseMock,
      deleteBaseArtifacts: runtimeDeleteBaseArtifactsMock,
      deleteItemChunk: runtimeDeleteItemChunkMock,
      deleteItems: runtimeDeleteItemsMock,
      listItemChunks: runtimeListItemChunksMock,
      reindexItems: runtimeReindexItemsMock,
      search: runtimeSearchMock
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
    getItemsByBaseId: knowledgeItemGetItemsByBaseIdMock,
    getLeafDescendantItems: knowledgeItemGetLeafDescendantItemsMock
  }
}))

vi.mock('../runtime/utils/cleanup', () => ({
  failItems: failItemsMock
}))

const { KnowledgeOrchestrationService, KnowledgeRuntimeAddItemsPartialError } = await import(
  '../KnowledgeOrchestrationService'
)

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createMissingModelBase() {
  return {
    ...createBase(),
    id: 'source-kb',
    name: 'Legacy KB',
    embeddingModelId: null,
    status: 'failed',
    error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
  }
}

function expectFailedBaseRuntimeGuard(error: unknown, operation: string) {
  expect(isDataApiError(error)).toBe(true)
  expect(error).toMatchObject({
    code: ErrorCode.VALIDATION_ERROR,
    message: `Cannot ${operation} failed knowledge base`,
    details: {
      fieldErrors: {
        base: [`Knowledge base 'kb-1' is in failed state; restore it before ${operation}.`]
      }
    }
  })
}

function expectCompletedBaseNoopRebuildGuard(error: unknown) {
  expect(isDataApiError(error)).toBe(true)
  expect(error).toMatchObject({
    code: ErrorCode.INVALID_OPERATION,
    message:
      'Invalid operation: restoreBase - Embedding model or dimensions must change when rebuilding a completed knowledge base',
    details: {
      operation: 'restoreBase',
      reason: 'Embedding model or dimensions must change when rebuilding a completed knowledge base'
    }
  })
}

function expectRestorePartialError(
  error: unknown,
  failures: Array<{ sourceItemId: string; sourceItemType: string; message: string }>
) {
  expect(error).toBeInstanceOf(KnowledgeRuntimeAddItemsPartialError)
  expect(error).toMatchObject({
    name: 'KnowledgeRuntimeAddItemsPartialError',
    message: `Failed to restore ${failures.length} knowledge root item(s)`,
    failures
  })
}

function createNoteItem(
  id = 'note-1',
  status: KnowledgeItem['status'] = 'idle',
  groupId: string | null = null
): KnowledgeItem {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(
  id = 'dir-1',
  status: KnowledgeItem['status'] = 'idle',
  groupId: string | null = null
): KnowledgeItem {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'directory',
    data: { source: `/docs/${id}`, path: `/docs/${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('KnowledgeOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    knowledgeBaseCreateMock.mockResolvedValue(createBase())
    knowledgeBaseDeleteMock.mockResolvedValue(undefined)
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([])
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem())
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([createNoteItem()])
    runtimeAddItemsMock.mockResolvedValue(undefined)
    runtimeCreateBaseMock.mockResolvedValue(undefined)
    runtimeDeleteBaseMock.mockResolvedValue([])
    runtimeDeleteBaseArtifactsMock.mockResolvedValue(undefined)
    runtimeDeleteItemChunkMock.mockResolvedValue(undefined)
    runtimeDeleteItemsMock.mockResolvedValue(undefined)
    failItemsMock.mockResolvedValue(undefined)
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
    expect(handlerCalls).toHaveLength(9)
    expect(handlerCalls).toEqual(
      expect.arrayContaining([
        'knowledge-runtime:create-base',
        'knowledge-runtime:restore-base',
        'knowledge-runtime:delete-base',
        'knowledge-runtime:add-items',
        'knowledge-runtime:delete-items',
        'knowledge-runtime:reindex-items',
        'knowledge-runtime:search',
        'knowledge-runtime:list-item-chunks',
        'knowledge-runtime:delete-item-chunk'
      ])
    )
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

  it('deletes the SQLite base before deleting vector artifacts', async () => {
    const service = new KnowledgeOrchestrationService()

    await expect(service.deleteBase('kb-1')).resolves.toBeUndefined()

    expect(runtimeDeleteBaseMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeDeleteBaseArtifactsMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeDeleteBaseArtifactsMock.mock.invocationCallOrder[0]
    )
  })

  it('does not delete the SQLite base when runtime base interruption fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const deleteError = new Error('base interruption failed')
    runtimeDeleteBaseMock.mockRejectedValueOnce(deleteError)

    await expect(service.deleteBase('kb-1')).rejects.toBe(deleteError)

    expect(runtimeDeleteBaseMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
    expect(runtimeDeleteBaseArtifactsMock).not.toHaveBeenCalled()
  })

  it('marks interrupted runtime items failed when SQLite base deletion fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const deleteError = new Error('sqlite delete failed')
    runtimeDeleteBaseMock.mockResolvedValueOnce(['item-1', 'item-2'])
    knowledgeBaseDeleteMock.mockRejectedValueOnce(deleteError)

    await expect(service.deleteBase('kb-1')).rejects.toBe(deleteError)

    expect(failItemsMock).toHaveBeenCalledWith(['item-1', 'item-2'], 'sqlite delete failed')
    expect(runtimeDeleteBaseArtifactsMock).not.toHaveBeenCalled()
  })

  it('reports partial deletion when post-SQLite artifact cleanup fails', async () => {
    const service = new KnowledgeOrchestrationService()
    runtimeDeleteBaseArtifactsMock.mockRejectedValueOnce(new Error('artifact delete failed'))

    await expect(service.deleteBase('kb-1')).rejects.toMatchObject({
      message: expect.stringContaining(
        'Invalid operation: deleteBase - SQLite knowledge base was deleted, but vector artifact cleanup failed: artifact delete failed'
      ),
      details: {
        operation: 'deleteBase',
        reason: expect.stringContaining('SQLite knowledge base was deleted, but vector artifact cleanup failed')
      }
    })

    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeDeleteBaseArtifactsMock).toHaveBeenCalledWith('kb-1')
    expect(failItemsMock).not.toHaveBeenCalled()
  })

  it('restores a failed base by creating a new base from source config and adding root items', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = {
      ...createMissingModelBase(),
      id: 'source-kb',
      name: 'Source KB',
      groupId: 'group-1',
      emoji: '📚',
      dimensions: 1024,
      rerankModelId: 'rerank-1',
      fileProcessorId: 'processor-1',
      threshold: 0.55,
      documentCount: 5,
      searchMode: 'hybrid',
      hybridAlpha: 0.7
    }
    const root = { ...createNoteItem('note-root'), baseId: sourceBase.id }
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: '  Source KB_bak  ',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).resolves.toEqual(createBase())

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith({
      name: 'Source KB_bak',
      groupId: 'group-1',
      emoji: '📚',
      dimensions: 3072,
      embeddingModelId: 'openai::text-embedding-3-large',
      rerankModelId: 'rerank-1',
      fileProcessorId: 'processor-1',
      chunkSize: sourceBase.chunkSize,
      chunkOverlap: 200,
      threshold: 0.55,
      documentCount: 5,
      searchMode: 'hybrid',
      hybridAlpha: 0.7
    })
    expect(knowledgeItemGetItemsByBaseIdMock).toHaveBeenCalledWith('source-kb', { groupId: null })
    expect(runtimeCreateBaseMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', [{ type: root.type, data: root.data }])
  })

  it('restores a failed base, keeps the source base, and allows reindexing the restored base', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = { ...createMissingModelBase(), id: 'source-kb' }
    const restoredBase = { ...createBase(), id: 'restored-kb' }
    const sourceRoot = { ...createNoteItem('source-root'), baseId: sourceBase.id }
    const restoredRoot = { ...createNoteItem('restored-root'), baseId: restoredBase.id }

    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase).mockResolvedValue(restoredBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([sourceRoot])
    knowledgeItemGetByIdMock.mockResolvedValueOnce(restoredRoot)

    await expect(
      service.restoreBase({
        sourceBaseId: sourceBase.id,
        name: restoredBase.name,
        embeddingModelId: restoredBase.embeddingModelId,
        dimensions: restoredBase.dimensions
      })
    ).resolves.toEqual(restoredBase)
    await expect(service.reindexItems(restoredBase.id, [restoredRoot.id])).resolves.toBeUndefined()

    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
    expect(runtimeDeleteBaseArtifactsMock).not.toHaveBeenCalled()
    expect(runtimeCreateBaseMock).toHaveBeenCalledWith(restoredBase.id)
    expect(runtimeAddItemsMock).toHaveBeenCalledWith(restoredBase.id, [
      { type: sourceRoot.type, data: sourceRoot.data }
    ])
    expect(runtimeReindexItemsMock).toHaveBeenCalledWith(restoredBase.id, [restoredRoot])
  })

  it('rebuilds a completed base when the embedding model changes', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = { ...createBase(), id: 'source-kb', embeddingModelId: 'ollama::old-embed', dimensions: 1024 }
    const root = { ...createNoteItem('note-root'), baseId: sourceBase.id }
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Source KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: sourceBase.dimensions
      })
    ).resolves.toEqual(createBase())

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: sourceBase.dimensions
      })
    )
    expect(runtimeCreateBaseMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', [{ type: root.type, data: root.data }])
  })

  it('rebuilds a completed base when dimensions change', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = { ...createBase(), id: 'source-kb', embeddingModelId: 'ollama::old-embed', dimensions: 1024 }
    const root = { ...createNoteItem('note-root'), baseId: sourceBase.id }
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Source KB_bak',
        embeddingModelId: sourceBase.embeddingModelId,
        dimensions: 3072
      })
    ).resolves.toEqual(createBase())

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModelId: sourceBase.embeddingModelId,
        dimensions: 3072
      })
    )
    expect(runtimeCreateBaseMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', [{ type: root.type, data: root.data }])
  })

  it('rejects completed base restore when embedding config is unchanged', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = { ...createBase(), id: 'source-kb', embeddingModelId: 'ollama::old-embed', dimensions: 1024 }
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Source KB_bak',
        embeddingModelId: sourceBase.embeddingModelId,
        dimensions: sourceBase.dimensions
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectCompletedBaseNoopRebuildGuard(error)
      return true
    })

    expect(knowledgeItemGetItemsByBaseIdMock).not.toHaveBeenCalled()
    expect(knowledgeBaseCreateMock).not.toHaveBeenCalled()
    expect(runtimeCreateBaseMock).not.toHaveBeenCalled()
    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
  })

  it('restores only source root items', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = createMissingModelBase()
    const root = { ...createNoteItem('note-root'), baseId: sourceBase.id }
    const child = { ...createNoteItem('note-child', 'idle', 'note-root'), baseId: sourceBase.id }
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Legacy KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).resolves.toEqual(createBase())

    expect(knowledgeItemGetItemsByBaseIdMock).toHaveBeenCalledWith('source-kb', { groupId: null })
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', [{ type: root.type, data: root.data }])
    expect(runtimeAddItemsMock).not.toHaveBeenCalledWith(
      'kb-1',
      expect.arrayContaining([{ type: child.type, data: child.data }])
    )
  })

  it('restores a base without adding items when it has no root items', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(createMissingModelBase())
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Legacy KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).resolves.toEqual(createBase())

    expect(knowledgeBaseCreateMock).toHaveBeenCalled()
    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
  })

  it('adds restored root items in one batch and deletes the new base when runtime acceptance fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = createMissingModelBase()
    const firstRoot = { ...createNoteItem('note-root-1'), baseId: sourceBase.id }
    const failedRoot = { ...createNoteItem('note-root-2'), baseId: sourceBase.id }
    const thirdRoot = { ...createNoteItem('note-root-3'), baseId: sourceBase.id }
    const error = new Error('runtime acceptance failed')
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([firstRoot, failedRoot, thirdRoot])
    runtimeAddItemsMock.mockRejectedValueOnce(error)

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Legacy KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).rejects.toSatisfy((restoreError: unknown) => {
      expectRestorePartialError(restoreError, [
        { sourceItemId: firstRoot.id, sourceItemType: firstRoot.type, message: error.message },
        { sourceItemId: failedRoot.id, sourceItemType: failedRoot.type, message: error.message },
        { sourceItemId: thirdRoot.id, sourceItemType: thirdRoot.type, message: error.message }
      ])
      return true
    })

    expect(runtimeAddItemsMock).toHaveBeenCalledOnce()
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', [
      { type: firstRoot.type, data: firstRoot.data },
      { type: failedRoot.type, data: failedRoot.data },
      { type: thirdRoot.type, data: thirdRoot.data }
    ])
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeDeleteBaseArtifactsMock).toHaveBeenCalledWith('kb-1')
  })

  it('aggregates root item parse failures without calling runtime addItems', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = createMissingModelBase()
    const firstRoot = { ...createNoteItem('note-root-1'), baseId: sourceBase.id }
    const invalidRoot = {
      ...createNoteItem('invalid-root'),
      baseId: sourceBase.id,
      type: 'unsupported',
      data: { source: 'invalid-root' }
    } as unknown as KnowledgeItem
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([firstRoot, invalidRoot])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Legacy KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).rejects.toSatisfy((restoreError: unknown) => {
      expectRestorePartialError(restoreError, [
        {
          sourceItemId: invalidRoot.id,
          sourceItemType: invalidRoot.type,
          message: expect.stringContaining('Invalid input')
        }
      ])
      return true
    })

    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(runtimeDeleteBaseArtifactsMock).toHaveBeenCalledWith('kb-1')
  })

  it('keeps the aggregate item acceptance error when cleanup of a failed restore also fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = createMissingModelBase()
    const root = { ...createNoteItem('note-root'), baseId: sourceBase.id }
    const error = new Error('runtime acceptance failed')
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root])
    runtimeAddItemsMock.mockRejectedValueOnce(error)
    runtimeDeleteBaseMock.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Legacy KB_bak',
        embeddingModelId: 'openai::text-embedding-3-large',
        dimensions: 3072
      })
    ).rejects.toSatisfy((restoreError: unknown) => {
      expectRestorePartialError(restoreError, [
        { sourceItemId: root.id, sourceItemType: root.type, message: error.message }
      ])
      return true
    })
    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
  })

  it('delegates create-item DTO inputs to runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    const input = [{ type: 'note' as const, data: { source: 'note-1', content: 'hello' } }]

    const result = await service.addItems('kb-1', input)

    expect(result).toBeUndefined()
    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', input)
  })

  it('rejects addItems when runtime acceptance fails', async () => {
    const service = new KnowledgeOrchestrationService()
    const runtimeError = new Error('runtime acceptance failed')
    runtimeAddItemsMock.mockRejectedValueOnce(runtimeError)

    await expect(
      service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello' } }])
    ).rejects.toBe(runtimeError)
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
      {
        type: 'url' as const,
        data: { source: 'https://example.com/page', url: 'https://example.com/page' }
      },
      {
        type: 'sitemap' as const,
        data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' }
      },
      { type: 'directory' as const, data: { source: '/docs/reference/', path: '/docs/reference/' } },
      { type: 'file' as const, data: { source: file.path, file } }
    ]

    await expect(service.addItems('kb-1', inputs)).resolves.toBeUndefined()

    expect(runtimeAddItemsMock).toHaveBeenCalledWith('kb-1', inputs)
  })

  it('rejects addItems on failed bases before calling runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ ...createMissingModelBase(), id: 'kb-1' })

    await expect(
      service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello' } }])
    ).rejects.toSatisfy((error: unknown) => {
      expectFailedBaseRuntimeGuard(error, 'addItems')
      return true
    })

    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
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
    expect(knowledgeItemDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      knowledgeItemDeleteMock.mock.invocationCallOrder[1]
    )
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

  it('rejects reindexItems on failed bases before resolving item roots or calling runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ ...createMissingModelBase(), id: 'kb-1' })

    await expect(service.reindexItems('kb-1', ['note-root'])).rejects.toSatisfy((error: unknown) => {
      expectFailedBaseRuntimeGuard(error, 'reindexItems')
      return true
    })

    expect(knowledgeItemGetByIdMock).not.toHaveBeenCalled()
    expect(runtimeReindexItemsMock).not.toHaveBeenCalled()
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
        scoreKind: 'relevance' as const,
        rank: 1,
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

  it('rejects search on failed bases before calling runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ ...createMissingModelBase(), id: 'kb-1' })

    await expect(service.search('kb-1', 'hello')).rejects.toSatisfy((error: unknown) => {
      expectFailedBaseRuntimeGuard(error, 'search')
      return true
    })

    expect(runtimeSearchMock).not.toHaveBeenCalled()
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

  it('rejects listItemChunks on failed bases before checking item ownership or calling runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ ...createMissingModelBase(), id: 'kb-1' })

    await expect(service.listItemChunks('kb-1', 'note-1')).rejects.toSatisfy((error: unknown) => {
      expectFailedBaseRuntimeGuard(error, 'listItemChunks')
      return true
    })

    expect(knowledgeItemGetByIdMock).not.toHaveBeenCalled()
    expect(runtimeListItemChunksMock).not.toHaveBeenCalled()
  })

  it('rejects deleteItemChunk on failed bases before checking item ownership or calling runtime', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ ...createMissingModelBase(), id: 'kb-1' })

    await expect(service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')).rejects.toSatisfy((error: unknown) => {
      expectFailedBaseRuntimeGuard(error, 'deleteItemChunk')
      return true
    })

    expect(knowledgeItemGetByIdMock).not.toHaveBeenCalled()
    expect(runtimeDeleteItemChunkMock).not.toHaveBeenCalled()
  })
})
