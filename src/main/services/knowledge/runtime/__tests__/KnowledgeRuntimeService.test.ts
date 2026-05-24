import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemOf
} from '@shared/data/types/knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelManyMock,
  cancelMock,
  chunkDocumentsMock,
  createVectorStoreMock,
  deleteVectorStoreMock,
  embedDocumentsMock,
  embedManyMock,
  enqueueMock,
  getEmbedModelMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemCreateMock,
  knowledgeItemDeleteLeafDescendantItemsMock,
  knowledgeItemDeleteMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetDescendantAndSelfItemsMock,
  knowledgeItemGetLeafDescendantItemsMock,
  knowledgeItemUpdateStatusMock,
  listMock,
  loadKnowledgeItemDocumentsMock,
  loggerWarnMock,
  prepareKnowledgeItemMock,
  rerankKnowledgeSearchResultsMock,
  registerHandlerMock
} = vi.hoisted(() => ({
  cancelManyMock: vi.fn(),
  cancelMock: vi.fn(),
  chunkDocumentsMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  deleteVectorStoreMock: vi.fn(),
  embedDocumentsMock: vi.fn(),
  embedManyMock: vi.fn(),
  enqueueMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemDeleteLeafDescendantItemsMock: vi.fn(),
  knowledgeItemDeleteMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetDescendantAndSelfItemsMock: vi.fn(),
  knowledgeItemGetLeafDescendantItemsMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  listMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  rerankKnowledgeSearchResultsMock: vi.fn(),
  registerHandlerMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      createStore: createVectorStoreMock,
      deleteStore: deleteVectorStoreMock
    },
    JobManager: {
      registerHandler: registerHandlerMock,
      enqueue: enqueueMock,
      cancel: cancelMock,
      cancelMany: cancelManyMock,
      list: listMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock
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
    getById: knowledgeItemGetByIdMock,
    getDescendantAndSelfItems: knowledgeItemGetDescendantAndSelfItemsMock,
    getLeafDescendantItems: knowledgeItemGetLeafDescendantItemsMock,
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

vi.mock('../utils/cleanup', () => ({
  deleteItemVectors: vi.fn()
}))

// Imported AFTER mocks so the side-effect declare-module merge for both
// handlers is in scope when the runtime references them at module load.
const { KnowledgeRuntimeService } = await import('..')
const { prepareRootJobHandler } = await import('../../tasks/prepareRootJobHandler')
const { indexLeafJobHandler } = await import('../../tasks/indexLeafJobHandler')

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
  } as KnowledgeBase
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
  } as KnowledgeItemOf<'note'>
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
    data: { source: id, path: `/docs/${id}` },
    ...lifecycle,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as KnowledgeItemOf<'directory'>
}

