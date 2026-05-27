import type { JobContext } from '@main/core/job/types'
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelMock,
  createStoreMock,
  enqueueMock,
  fileEntryFindByIdMock,
  fileRefCleanupBySourceBatchMock,
  fileRefCountByEntryIdsMock,
  fileRefFindBySourceMock,
  fileManagerPermanentDeleteMock,
  getJobMock,
  getStoreIfExistsMock,
  hardDeleteItemsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  listMock,
  loadKnowledgeItemDocumentsMock,
  prepareKnowledgeItemMock,
  replaceByExternalIdMock,
  scheduleItemMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  createStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  fileEntryFindByIdMock: vi.fn(),
  fileRefCleanupBySourceBatchMock: vi.fn(),
  fileRefCountByEntryIdsMock: vi.fn(),
  fileRefFindBySourceMock: vi.fn(),
  fileManagerPermanentDeleteMock: vi.fn(),
  getJobMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  hardDeleteItemsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  listMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  replaceByExternalIdMock: vi.fn(),
  scheduleItemMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      enqueue: enqueueMock,
      get: getJobMock,
      list: listMock
    },
    FileManager: {
      permanentDelete: fileManagerPermanentDeleteMock
    },
    KnowledgeVectorStoreService: {
      createStore: createStoreMock,
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

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock,
    hardDeleteItems: hardDeleteItemsMock,
    setSubtreeStatus: knowledgeItemSetSubtreeStatusMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('@data/services/FileEntryService', () => ({
  fileEntryService: {
    findById: fileEntryFindByIdMock
  }
}))

vi.mock('@data/services/FileRefService', () => ({
  fileRefService: {
    cleanupBySourceBatch: fileRefCleanupBySourceBatchMock,
    countByEntryIds: fileRefCountByEntryIdsMock,
    findBySource: fileRefFindBySourceMock
  }
}))

vi.mock('../../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
}))

vi.mock('../../utils/sources/prepare', () => ({
  prepareKnowledgeItem: prepareKnowledgeItemMock
}))

vi.mock('../../utils/indexing/embed', () => ({
  embedDocuments: vi.fn(async () => [{ id_: 'node-1', metadata: {}, getContent: () => 'chunk' }])
}))

vi.mock('../../utils/model/embedding', () => ({
  getEmbedModel: vi.fn(() => ({ modelId: 'mock-embed' }))
}))

const { createDeleteSubtreeJobHandler } = await import('../deleteSubtreeJobHandler')
const { createIndexDocumentsJobHandler } = await import('../indexDocumentsJobHandler')
const { createPrepareRootJobHandler } = await import('../prepareRootJobHandler')
const { createReindexSubtreeJobHandler } = await import('../reindexSubtreeJobHandler')

const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'

function createBase(): KnowledgeBase {
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
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(
  id = 'note-1',
  groupId: string | null = null,
  status: Exclude<KnowledgeItemOf<'note'>['status'], 'failed'> = 'processing'
): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    status,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(
  id = 'dir-1',
  status: Exclude<KnowledgeItemOf<'directory'>['status'], 'failed'> = 'preparing'
): KnowledgeItemOf<'directory'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    status,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createCtx<TInput>(input: TInput, jobId = 'job-1'): JobContext<TInput> {
  return {
    jobId,
    input,
    attempt: 1,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    } as unknown as JobContext['logger']
  }
}

const mutationCoordinator = {
  withBaseMutationLock: vi.fn(async (_baseId: string, task: () => Promise<unknown>) => await task())
}

const workflowCoordinator = {
  scheduleItem: scheduleItemMock
}

