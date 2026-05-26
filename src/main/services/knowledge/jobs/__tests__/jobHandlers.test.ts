import type { JobContext } from '@main/core/job/types'
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelMock,
  createStoreMock,
  enqueueMock,
  fileRefCleanupBySourceBatchMock,
  getStoreIfExistsMock,
  hardDeleteItemsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
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
  fileRefCleanupBySourceBatchMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  hardDeleteItemsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
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
      get: vi.fn(),
      list: listMock
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
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('@data/services/FileRefService', () => ({
  fileRefService: {
    cleanupBySourceBatch: fileRefCleanupBySourceBatchMock
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

function createNoteItem(id = 'note-1', groupId: string | null = null): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(id = 'dir-1'): KnowledgeItemOf<'directory'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    status: 'preparing',
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
    enqueueMock.mockResolvedValue({ id: 'job-index', snapshot: {}, finished: Promise.resolve({}) })
    fileRefCleanupBySourceBatchMock.mockResolvedValue(0)
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

  it('index-documents updates statuses, writes vectors, and completes the item', async () => {
    const handler = createIndexDocumentsJobHandler(mutationCoordinator as never)

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'note-1', parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'embedding')
    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-1', expect.any(Array))
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'completed')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: 'note-1', parentJobId: null })).toBe('base.kb-1')
  })

  it('delete-subtree cancels active subtree jobs, clears vectors, detaches refs, and hard deletes rows', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [createDirectoryItem('dir-1'), createNoteItem('note-1', 'dir-1')]
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
})
