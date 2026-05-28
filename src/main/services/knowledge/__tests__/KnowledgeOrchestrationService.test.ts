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
  createInternalEntryMock,
  createStoreMock,
  deleteStoreMock,
  enqueueMock,
  fileProcessingStartTaskMock,
  getStoreIfExistsMock,
  knowledgeBaseCreateMock,
  knowledgeBaseDeleteMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetDeletingRootGroupsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetItemsByBaseIdMock,
  knowledgeItemGetOutermostSelectedItemIdsMock,
  knowledgeItemGetRootItemsByBaseIdMock,
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
  createInternalEntryMock: vi.fn(),
  createStoreMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  fileProcessingStartTaskMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  knowledgeBaseCreateMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetDeletingRootGroupsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  knowledgeItemGetOutermostSelectedItemIdsMock: vi.fn(),
  knowledgeItemGetRootItemsByBaseIdMock: vi.fn(),
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
    FileManager: {
      createInternalEntry: createInternalEntryMock
    },
    FileProcessingOrchestrationService: {
      startTask: fileProcessingStartTaskMock
    },
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
    getOutermostSelectedItemIds: knowledgeItemGetOutermostSelectedItemIdsMock,
    getRootItemsByBaseId: knowledgeItemGetRootItemsByBaseIdMock,
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
const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000501'
const PROCESSED_FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000502'

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

