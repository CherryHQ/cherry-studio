import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemOf
} from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KnowledgeQueueManager } from '../../queue/KnowledgeQueueManager'

const {
  chunkDocumentsMock,
  createVectorStoreMock,
  deleteVectorStoreMock,
  embedDocumentsMock,
  embedManyMock,
  getEmbedModelMock,
  getStoreIfExistsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
  knowledgeItemDeleteMock,
  knowledgeItemDeleteLeafDescendantItemsMock,
  knowledgeItemGetDescendantItemsMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetLeafDescendantItemsMock,
  knowledgeItemReconcileContainersMock,
  knowledgeItemUpdateStatusMock,
  loadKnowledgeItemDocumentsMock,
  loggerErrorMock,
  prepareKnowledgeItemMock,
  rerankKnowledgeSearchResultsMock,
  vectorStoreAddMock,
  vectorStoreDeleteMock,
  vectorStoreDeleteByIdAndExternalIdMock,
  vectorStoreListByExternalIdMock,
  vectorStoreQueryMock
} = vi.hoisted(() => ({
  chunkDocumentsMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  deleteVectorStoreMock: vi.fn(),
  embedDocumentsMock: vi.fn(),
  embedManyMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemDeleteLeafDescendantItemsMock: vi.fn(),
  knowledgeItemGetDescendantItemsMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetLeafDescendantItemsMock: vi.fn(),
  knowledgeItemReconcileContainersMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  rerankKnowledgeSearchResultsMock: vi.fn(),
  vectorStoreAddMock: vi.fn(),
  vectorStoreDeleteMock: vi.fn(),
  vectorStoreDeleteByIdAndExternalIdMock: vi.fn(),
  vectorStoreListByExternalIdMock: vi.fn(),
  vectorStoreQueryMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      createStore: createVectorStoreMock,
      deleteStore: deleteVectorStoreMock,
      getStoreIfExists: getStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: loggerErrorMock,
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

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    create: knowledgeItemCreateMock,
    delete: knowledgeItemDeleteMock,
    deleteLeafDescendantItems: knowledgeItemDeleteLeafDescendantItemsMock,
    getDescendantItems: knowledgeItemGetDescendantItemsMock,
    getById: knowledgeItemGetByIdMock,
    getLeafDescendantItems: knowledgeItemGetLeafDescendantItemsMock,
    reconcileContainers: knowledgeItemReconcileContainersMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: knowledgeBaseGetByIdMock
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
  chunkDocuments: chunkDocumentsMock
}))

vi.mock('../../utils/embed', () => ({
  embedDocuments: embedDocumentsMock
}))

vi.mock('../../utils/model', () => ({
  getEmbedModel: getEmbedModelMock
}))

vi.mock('../utils/prepare', () => ({
  prepareKnowledgeItem: prepareKnowledgeItemMock
}))

const { KnowledgeRuntimeService } = await import('..')

