import type { JobContext } from '@main/core/job/types'
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelMock,
  createInternalEntryMock,
  createStoreMock,
  detachFileRefsMock,
  enqueueMock,
  getJobMock,
  getStoreIfExistsMock,
  deleteItemsByIdsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemAttachFileRefMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  listMock,
  loadKnowledgeItemDocumentsMock,
  prepareKnowledgeItemMock,
  replaceByExternalIdMock,
  scheduleFileProcessingCheckMock,
  scheduleIndexingMock,
  scheduleItemMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  createStoreMock: vi.fn(),
  detachFileRefsMock: vi.fn(),
  enqueueMock: vi.fn(),
  getJobMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  deleteItemsByIdsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemAttachFileRefMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  listMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  replaceByExternalIdMock: vi.fn(),
  scheduleFileProcessingCheckMock: vi.fn(),
  scheduleIndexingMock: vi.fn(),
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
      createInternalEntry: createInternalEntryMock
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
    attachFileRef: knowledgeItemAttachFileRefMock,
    detachFileRefs: detachFileRefsMock,
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock,
    deleteItemsByIds: deleteItemsByIdsMock,
    setSubtreeStatus: knowledgeItemSetSubtreeStatusMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
}))

vi.mock('../../utils/sources/prepare', () => ({
  prepareKnowledgeItem: prepareKnowledgeItemMock
}))

vi.mock('../../utils/indexing/embed', () => ({
  embedDocuments: vi.fn(async (_model, documents: unknown[]) =>
    documents.length === 0 ? [] : [{ id_: 'node-1', metadata: {}, getContent: () => 'chunk' }]
  )
}))

vi.mock('../../utils/model/embedding', () => ({
  getEmbedModel: vi.fn(() => ({ modelId: 'mock-embed' }))
}))

const { createDeleteSubtreeJobHandler } = await import('../deleteSubtreeJobHandler')
const { createCheckFileProcessingResultJobHandler } = await import('../checkFileProcessingResultJobHandler')
const { createIndexDocumentsJobHandler } = await import('../indexDocumentsJobHandler')
const { createPrepareRootJobHandler } = await import('../prepareRootJobHandler')
const { createReindexSubtreeJobHandler } = await import('../reindexSubtreeJobHandler')

const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000501'
const PROCESSED_FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000502'

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

function createFileItem(
  id = 'file-1',
  status: Exclude<KnowledgeItemOf<'file'>['status'], 'failed'> = 'processing'
): KnowledgeItemOf<'file'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'file',
    data: { source: '/docs/source.pdf', fileEntryId: FILE_ENTRY_ID },
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
  scheduleFileProcessingCheck: scheduleFileProcessingCheckMock,
  scheduleIndexing: scheduleIndexingMock,
  scheduleItem: scheduleItemMock
}