function createFileItem(
  id = 'file-1',
  baseId = 'kb-1',
  source = '/docs/source.pdf',
  status: KnowledgeItemOf<'file'>['status'] = 'idle'
): KnowledgeItemOf<'file'> {
  const lifecycle =
    status === 'failed' ? ({ status, error: `failed ${id}` } as const) : ({ status, error: null } as const)

  return {
    id,
    baseId,
    groupId: null,
    type: 'file',
    data: { source, fileEntryId: FILE_ENTRY_ID },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(
  id = 'dir-1',
  groupId: string | null = null,
  status: KnowledgeItemOf<'directory'>['status'] = 'idle'
): KnowledgeItemOf<'directory'> {
  const lifecycle =
    status === 'failed' ? ({ status, error: `failed ${id}` } as const) : ({ status, error: null } as const)

  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    ...lifecycle,
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
    knowledgeItemGetOutermostSelectedItemIdsMock.mockImplementation(async (_baseId: string, itemIds: string[]) => [
      ...new Set(itemIds)
    ])
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) {
          return [createNoteItem('note-1', 'kb-1', null, 'completed')]
        }

        return options.includeRoots ? rootIds.map((id) => createNoteItem(id, 'kb-1', null, 'completed')) : []
      }
    )
    knowledgeItemSetSubtreeStatusMock.mockResolvedValue(['note-1'])
    knowledgeItemUpdateStatusMock.mockImplementation(async (id: string, status: KnowledgeItemOf<'note'>['status']) => {
      return createNoteItem(id, createdItemBaseIds.get(id) ?? 'kb-1', null, status)
    })
    enqueueMock.mockResolvedValue({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
    fileProcessingStartTaskMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'pending'
    })
    createInternalEntryMock.mockResolvedValue({ id: PROCESSED_FILE_ENTRY_ID })
    createStoreMock.mockResolvedValue({
      deleteByIdAndExternalId: vectorDeleteByIdAndExternalIdMock,
      listByExternalId: vectorListByExternalIdMock,
      query: vectorQueryMock
    })
    vectorListByExternalIdMock.mockResolvedValue([])
    vectorQueryMock.mockResolvedValue({ nodes: [], similarities: [] })
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValue([])
  })

  it('uses WhenReady phase and depends on same-phase runtime services', () => {
    expect(getPhase(KnowledgeOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeOrchestrationService)).toEqual([
      'KnowledgeVectorStoreService',
      'FileManager',
      'JobManager',
      'FileProcessingOrchestrationService'
    ])
  })

  it('registers formal knowledge job handlers and caller-facing IPC handlers', () => {
    const service = new KnowledgeOrchestrationService()

    ;(service as unknown as { onInit: () => void }).onInit()

    expect(registerHandlerMock.mock.calls.map((call) => call[0])).toEqual([
      'knowledge.prepare-root',
      'knowledge.index-documents',
      'knowledge.check-file-processing-result',
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

  it('does not cancel knowledge jobs during service shutdown', async () => {
    const service = new KnowledgeOrchestrationService()
    const stop = (service as unknown as { onStop?: () => Promise<void> }).onStop

    if (stop) {
      await stop.call(service)
    }

    expect(cancelManyMock).not.toHaveBeenCalled()
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

  it('logs and stops startup deleting recovery when the initial scan fails', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetDeletingRootGroupsMock.mockRejectedValueOnce(new Error('scan failed'))

    await expect((service as unknown as { onAllReady: () => Promise<void> }).onAllReady()).resolves.toBeUndefined()

    expect(enqueueMock).not.toHaveBeenCalled()
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
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([createNoteItem('source-note', 'source-kb')])

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

  it('restores a completed base when embedding model and dimensions are unchanged', async () => {
    const service = new KnowledgeOrchestrationService()
    const sourceBase = createBase({ id: 'source-kb', embeddingModelId: 'provider::embed', dimensions: 3 })
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::embed', dimensions: 3 })
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([])

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::embed',
        dimensions: 3
      })
    ).resolves.toBe(restoredBase)

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Restored KB',
        embeddingModelId: 'provider::embed',
        dimensions: 3
      })
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

  it('starts file processing and schedules a check job for supported document files when the base has a processor', async () => {
    const service = new KnowledgeOrchestrationService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.pdf', fileEntryId: FILE_ENTRY_ID } }])

    expect(fileProcessingStartTaskMock).toHaveBeenCalledWith(
      {
        feature: 'document_to_markdown',
        fileEntryId: FILE_ENTRY_ID,
        processorId: 'doc2x'
      },
      {
        idempotencyKey: 'knowledge:kb-1:file-1:fp-start',
        parentId: undefined
      }
    )
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.check-file-processing-result',
      {
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        sourceFileEntryId: FILE_ENTRY_ID,
        checkCount: 0,
        firstScheduledAt: expect.any(Number)
      },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:file-1:fp-check:fp-job-1:0',
        queue: 'base.kb-1',
        parentId: 'fp-job-1',
        scheduledAt: expect.any(Number)
      })
    )
    expect(enqueueMock).not.toHaveBeenCalledWith('knowledge.index-documents', expect.anything(), expect.anything())
  })

  it('schedules direct indexing for file items when the extension does not need file processing', async () => {
    const service = new KnowledgeOrchestrationService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.md')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.md', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.md', fileEntryId: FILE_ENTRY_ID } }])

    expect(fileProcessingStartTaskMock).not.toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      { baseId: 'kb-1', itemId: 'file-1', parentJobId: null },
      {
        idempotencyKey: 'knowledge:kb-1:file-1:index',
        queue: 'base.kb-1',
        parentId: undefined
      }
    )
  })

  it('schedules direct indexing for document files when the base has no file processor', async () => {
    const service = new KnowledgeOrchestrationService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.pdf', fileEntryId: FILE_ENTRY_ID } }])

    expect(fileProcessingStartTaskMock).not.toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      { baseId: 'kb-1', itemId: 'file-1', parentJobId: null },
      {
        idempotencyKey: 'knowledge:kb-1:file-1:index',
        queue: 'base.kb-1',
        parentId: undefined
      }
    )
  })

  it('marks accepted addItems rows failed when job scheduling fails', async () => {
    const service = new KnowledgeOrchestrationService()
    enqueueMock
      .mockResolvedValueOnce({ id: 'job-1', snapshot: {}, finished: Promise.resolve({}) })
      .mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(
      service.addItems('kb-1', [
        { type: 'note', data: { source: 'note-1', content: 'hello 1' } },
        { type: 'note', data: { source: 'note-2', content: 'hello 2' } }
      ])
    ).rejects.toThrow('enqueue failed')

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-2', 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-2', 'failed', {
      error: 'Failed to schedule knowledge item job: enqueue failed'
    })
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', expect.anything())
  })

  it('keeps items deleting when delete cleanup enqueue fails', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1'))
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(service.deleteItems('kb-1', ['note-1'])).rejects.toThrow('enqueue failed')

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['note-1'], 'deleting')
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith('kb-1', ['note-1'], 'failed', expect.anything())
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('collapses nested delete and reindex inputs to top-level roots', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetOutermostSelectedItemIdsMock.mockResolvedValue(['dir-1'])
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([createDirectoryItem('dir-1', null, 'completed')])

    await service.deleteItems('kb-1', ['dir-1', 'note-1'])
    await service.reindexItems('kb-1', ['dir-1', 'note-1'])

    expect(knowledgeItemGetOutermostSelectedItemIdsMock).toHaveBeenNthCalledWith(1, 'kb-1', ['dir-1', 'note-1'])
    expect(knowledgeItemGetOutermostSelectedItemIdsMock).toHaveBeenNthCalledWith(2, 'kb-1', ['dir-1', 'note-1'])

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

  it('rejects reindex when any selected subtree item is not completed or failed', async () => {
    const service = new KnowledgeOrchestrationService()
    const root = createDirectoryItem('dir-1', null, 'completed')
    const processingChild = createNoteItem('note-1', 'kb-1', 'dir-1', 'processing')
    knowledgeItemGetByIdMock.mockResolvedValue(root)
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean } = {}) =>
        options.includeRoots ? [root, processingChild] : [processingChild]
    )

    await expect(service.reindexItems('kb-1', ['dir-1'])).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot reindex knowledge item until the entire subtree is completed or failed'
    })

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })

  it('rejects a whole reindex batch when one root subtree is still active', async () => {
    const service = new KnowledgeOrchestrationService()
    const completedRoot = createNoteItem('note-1', 'kb-1', null, 'completed')
    const failedRoot = createNoteItem('note-2', 'kb-1', null, 'failed')
    const activeRoot = createNoteItem('note-3', 'kb-1', null, 'embedding')
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      return { 'note-1': completedRoot, 'note-2': failedRoot, 'note-3': activeRoot }[id] ?? completedRoot
    })
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, rootIds: string[], options: { includeRoots?: boolean } = {}) => {
        if (!options.includeRoots) {
          return []
        }

        return rootIds.map((id) => ({ 'note-1': completedRoot, 'note-2': failedRoot, 'note-3': activeRoot })[id])
      }
    )

    await expect(service.reindexItems('kb-1', ['note-1', 'note-2', 'note-3'])).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })

    expect(enqueueMock).not.toHaveBeenCalled()
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
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', 'kb-1', null, 'completed'))
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

  it('lists chunks for completed directories without deleting children', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1', null, 'completed'))
    knowledgeItemGetSubtreeItemsMock
      .mockResolvedValueOnce([createNoteItem('note-1', 'kb-1', 'dir-1', 'completed')])
      .mockResolvedValueOnce([createNoteItem('note-1', 'kb-1', 'dir-1', 'completed')])
    vectorListByExternalIdMock.mockResolvedValueOnce([
      {
        id_: 'chunk-1',
        metadata: { itemId: NOTE_ITEM_ID, itemType: 'note', source: 'note-1', chunkIndex: 0, tokenCount: 2 },
        getContent: () => 'chunk text'
      }
    ])

    await expect(service.listItemChunks('kb-1', 'dir-1')).resolves.toEqual([
      expect.objectContaining({ id: 'chunk-1', itemId: NOTE_ITEM_ID, content: 'chunk text' })
    ])

    expect(vectorListByExternalIdMock).toHaveBeenCalledWith('note-1')
  })

  it('rejects listing chunks for completed directories with deleting children', async () => {
    const service = new KnowledgeOrchestrationService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1', null, 'completed'))
    knowledgeItemGetSubtreeItemsMock.mockResolvedValueOnce([
      createNoteItem('deleting-note', 'kb-1', 'dir-1', 'deleting')
    ])

    await expect(service.listItemChunks('kb-1', 'dir-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot list chunks for a deleting knowledge item'
    })
    expect(vectorListByExternalIdMock).not.toHaveBeenCalled()
  })

  it.each(['idle', 'processing', 'reading', 'embedding', 'failed', 'deleting'] as const)(
    'rejects chunk operations for %s leaf items',
    async (status) => {
      const service = new KnowledgeOrchestrationService()
      knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', 'kb-1', null, status))

      await expect(service.listItemChunks('kb-1', 'note-1')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot list chunks for a non-completed knowledge item'
      })
      await expect(service.deleteItemChunk('kb-1', 'note-1', 'chunk-1')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot delete chunk for a non-completed knowledge item'
      })

      expect(vectorListByExternalIdMock).not.toHaveBeenCalled()
      expect(vectorDeleteByIdAndExternalIdMock).not.toHaveBeenCalled()
    }
  )
})