describe('KnowledgeRuntimeService (Phase 4 JobManager backbone)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemGetByIdMock.mockImplementation(async (id: string) => createNoteItem(id, 'processing'))
    knowledgeItemUpdateStatusMock.mockImplementation(async (id: string) => createNoteItem(id, 'processing'))
    knowledgeItemGetDescendantAndSelfItemsMock.mockResolvedValue([])
    knowledgeItemGetLeafDescendantItemsMock.mockResolvedValue([])
    listMock.mockResolvedValue([])
    enqueueMock.mockResolvedValue({ id: 'job-id', snapshot: {}, finished: Promise.resolve({}) })
    cancelMock.mockResolvedValue(undefined)
    cancelManyMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('lifecycle decorators', () => {
    it('runs in WhenReady phase and depends on KnowledgeVectorStoreService', () => {
      expect(getPhase(KnowledgeRuntimeService)).toBe(Phase.WhenReady)
      expect(getDependencies(KnowledgeRuntimeService)).toEqual(['KnowledgeVectorStoreService'])
    })
  })

  describe('onInit', () => {
    it('registers both knowledge JobHandlers', async () => {
      const service = new KnowledgeRuntimeService()
      ;(service as unknown as { onInit: () => void }).onInit()

      expect(registerHandlerMock).toHaveBeenCalledTimes(2)
      expect(registerHandlerMock).toHaveBeenCalledWith('knowledge.prepare-root', prepareRootJobHandler)
      expect(registerHandlerMock).toHaveBeenCalledWith('knowledge.index-leaf', indexLeafJobHandler)
    })
  })

  describe('onStop', () => {
    it('cancels both job types and waits for outstanding locks (no item.status rollback)', async () => {
      const service = new KnowledgeRuntimeService()
      await (service as unknown as { onStop: () => Promise<void> }).onStop()

      expect(cancelManyMock).toHaveBeenCalledTimes(2)
      const calledTypes = cancelManyMock.mock.calls.map((c) => (c[0] as { type?: string }).type)
      expect(calledTypes).toEqual(expect.arrayContaining(['knowledge.prepare-root', 'knowledge.index-leaf']))
      expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    })
  })

  describe('cancelAllJobsForBase', () => {
    it('delegates to JobManager.cancelMany with a per-base queue filter', async () => {
      const service = new KnowledgeRuntimeService()
      await service.cancelAllJobsForBase('kb-99')

      expect(cancelManyMock).toHaveBeenCalledWith({ queue: 'base.kb-99' }, 'delete-base')
    })
  })

  describe('addItems', () => {
    it('returns immediately for empty inputs without acquiring base or JobManager', async () => {
      const service = new KnowledgeRuntimeService()
      await service.addItems('kb-1', [])

      expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
      expect(enqueueMock).not.toHaveBeenCalled()
    })

    it('enqueues a leaf item via knowledge.index-leaf with idempotency key', async () => {
      const noteItem = createNoteItem('note-1', 'idle')
      const processingNote = createNoteItem('note-1', 'processing')
      knowledgeItemCreateMock.mockResolvedValueOnce(noteItem)
      knowledgeItemUpdateStatusMock.mockResolvedValueOnce(processingNote)

      const service = new KnowledgeRuntimeService()
      await service.addItems('kb-1', [{ type: 'note', data: noteItem.data }])

      expect(enqueueMock).toHaveBeenCalledTimes(1)
      const [type, payload, opts] = enqueueMock.mock.calls[0]
      expect(type).toBe('knowledge.index-leaf')
      expect(payload).toEqual({ baseId: 'kb-1', itemId: 'note-1', parentJobId: null })
      expect(opts).toEqual({ idempotencyKey: 'knowledge:kb-1:note-1' })
    })

    it('enqueues a container as knowledge.prepare-root with the original item type', async () => {
      const dirItem = createDirectoryItem('dir-1', 'idle')
      const preparingDir = createDirectoryItem('dir-1', 'processing')
      knowledgeItemCreateMock.mockResolvedValueOnce(dirItem)
      knowledgeItemUpdateStatusMock.mockResolvedValueOnce(preparingDir)

      const service = new KnowledgeRuntimeService()
      await service.addItems('kb-1', [{ type: 'directory', data: dirItem.data }])

      expect(enqueueMock).toHaveBeenCalledTimes(1)
      const [type, payload] = enqueueMock.mock.calls[0]
      expect(type).toBe('knowledge.prepare-root')
      expect(payload).toEqual({ baseId: 'kb-1', itemId: 'dir-1' })
    })

    it('rolls back accepted items when one input fails partway through', async () => {
      const noteItem = createNoteItem('note-1', 'idle')
      knowledgeItemCreateMock.mockResolvedValueOnce(noteItem).mockRejectedValueOnce(new Error('create failed'))

      const service = new KnowledgeRuntimeService()
      await expect(
        service.addItems('kb-1', [
          { type: 'note', data: noteItem.data },
          { type: 'note', data: noteItem.data }
        ])
      ).rejects.toThrow('create failed')

      expect(knowledgeItemDeleteMock).toHaveBeenCalledWith('note-1')
      expect(enqueueMock).not.toHaveBeenCalled()
    })
  })

  describe('reindexItems', () => {
    it('cancels active jobs whose itemId is in the targeted subtree, then re-enqueues roots', async () => {
      const root = createNoteItem('note-1', 'processing')
      const descendant = createNoteItem('descendant-1', 'processing')
      knowledgeItemGetDescendantAndSelfItemsMock.mockResolvedValueOnce([root, descendant])
      knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([root, descendant])
      listMock.mockResolvedValueOnce([
        { id: 'job-active', input: { itemId: 'descendant-1' } },
        { id: 'job-unrelated', input: { itemId: 'other-item' } }
      ])

      const service = new KnowledgeRuntimeService()
      await service.reindexItems('kb-1', [root])

      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(cancelMock).toHaveBeenCalledWith('job-active', 'reindex')
      // Leaf re-enqueue uses the index-leaf path.
      expect(enqueueMock).toHaveBeenCalledTimes(1)
      const [type] = enqueueMock.mock.calls[0]
      expect(type).toBe('knowledge.index-leaf')
    })

    it('deletes prior leaf descendants for container roots before re-enqueueing', async () => {
      const dir = createDirectoryItem('dir-1', 'processing')
      knowledgeItemGetDescendantAndSelfItemsMock.mockResolvedValueOnce([dir])
      knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([])

      const service = new KnowledgeRuntimeService()
      await service.reindexItems('kb-1', [dir])

      expect(knowledgeItemDeleteLeafDescendantItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1'])
      expect(enqueueMock).toHaveBeenCalledWith(
        'knowledge.prepare-root',
        expect.objectContaining({ itemId: 'dir-1' }),
        expect.objectContaining({ idempotencyKey: 'knowledge:kb-1:dir-1' })
      )
    })

    it('silently swallows cancel failures (job may already be terminal)', async () => {
      const root = createNoteItem('note-1', 'processing')
      knowledgeItemGetDescendantAndSelfItemsMock.mockResolvedValueOnce([root])
      knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([root])
      listMock.mockResolvedValueOnce([{ id: 'job-stale', input: { itemId: 'note-1' } }])
      cancelMock.mockRejectedValueOnce(new Error('already terminal'))

      const service = new KnowledgeRuntimeService()
      await expect(service.reindexItems('kb-1', [root])).resolves.toBeUndefined()
      expect(loggerWarnMock).toHaveBeenCalledWith('reindex cancel failed (job may already be terminal)', {
        jobId: 'job-stale',
        error: 'already terminal'
      })
    })
  })

  describe('deleteItems', () => {
    it('cancels in-flight jobs for the subtree and cleans leaf vectors (no DB row delete)', async () => {
      const root = createNoteItem('note-1', 'processing')
      knowledgeItemGetDescendantAndSelfItemsMock.mockResolvedValueOnce([root])
      knowledgeItemGetLeafDescendantItemsMock.mockResolvedValueOnce([root])
      listMock.mockResolvedValueOnce([{ id: 'job-x', input: { itemId: 'note-1' } }])

      const service = new KnowledgeRuntimeService()
      await service.deleteItems('kb-1', [root])

      expect(cancelMock).toHaveBeenCalledWith('job-x', 'delete-items')
      expect(knowledgeItemDeleteMock).not.toHaveBeenCalled()
    })
  })

  describe('runWithBaseWriteLockForBase', () => {
    it('serializes overlapping tasks for the same base', async () => {
      const service = new KnowledgeRuntimeService()
      const order: string[] = []

      const first = service.runWithBaseWriteLockForBase('kb-1', async () => {
        order.push('first-start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('first-end')
      })
      const second = service.runWithBaseWriteLockForBase('kb-1', async () => {
        order.push('second-start')
        order.push('second-end')
      })

      await Promise.all([first, second])
      expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
    })

    it('releases the lock even when the task throws', async () => {
      const service = new KnowledgeRuntimeService()

      await expect(
        service.runWithBaseWriteLockForBase('kb-1', async () => {
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')

      // Second call must not deadlock.
      await expect(service.runWithBaseWriteLockForBase('kb-1', async () => 'ok')).resolves.toBe('ok')
    })
  })

  describe('waitForBaseWriteLocks', () => {
    it('returns immediately when no locks are held', async () => {
      const service = new KnowledgeRuntimeService()
      await expect(service.waitForBaseWriteLocks('kb-1', 100)).resolves.toBeUndefined()
    })

    it('logs a warning and returns when timeout elapses while a lock is still held', async () => {
      vi.useFakeTimers()
      const service = new KnowledgeRuntimeService()

      const blocker = service.runWithBaseWriteLockForBase('kb-1', async () => {
        await new Promise<void>(() => {
          /* never resolves */
        })
      })

      const waitPromise = service.waitForBaseWriteLocks('kb-1', 50)
      await vi.advanceTimersByTimeAsync(60)
      await expect(waitPromise).resolves.toBeUndefined()
      expect(loggerWarnMock).toHaveBeenCalledWith('waitForBaseWriteLocks timed out', {
        baseId: 'kb-1',
        timeoutMs: 50,
        lockCount: 1
      })

      void blocker.catch(() => undefined)
    })
  })
})