describe('knowledge job handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainCacheServiceUtils.resetMocks()
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
    detachFileRefsMock.mockResolvedValue([])
    createInternalEntryMock.mockResolvedValue({ id: PROCESSED_FILE_ENTRY_ID })
    knowledgeItemAttachFileRefMock.mockResolvedValue(undefined)
    deleteItemsByIdsMock.mockResolvedValue(undefined)
    cancelMock.mockResolvedValue(undefined)
    scheduleFileProcessingCheckMock.mockResolvedValue(undefined)
    scheduleIndexingMock.mockResolvedValue(undefined)
    scheduleItemMock.mockResolvedValue({ id: 'scheduled-job' })
  })

  it('prepare-root clears stale expansion and schedules recreated leaves', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(knowledgeItemGetSubtreeItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1'])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', [])
    expect(prepareKnowledgeItemMock).toHaveBeenCalledWith(expect.objectContaining({ baseId: 'kb-1' }))
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-1', 'prepare-job')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: 'dir-1' })).toBe('base.kb-1')
  })

  it('prepare-root clears stale expansion vectors before deleting rows', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const activeChild = createNoteItem('active-note', 'dir-1')
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([activeChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(replaceByExternalIdMock).toHaveBeenCalledWith('active-note', [])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(replaceByExternalIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
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
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(replaceByExternalIdMock).not.toHaveBeenCalledWith('deleting-note', [])
    expect(deleteItemsByIdsMock).not.toHaveBeenCalledWith('kb-1', expect.arrayContaining(['deleting-note']))
  })

  it('prepare-root skips expansion when the root becomes deleting inside the mutation lock', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    knowledgeItemGetByIdMock
      .mockResolvedValueOnce(createDirectoryItem())
      .mockResolvedValueOnce(createDirectoryItem('dir-1', 'deleting'))

    const ctx = createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job')
    await handler.execute(ctx)

    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'processing')
    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting' })
  })

  it('prepare-root keeps terminal failure from an empty expansion', async () => {
    const handler = createPrepareRootJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    prepareKnowledgeItemMock.mockResolvedValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'processing')
    expect(scheduleItemMock).not.toHaveBeenCalled()
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

  it('check-file-processing-result reschedules delayed polling while file processing is active', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'running'
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: 'file-1',
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID,
      checkCount: 2,
      firstScheduledAt: 1779811200000
    })
    await handler.execute(ctx)

    expect(scheduleFileProcessingCheckMock).toHaveBeenCalledWith('kb-1', 'file-1', 'fp-job-1', FILE_ENTRY_ID, {
      checkCount: 3,
      firstScheduledAt: 1779811200000,
      parentJobId: 'job-1'
    })
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(scheduleIndexingMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'waiting', checkCount: 3 })
  })

  it('check-file-processing-result mirrors file-processing progress while polling', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'running'
    })
    MockMainCacheServiceUtils.setSharedCacheValue('jobs.progress.fp-job-1', {
      progress: 42,
      detail: { stage: 'polling' }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: 'file-1',
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID,
      checkCount: 2,
      firstScheduledAt: 1779811200000
    })
    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(42, {
      stage: 'waiting',
      checkCount: 3,
      fileProcessingJobId: 'fp-job-1',
      fileProcessing: {
        progress: 42,
        detail: { stage: 'polling' }
      }
    })
  })

  it('check-file-processing-result creates a processed artifact ref and schedules indexing on completion', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'completed',
      output: {
        artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/fp-result/result.md' }]
      }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: 'file-1',
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/fp-result/result.md'
    })
    expect(knowledgeItemAttachFileRefMock).toHaveBeenCalledWith('file-1', PROCESSED_FILE_ENTRY_ID, 'processed_artifact')
    expect(scheduleIndexingMock).toHaveBeenCalledWith('kb-1', 'file-1', PROCESSED_FILE_ENTRY_ID, 'job-1')
    expect(scheduleFileProcessingCheckMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('check-file-processing-result marks the item failed when file processing fails', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'failed',
      error: { code: 'FAILED', message: 'processor failed', retryable: false }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: 'file-1',
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('file-1', 'failed', {
      error: 'File processing job fp-job-1 failed: processor failed'
    })
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(scheduleIndexingMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('check-file-processing-result marks the item failed when the completed output has no markdown artifact', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'completed',
      output: {
        artifacts: [{ kind: 'text', format: 'plain', text: 'hello' }]
      }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: 'file-1',
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('file-1', 'failed', {
      error: 'Invalid file processing result for job fp-job-1'
    })
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(scheduleIndexingMock).not.toHaveBeenCalled()
  })

  it('check-file-processing-result skips missing or deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem('file-1', 'deleting'))

    await handler.execute(
      createCtx({
        baseId: 'kb-1',
        itemId: 'file-1',
        fileProcessingJobId: 'fp-job-1',
        sourceFileEntryId: FILE_ENTRY_ID
      })
    )

    expect(getJobMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleIndexingMock).not.toHaveBeenCalled()
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

  it('index-documents completes with empty vectors when the reader returns no documents', async () => {
    const handler = createIndexDocumentsJobHandler(mutationCoordinator as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(replaceByExternalIdMock).toHaveBeenCalledWith(NOTE_ITEM_ID, [])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
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
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
  })

  it('delete-subtree deletes deleting rows by id', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
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
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
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
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('delete-subtree completes when the subtree is already gone', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['missing-root'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('delete-subtree no-ops when a stale job targets visible rows', async () => {
    const handler = createDeleteSubtreeJobHandler(mutationCoordinator as never)
    const subtreeItems: KnowledgeItem[] = [createDirectoryItem('dir-1'), createNoteItem('note-1', 'dir-1')]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
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
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job')
  })

  it('reindex-subtree skips deleting subtrees before reset', async () => {
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
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('reindex-subtree skips reset when the subtree becomes deleting inside the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(mutationCoordinator as never, workflowCoordinator as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    const deletingChild = createNoteItem('note-1', 'dir-1', 'deleting')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockResolvedValueOnce([root, child]).mockResolvedValueOnce([root, deletingChild])

    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting', totalFiles: 0 })
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
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

    expect(detachFileRefsMock).toHaveBeenCalledWith(['note-1'])
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
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
})
