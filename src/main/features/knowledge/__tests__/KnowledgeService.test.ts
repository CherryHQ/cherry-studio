import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED,
  type KnowledgeBase,
  type KnowledgeItemOf
} from '@shared/data/types/knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../utils/storage/pathStorage'

const {
  cancelManyMock,
  cancelMock,
  getIndexStoreMock,
  deleteStoreMock,
  enqueueMock,
  fileProcessingStartJobMock,
  getJobMock,
  aiEmbedManyMock,
  knowledgeBaseCreateMock,
  knowledgeBaseDeleteMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetDeletingRootGroupsMock,
  knowledgeItemFailInterruptedItemsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetItemsByBaseIdMock,
  knowledgeItemGetOutermostSelectedItemIdsMock,
  knowledgeItemGetRootItemsByBaseIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  listMock,
  registerHandlerMock,
  rerankKnowledgeSearchResultsMock,
  copyFileIntoKnowledgeBaseAtMock,
  deleteKnowledgeItemFilesBestEffortMock,
  fsLstatMock,
  fsStatMock,
  listMaterialUnitsMock,
  storeSearchMock,
  probeKnowledgeFileMock,
  probeKnowledgeSourcePathMock
} = vi.hoisted(() => ({
  cancelManyMock: vi.fn(),
  cancelMock: vi.fn(),
  getIndexStoreMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  fileProcessingStartJobMock: vi.fn(),
  getJobMock: vi.fn(),
  aiEmbedManyMock: vi.fn(),
  knowledgeBaseCreateMock: vi.fn(),
  knowledgeBaseDeleteMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetDeletingRootGroupsMock: vi.fn(),
  knowledgeItemFailInterruptedItemsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  knowledgeItemGetOutermostSelectedItemIdsMock: vi.fn(),
  knowledgeItemGetRootItemsByBaseIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  listMock: vi.fn(),
  registerHandlerMock: vi.fn(),
  rerankKnowledgeSearchResultsMock: vi.fn(),
  copyFileIntoKnowledgeBaseAtMock: vi.fn(),
  deleteKnowledgeItemFilesBestEffortMock: vi.fn(),
  fsLstatMock: vi.fn(),
  fsStatMock: vi.fn(),
  listMaterialUnitsMock: vi.fn(),
  storeSearchMock: vi.fn(),
  probeKnowledgeFileMock: vi.fn(),
  probeKnowledgeSourcePathMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileProcessingService: {
      startJob: fileProcessingStartJobMock
    },
    JobManager: {
      cancel: cancelMock,
      cancelMany: cancelManyMock,
      enqueue: enqueueMock,
      get: getJobMock,
      list: listMock,
      registerHandler: registerHandlerMock
    },
    KnowledgeVectorStoreService: {
      getIndexStore: getIndexStoreMock,
      deleteStore: deleteStoreMock
    },
    AiService: {
      embedMany: aiEmbedManyMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('node:fs/promises', () => ({
  default: {
    lstat: fsLstatMock,
    stat: fsStatMock
  }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {
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
    failInterruptedItems: knowledgeItemFailInterruptedItemsMock,
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock,
    getItemsByBaseId: knowledgeItemGetItemsByBaseIdMock,
    getOutermostSelectedItemIds: knowledgeItemGetOutermostSelectedItemIdsMock,
    getRootItemsByBaseId: knowledgeItemGetRootItemsByBaseIdMock,
    setSubtreeStatus: knowledgeItemSetSubtreeStatusMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../utils/indexing/rerank', () => ({
  rerankKnowledgeSearchResults: rerankKnowledgeSearchResultsMock
}))

vi.mock('../utils/storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../utils/storage/pathStorage')
  return {
    ...actual,
    copyFileIntoKnowledgeBaseAt: copyFileIntoKnowledgeBaseAtMock,
    deleteKnowledgeItemFilesBestEffort: deleteKnowledgeItemFilesBestEffortMock,
    probeKnowledgeFile: probeKnowledgeFileMock,
    probeKnowledgeSourcePath: probeKnowledgeSourcePathMock
  }
})

const { KnowledgeService } = await import('../KnowledgeService')

const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const DELETING_NOTE_ITEM_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const MISSING_NOTE_ITEM_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const FAILED_NOTE_ITEM_ID = '0198f3f2-7d1d-7abc-8def-123456789abc'
const PROCESSING_NOTE_ITEM_ID = '0198f3f2-7d1e-7abc-8def-123456789abc'
const EMBEDDING_NOTE_ITEM_ID = '0198f3f2-7d1f-7abc-8def-123456789abc'
function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
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
    searchMode: 'vector',
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
    data: { source: id },
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
    data: { source, relativePath: source.split('/').pop() ?? source },
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const createdItemBaseIds = new Map<string, string>()

describe('KnowledgeService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    createdItemBaseIds.clear()
    knowledgeBaseCreateMock.mockResolvedValue(createBase())
    knowledgeBaseDeleteMock.mockResolvedValue(undefined)
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    fsStatMock.mockResolvedValue({
      isFile: () => true,
      size: 1024,
      birthtime: new Date('2026-04-08T00:00:00.000Z')
    })
    fsLstatMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    // Reindex source-existence gate: default every source readable so existing reindex tests are
    // unaffected; the missing/unverifiable-source tests override these per case.
    probeKnowledgeFileMock.mockResolvedValue('readable')
    probeKnowledgeSourcePathMock.mockResolvedValue('readable')
    copyFileIntoKnowledgeBaseAtMock.mockImplementation(
      async (_baseId: string, _sourcePath: string, relativePath: string) => relativePath
    )
    knowledgeItemCreateMock.mockImplementation(
      async (baseId: string, input: { type?: string; data: { source: string } }) => {
        createdItemBaseIds.set(input.data.source, baseId)
        if (input.type === 'file') {
          return createFileItem(input.data.source, baseId, input.data.source)
        }
        return createNoteItem(input.data.source, baseId)
      }
    )
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    deleteKnowledgeItemFilesBestEffortMock.mockResolvedValue(undefined)
    knowledgeItemGetDeletingRootGroupsMock.mockResolvedValue([])
    knowledgeItemFailInterruptedItemsMock.mockResolvedValue(0)
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
    fileProcessingStartJobMock.mockResolvedValue({ id: 'fp-job-1', snapshot: {}, finished: Promise.resolve({}) })
    getJobMock.mockResolvedValue(null)
    listMock.mockResolvedValue([])
    getIndexStoreMock.mockResolvedValue({
      search: storeSearchMock,
      listMaterialUnits: listMaterialUnitsMock
    })
    listMaterialUnitsMock.mockResolvedValue([])
    storeSearchMock.mockResolvedValue([])
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValue([])
    aiEmbedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })
    rerankKnowledgeSearchResultsMock.mockImplementation(async (_base, _query, results) => results)
  })

  it('uses WhenReady phase and depends on same-phase runtime services', () => {
    expect(getPhase(KnowledgeService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeService)).toEqual([
      'KnowledgeVectorStoreService',
      'JobManager',
      'FileProcessingService'
    ])
  })

  it('registers formal knowledge job handlers', () => {
    const service = new KnowledgeService()

    ;(service as unknown as { onInit: () => void }).onInit()

    expect(registerHandlerMock.mock.calls.map((call) => call[0])).toEqual([
      'knowledge.prepare-root',
      'knowledge.index-documents',
      'knowledge.check-file-processing-result',
      'knowledge.delete-subtree',
      'knowledge.reindex-subtree'
    ])
  })

  it('does not cancel knowledge jobs during service shutdown', async () => {
    const service = new KnowledgeService()
    const stop = (service as unknown as { onStop?: () => Promise<void> }).onStop

    if (stop) {
      await stop.call(service)
    }

    expect(cancelManyMock).not.toHaveBeenCalled()
  })

  it('recovers deleting roots by enqueueing delete cleanup jobs after all services are ready', async () => {
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
    knowledgeItemGetDeletingRootGroupsMock.mockRejectedValueOnce(new Error('scan failed'))

    await expect((service as unknown as { onAllReady: () => Promise<void> }).onAllReady()).resolves.toBeUndefined()

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('parks items interrupted mid-indexing at failed after all services are ready', async () => {
    const service = new KnowledgeService()
    knowledgeItemFailInterruptedItemsMock.mockResolvedValueOnce(3)

    await (service as unknown as { onAllReady: () => Promise<void> }).onAllReady()

    expect(knowledgeItemFailInterruptedItemsMock).toHaveBeenCalledWith(KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED)
  })

  it('does not let interrupted-item recovery failure abort startup', async () => {
    const service = new KnowledgeService()
    knowledgeItemFailInterruptedItemsMock.mockRejectedValueOnce(new Error('mark failed'))

    await expect((service as unknown as { onAllReady: () => Promise<void> }).onAllReady()).resolves.toBeUndefined()

    expect(knowledgeItemFailInterruptedItemsMock).toHaveBeenCalledWith(KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED)
  })

  it('creates vector artifacts after creating the base and rolls back on artifact failure', async () => {
    const service = new KnowledgeService()
    const base = createBase({ id: 'created-base' })
    knowledgeBaseCreateMock.mockResolvedValueOnce(base)

    await expect(service.createBase({ name: 'KB', dimensions: 3, embeddingModelId: 'provider::embed' })).resolves.toBe(
      base
    )
    expect(getIndexStoreMock).toHaveBeenCalledWith(base)

    getIndexStoreMock.mockRejectedValueOnce(new Error('store failed'))
    await expect(
      service.createBase({ name: 'KB', dimensions: 3, embeddingModelId: 'provider::embed' })
    ).rejects.toThrow('store failed')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
  })

  it('rollback removes the orphaned index dir and still surfaces the original error when cleanup itself fails', async () => {
    const service = new KnowledgeService()
    getIndexStoreMock.mockRejectedValueOnce(new Error('store failed'))
    // Even if the orphan-dir cleanup throws, the caller must see the open error.
    deleteStoreMock.mockRejectedValueOnce(new Error('cleanup boom'))

    await expect(
      service.createBase({ name: 'KB', dimensions: 3, embeddingModelId: 'provider::embed' })
    ).rejects.toThrow('store failed')

    expect(deleteStoreMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
  })

  it('deletes base jobs before vector artifacts and SQLite base', async () => {
    const service = new KnowledgeService()

    await service.deleteBase('kb-1')

    expect(listMock).toHaveBeenCalledWith({
      queue: 'base.kb-1',
      status: ['pending', 'delayed', 'running'],
      limit: 5000
    })
    expect(deleteStoreMock).toHaveBeenCalledWith('kb-1')
    expect(knowledgeBaseDeleteMock).toHaveBeenCalledWith('kb-1')
    expect(listMock.mock.invocationCallOrder[0]).toBeLessThan(deleteStoreMock.mock.invocationCallOrder[0])
    expect(deleteStoreMock.mock.invocationCallOrder[0]).toBeLessThan(
      knowledgeBaseDeleteMock.mock.invocationCallOrder[0]
    )
  })

  it('cancels file-processing jobs linked by active knowledge checks before deleting a base', async () => {
    const service = new KnowledgeService()
    listMock.mockResolvedValueOnce([
      {
        id: 'check-job',
        type: 'knowledge.check-file-processing-result',
        input: {
          baseId: 'kb-1',
          itemId: 'file-1',
          fileProcessingJobId: 'fp-job-1',
          pollRound: 0,
          firstScheduledAt: 1779811200000,
          parentJobId: null
        }
      }
    ])

    await service.deleteBase('kb-1')

    expect(cancelMock).toHaveBeenCalledWith('check-job', 'delete-base')
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'delete-base')
    expect(cancelMock.mock.invocationCallOrder[0]).toBeLessThan(deleteStoreMock.mock.invocationCallOrder[0])
    expect(cancelMock.mock.invocationCallOrder[1]).toBeLessThan(deleteStoreMock.mock.invocationCallOrder[0])
  })

  it('serializes concurrent deleteBase cleanup for the same base', async () => {
    const service = new KnowledgeService()
    const firstDeleteStoreEntered = createDeferred()
    const releaseFirstDeleteStore = createDeferred()
    const cleanupEvents: string[] = []
    let deleteStoreCallCount = 0
    deleteStoreMock.mockImplementation(async (baseId: string) => {
      deleteStoreCallCount += 1
      const callNumber = deleteStoreCallCount
      cleanupEvents.push(`delete-store-${callNumber}-start:${baseId}`)
      if (callNumber === 1) {
        firstDeleteStoreEntered.resolve()
        await releaseFirstDeleteStore.promise
      }
      cleanupEvents.push(`delete-store-${callNumber}-end:${baseId}`)
    })
    knowledgeBaseDeleteMock.mockImplementation(async (baseId: string) => {
      cleanupEvents.push(`sqlite-${cleanupEvents.filter((event) => event.startsWith('sqlite-')).length + 1}:${baseId}`)
    })

    const firstDelete = service.deleteBase('kb-1')
    await firstDeleteStoreEntered.promise
    const secondDelete = service.deleteBase('kb-1')
    await flushMicrotasks()

    expect(deleteStoreMock).toHaveBeenCalledTimes(1)
    expect(knowledgeBaseDeleteMock).not.toHaveBeenCalled()
    expect(cleanupEvents).toEqual(['delete-store-1-start:kb-1'])

    releaseFirstDeleteStore.resolve()
    await Promise.all([firstDelete, secondDelete])

    expect(cleanupEvents).toEqual([
      'delete-store-1-start:kb-1',
      'delete-store-1-end:kb-1',
      'sqlite-1:kb-1',
      'delete-store-2-start:kb-1',
      'delete-store-2-end:kb-1',
      'sqlite-2:kb-1'
    ])
  })

  it('restores a failed base by creating a new base and enqueueing restored root items', async () => {
    const service = new KnowledgeService()
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
    ).resolves.toEqual({ base: restoredBase, skippedMissingSourceCount: 0 })

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      expect.objectContaining({ baseId: 'restored-kb' }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('knowledge:restored-kb:') })
    )
  })

  it('skips a root item whose source is gone and restores the rest (partial restore)', async () => {
    // M4: a failed base often holds an item whose source no longer exists — a v1-migrated directory
    // child has a virtual path with no raw/ file, and a deleted file has no material to copy. Because
    // addItems is atomic, one such item used to abort the whole restore. Restore now probes each root
    // and skips only the genuinely-missing ones, restoring the rest.
    const service = new KnowledgeService()
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::new', dimensions: 6 })
    knowledgeBaseGetByIdMock
      .mockResolvedValueOnce(createBase({ id: 'source-kb', status: 'failed' }))
      .mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([
      createNoteItem('keep-note', 'source-kb'),
      createFileItem('gone-file', 'source-kb', '/docs/gone.pdf')
    ])
    // The file's material is gone; a note never probes the filesystem (always rebuildable).
    probeKnowledgeFileMock.mockResolvedValue('missing')

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::new',
        dimensions: 6
      })
    ).resolves.toEqual({ base: restoredBase, skippedMissingSourceCount: 1 })

    // The note is restored into the new base; the missing-source file is skipped, not restored.
    expect(createdItemBaseIds.get('keep-note')).toBe('restored-kb')
    expect(createdItemBaseIds.has('/docs/gone.pdf')).toBe(false)
  })

  it('keeps an unverifiable source during restore instead of skipping it (restore is not reindex)', async () => {
    // The restore docstring promises an `unverifiable` source (a transient/permission probe error, not
    // a genuine ENOENT) is KEPT — the invariant that separates restore from reindex, which skips both
    // `missing` and `unverifiable`. Restore skips only `missing`. A refactor that also skipped
    // `unverifiable` would silently drop recoverable items and still pass every other restore test.
    const service = new KnowledgeService()
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::new', dimensions: 6 })
    knowledgeBaseGetByIdMock
      .mockResolvedValueOnce(createBase({ id: 'source-kb', status: 'failed' }))
      .mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([
      createFileItem('probe-fail-file', 'source-kb', '/docs/report.pdf')
    ])
    // A transient/permission probe error classifies the source as `unverifiable`, not `missing`.
    probeKnowledgeFileMock.mockResolvedValue('unverifiable')

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::new',
        dimensions: 6
      })
    ).resolves.toEqual({ base: restoredBase, skippedMissingSourceCount: 0 })

    // The unverifiable-source file is restored into the new base, not dropped.
    expect(createdItemBaseIds.get('/docs/report.pdf')).toBe('restored-kb')
  })

  it('creates an empty base and counts every root when all sources are missing', async () => {
    // When every root's source is genuinely gone, restorableRootItems is empty: createBase still builds
    // the fully-configured base, addItems([]) short-circuits without enqueuing an index job, and
    // skippedMissingSourceCount equals the root count. This is the deliberate never-abort tradeoff (the
    // dialog surfaces the generic skipped-sources warning) — pin the count so it can't silently change.
    const service = new KnowledgeService()
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::new', dimensions: 6 })
    knowledgeBaseGetByIdMock
      .mockResolvedValueOnce(createBase({ id: 'source-kb', status: 'failed' }))
      .mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([
      createFileItem('gone-1', 'source-kb', '/docs/gone-1.pdf'),
      createFileItem('gone-2', 'source-kb', '/docs/gone-2.pdf')
    ])
    probeKnowledgeFileMock.mockResolvedValue('missing')

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::new',
        dimensions: 6
      })
    ).resolves.toEqual({ base: restoredBase, skippedMissingSourceCount: 2 })

    // The empty base is still created; nothing is enqueued because addItems([]) short-circuits.
    expect(knowledgeBaseCreateMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(createdItemBaseIds.size).toBe(0)
  })

  it('restores a completed base when embedding model and dimensions are unchanged', async () => {
    const service = new KnowledgeService()
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
    ).resolves.toEqual({ base: restoredBase, skippedMissingSourceCount: 0 })

    expect(knowledgeBaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Restored KB',
        embeddingModelId: 'provider::embed',
        dimensions: 3
      })
    )
  })

  it('surfaces restored base id when restore item failure cleanup also fails', async () => {
    const service = new KnowledgeService()
    const sourceBase = createBase({ id: 'source-kb', embeddingModelId: 'provider::embed', dimensions: 3 })
    const restoredBase = createBase({ id: 'restored-kb', embeddingModelId: 'provider::embed', dimensions: 3 })
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([createNoteItem('source-note', 'source-kb')])
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed'))
    deleteStoreMock.mockRejectedValueOnce(new Error('delete store failed'))

    await expect(
      service.restoreBase({
        sourceBaseId: 'source-kb',
        name: 'Restored KB',
        embeddingModelId: 'provider::embed',
        dimensions: 3
      })
    ).rejects.toThrow(
      "Restored knowledge base 'restored-kb' could not be cleaned up automatically: delete store failed"
    )
  })

  it('restores a processed file by copying its source and artifact, then indexes without reprocessing', async () => {
    const service = new KnowledgeService()
    const sourceBase = createBase({ id: 'source-kb', fileProcessorId: 'doc2x' })
    const restoredBase = createBase({ id: 'restored-kb', fileProcessorId: 'doc2x' })
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase).mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)

    const processedSourceFile = {
      ...createFileItem('src-file', 'source-kb', '/docs/report.pdf'),
      data: { source: '/docs/report.pdf', relativePath: 'report.pdf', indexedRelativePath: 'report.md' }
    }
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([processedSourceFile])

    const restoredFile = {
      ...createFileItem('restored-file', 'restored-kb', '/docs/report.pdf', 'processing'),
      data: { source: '/docs/report.pdf', relativePath: 'report.pdf', indexedRelativePath: 'report.md' }
    }
    knowledgeItemCreateMock.mockResolvedValueOnce(restoredFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(restoredFile)
    knowledgeItemGetByIdMock.mockResolvedValue(restoredFile)

    await service.restoreBase({
      sourceBaseId: 'source-kb',
      name: 'Restored KB',
      embeddingModelId: 'provider::embed',
      dimensions: 3
    })

    // Both the source file and its already-processed artifact are copied into the restored base.
    expect(copyFileIntoKnowledgeBaseAtMock.mock.calls).toEqual([
      ['restored-kb', '/mock/feature.knowledgebase.data/source-kb/raw/report.pdf', 'report.pdf'],
      ['restored-kb', '/mock/feature.knowledgebase.data/source-kb/raw/report.md', 'report.md']
    ])
    // The created item carries the artifact path.
    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(
      'restored-kb',
      expect.objectContaining({
        type: 'file',
        data: { source: '/docs/report.pdf', relativePath: 'report.pdf', indexedRelativePath: 'report.md' }
      })
    )
    // The file processor is skipped and indexing runs straight from the artifact (re-embedding still happens).
    expect(fileProcessingStartJobMock).not.toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      expect.objectContaining({ baseId: 'restored-kb', itemId: 'restored-file' }),
      expect.anything()
    )
  })

  it('restores a url with a captured snapshot by copying it in so the first index reads it offline', async () => {
    const service = new KnowledgeService()
    const sourceBase = createBase({ id: 'source-kb' })
    const restoredBase = createBase({ id: 'restored-kb' })
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase).mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)

    const sourceUrl = {
      ...createNoteItem('source-url', 'source-kb'),
      type: 'url' as const,
      data: { source: 'https://example.com', url: 'https://example.com', relativePath: 'example-page.md' }
    }
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([sourceUrl])

    await service.restoreBase({
      sourceBaseId: 'source-kb',
      name: 'Restored KB',
      embeddingModelId: 'provider::embed',
      dimensions: 3
    })

    // The snapshot markdown is copied into the restored base under the same name.
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'restored-kb',
      '/mock/feature.knowledgebase.data/source-kb/raw/example-page.md',
      'example-page.md'
    )
    // The created url item is pinned to the copied snapshot so first index reads it offline.
    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(
      'restored-kb',
      expect.objectContaining({
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com', relativePath: 'example-page.md' }
      })
    )
  })

  it('restores a url without a captured snapshot by re-fetching on first index', async () => {
    const service = new KnowledgeService()
    const sourceBase = createBase({ id: 'source-kb' })
    const restoredBase = createBase({ id: 'restored-kb' })
    knowledgeBaseGetByIdMock.mockResolvedValueOnce(sourceBase).mockResolvedValue(restoredBase)
    knowledgeBaseCreateMock.mockResolvedValueOnce(restoredBase)

    const sourceUrl = {
      ...createNoteItem('source-url', 'source-kb'),
      type: 'url' as const,
      data: { source: 'https://example.com', url: 'https://example.com' }
    }
    knowledgeItemGetRootItemsByBaseIdMock.mockResolvedValueOnce([sourceUrl])

    await service.restoreBase({
      sourceBaseId: 'source-kb',
      name: 'Restored KB',
      embeddingModelId: 'provider::embed',
      dimensions: 3
    })

    // No snapshot to carry: the restored url has no relativePath so first index re-captures it.
    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(
      'restored-kb',
      expect.objectContaining({ type: 'url', data: { source: 'https://example.com', url: 'https://example.com' } })
    )
    expect(copyFileIntoKnowledgeBaseAtMock).not.toHaveBeenCalled()
  })

  it('schedules add, delete, and reindex through the new workflow jobs', async () => {
    const service = new KnowledgeService()
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'))
    const service = new KnowledgeService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.pdf', path: '/docs/source.pdf' } }])

    expect(fileProcessingStartJobMock).toHaveBeenCalledWith(
      {
        feature: 'document_to_markdown',
        file: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.pdf' },
        output: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' },
        context: { dataId: 'file-1' },
        processorId: 'doc2x'
      },
      {
        parentId: undefined
      }
    )
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.check-file-processing-result',
      {
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        pollRound: 0,
        firstScheduledAt: expect.any(Number),
        parentJobId: 'fp-job-1'
      },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:file-1:fp-check:fp-job-1:0',
        queue: 'base.kb-1',
        parentId: 'fp-job-1',
        scheduledAt: Date.parse('2026-04-08T00:00:05.000Z')
      })
    )
    expect(enqueueMock).not.toHaveBeenCalledWith('knowledge.index-documents', expect.anything(), expect.anything())
  })

  it('auto-renames a duplicate uploaded file name instead of rejecting the import', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    knowledgeItemCreateMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/notes.md'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/notes.md'))
    knowledgeItemUpdateStatusMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/notes.md', 'processing'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/notes.md', 'processing'))
    knowledgeItemGetByIdMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/notes.md', 'processing'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/notes.md', 'processing'))

    await service.addItems('kb-1', [
      { type: 'file', data: { source: '/Users/me/a/notes.md', path: '/Users/me/a/notes.md' } },
      { type: 'file', data: { source: '/Users/me/b/notes.md', path: '/Users/me/b/notes.md' } }
    ])

    // Both imports land; the second's relativePath is deduped (`_N`) rather than refused.
    expect(knowledgeItemCreateMock).toHaveBeenCalledTimes(2)
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenNthCalledWith(1, 'kb-1', '/Users/me/a/notes.md', 'notes.md')
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenNthCalledWith(2, 'kb-1', '/Users/me/b/notes.md', 'notes_1.md')
  })

  it('auto-renames a file whose processed-markdown name would collide', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemCreateMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/brief.pdf'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/brief.docx'))
    knowledgeItemUpdateStatusMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/brief.pdf', 'processing'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/brief.docx', 'processing'))
    knowledgeItemGetByIdMock
      .mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/a/brief.pdf', 'processing'))
      .mockResolvedValueOnce(createFileItem('file-2', 'kb-1', '/Users/me/b/brief.docx', 'processing'))

    await service.addItems('kb-1', [
      { type: 'file', data: { source: '/Users/me/a/brief.pdf', path: '/Users/me/a/brief.pdf' } },
      { type: 'file', data: { source: '/Users/me/b/brief.docx', path: '/Users/me/b/brief.docx' } }
    ])

    // brief.pdf reserves brief.pdf + its brief.md output; brief.docx would also emit
    // brief.md, so it is bumped to brief_1.docx (whose brief_1.md sibling is free).
    expect(knowledgeItemCreateMock).toHaveBeenCalledTimes(2)
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenNthCalledWith(1, 'kb-1', '/Users/me/a/brief.pdf', 'brief.pdf')
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenNthCalledWith(2, 'kb-1', '/Users/me/b/brief.docx', 'brief_1.docx')
  })

  it('auto-renames a restored url snapshot whose name collides with an existing url snapshot', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    // The base already holds a url whose captured snapshot occupies `example-page.md` under `raw/`.
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([
      {
        ...createNoteItem('existing-url', 'kb-1'),
        type: 'url' as const,
        data: { source: 'https://example.com/old', url: 'https://example.com/old', relativePath: 'example-page.md' }
      }
    ])

    await service.addItems('kb-1', [
      {
        type: 'url',
        data: {
          source: 'https://example.com/new',
          url: 'https://example.com/new',
          snapshotPath: '/captured/example-page.md'
        }
      }
    ])

    // The restored snapshot's name collides with the existing url's reserved path, so it is
    // deduped to `_N` instead of hard-failing the on-disk copy — the bug was that existing url
    // snapshots were never added to the reserved set, so reservation could not see the collision.
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      '/captured/example-page.md',
      'example-page_1.md'
    )
    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({
        type: 'url',
        data: { source: 'https://example.com/new', url: 'https://example.com/new', relativePath: 'example-page_1.md' }
      })
    )
  })

  it('cleans up a restored url snapshot when a mid-batch create fails, so the url stays re-restorable', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([])
    // The url restore copies its snapshot to raw/ before the row is created; that create fails.
    knowledgeItemCreateMock.mockRejectedValueOnce(new Error('db down'))

    await expect(
      service.addItems('kb-1', [
        {
          type: 'url',
          data: {
            source: 'https://example.com/p',
            url: 'https://example.com/p',
            snapshotPath: '/captured/example-page.md'
          }
        }
      ])
    ).rejects.toThrow('db down')

    // The copied url snapshot must be in the rollback cleanup list (the W1 fix); before it,
    // only file-type copies were tracked, so the snapshot leaked and a same-titled re-restore
    // later hard-failed on the orphan.
    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith(
      'kb-1',
      [expect.objectContaining({ type: 'url', data: expect.objectContaining({ relativePath: 'example-page.md' }) })],
      expect.anything()
    )
  })

  it('auto-renames a file whose name collides with an existing note snapshot', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    // The base already holds a note whose captured snapshot occupies `Meeting notes.md` under `raw/`.
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([
      {
        ...createNoteItem('existing-note', 'kb-1'),
        type: 'note' as const,
        data: { source: 'Meeting notes', content: 'hello', relativePath: 'Meeting notes.md' }
      }
    ])
    knowledgeItemCreateMock.mockResolvedValueOnce(createFileItem('file-1', 'kb-1', '/Users/me/Meeting notes.md'))
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(
      createFileItem('file-1', 'kb-1', '/Users/me/Meeting notes.md', 'processing')
    )
    knowledgeItemGetByIdMock.mockResolvedValueOnce(
      createFileItem('file-1', 'kb-1', '/Users/me/Meeting notes.md', 'processing')
    )

    await service.addItems('kb-1', [
      { type: 'file', data: { source: '/Users/me/Meeting notes.md', path: '/Users/me/Meeting notes.md' } }
    ])

    // The new file's name collides with the existing note's reserved snapshot path, so it is
    // deduped to `_N` instead of hard-failing the on-disk copy — note snapshots must enter the
    // reserved set just like url snapshots (they too live as base files under `raw/`).
    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      '/Users/me/Meeting notes.md',
      'Meeting notes_1.md'
    )
    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({
        type: 'file',
        data: { source: '/Users/me/Meeting notes.md', relativePath: 'Meeting notes_1.md' }
      })
    )
  })

  it('throws when a file’s processed-markdown name collides with an existing note snapshot', async () => {
    const service = new KnowledgeService()
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)
    // An existing note already occupies the `source.md` path the processor would write its output to.
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([
      {
        ...createNoteItem('existing-note', 'kb-1'),
        type: 'note' as const,
        data: { source: 'Source', content: 'hello', relativePath: 'source.md' }
      }
    ])

    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleItem(baseId: string, itemId: string, parentJobId?: string | null): Promise<void>
        }
      }
    ).workflowService

    // The processed-artifact reservation guard must treat the note snapshot as occupied (it lives
    // under `raw/` too), so it refuses the colliding `.md` output instead of overwriting it on disk.
    await expect(workflowService.scheduleItem('kb-1', 'file-1')).rejects.toThrow(
      'Knowledge file already exists: source.md'
    )
    expect(fileProcessingStartJobMock).not.toHaveBeenCalled()
  })

  it('auto-renames against a file imported in an earlier addItems call, not just within one call', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    // A prior import already stored notes.md; loadReservedKnowledgeFilePaths must surface
    // the existing row's relativePath so a later import of the same name deduplicates
    // against it rather than colliding and failing the whole batch at assertTargetAvailable.
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([createFileItem('file-existing', 'kb-1', '/old/notes.md')])

    await service.addItems('kb-1', [
      { type: 'file', data: { source: '/Users/me/c/notes.md', path: '/Users/me/c/notes.md' } }
    ])

    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith('kb-1', '/Users/me/c/notes.md', 'notes_1.md')
  })

  it('auto-renames against the processed-markdown sibling reserved for an earlier-imported document', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    // The stored brief.pdf reserves both brief.pdf and its derived brief.md sibling. A later
    // brief.md import must dedupe against that derived reservation — guarding the sibling
    // derivation in loadReservedKnowledgeFilePaths, not just the stored relativePath.
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([createFileItem('file-existing', 'kb-1', '/old/brief.pdf')])

    await service.addItems('kb-1', [
      { type: 'file', data: { source: '/Users/me/c/brief.md', path: '/Users/me/c/brief.md' } }
    ])

    expect(copyFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith('kb-1', '/Users/me/c/brief.md', 'brief_1.md')
  })

  it('rejects unsupported uploaded file extensions before copying files', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))

    await expect(
      service.addItems('kb-1', [{ type: 'file', data: { source: '/Users/me/app.exe', path: '/Users/me/app.exe' } }])
    ).rejects.toThrow('Unsupported knowledge file type: /Users/me/app.exe')

    expect(knowledgeItemCreateMock).not.toHaveBeenCalled()
    expect(copyFileIntoKnowledgeBaseAtMock).not.toHaveBeenCalled()
    expect(fileProcessingStartJobMock).not.toHaveBeenCalled()
  })

  it('passes the parent job when starting file processing during reindex', async () => {
    const service = new KnowledgeService()
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleItem(baseId: string, itemId: string, parentJobId?: string | null): Promise<void>
        }
      }
    ).workflowService
    await workflowService.scheduleItem('kb-1', 'file-1', 'reindex-job')

    expect(fileProcessingStartJobMock).toHaveBeenCalledWith(
      {
        feature: 'document_to_markdown',
        file: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.pdf' },
        output: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' },
        context: { dataId: 'file-1' },
        processorId: 'doc2x'
      },
      {
        parentId: 'reindex-job'
      }
    )
    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.check-file-processing-result',
      {
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        pollRound: 0,
        firstScheduledAt: expect.any(Number),
        parentJobId: 'reindex-job'
      },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:file-1:fp-check:fp-job-1:0',
        queue: 'base.kb-1',
        parentId: 'reindex-job',
        scheduledAt: expect.any(Number)
      })
    )
  })

  it('cancels the started file-processing job when check scheduling fails', async () => {
    const service = new KnowledgeService()
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)
    enqueueMock.mockRejectedValueOnce(new Error('check enqueue failed'))

    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleItem(baseId: string, itemId: string, parentJobId?: string | null): Promise<void>
        }
      }
    ).workflowService

    await expect(workflowService.scheduleItem('kb-1', 'file-1')).rejects.toThrow('check enqueue failed')

    expect(fileProcessingStartJobMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-file-processing-check-enqueue-failed')
  })

  it('preserves check scheduling errors when rollback cancellation fails', async () => {
    const service = new KnowledgeService()
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)
    enqueueMock.mockRejectedValueOnce(new Error('check enqueue failed'))
    cancelMock.mockRejectedValueOnce(new Error('cancel failed'))

    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleItem(baseId: string, itemId: string, parentJobId?: string | null): Promise<void>
        }
      }
    ).workflowService

    await expect(workflowService.scheduleItem('kb-1', 'file-1')).rejects.toThrow('check enqueue failed')
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-file-processing-check-enqueue-failed')
  })

  it('uses the parent job as the direct indexing idempotency scope during reindex', async () => {
    const service = new KnowledgeService()
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.md', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleItem(baseId: string, itemId: string, parentJobId?: string | null): Promise<void>
        }
      }
    ).workflowService
    await workflowService.scheduleItem('kb-1', 'file-1', 'reindex-job')

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.index-documents',
      { baseId: 'kb-1', itemId: 'file-1', parentJobId: 'reindex-job' },
      {
        idempotencyKey: 'knowledge:kb-1:file-1:index:reindex-job',
        queue: 'base.kb-1',
        parentId: 'reindex-job'
      }
    )
  })

  it('schedules follow-up file-processing checks with a five-second delay', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'))
    const service = new KnowledgeService()
    const workflowService = (
      service as unknown as {
        workflowService: {
          scheduleFileProcessingCheck(
            baseId: string,
            itemId: string,
            fileProcessingJobId: string,
            options: { pollRound: number; firstScheduledAt: number; parentJobId: string | null }
          ): Promise<void>
        }
      }
    ).workflowService

    await workflowService.scheduleFileProcessingCheck('kb-1', 'file-1', 'fp-job-1', {
      pollRound: 1,
      firstScheduledAt: Date.parse('2026-04-08T00:00:00.000Z'),
      parentJobId: 'check-job-0'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'knowledge.check-file-processing-result',
      {
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        pollRound: 1,
        firstScheduledAt: Date.parse('2026-04-08T00:00:00.000Z'),
        parentJobId: 'check-job-0'
      },
      expect.objectContaining({
        idempotencyKey: 'knowledge:kb-1:file-1:fp-check:fp-job-1:1',
        queue: 'base.kb-1',
        parentId: 'check-job-0',
        scheduledAt: Date.parse('2026-04-08T00:00:05.000Z')
      })
    )
  })

  it('schedules direct indexing for file items when the extension does not need file processing', async () => {
    const service = new KnowledgeService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.md')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.md', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: 'doc2x' }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.md', path: '/docs/source.md' } }])

    expect(fileProcessingStartJobMock).not.toHaveBeenCalled()
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
    const service = new KnowledgeService()
    const createdFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf')
    const processingFile = createFileItem('file-1', 'kb-1', '/docs/source.pdf', 'processing')
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ fileProcessorId: null }))
    knowledgeItemCreateMock.mockResolvedValueOnce(createdFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingFile)
    knowledgeItemGetByIdMock.mockResolvedValueOnce(processingFile)

    await service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/source.pdf', path: '/docs/source.pdf' } }])

    expect(fileProcessingStartJobMock).not.toHaveBeenCalled()
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
    const service = new KnowledgeService()
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

  it('rolls back every created addItems row when a status update fails', async () => {
    const service = new KnowledgeService()
    knowledgeItemUpdateStatusMock
      .mockResolvedValueOnce(createNoteItem('note-1', 'kb-1', null, 'processing'))
      .mockRejectedValueOnce(new Error('status failed'))

    await expect(
      service.addItems('kb-1', [
        { type: 'note', data: { source: 'note-1', content: 'hello 1' } },
        { type: 'note', data: { source: 'note-2', content: 'hello 2' } }
      ])
    ).rejects.toThrow('status failed')

    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith('note-1')
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith('note-2')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('runs best-effort copied-file cleanup and preserves the original addItems error', async () => {
    const service = new KnowledgeService()
    knowledgeItemCreateMock.mockRejectedValueOnce(new Error('create failed'))

    await expect(
      service.addItems('kb-1', [{ type: 'file', data: { source: '/docs/x.pdf', path: '/docs/x.pdf' } }])
    ).rejects.toThrow('create failed')

    // Copied-file cleanup is delegated to the best-effort variant, which swallows its
    // own failures (see pathStorage test), so it cannot mask the create error.
    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledTimes(1)
  })

  it('keeps items deleting when delete cleanup enqueue fails', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1'))
    enqueueMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(service.deleteItems('kb-1', ['note-1'])).rejects.toThrow('enqueue failed')

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['note-1'], 'deleting')
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith('kb-1', ['note-1'], 'failed', expect.anything())
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('collapses nested delete and reindex inputs to top-level roots', async () => {
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
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

  it('rejects reindex of a directory whose source folder no longer exists, without deleting its vectors', async () => {
    const service = new KnowledgeService()
    // A v1-migrated folder: completed, but its original folder path is gone (untrustworthy v1 path)
    // and its child carries a virtual relativePath with no raw/ file behind it.
    const root = createDirectoryItem('dir-1', null, 'completed')
    const migratedChild: KnowledgeItemOf<'file'> = {
      ...createFileItem('file-1', 'kb-1', '/legacy/abs/x.md', 'completed'),
      groupId: 'dir-1',
      data: { source: '/legacy/abs/x.md', relativePath: 'file-1' }
    }
    probeKnowledgeSourcePathMock.mockResolvedValue('missing')
    knowledgeItemGetByIdMock.mockResolvedValue(root)
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean } = {}) =>
        options.includeRoots ? [root, migratedChild] : [migratedChild]
    )

    await expect(service.reindexItems('kb-1', ['dir-1'])).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message:
        'Cannot reindex a knowledge item whose source file or folder no longer exists; delete it and add it again to rebuild'
    })

    // The reindex-subtree job — which deletes vectors before re-reading — is never enqueued,
    // so the migrated vectors survive.
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })

  it('rejects reindex with a retry hint when a directory source cannot be verified (transient error)', async () => {
    const service = new KnowledgeService()
    const root = createDirectoryItem('dir-1', null, 'completed')
    // A transient/permission error (not ENOENT): the folder may still exist, so the user must be
    // told to retry — never to delete and re-add a source that is probably still there.
    probeKnowledgeSourcePathMock.mockResolvedValue('unverifiable')
    knowledgeItemGetByIdMock.mockResolvedValue(root)
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean } = {}) =>
        options.includeRoots ? [root] : []
    )

    await expect(service.reindexItems('kb-1', ['dir-1'])).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Could not verify the knowledge item source (it may be temporarily unavailable); please try again'
    })

    // No destructive action: the existing vectors are kept and nothing is enqueued.
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })

  it('rejects reindex of a file whose source file no longer exists on disk', async () => {
    const service = new KnowledgeService()
    const root = createFileItem('file-1', 'kb-1', '/docs/gone.pdf', 'completed')
    probeKnowledgeFileMock.mockResolvedValue('missing')
    knowledgeItemGetByIdMock.mockResolvedValue(root)
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean } = {}) =>
        options.includeRoots ? [root] : []
    )

    await expect(service.reindexItems('kb-1', ['file-1'])).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message:
        'Cannot reindex a knowledge item whose source file or folder no longer exists; delete it and add it again to rebuild'
    })

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects a whole reindex batch when one root subtree is still active', async () => {
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
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
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ threshold: 0.5 }))
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'chunk-1', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'hello world', score: 0.8 },
      { unitId: 'chunk-2', materialId: NOTE_ITEM_ID, unitIndex: 1, text: 'low score', score: 0.2 }
    ])

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      expect.objectContaining({ chunkId: 'chunk-1', itemId: NOTE_ITEM_ID, rank: 1, score: 0.8 })
    ])
    expect(aiEmbedManyMock).toHaveBeenCalledWith({
      uniqueModelId: 'provider::embed',
      values: ['hello'],
      requestOptions: undefined
    })
  })

  it('bm25 mode skips the embedding round-trip and dispatches a lexical-only store search', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ searchMode: 'bm25', threshold: 0.5 }))
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'c1', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'hit', score: 3.2 },
      { unitId: 'c2', materialId: NOTE_ITEM_ID, unitIndex: 1, text: 'low', score: 0.1 }
    ])

    const results = await service.search('kb-1', 'hello')

    // No paid embedding call, and the store is told not to expect a query vector.
    expect(aiEmbedManyMock).not.toHaveBeenCalled()
    expect(storeSearchMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'bm25', queryEmbedding: undefined }))
    // BM25 'ranking' scores aren't relevance-comparable, so the 0.5 threshold can't gate them.
    expect(results.map((result) => result.chunkId)).toEqual(['c1', 'c2'])
  })

  it('hybrid mode embeds the query and passes the per-base hybridAlpha through to the store', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ searchMode: 'hybrid', hybridAlpha: 0.7, threshold: 0.5 }))
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'c1', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'fused hit', score: 0.02 }
    ])

    const results = await service.search('kb-1', 'hello')

    // The query embedding is computed and forwarded, and the base's alpha is passed
    // verbatim (a lost alpha would silently fall back to 0.5; a reversed bm25/non-bm25
    // branch would forward an undefined embedding and the store would reject hybrid).
    expect(aiEmbedManyMock).toHaveBeenCalledWith({
      uniqueModelId: 'provider::embed',
      values: ['hello'],
      requestOptions: undefined
    })
    expect(storeSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'hybrid', alpha: 0.7, queryEmbedding: [0.1, 0.2, 0.3] })
    )
    // RRF 'ranking' scores bypass the relevance threshold too (0.02 < 0.5, still kept).
    expect(results.map((result) => result.chunkId)).toEqual(['c1'])
  })

  it('over-fetches index candidates (documentCount × factor, capped) so visibility filtering keeps enough results', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ documentCount: 3 }))
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([])

    await service.search('kb-1', 'hello')

    expect(storeSearchMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 15 }))
  })

  it('caps over-fetched candidates regardless of a large documentCount', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ documentCount: 1000 }))
    storeSearchMock.mockResolvedValueOnce([])

    await service.search('kb-1', 'hello')

    expect(storeSearchMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 200 }))
  })

  it('trims visible search results down to the configured documentCount after over-fetching', async () => {
    const service = new KnowledgeService()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase({ documentCount: 2 }))
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'c1', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'a', score: 0.9 },
      { unitId: 'c2', materialId: NOTE_ITEM_ID, unitIndex: 1, text: 'b', score: 0.8 },
      { unitId: 'c3', materialId: NOTE_ITEM_ID, unitIndex: 2, text: 'c', score: 0.7 }
    ])

    const results = await service.search('kb-1', 'hello')

    expect(results.map((result) => result.chunkId)).toEqual(['c1', 'c2'])
  })

  it('applies rerank results before applying relevance threshold', async () => {
    const service = new KnowledgeService()
    const base = createBase({ threshold: 0.5, rerankModelId: 'jina::jina-reranker-v2-base-multilingual' })
    knowledgeBaseGetByIdMock.mockResolvedValue(base)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID, 'kb-1', null, 'completed'))
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'chunk-1', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'vector high rerank low', score: 0.8 },
      { unitId: 'chunk-2', materialId: NOTE_ITEM_ID, unitIndex: 1, text: 'vector low rerank high', score: 0.2 }
    ])
    rerankKnowledgeSearchResultsMock.mockImplementationOnce(async (_base, _query, results) => [
      { ...results[1], score: 0.9, scoreKind: 'relevance', rank: 1 },
      { ...results[0], score: 0.2, scoreKind: 'relevance', rank: 2 }
    ])

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      expect.objectContaining({ chunkId: 'chunk-2', rank: 1, score: 0.9 })
    ])
    expect(rerankKnowledgeSearchResultsMock).toHaveBeenCalledWith(
      base,
      'hello',
      expect.arrayContaining([
        expect.objectContaining({ chunkId: 'chunk-1', score: 0.8 }),
        expect.objectContaining({ chunkId: 'chunk-2', score: 0.2 })
      ])
    )
  })

  it('filters search results for missing or non-completed items', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      if (id === MISSING_NOTE_ITEM_ID) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }
      if (id === DELETING_NOTE_ITEM_ID) {
        return createNoteItem(id, 'kb-1', null, 'deleting')
      }
      if (id === FAILED_NOTE_ITEM_ID) {
        return createNoteItem(id, 'kb-1', null, 'failed')
      }
      if (id === PROCESSING_NOTE_ITEM_ID) {
        return createNoteItem(id, 'kb-1', null, 'processing')
      }
      if (id === EMBEDDING_NOTE_ITEM_ID) {
        return createNoteItem(id, 'kb-1', null, 'embedding')
      }
      return createNoteItem(id, 'kb-1', null, 'completed')
    })
    storeSearchMock.mockResolvedValueOnce([
      { unitId: 'chunk-active', materialId: NOTE_ITEM_ID, unitIndex: 0, text: 'active', score: 0.9 },
      { unitId: 'chunk-deleting', materialId: DELETING_NOTE_ITEM_ID, unitIndex: 0, text: 'deleting', score: 0.8 },
      { unitId: 'chunk-failed', materialId: FAILED_NOTE_ITEM_ID, unitIndex: 0, text: 'failed', score: 0.7 },
      { unitId: 'chunk-processing', materialId: PROCESSING_NOTE_ITEM_ID, unitIndex: 0, text: 'processing', score: 0.6 },
      { unitId: 'chunk-embedding', materialId: EMBEDDING_NOTE_ITEM_ID, unitIndex: 0, text: 'embedding', score: 0.5 },
      { unitId: 'chunk-missing', materialId: MISSING_NOTE_ITEM_ID, unitIndex: 0, text: 'missing', score: 0.4 }
    ])

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      expect.objectContaining({ chunkId: 'chunk-active', itemId: NOTE_ITEM_ID, rank: 1, score: 0.9 })
    ])
  })

  it('throws when search query embedding returns no vector', async () => {
    const service = new KnowledgeService()
    aiEmbedManyMock.mockResolvedValueOnce({ embeddings: [[]] })

    await expect(service.search('kb-1', 'hello')).rejects.toThrow(
      "Invalid operation: embed knowledge content - Embedding model returned empty vector at index 0 for knowledge base 'kb-1'"
    )
  })

  it('translates a search failure into a defined error when the store was closed mid-flight', async () => {
    const service = new KnowledgeService()
    getIndexStoreMock.mockResolvedValueOnce({
      search: vi.fn().mockRejectedValue(new Error('Knowledge index store driver is closed')),
      listMaterialUnits: listMaterialUnitsMock,
      isClosed: () => true
    })

    await expect(service.search('kb-1', 'hello')).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION,
      message: expect.stringContaining("Knowledge base 'kb-1' index store was closed during search")
    })
  })

  it('rethrows a genuine search failure unchanged when the store is still open', async () => {
    const service = new KnowledgeService()
    const queryError = new Error('disk I/O error')
    getIndexStoreMock.mockResolvedValueOnce({
      search: vi.fn().mockRejectedValue(queryError),
      listMaterialUnits: listMaterialUnitsMock,
      isClosed: () => false
    })

    await expect(service.search('kb-1', 'hello')).rejects.toBe(queryError)
  })

  it('lists chunks after checking item ownership', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', 'kb-1', null, 'completed'))
    listMaterialUnitsMock.mockResolvedValueOnce([
      {
        unitId: 'chunk-1',
        materialId: 'note-1',
        unitType: 'chunk',
        unitIndex: 0,
        title: null,
        charStart: 0,
        charEnd: 10,
        text: 'chunk text'
      }
    ])

    await expect(service.listItemChunks('kb-1', 'note-1')).resolves.toEqual([
      expect.objectContaining({ id: 'chunk-1', itemId: 'note-1', content: 'chunk text' })
    ])
    expect(listMaterialUnitsMock).toHaveBeenCalledWith('note-1')
  })

  it('lists chunks for completed directories without deleting children', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1', null, 'completed'))
    knowledgeItemGetSubtreeItemsMock
      .mockResolvedValueOnce([createNoteItem('note-1', 'kb-1', 'dir-1', 'completed')])
      .mockResolvedValueOnce([createNoteItem('note-1', 'kb-1', 'dir-1', 'completed')])
    listMaterialUnitsMock.mockResolvedValueOnce([
      {
        unitId: 'chunk-1',
        materialId: 'note-1',
        unitType: 'chunk',
        unitIndex: 0,
        title: null,
        charStart: 0,
        charEnd: 10,
        text: 'chunk text'
      }
    ])

    await expect(service.listItemChunks('kb-1', 'dir-1')).resolves.toEqual([
      expect.objectContaining({ id: 'chunk-1', itemId: 'note-1', content: 'chunk text' })
    ])

    expect(listMaterialUnitsMock).toHaveBeenCalledWith('note-1')
  })

  it('rejects listing chunks for completed directories with deleting children', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem('dir-1', null, 'completed'))
    knowledgeItemGetSubtreeItemsMock.mockResolvedValueOnce([
      createNoteItem('deleting-note', 'kb-1', 'dir-1', 'deleting')
    ])

    await expect(service.listItemChunks('kb-1', 'dir-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Cannot list chunks for a deleting knowledge item'
    })
    expect(listMaterialUnitsMock).not.toHaveBeenCalled()
  })

  it.each(['idle', 'processing', 'reading', 'embedding', 'failed', 'deleting'] as const)(
    'rejects chunk operations for %s leaf items',
    async (status) => {
      const service = new KnowledgeService()
      knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', 'kb-1', null, status))

      await expect(service.listItemChunks('kb-1', 'note-1')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot list chunks for a non-completed knowledge item'
      })

      expect(listMaterialUnitsMock).not.toHaveBeenCalled()
    }
  )

  it('translates a listItemChunks failure into a defined error when the store was closed mid-flight', async () => {
    const service = new KnowledgeService()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', 'kb-1', null, 'completed'))
    getIndexStoreMock.mockResolvedValueOnce({
      search: storeSearchMock,
      listMaterialUnits: vi.fn().mockRejectedValue(new Error('Knowledge index store driver is closed')),
      isClosed: () => true
    })

    await expect(service.listItemChunks('kb-1', 'note-1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION,
      message: expect.stringContaining("Knowledge base 'kb-1' index store was closed during listItemChunks")
    })
  })
})
