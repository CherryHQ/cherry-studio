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

const {
  appGetMock,
  chunkDocumentsMock,
  createVectorStoreMock,
  deleteVectorStoreMock,
  embedDocumentsMock,
  embedManyMock,
  getEmbedModelMock,
  getStoreIfExistsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
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
  appGetMock: vi.fn(),
  chunkDocumentsMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  deleteVectorStoreMock: vi.fn(),
  embedDocumentsMock: vi.fn(),
  embedManyMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
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

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
}))

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

function createNoteItem(id = 'note-1', status: KnowledgeItem['status'] = 'idle'): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    status,
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(id = 'dir-1', status: KnowledgeItem['status'] = 'idle'): KnowledgeItemOf<'directory'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source: `/docs/${id}`, path: `/docs/${id}` },
    status,
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
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

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeVectorStoreService') {
        return {
          createStore: createVectorStoreMock,
          deleteStore: deleteVectorStoreMock,
          getStoreIfExists: getStoreIfExistsMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })
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

    await service.addItems(base.id, [{ type: 'note', content: 'hello note-1', source: 'note-1' }])

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

  it('cleans up accepted roots when batch acceptance fails', async () => {
    const service = new KnowledgeRuntimeService()
    const acceptError = new Error('create failed')
    knowledgeItemCreateMock.mockResolvedValueOnce(createNoteItem('note-1', 'idle')).mockRejectedValueOnce(acceptError)

    await expect(
      service.addItems('kb-1', [
        { type: 'note', content: 'hello 1', source: 'note-1' },
        { type: 'note', content: 'hello 2', source: 'note-2' }
      ])
    ).rejects.toBe(acceptError)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'failed', { error: 'create failed' })
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
  })

  it('marks an item failed when indexing throws', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    loadKnowledgeItemDocumentsMock.mockRejectedValueOnce(new Error('read failed'))

    await service.addItems('kb-1', [{ type: 'note', content: 'hello note-1', source: 'note-1' }])

    await vi.waitFor(() => {
      expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(item.id, 'failed', { error: 'read failed' })
    })
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

    await service.addItems('kb-1', [{ type: 'note', content: 'hello note-1', source: 'note-1' }])

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

    await service.addItems('kb-1', [{ type: 'directory', path: '/docs/dir-1' }])

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

    const addPromise = service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
    await childCreated.promise

    await service.deleteItems(base.id, [child])
    finishPreparation.resolve()
    await addPromise

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalledWith(child, expect.any(AbortSignal))
    await vi.waitFor(() => {
      expect(knowledgeItemReconcileContainersMock).toHaveBeenCalledWith(base.id, [root.id])
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

    await service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])

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

    await service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])

    await vi.waitFor(() => {
      expect(knowledgeItemReconcileContainersMock).toHaveBeenCalledWith(base.id, [root.id])
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

    await service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])

    await vi.waitFor(() => {
      expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(firstChild, expect.any(AbortSignal))
    })
    await vi.waitFor(() => {
      expect(knowledgeItemReconcileContainersMock).toHaveBeenCalledWith(base.id, [root.id])
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

    const addPromise = service.addItems('kb-1', [{ type: 'directory', path: '/docs/dir-1' }])
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

    const addPromise = service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
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

    await service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
    await childReadStarted.promise

    const deletePromise = service.deleteItems(base.id, [root])
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

    const addPromise = service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
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

    const addPromise = service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
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

    await service.addItems(base.id, [{ type: 'directory', path: '/docs/dir-1' }])
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

    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([child])
    knowledgeItemDeleteLeafDescendantItemsMock.mockRejectedValueOnce(deletionError)

    await expect(service.reindexItems(base.id, [root])).rejects.toBe(deletionError)

    expect(vectorStoreDeleteMock).toHaveBeenCalledWith(child.id)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'delete descendants failed'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
      error: 'delete descendants failed'
    })
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

    await service.addItems(originalBase.id, [{ type: 'directory', path: '/docs/dir-1' }])

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

    const addPromise = service.addItems('kb-1', [{ type: 'directory', path: '/docs/dir-1' }])
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

  it('marks interrupted base tasks failed when deleting the vector store fails', async () => {
    const service = new KnowledgeRuntimeService()
    const root = createDirectoryItem('dir-1', 'processing')
    const child = createNoteItem('child-1', 'processing')
    const deleteStoreError = new Error('delete store failed')
    const expansionStarted = createDeferred()
    const finishCreation = createDeferred()

    knowledgeItemCreateMock.mockResolvedValueOnce(root)
    knowledgeItemGetDescendantItemsMock.mockResolvedValue([child])
    deleteVectorStoreMock.mockRejectedValueOnce(deleteStoreError)
    prepareKnowledgeItemMock.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      expansionStarted.resolve()
      await finishCreation.promise
      signal.throwIfAborted()
      return [child]
    })

    const addPromise = service.addItems('kb-1', [{ type: 'directory', path: '/docs/dir-1' }])
    await expansionStarted.promise

    const deleteBasePromise = service.deleteBase('kb-1')
    await flushPromises()

    finishCreation.resolve()
    await expect(deleteBasePromise).rejects.toBe(deleteStoreError)
    await addPromise

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'delete store failed'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(child.id, 'failed', {
      error: 'delete store failed'
    })
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

    const addPromise = service.addItems('kb-1', [{ type: 'directory', path: '/docs/dir-root' }])
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

  it('marks queued work failed on stop', async () => {
    const service = new KnowledgeRuntimeService()
    const item = createNoteItem('note-1', 'processing')
    const readDeferred = createDeferred<object[]>()
    loadKnowledgeItemDocumentsMock.mockReturnValueOnce(readDeferred.promise)

    await service.addItems('kb-1', [{ type: 'note', content: 'hello note-1', source: 'note-1' }])
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

    await service.addItems('kb-1', [{ type: 'note', content: 'hello note-1', source: 'note-1' }])
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
})