function createSearchNode(id: string, score: number, chunkIndex = 0) {
  return {
    id_: id,
    score,
    metadata: {
      itemId: `item-${id}`,
      itemType: 'note',
      source: `note-${id}`,
      chunkIndex,
      tokenCount: 2
    },
    getContent: vi.fn(() => `content ${id}`)
  }
}

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    status: 'completed',
    error: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(id = 'note-1', status: KnowledgeItem['status'] = 'idle'): KnowledgeItemOf<'note'> {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(id = 'dir-1', status: KnowledgeItem['status'] = 'idle'): KnowledgeItemOf<'directory'> {
  const lifecycle =
    status === 'failed'
      ? ({ status, phase: null, error: `failed ${id}` } as const)
      : ({ status, phase: null, error: null } as const)

  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source: `/docs/${id}`, path: `/docs/${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createQueueDescriptor(
  base: KnowledgeBase,
  item: KnowledgeItem,
  kind: 'index-leaf' | 'prepare-root'
): {
  base: KnowledgeBase
  baseId: string
  itemId: string
  itemType: KnowledgeItem['type']
  kind: 'index-leaf' | 'prepare-root'
} {
  return {
    base,
    baseId: base.id,
    itemId: item.id,
    itemType: item.type,
    kind
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('KnowledgeRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    createVectorStoreMock.mockResolvedValue({
      add: vectorStoreAddMock,
      delete: vectorStoreDeleteMock,
      deleteByIdAndExternalId: vectorStoreDeleteByIdAndExternalIdMock,
      listByExternalId: vectorStoreListByExternalIdMock,
      query: vectorStoreQueryMock
    })
    getStoreIfExistsMock.mockResolvedValue({
      add: vectorStoreAddMock,
      delete: vectorStoreDeleteMock,
      deleteByIdAndExternalId: vectorStoreDeleteByIdAndExternalIdMock,
      listByExternalId: vectorStoreListByExternalIdMock,
      query: vectorStoreQueryMock
    })
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    deleteVectorStoreMock.mockResolvedValue(undefined)
    vectorStoreAddMock.mockResolvedValue(undefined)
    vectorStoreDeleteMock.mockResolvedValue(undefined)
    vectorStoreDeleteByIdAndExternalIdMock.mockResolvedValue(undefined)
    vectorStoreListByExternalIdMock.mockResolvedValue([])
    vectorStoreQueryMock.mockResolvedValue({ nodes: [], similarities: [] })
    getEmbedModelMock.mockReturnValue({ modelId: 'embedding-model' })
    loadKnowledgeItemDocumentsMock.mockResolvedValue([{ text: 'document' }])
    chunkDocumentsMock.mockReturnValue([{ text: 'chunk' }])
    embedDocumentsMock.mockResolvedValue([{ id_: 'node-1' }])
    embedManyMock.mockResolvedValue({ embeddings: [[0.1, 0.2]] })
    knowledgeItemCreateMock.mockImplementation(async (_baseId: string, item: { type: KnowledgeItem['type'] }) => {
      if (item.type === 'directory') {
        return createDirectoryItem('dir-1', 'idle')
      }

      return createNoteItem('note-1', 'idle')
    })
    knowledgeItemDeleteMock.mockResolvedValue(undefined)
    knowledgeItemDeleteLeafDescendantItemsMock.mockResolvedValue(undefined)
    knowledgeItemReconcileContainersMock.mockResolvedValue(undefined)
    knowledgeItemGetLeafDescendantItemsMock.mockImplementation(async (_baseId: string, itemIds: string[]) =>
      itemIds.map((itemId) => createNoteItem(itemId, 'processing'))
    )
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([])
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => createNoteItem(id, 'processing'))
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (
        id: string,
        status: KnowledgeItem['status'],
        update: { phase?: KnowledgeItem['phase']; error?: string | null } = {}
      ) => ({
        ...(id.startsWith('dir') ? createDirectoryItem(id, status) : createNoteItem(id, status)),
        phase: update.phase ?? null,
        error: update.error ?? null
      })
    )
    prepareKnowledgeItemMock.mockImplementation(async ({ item }: { item: KnowledgeItem }) => [item])
  })

  it('uses WhenReady phase and depends on KnowledgeVectorStoreService', () => {
    expect(getPhase(KnowledgeRuntimeService)).toBe(Phase.WhenReady)
    expect(getDependencies(KnowledgeRuntimeService)).toEqual(['KnowledgeVectorStoreService'])
  })

  it('returns from addItems after enqueueing and completes indexing in the background', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-1', 'processing')
    const readDeferred = createDeferred<object[]>()
    loadKnowledgeItemDocumentsMock.mockReturnValueOnce(readDeferred.promise)

    await service.addItems(base.id, [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])

    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(base.id, {
      groupId: undefined,
      type: 'note',
      data: {
        source: 'note-1',
        content: 'hello note-1'
      }
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'processing')
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(item, expect.any(AbortSignal))
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'processing', { phase: 'reading' })
    expect(vectorStoreAddMock).not.toHaveBeenCalled()

    readDeferred.resolve([{ text: 'document' }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'completed')
    })
    expect(knowledgeItemUpdateStatusMock.mock.calls.map((call) => call[1])).toEqual([
      'processing',
      'processing',
      'processing',
      'completed'
    ])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'processing', { phase: 'reading' })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'processing', { phase: 'embedding' })
    expect(vectorStoreAddMock).toHaveBeenCalledWith([{ id_: 'node-1' }])
    expect(
      knowledgeItemUpdateStatusMock.mock.invocationCallOrder[
        knowledgeItemUpdateStatusMock.mock.calls.findIndex(
          (call) => call[0] === item.id && call[1] === 'processing' && call[2]?.phase === 'embedding'
        )
      ]
    ).toBeLessThan(vectorStoreAddMock.mock.invocationCallOrder[0])
  })

  it('serializes same-base vector writes and completion status updates', async () => {
    const service = new KnowledgeRuntimeService()
    const releaseFirstVectorWrite = createDeferred()
    const firstVectorWriteStarted = createDeferred()
    const events: string[] = []

    knowledgeItemCreateMock
      .mockResolvedValueOnce(createNoteItem('note-1', 'idle'))
      .mockResolvedValueOnce(createNoteItem('note-2', 'idle'))
    chunkDocumentsMock.mockImplementation((_base: KnowledgeBase, item: KnowledgeItem) => [{ text: item.id }])
    embedDocumentsMock.mockImplementation(async (_model: unknown, chunks: Array<{ text: string }>) => [
      { id_: `node-${chunks[0].text}` }
    ])
    vectorStoreAddMock.mockImplementation(async (nodes: Array<{ id_: string }>) => {
      const itemId = nodes[0].id_.replace('node-', '')
      events.push(`vector:start:${itemId}`)

      if (itemId === 'note-1') {
        firstVectorWriteStarted.resolve()
        await releaseFirstVectorWrite.promise
      }

      events.push(`vector:end:${itemId}`)
    })
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (
        id: string,
        status: KnowledgeItem['status'],
        update: { phase?: KnowledgeItem['phase']; error?: string | null } = {}
      ) => {
        if (status === 'completed') {
          events.push(`status:completed:${id}`)
        }

        return {
          ...createNoteItem(id, status),
          phase: update.phase ?? null,
          error: update.error ?? null
        }
      }
    )

    await service.addItems('kb-1', [
      { type: 'note', data: { source: 'note-1', content: 'hello note-1' } },
      { type: 'note', data: { source: 'note-2', content: 'hello note-2' } }
    ])
    await firstVectorWriteStarted.promise
    await flushPromises()

    expect(events).toEqual(['vector:start:note-1'])

    releaseFirstVectorWrite.resolve()

    await vi.waitFor(() => {
      expect(events).toEqual([
        'vector:start:note-1',
        'vector:end:note-1',
        'status:completed:note-1',
        'vector:start:note-2',
        'vector:end:note-2',
        'status:completed:note-2'
      ])
    })
  })

  it('serializes addItems acceptance with same-base queue writes before enqueueing runtime work', async () => {
    const service = new KnowledgeRuntimeService()
    const releaseActiveWrite = createDeferred()
    const activeWriteStarted = createDeferred()
    const events: string[] = []

    const queue = (service as unknown as { queue: KnowledgeQueueManager }).queue
    const activeWritePromise = queue.runWithBaseWriteLockForBase('kb-1', async () => {
      events.push('lock:active')
      activeWriteStarted.resolve()
      await releaseActiveWrite.promise
      events.push('unlock:active')
    })

    await activeWriteStarted.promise
    const addPromise = service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])
    await flushPromises()

    expect(knowledgeItemCreateMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
    expect(events).toEqual(['lock:active'])

    releaseActiveWrite.resolve()
    await addPromise
    await activeWritePromise

    expect(knowledgeItemCreateMock).toHaveBeenCalledWith('kb-1', {
      groupId: undefined,
      type: 'note',
      data: { source: 'note-1', content: 'hello note-1' }
    })
    expect(events).toEqual(['lock:active', 'unlock:active'])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
        createNoteItem('note-1', 'processing'),
        expect.any(AbortSignal)
      )
    })
    expect(
      knowledgeItemUpdateStatusMock.mock.invocationCallOrder[
        knowledgeItemUpdateStatusMock.mock.calls.findIndex((call) => call[0] === 'note-1' && call[1] === 'processing')
      ]
    ).toBeLessThan(loadKnowledgeItemDocumentsMock.mock.invocationCallOrder[0])
  })

  it('cleans up accepted roots when batch acceptance fails', async () => {
    const service = new KnowledgeRuntimeService()
    const acceptError = new Error('create failed')
    knowledgeItemCreateMock.mockResolvedValueOnce(createNoteItem('note-1', 'idle')).mockRejectedValueOnce(acceptError)

    await expect(
      service.addItems('kb-1', [
        { type: 'note', data: { source: 'note-1', content: 'hello 1' } },
        { type: 'note', data: { source: 'note-2', content: 'hello 2' } }
      ])
    ).rejects.toBe(acceptError)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(knowledgeItemDeleteMock).toHaveBeenCalledWith('note-1')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', { error: 'create failed' })
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to add knowledge items', acceptError, {
      baseId: 'kb-1',
      accepted: 1,
      total: 2
    })
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
  })

  it('keeps the original addItems error when accepted item rollback fails', async () => {
    const service = new KnowledgeRuntimeService()
    const acceptError = new Error('create failed')
    const cleanupError = new Error('delete failed')
    knowledgeItemCreateMock.mockResolvedValueOnce(createNoteItem('note-1', 'idle')).mockRejectedValueOnce(acceptError)
    knowledgeItemDeleteMock.mockRejectedValueOnce(cleanupError)

    await expect(
      service.addItems('kb-1', [
        { type: 'note', data: { source: 'note-1', content: 'hello 1' } },
        { type: 'note', data: { source: 'note-2', content: 'hello 2' } }
      ])
    ).rejects.toBe(acceptError)

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to rollback accepted knowledge item after addItems failure',
      cleanupError,
      {
        baseId: 'kb-1',
        itemId: 'note-1',
        addError: acceptError.message
      }
    )
  })

  it('marks an indexable item failed when queue enqueue rejects before execution', async () => {
    const service = new KnowledgeRuntimeService()
    const enqueueError = new Error('queue resetting')
    const enqueueMock = vi.fn().mockRejectedValue(enqueueError)
    const getSnapshotMock = vi.fn().mockReturnValue({ pending: [], running: [] })
    const runWithBaseWriteLockForBaseMock = vi.fn(async (_baseId: string, task: () => Promise<unknown>) => task())

    ;(
      service as unknown as {
        queue: {
          enqueue: typeof enqueueMock
          getSnapshot: typeof getSnapshotMock
          runWithBaseWriteLockForBase: typeof runWithBaseWriteLockForBaseMock
        }
      }
    ).queue = {
      enqueue: enqueueMock,
      getSnapshot: getSnapshotMock,
      runWithBaseWriteLockForBase: runWithBaseWriteLockForBaseMock
    }

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'failed', { error: 'queue resetting' })
    })
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Knowledge queue rejected runtime task before execution',
      enqueueError,
      {
        baseId: 'kb-1',
        itemId: 'note-1',
        kind: 'index-leaf'
      }
    )
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
  })

  it('marks a preparation root failed when queue enqueue rejects before execution', async () => {
    const service = new KnowledgeRuntimeService()
    const enqueueError = new Error('queue resetting')
    const enqueueMock = vi.fn().mockRejectedValue(enqueueError)
    const getSnapshotMock = vi.fn().mockReturnValue({ pending: [], running: [] })
    const runWithBaseWriteLockForBaseMock = vi.fn(async (_baseId: string, task: () => Promise<unknown>) => task())

    ;(
      service as unknown as {
        queue: {
          enqueue: typeof enqueueMock
          getSnapshot: typeof getSnapshotMock
          runWithBaseWriteLockForBase: typeof runWithBaseWriteLockForBaseMock
        }
      }
    ).queue = {
      enqueue: enqueueMock,
      getSnapshot: getSnapshotMock,
      runWithBaseWriteLockForBase: runWithBaseWriteLockForBaseMock
    }

    await service.addItems('kb-1', [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'failed', { error: 'queue resetting' })
    })
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Knowledge queue rejected runtime task before execution',
      enqueueError,
      {
        baseId: 'kb-1',
        itemId: 'dir-1',
        kind: 'prepare-root'
      }
    )
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
  })

  it('marks an item failed when indexing throws', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    loadKnowledgeItemDocumentsMock.mockRejectedValueOnce(new Error('read failed'))

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', { error: 'read failed' })
    })
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
  })

  it('marks an item failed when chunk metadata validation throws before embedding', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    chunkDocumentsMock.mockImplementationOnce(() => {
      throw new Error('Invalid chunk metadata')
    })

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
        error: 'Invalid chunk metadata'
      })
    })
    expect(embedDocumentsMock).not.toHaveBeenCalled()
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
  })

  it('deletes vectors when indexing fails after vector write starts', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (
        id: string,
        status: KnowledgeItem['status'],
        update: { phase?: KnowledgeItem['phase']; error?: string | null } = {}
      ) => {
        if (status === 'completed') {
          throw new Error('completed write failed')
        }

        return {
          ...createNoteItem(id, status),
          phase: update.phase ?? null,
          error: update.error ?? null
        }
      }
    )

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
        error: 'completed write failed'
      })
    })
    expect(vectorStoreAddMock).toHaveBeenCalledWith([{ id_: 'node-1' }])
    expect(getStoreIfExistsMock).toHaveBeenCalledWith(createBase())
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
  })

  it('marks root and created children failed when expansion fails', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const expansionError = new Error('child creation failed')

    knowledgeItemCreateMock.mockResolvedValueOnce(createDirectoryItem('dir-1', 'idle'))
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (
        id: string,
        status: KnowledgeItem['status'],
        update: { phase?: KnowledgeItem['phase']; error?: string | null } = {}
      ) => {
        if (id === root.id) {
          return { ...root, status, phase: update.phase ?? null, error: update.error ?? null }
        }

        return {
          ...createNoteItem(id, status),
          phase: update.phase ?? null,
          error: update.error ?? null
        }
      }
    )
    prepareKnowledgeItemMock.mockImplementationOnce(
      async ({ onCreatedItem }: { onCreatedItem: (item: KnowledgeItem) => void }) => {
        onCreatedItem(child)
        throw expansionError
      }
    )

    await service.addItems('kb-1', [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
        error: expansionError.message
      })
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
        error: expansionError.message
      })
    })
  })

  it('does not enqueue an expanded child that was deleted before expansion finished', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const childCreated = createDeferred()
    const finishPreparation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetLeafDescendantItemsMock.mockImplementation(async (_baseId: string, itemIds: string[]) =>
      itemIds.includes(child.id) ? [child] : []
    )
    prepareKnowledgeItemMock.mockImplementationOnce(
      async ({ onCreatedItem }: { onCreatedItem: (item: KnowledgeItem) => void }) => {
        onCreatedItem(child)
        childCreated.resolve()
        await finishPreparation.promise
        return [child]
      }
    )
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      if (id === child.id) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      return createNoteItem(id, 'processing')
    })

    const addPromise = service.addItems(base.id, [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await childCreated.promise

    await service.deleteItems(base.id, [child])
    finishPreparation.resolve()
    await addPromise

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'processing')
    })
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Knowledge task interrupted by item deletion'
    })
  })

  it('fails preparation when leaf enqueue lookup fails unexpectedly', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const lookupError = new Error('database unavailable')

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([child])
    knowledgeItemGetByIdMock.mockRejectedValueOnce(lookupError)

    await service.addItems(base.id, [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
        error: lookupError.message
      })
    })
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
  })

  it('finalizes a prepared container when every expanded leaf is gone before enqueue', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const firstChild = createNoteItem('child-1', 'processing')
    const secondChild = createNoteItem('child-2', 'processing')

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([firstChild, secondChild])
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) =>
      Promise.reject(DataApiErrorFactory.notFound('KnowledgeItem', id))
    )

    await service.addItems(base.id, [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'processing')
    })
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(firstChild, expect.any(AbortSignal))
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(secondChild, expect.any(AbortSignal))
  })

  it('reconciles a prepared container after enqueueing leaves', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const firstChild = createNoteItem('child-1', 'processing')
    const secondChild = createNoteItem('child-2', 'processing')

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([firstChild, secondChild])
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => {
      if (id === firstChild.id) {
        return firstChild
      }

      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    })

    await service.addItems(base.id, [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(firstChild, expect.any(AbortSignal))
    })
    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'processing')
    })
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(secondChild, expect.any(AbortSignal))
  })

  it('does not finalize a prepared container after preparation is interrupted', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const preparationStarted = createDeferred()
    const finishPreparation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      preparationStarted.resolve()
      await finishPreparation.promise
      signal.throwIfAborted()
      return [createNoteItem('child-1', 'processing')]
    })

    const addPromise = service.addItems('kb-1', [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await preparationStarted.promise

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    await flushPromises()

    finishPreparation.resolve()
    await stopPromise
    await addPromise

    expect(knowledgeItemReconcileContainersMock).not.toHaveBeenCalled()
  })

  it('interrupts parent preparation during delete so stale leaves are not enqueued', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const preparationStarted = createDeferred()
    const finishPreparation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    prepareKnowledgeItemMock.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      preparationStarted.resolve()
      await finishPreparation.promise
      signal.throwIfAborted()
      return [child]
    })

    const addPromise = service.addItems(base.id, [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await preparationStarted.promise

    const deletePromise = service.deleteItems(base.id, [root])
    await flushPromises()

    finishPreparation.resolve()
    await deletePromise
    await addPromise

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
    expect(knowledgeItemGetDescendantItemsMock).toHaveBeenCalledWith(base.id, [root.id])
  })

  it('interrupts a child task that preparation enqueued before delete descendant lookup', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const childReadStarted = createDeferred()
    const finishChildRead = createDeferred<object[]>()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([child])
    knowledgeItemGetByIdMock.mockResolvedValue(child)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    loadKnowledgeItemDocumentsMock.mockImplementationOnce(async () => {
      childReadStarted.resolve()
      return await finishChildRead.promise
    })

    await service.addItems(base.id, [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])
    await childReadStarted.promise

    const deletePromise = service.deleteItems(base.id, [root])
    await vi.waitFor(() => {
      expect(knowledgeItemGetDescendantItemsMock).toHaveBeenCalledWith(base.id, [root.id])
    })
    await flushPromises()

    finishChildRead.resolve([{ text: 'document' }])
    await deletePromise

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(chunkDocumentsMock).not.toHaveBeenCalled()
    expect(vectorStoreAddMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(child.id, 'completed')
  })

  it('marks interrupted delete items failed when strict vector cleanup fails', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')

    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    vectorStoreDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(service.deleteItems(base.id, [root])).rejects.toThrow(
      'Failed to delete vectors for knowledge items in base kb-1: child-1'
    )

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Failed to delete vectors for knowledge items in base kb-1: child-1'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
      error: 'Failed to delete vectors for knowledge items in base kb-1: child-1'
    })
  })

  it('preserves the original delete cleanup error when failure-state persistence fails', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const failureStateError = new Error('database locked')

    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    vectorStoreDeleteMock.mockRejectedValueOnce(new Error('delete failed'))
    knowledgeItemUpdateStatusMock.mockRejectedValue(failureStateError)

    await expect(service.deleteItems(base.id, [root])).rejects.toThrow(
      'Failed to delete vectors for knowledge items in base kb-1: child-1'
    )

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist knowledge item failure state during runtime cleanup',
      expect.objectContaining({ name: 'FailedToPersistFailureStateError' }),
      {
        baseId: base.id,
        itemIds: [root.id, child.id],
        operation: 'deleteItems',
        reason: 'Failed to delete vectors for knowledge items in base kb-1: child-1',
        rootIds: [root.id]
      }
    )
  })

  it('marks delete roots failed when descendant lookup fails after interruption', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const lookupError = new Error('descendant lookup failed')

    knowledgeItemGetDescendantItemsMock.mockRejectedValueOnce(lookupError)

    await expect(service.deleteItems(base.id, [root])).rejects.toBe(lookupError)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'descendant lookup failed'
    })
    expect(knowledgeItemGetLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(vectorStoreDeleteMock).not.toHaveBeenCalled()
  })

  it('reindexes a child during parent expansion without duplicating the parent-submitted leaf task', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const childCreated = createDeferred()
    const finishPreparation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetLeafDescendantItemsMock.mockImplementation(async (_baseId: string, itemIds: string[]) =>
      itemIds.includes(child.id) ? [child] : []
    )
    prepareKnowledgeItemMock.mockImplementationOnce(
      async ({ onCreatedItem }: { onCreatedItem: (item: KnowledgeItem) => void }) => {
        onCreatedItem(child)
        childCreated.resolve()
        await finishPreparation.promise
        return [child]
      }
    )

    const addPromise = service.addItems(base.id, [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await childCreated.promise

    await service.reindexItems(base.id, [child])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(child, expect.any(AbortSignal))
    })

    finishPreparation.resolve()
    await addPromise
    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'completed')
    })

    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledTimes(1)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
  })

  it('interrupts parent preparation during reindex before scheduling a fresh preparation task', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const oldChild = createNoteItem('old-child-1', 'processing')
    const newChild = createNoteItem('new-child-1', 'processing')
    const oldPreparationStarted = createDeferred()
    const finishOldPreparation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetDescendantItemsMock.mockImplementation(async (_baseId: string, itemIds: string[]) =>
      itemIds.includes(root.id) ? [oldChild] : []
    )
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([oldChild])
    prepareKnowledgeItemMock
      .mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
        oldPreparationStarted.resolve()
        await finishOldPreparation.promise
        signal.throwIfAborted()
        return [oldChild]
      })
      .mockResolvedValueOnce([newChild])

    const addPromise = service.addItems(base.id, [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await oldPreparationStarted.promise

    const reindexPromise = service.reindexItems(base.id, [root])
    await flushPromises()

    finishOldPreparation.resolve()
    await reindexPromise
    await addPromise

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(newChild, expect.any(AbortSignal))
    })
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(oldChild, expect.any(AbortSignal))
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(oldChild.id)
    expect(knowledgeItemDeleteLeafDescendantItemsMock).toHaveBeenCalledWith(base.id, [root.id])
  })

  it('interrupts a child task that preparation enqueued before reindex descendant lookup', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const oldChild = createNoteItem('old-child-1', 'processing')
    const newChild = createNoteItem('new-child-1', 'processing')
    const childReadStarted = createDeferred()
    const finishChildRead = createDeferred<object[]>()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([oldChild]).mockResolvedValueOnce([newChild])
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) =>
      id === newChild.id ? newChild : createNoteItem(id, 'processing')
    )
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([oldChild])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([oldChild])
    loadKnowledgeItemDocumentsMock.mockImplementationOnce(async () => {
      childReadStarted.resolve()
      return await finishChildRead.promise
    })

    await service.addItems(base.id, [{ type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }])
    await childReadStarted.promise

    const reindexPromise = service.reindexItems(base.id, [root])
    await flushPromises()

    finishChildRead.resolve([{ text: 'document' }])
    await reindexPromise

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(oldChild.id)
    expect(knowledgeItemDeleteLeafDescendantItemsMock).toHaveBeenCalledWith(base.id, [root.id])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(newChild, expect.any(AbortSignal))
    })
  })

  it('marks interrupted reindex items failed and does not rebuild when strict vector cleanup fails', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')

    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    vectorStoreDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(service.reindexItems(base.id, [root])).rejects.toThrow(
      'Failed to delete vectors for knowledge items in base kb-1: child-1'
    )

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Failed to delete vectors for knowledge items in base kb-1: child-1'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
      error: 'Failed to delete vectors for knowledge items in base kb-1: child-1'
    })
    expect(knowledgeItemDeleteLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
  })

  it('marks interrupted reindex items failed and does not rebuild when descendant deletion fails', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const deletionError = new Error('delete descendants failed')
    const failureStateError = new Error('database locked')

    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemDeleteLeafDescendantItemsMock.mockRejectedValueOnce(deletionError)
    knowledgeItemUpdateStatusMock.mockRejectedValue(failureStateError)

    await expect(service.reindexItems(base.id, [root])).rejects.toBe(deletionError)

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist knowledge item failure state during runtime cleanup',
      expect.objectContaining({ name: 'FailedToPersistFailureStateError' }),
      {
        baseId: base.id,
        itemIds: [root.id, child.id],
        operation: 'reindexItems',
        reason: 'delete descendants failed',
        rootIds: [root.id]
      }
    )
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
  })

  it('marks reindex roots failed and does not rebuild when descendant lookup fails after interruption', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const root = createDirectoryItem('dir-1', 'processing')
    const lookupError = new Error('descendant lookup failed')

    knowledgeItemGetDescendantItemsMock.mockRejectedValueOnce(lookupError)

    await expect(service.reindexItems(base.id, [root])).rejects.toBe(lookupError)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'descendant lookup failed'
    })
    expect(knowledgeItemGetLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemDeleteLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
  })

  it('uses the operation base snapshot for children created by expansion', async () => {
    const service = new KnowledgeRuntimeService()
    const originalBase = { ...createBase(), chunkSize: 512 }
    const updatedBase = { ...createBase(), chunkSize: 2048 }
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')

    knowledgeBaseGetByIdMock.mockResolvedValueOnce(originalBase).mockResolvedValue(updatedBase)
    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockResolvedValueOnce([child])

    await service.addItems(originalBase.id, [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])

    await vi.waitFor(() => {
      expect(chunkDocumentsMock).toHaveBeenCalledWith(originalBase, child, [{ text: 'document' }])
    })
    expect(knowledgeBaseGetByIdMock).toHaveBeenCalledOnce()
  })

  it('interrupts queued root preparation during stop and does not enqueue created leaves', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const expansionStarted = createDeferred()
    const finishCreation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockImplementationOnce(
      async ({ onCreatedItem, signal }: { onCreatedItem: (item: KnowledgeItem) => void; signal: AbortSignal }) => {
        expansionStarted.resolve()
        await finishCreation.promise
        signal.throwIfAborted()
        onCreatedItem(child)
        return [child]
      }
    )
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])

    const addPromise = service.addItems('kb-1', [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await expansionStarted.promise

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    await flushPromises()

    finishCreation.resolve()
    await stopPromise
    await addPromise

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
  })

  it('returns interrupted base item ids without deleting vector artifacts', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const expansionStarted = createDeferred()
    const finishCreation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    prepareKnowledgeItemMock.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      expansionStarted.resolve()
      await finishCreation.promise
      signal.throwIfAborted()
      return [child]
    })

    const addPromise = service.addItems('kb-1', [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await expansionStarted.promise

    const deleteBasePromise = service.deleteBase('kb-1')
    await flushPromises()

    finishCreation.resolve()
    await expect(deleteBasePromise).resolves.toEqual([root.id, child.id])
    await addPromise

    expect(deleteVectorStoreMock).not.toHaveBeenCalled()
  })

  it('marks interrupted base roots failed when expanding interrupted base entries fails', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const expansionStarted = createDeferred()
    const finishCreation = createDeferred()
    const expansionError = new Error('descendant lookup failed')

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      expansionStarted.resolve()
      await finishCreation.promise
      signal.throwIfAborted()
      return []
    })
    knowledgeItemGetDescendantItemsMock.mockRejectedValueOnce(expansionError)

    const addPromise = service.addItems('kb-1', [
      { type: 'directory', data: { source: '/docs/dir-1', path: '/docs/dir-1' } }
    ])
    await expansionStarted.promise

    const deleteBasePromise = service.deleteBase('kb-1')
    await flushPromises()

    finishCreation.resolve()
    await expect(deleteBasePromise).rejects.toBe(expansionError)
    await addPromise

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'descendant lookup failed'
    })
    expect(deleteVectorStoreMock).not.toHaveBeenCalled()
  })

  it('deletes base vector artifacts through the artifact cleanup method', async () => {
    const service = new KnowledgeRuntimeService()

    await expect(service.deleteBaseArtifacts('kb-1')).resolves.toBeUndefined()

    expect(deleteVectorStoreMock).toHaveBeenCalledWith('kb-1')
  })

  it('marks nested preparation subtree failed on stop', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-root', 'processing')
    const childDir = createDirectoryItem('dir-child', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const expansionStarted = createDeferred()
    const finishCreation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    prepareKnowledgeItemMock.mockImplementationOnce(
      async ({ onCreatedItem, signal }: { onCreatedItem: (item: KnowledgeItem) => void; signal: AbortSignal }) => {
        expansionStarted.resolve()
        await finishCreation.promise
        signal.throwIfAborted()
        onCreatedItem(childDir)
        onCreatedItem(child)
        return [child]
      }
    )
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([childDir, child])

    const addPromise = service.addItems('kb-1', [
      { type: 'directory', data: { source: '/docs/dir-root', path: '/docs/dir-root' } }
    ])
    await expansionStarted.promise

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    await flushPromises()

    finishCreation.resolve()
    await stopPromise
    await addPromise

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
    for (const item of [root, childDir, child]) {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
        error: 'Knowledge task interrupted by service shutdown'
      })
    }
  })

  it('merges interrupted same-base entries before deleting vectors on stop', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const firstItem = createNoteItem('note-1')
    const secondItem = createNoteItem('note-2')
    const waitForRunningMock = vi.fn().mockResolvedValue(undefined)
    const interruptAllMock = vi
      .fn()
      .mockReturnValue([
        createQueueDescriptor(base, firstItem, 'index-leaf'),
        createQueueDescriptor(base, secondItem, 'index-leaf')
      ])

    ;(
      service as unknown as {
        queue: { interruptAll: typeof interruptAllMock; waitForRunning: typeof waitForRunningMock }
      }
    ).queue = {
      interruptAll: interruptAllMock,
      waitForRunning: waitForRunningMock
    }

    await (service as unknown as { onStop: () => Promise<void> }).onStop()

    expect(waitForRunningMock).toHaveBeenCalledWith(['note-1', 'note-2'])
    expect(getStoreIfExistsMock).toHaveBeenCalledOnce()
    expect(getStoreIfExistsMock).toHaveBeenCalledWith(base)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('note-1')
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith('note-2')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-2', 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
  })

  it('reindex deletes old vectors before returning and then schedules background indexing', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem('note-1', 'processing')
    const deleteDeferred = createDeferred()
    vectorStoreDeleteMock.mockReturnValueOnce(deleteDeferred.promise)

    let resolved = false
    const reindexPromise = service.reindexItems(base.id, [item]).then(() => {
      resolved = true
    })

    await vi.waitFor(() => {
      expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
    })
    await flushPromises()
    expect(resolved).toBe(false)

    deleteDeferred.resolve()
    await reindexPromise

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(item, expect.any(AbortSignal))
    })
  })

  it('deletes item vectors synchronously for deleteItems', async () => {
    const service = new KnowledgeRuntimeService()
    const base = createBase()
    const item = createNoteItem()

    await service.deleteItems(base.id, [item])

    expect(getStoreIfExistsMock).toHaveBeenCalledWith(base)
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
  })

  it('lists chunks for leaf descendants when the requested item is a container', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'completed')
    const fileChild = createNoteItem('file-child', 'completed')
    const urlChild = createNoteItem('url-child', 'completed')
    const fileChunk = {
      id_: 'chunk-file-1',
      metadata: {
        itemId: fileChild.id,
        itemType: 'note',
        source: 'file child',
        chunkIndex: 0,
        tokenCount: 3
      },
      getContent: vi.fn(() => 'file child chunk')
    }
    const urlChunk = {
      id_: 'chunk-url-1',
      metadata: {
        itemId: urlChild.id,
        itemType: 'note',
        source: 'url child',
        chunkIndex: 0,
        tokenCount: 4
      },
      getContent: vi.fn(() => 'url child chunk')
    }

    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([fileChild, urlChild])
    vectorStoreListByExternalIdMock.mockImplementation(async (itemId: string) => {
      if (itemId === fileChild.id) {
        return [fileChunk]
      }
      if (itemId === urlChild.id) {
        return [urlChunk]
      }

      return []
    })

    await expect(service.listItemChunks('kb-1', root.id)).resolves.toEqual([
      {
        id: 'chunk-file-1',
        itemId: fileChild.id,
        content: 'file child chunk',
        metadata: fileChunk.metadata
      },
      {
        id: 'chunk-url-1',
        itemId: urlChild.id,
        content: 'url child chunk',
        metadata: urlChunk.metadata
      }
    ])

    expect(knowledgeItemGetLeafDescendantItemsMock).toHaveBeenCalledWith('kb-1', [root.id])
    expect(vectorStoreListByExternalIdMock).toHaveBeenCalledWith(fileChild.id)
    expect(vectorStoreListByExternalIdMock).toHaveBeenCalledWith(urlChild.id)
    expect(vectorStoreListByExternalIdMock).not.toHaveBeenCalledWith(root.id)
  })

  it('returns no chunks without creating a vector store when a container has no leaf descendants', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-empty', 'completed')

    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([])

    await expect(service.listItemChunks('kb-1', root.id)).resolves.toEqual([])

    expect(knowledgeItemGetLeafDescendantItemsMock).toHaveBeenCalledWith('kb-1', [root.id])
    expect(createVectorStoreMock).not.toHaveBeenCalled()
    expect(vectorStoreListByExternalIdMock).not.toHaveBeenCalled()
  })

  it('throws when search query embedding is empty', async () => {
    const service = new KnowledgeRuntimeService()
    embedManyMock.mockResolvedValueOnce({ embeddings: [] })

    await expect(service.search('kb-1', 'hello')).rejects.toThrow('Failed to embed search query')

    expect(vectorStoreQueryMock).not.toHaveBeenCalled()
  })

  it('returns empty search results for punctuation-only queries without embedding', async () => {
    const service = new KnowledgeRuntimeService()

    await expect(service.search('kb-1', '...')).resolves.toEqual([])

    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(embedManyMock).not.toHaveBeenCalled()
    expect(vectorStoreQueryMock).not.toHaveBeenCalled()
  })

  it('marks vector search scores as relevance and filters them by threshold', async () => {
    const service = new KnowledgeRuntimeService()
    const base = { ...createBase(), searchMode: 'default' as const, threshold: 0.7 }
    const lowNode = createSearchNode('chunk-low', 0.6, 0)
    const highNode = createSearchNode('chunk-high', 0.8, 1)

    knowledgeBaseGetByIdMock.mockResolvedValueOnce(base)
    vectorStoreQueryMock.mockResolvedValueOnce({ nodes: [lowNode, highNode], similarities: [0.6, 0.8] })

    await expect(service.search('kb-1', 'hello')).resolves.toEqual([
      {
        pageContent: 'content chunk-high',
        score: 0.8,
        scoreKind: 'relevance',
        rank: 1,
        metadata: highNode.metadata,
        itemId: 'item-chunk-high',
        chunkId: 'chunk-high'
      }
    ])
  })

  it.each(['bm25', 'hybrid'] as const)(
    'marks %s search scores as ranking and does not filter by threshold',
    async (searchMode) => {
      const service = new KnowledgeRuntimeService()
      const base = { ...createBase(), searchMode, threshold: 0.7 }
      const firstNode = createSearchNode(`${searchMode}-first`, 0.2, 0)
      const secondNode = createSearchNode(`${searchMode}-second`, 0.1, 1)

      knowledgeBaseGetByIdMock.mockResolvedValueOnce(base)
      vectorStoreQueryMock.mockResolvedValueOnce({ nodes: [firstNode, secondNode], similarities: [0.2, 0.1] })

      await expect(service.search('kb-1', 'hello')).resolves.toEqual([
        {
          pageContent: `content ${searchMode}-first`,
          score: 0.2,
          scoreKind: 'ranking',
          rank: 1,
          metadata: firstNode.metadata,
          itemId: `item-${searchMode}-first`,
          chunkId: `${searchMode}-first`
        },
        {
          pageContent: `content ${searchMode}-second`,
          score: 0.1,
          scoreKind: 'ranking',
          rank: 2,
          metadata: secondNode.metadata,
          itemId: `item-${searchMode}-second`,
          chunkId: `${searchMode}-second`
        }
      ])
    }
  )

  it('reranks search results when the base has a rerank model', async () => {
    const service = new KnowledgeRuntimeService()
    const base = { ...createBase(), rerankModelId: 'openai::rerank-model' }
    const node = {
      id_: 'chunk-1',
      metadata: {
        itemId: 'note-1',
        itemType: 'note',
        source: 'note-1',
        chunkIndex: 0,
        tokenCount: 2
      },
      getContent: vi.fn(() => 'hello world')
    }
    const reranked = [
      {
        pageContent: 'hello world',
        score: 0.99,
        scoreKind: 'relevance' as const,
        rank: 1,
        metadata: node.metadata,
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ]

    knowledgeBaseGetByIdMock.mockResolvedValueOnce(base)
    vectorStoreQueryMock.mockResolvedValueOnce({ nodes: [node], similarities: [0.8] })
    rerankKnowledgeSearchResultsMock.mockResolvedValueOnce(reranked)

    await expect(service.search('kb-1', 'hello')).resolves.toEqual(reranked)

    expect(rerankKnowledgeSearchResultsMock).toHaveBeenCalledWith(base, 'hello', [
      {
        pageContent: 'hello world',
        score: 0.8,
        scoreKind: 'ranking',
        rank: 1,
        metadata: node.metadata,
        itemId: 'note-1',
        chunkId: 'chunk-1'
      }
    ])
  })

  it('marks queued work failed on stop', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    const readDeferred = createDeferred<object[]>()
    loadKnowledgeItemDocumentsMock.mockReturnValueOnce(readDeferred.promise)

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalled()
    })

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    await flushPromises()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(item.id, 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })

    readDeferred.resolve([{ text: 'document' }])
    await stopPromise

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
  })

  it('marks queued work failed on stop when vector cleanup fails', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    const readDeferred = createDeferred<object[]>()
    loadKnowledgeItemDocumentsMock.mockReturnValueOnce(readDeferred.promise)
    vectorStoreDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalled()
    })

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    readDeferred.resolve([{ text: 'document' }])

    await expect(stopPromise).resolves.toBeUndefined()
    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(item.id)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', {
      error: 'Knowledge task interrupted by service shutdown'
    })
  })

  it('does not fail stop when failure-state persistence fails during interrupt cleanup', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    const readDeferred = createDeferred<object[]>()
    const failureStateError = new Error('database locked')
    loadKnowledgeItemDocumentsMock.mockReturnValueOnce(readDeferred.promise)

    await service.addItems('kb-1', [{ type: 'note', data: { source: 'note-1', content: 'hello note-1' } }])
    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalled()
    })

    const stopPromise = (service as unknown as { onStop: () => Promise<void> }).onStop()
    knowledgeItemUpdateStatusMock.mockRejectedValue(failureStateError)
    readDeferred.resolve([{ text: 'document' }])

    await expect(stopPromise).resolves.toBeUndefined()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to persist knowledge item failure state during runtime cleanup',
      expect.objectContaining({ name: 'FailedToPersistFailureStateError' }),
      {
        itemIds: [item.id],
        operation: 'interruptedRuntimeCleanup',
        reason: 'Knowledge task interrupted by service shutdown'
      }
    )
  })
})