describe('knowledge job handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationCoordinator.withBaseMutationLock.mockImplementation(
      async (_baseId: string, task: () => Promise<unknown>) => await task()
    )
    knowledgeBaseGetByIdMock.mockResolvedValue(createBase())
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem())
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([])
    knowledgeItemSetSubtreeStatusMock.mockResolvedValue([])
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem())
    loadKnowledgeItemDocumentsMock.mockResolvedValue([
      {
        text: 'hello world',
        metadata: { source: 'note-1' }
      }
    ])
    prepareKnowledgeItemMock.mockResolvedValue([createNoteItem('leaf-1', 'dir-1')])
    createStoreMock.mockResolvedValue({ replaceByExternalId: replaceByExternalIdMock })
    getStoreIfExistsMock.mockResolvedValue({ replaceByExternalId: replaceByExternalIdMock })
    listMock.mockResolvedValue([])
    getJobMock.mockResolvedValue(null)
    enqueueMock.mockResolvedValue({ id: 'job-index', snapshot: {}, finished: Promise.resolve({}) })
    fileEntryFindByIdMock.mockResolvedValue(null)
    fileRefCleanupBySourceBatchMock.mockResolvedValue(0)
    fileRefCountByEntryIdsMock.mockResolvedValue(new Map())
    fileRefFindBySourceMock.mockResolvedValue([])
    fileManagerPermanentDeleteMock.mockResolvedValue(undefined)
    cancelMock.mockResolvedValue(undefined)
    scheduleItemMock.mockResolvedValue({ id: 'scheduled-job' })
  })

  it('prepare-root clears stale expansion and schedules recreated leaves', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(knowledgeItemGetSubtreeItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1'])
    expect(hardDeleteItemsMock).toHaveBeenCalledWith('kb-1', [])
    expect(prepareKnowledgeItemMock).toHaveBeenCalledWith(expect.objectContaining({ baseId: 'kb-1' }))
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-1', 'prepare-job')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: 'dir-1' })).toBe('base.kb-1')
  })

  it('prepare-root clears stale expansion artifacts before deleting rows', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const activeChild = createNoteItem('active-note', 'dir-1')
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([activeChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(replaceByExternalIdMock).toHaveBeenCalledWith('active-note', [])
    expect(fileRefCleanupBySourceBatchMock).toHaveBeenCalledWith('knowledge_item', ['active-note'])
    expect(hardDeleteItemsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(replaceByExternalIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      hardDeleteItemsMock.mock.invocationCallOrder[0]
    )
    expect(fileRefCleanupBySourceBatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      hardDeleteItemsMock.mock.invocationCallOrder[0]
    )
  })

  it('prepare-root leaves deleting descendants for delete-subtree cleanup', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const activeChild = createNoteItem('active-note', 'dir-1')
    const deletingChild = createNoteItem('deleting-note', 'dir-1', 'deleting')
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([activeChild, deletingChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(replaceByExternalIdMock).toHaveBeenCalledWith('active-note', [])
    expect(fileRefCleanupBySourceBatchMock).toHaveBeenCalledWith('knowledge_item', ['active-note'])
    expect(hardDeleteItemsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(replaceByExternalIdMock).not.toHaveBeenCalledWith('deleting-note', [])
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalledWith(
      'knowledge_item',
      expect.arrayContaining(['deleting-note'])
    )
    expect(hardDeleteItemsMock).not.toHaveBeenCalledWith('kb-1', expect.arrayContaining(['deleting-note']))
  })

  it('prepare-root marks unscheduled child leaves failed when enqueueing a child fails', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const leaves = [
      createNoteItem('leaf-1', 'dir-1'),
      createNoteItem('leaf-2', 'dir-1'),
      createNoteItem('leaf-3', 'dir-1')
    ]
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    prepareKnowledgeItemMock.mockResolvedValue(leaves)
    scheduleItemMock.mockResolvedValueOnce({ id: 'job-leaf-1' }).mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))).rejects.toThrow(
      'enqueue failed'
    )

    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-1', 'prepare-job')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-2', 'prepare-job')
    expect(scheduleItemMock).not.toHaveBeenCalledWith('kb-1', 'leaf-3', 'prepare-job')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('leaf-1', 'failed', expect.anything())
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('leaf-2', 'failed', {
      error: 'Failed to schedule knowledge child item job: enqueue failed'
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('leaf-3', 'failed', {
      error: 'Failed to schedule knowledge child item job: enqueue failed'
    })
  })

  it('index-documents updates statuses, writes vectors, and completes the item', async () => {
    const handler = createIndexDocumentsJobHandler(mutationCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(replaceByExternalIdMock).toHaveBeenCalledWith(NOTE_ITEM_ID, expect.any(Array))
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null })).toBe('base.kb-1')
  })

  it('index-documents onSettled skips failed status when the item is deleting', async () => {
    const handler = createIndexDocumentsJobHandler(mutationCoordinator as never)
    getJobMock.mockResolvedValue({
      input: { itemId: 'note-1' }
    })
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', null, 'deleting'))

    await handler.onSettled?.({
      jobId: 'index-job',
      type: 'knowledge.index-documents',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'cancelled', retryable: false },
      attempt: 1
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', expect.anything())
  })

  it('prepare-root onSettled skips failed status when the item is deleting', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    getJobMock.mockResolvedValue({
      input: { itemId: 'dir-1' }
    })
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem('dir-1', 'deleting'))

    await handler.onSettled?.({
      jobId: 'prepare-job',
      type: 'knowledge.prepare-root',
      scheduleId: null,
      status: 'cancelled',
      error: { code: 'CANCELLED', message: 'cancelled', retryable: false },
      attempt: 1
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'failed', expect.anything())
  })

  it('delete-subtree cancels active subtree jobs, clears vectors, detaches refs, and hard deletes rows', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([
      { id: 'current-job', input: { rootItemIds: ['dir-1'] } },
      { id: 'index-job', input: { itemId: 'note-1' } },
      { id: 'unrelated-job', input: { itemId: 'other' } }
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'current-job'))

    expect(cancelMock).toHaveBeenCalledWith('index-job', 'knowledge-delete-subtree')
    expect(cancelMock).not.toHaveBeenCalledWith('unrelated-job', expect.anything())
    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-1', [])
    expect(hardDeleteItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
  })

  it('delete-subtree permanent deletes detached internal artifacts with no remaining refs', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    fileRefFindBySourceMock.mockImplementation(async ({ sourceId }: { sourceId: string }) =>
      sourceId === 'note-1'
        ? [
            {
              id: 'ref-1',
              fileEntryId: '019606a0-0000-7000-8000-000000000001',
              sourceType: 'knowledge_item',
              sourceId,
              role: 'attachment',
              createdAt: 1,
              updatedAt: 1
            }
          ]
        : []
    )
    fileEntryFindByIdMock.mockResolvedValue({
      id: '019606a0-0000-7000-8000-000000000001',
      origin: 'internal',
      name: 'artifact',
      ext: 'md',
      size: 12,
      createdAt: 1,
      updatedAt: 1
    })

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(fileRefCleanupBySourceBatchMock).toHaveBeenCalledWith('knowledge_item', ['dir-1', 'note-1'])
    expect(fileRefCountByEntryIdsMock).toHaveBeenCalledWith(['019606a0-0000-7000-8000-000000000001'])
    expect(fileManagerPermanentDeleteMock).toHaveBeenCalledWith('019606a0-0000-7000-8000-000000000001')
  })

  it('delete-subtree keeps detached artifacts that still have refs or are external', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    fileRefFindBySourceMock.mockImplementation(async ({ sourceId }: { sourceId: string }) =>
      sourceId === 'note-1'
        ? [
            {
              id: 'ref-1',
              fileEntryId: '019606a0-0000-7000-8000-000000000001',
              sourceType: 'knowledge_item',
              sourceId,
              role: 'attachment',
              createdAt: 1,
              updatedAt: 1
            },
            {
              id: 'ref-2',
              fileEntryId: '019606a0-0000-7000-8000-000000000002',
              sourceType: 'knowledge_item',
              sourceId,
              role: 'attachment',
              createdAt: 1,
              updatedAt: 1
            }
          ]
        : []
    )
    fileRefCountByEntryIdsMock.mockResolvedValue(new Map([['019606a0-0000-7000-8000-000000000001', 1]]))
    fileEntryFindByIdMock.mockResolvedValue({
      id: '019606a0-0000-7000-8000-000000000002',
      origin: 'external',
      name: 'external',
      ext: 'md',
      externalPath: '/tmp/external.md',
      createdAt: 1,
      updatedAt: 1
    })

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(fileManagerPermanentDeleteMock).not.toHaveBeenCalled()
  })

  it('delete-subtree stops before cleanup when subtree job cancellation fails', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([{ id: 'index-job', input: { itemId: 'note-1' } }])
    cancelMock.mockRejectedValue(new Error('cancel failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'cancel failed'
    )

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
  })

  it('delete-subtree stops before cleanup when subtree job cancellation times out', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([{ id: 'index-job', input: { itemId: 'note-1' } }])
    getJobMock.mockResolvedValue({
      error: {
        code: 'JOB_CANCELLED',
        message: 'Cancel timed out after 30000ms (reason: knowledge-delete-subtree)',
        retryable: false
      }
    })

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'Knowledge subtree job cancel timed out: index-job'
    )

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
  })

  it('delete-subtree completes when the subtree is already gone', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['missing-root'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
  })

  it('delete-subtree no-ops when a stale job targets visible rows', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [createDirectoryItem('dir-1'), createNoteItem('note-1', 'dir-1')]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
  })

  it('reindex-subtree clears old artifacts, resets selected roots, and schedules selected roots', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))

    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-1', [])
    expect(hardDeleteItemsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job')
  })

  it('reindex-subtree skips deleting subtrees before cancelling active jobs', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1', 'deleting')
    const child = createNoteItem('note-1', 'dir-1', 'deleting')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([root, child])

    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting' })
    expect(listMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('reindex-subtree skips reset when the subtree becomes deleting inside the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    const deletingChild = createNoteItem('note-1', 'dir-1', 'deleting')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock
      .mockResolvedValueOnce([root, child])
      .mockResolvedValueOnce([root, child])
      .mockResolvedValueOnce([root, deletingChild])

    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting', totalFiles: 0 })
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('reindex-subtree does not cancel active delete cleanup jobs touching the same subtree', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )
    listMock.mockResolvedValue([
      { id: 'delete-job', type: 'knowledge.delete-subtree', input: { rootItemIds: ['dir-1'] } },
      { id: 'index-job', type: 'knowledge.index-documents', input: { itemId: 'note-1' } }
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))

    expect(cancelMock).toHaveBeenCalledWith('index-job', 'knowledge-reindex-subtree')
    expect(cancelMock).not.toHaveBeenCalledWith('delete-job', expect.anything())
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job')
  })

  it('reindex-subtree clears old artifacts for selected leaf roots', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createNoteItem('note-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [root]
        if (options.includeRoots) return [root]
        return []
      }
    )

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'reindex-job'))

    expect(fileRefCleanupBySourceBatchMock).toHaveBeenCalledWith('knowledge_item', ['note-1'])
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'note-1', 'reindex-job')
  })

  it('reindex-subtree marks reset roots failed when rescheduling fails', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )
    scheduleItemMock.mockRejectedValue(new Error('enqueue failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))).rejects.toThrow(
      'enqueue failed'
    )

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1'], 'failed', {
      error: 'Failed to schedule reindex after reset: enqueue failed'
    })
  })

  it('reindex-subtree stops before reset when subtree job cancellation fails', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([root, child])
    listMock.mockResolvedValue([{ id: 'index-job', input: { itemId: 'note-1' } }])
    cancelMock.mockRejectedValue(new Error('cancel failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))).rejects.toThrow(
      'cancel failed'
    )

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('reindex-subtree stops before reset when subtree job cancellation times out', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([root, child])
    listMock.mockResolvedValue([{ id: 'index-job', input: { itemId: 'note-1' } }])
    getJobMock.mockResolvedValue({
      error: {
        code: 'JOB_CANCELLED',
        message: 'Cancel timed out after 30000ms (reason: knowledge-reindex-subtree)',
        retryable: false
      }
    })

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job'))).rejects.toThrow(
      'Knowledge subtree job cancel timed out: index-job'
    )

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(fileRefCleanupBySourceBatchMock).not.toHaveBeenCalled()
    expect(hardDeleteItemsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })
})
