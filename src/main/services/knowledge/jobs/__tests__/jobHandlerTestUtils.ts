import type { JobContext } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  createStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  getJobMock: vi.fn(),
  getStoreIfExistsMock: vi.fn(),
  deleteItemsByIdsMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  knowledgeItemReplaceFileRefMock: vi.fn(),
  rebuildFileRefsForItemsMock: vi.fn(),
  listMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  replaceByExternalIdMock: vi.fn(),
  scheduleItemMock: vi.fn()
}))

export const {
  cancelMock,
  createInternalEntryMock,
  createStoreMock,
  enqueueMock,
  getJobMock,
  getStoreIfExistsMock,
  deleteItemsByIdsMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeItemReplaceFileRefMock,
  rebuildFileRefsForItemsMock,
  listMock,
  loadKnowledgeItemDocumentsMock,
  prepareKnowledgeItemMock,
  replaceByExternalIdMock,
  scheduleItemMock
} = mocks

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
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock,
    deleteItemsByIds: deleteItemsByIdsMock,
    rebuildFileRefsForItems: rebuildFileRefsForItemsMock,
    replaceFileRef: knowledgeItemReplaceFileRefMock,
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

export const { createDeleteSubtreeJobHandler } = await import('../deleteSubtreeJobHandler')
export const { createCheckFileProcessingResultJobHandler } = await import('../checkFileProcessingResultJobHandler')
export const { createIndexDocumentsJobHandler } = await import('../indexDocumentsJobHandler')
export const { createPrepareRootJobHandler } = await import('../prepareRootJobHandler')
export const { createReindexSubtreeJobHandler } = await import('../reindexSubtreeJobHandler')

export const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
export const FILE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abd'
export const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000501' as FileEntryId
export const PROCESSED_FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000502' as FileEntryId
type KnowledgeJobSnapshotInput = Pick<JobSnapshot, 'type' | 'input'> & Partial<JobSnapshot>

export function createBase(): KnowledgeBase {
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
    searchMode: 'default',
    hybridAlpha: undefined,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

export function createNoteItem(
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

export function createFileItem(
  id = FILE_ITEM_ID,
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

export function createDirectoryItem(
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

export function createCtx<TInput>(input: TInput, jobId = 'job-1'): JobContext<TInput> {
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

export function createAbortedCtx<TInput>(input: TInput, jobId = 'job-1'): JobContext<TInput> {
  const controller = new AbortController()
  controller.abort()
  return {
    ...createCtx(input, jobId),
    signal: controller.signal
  }
}

export function createJobSnapshot(overrides: KnowledgeJobSnapshotInput): JobSnapshot {
  return {
    id: 'job-1',
    status: 'running',
    priority: 0,
    queue: 'base.kb-1',
    idempotencyKey: null,
    scheduleId: null,
    scheduledAt: '2026-04-08T00:00:00.000Z',
    startedAt: '2026-04-08T00:00:00.000Z',
    finishedAt: null,
    attempt: 1,
    maxAttempts: 3,
    output: null,
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

export const knowledgeLockManager = {
  withBaseMutationLock: vi.fn(async (_baseId: string, task: () => Promise<unknown>) => await task())
}

export const workflowService = {
  scheduleFileProcessingCheck: vi.fn(),
  scheduleIndexing: vi.fn(),
  scheduleItem: scheduleItemMock
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainCacheServiceUtils.resetMocks()
  knowledgeLockManager.withBaseMutationLock.mockImplementation(
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
  createInternalEntryMock.mockResolvedValue({ id: PROCESSED_FILE_ENTRY_ID })
  knowledgeItemReplaceFileRefMock.mockResolvedValue(undefined)
  deleteItemsByIdsMock.mockResolvedValue(undefined)
  rebuildFileRefsForItemsMock.mockResolvedValue(undefined)
  cancelMock.mockResolvedValue({ outcome: 'cancelled' })
  workflowService.scheduleFileProcessingCheck.mockResolvedValue(undefined)
  workflowService.scheduleIndexing.mockResolvedValue(undefined)
  scheduleItemMock.mockResolvedValue({ id: 'scheduled-job' })
})
