import type { JobContext } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, vi } from 'vitest'

import type * as PathStorage from '../../utils/storage/pathStorage'

const mocks = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getIndexStoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  getJobMock: vi.fn(),
  getIndexStoreIfExistsMock: vi.fn(),
  deleteItemsByIdsMock: vi.fn(),
  deleteKnowledgeItemFilesBestEffortMock: vi.fn(),
  probeKnowledgeFileMock: vi.fn(),
  probeKnowledgeSourcePathMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn(),
  knowledgeItemSetSubtreeStatusMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  knowledgeItemUpdateIndexedRelativePathMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  knowledgeItemUpdateSnapshotRelativePathMock: vi.fn(),
  listMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  fetchKnowledgeWebPageMock: vi.fn(),
  captureUrlSnapshotFileMock: vi.fn(),
  captureNoteSnapshotFileMock: vi.fn(),
  rebuildMaterialMock: vi.fn(),
  deleteMaterialMock: vi.fn(),
  listExistingEmbeddingHashesMock: vi.fn(),
  embedKnowledgeTextsMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  scheduleItemMock: vi.fn()
}))

export const {
  cancelMock,
  getIndexStoreMock,
  enqueueMock,
  getJobMock,
  getIndexStoreIfExistsMock,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesBestEffortMock,
  probeKnowledgeFileMock,
  probeKnowledgeSourcePathMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeItemUpdateIndexedRelativePathMock,
  knowledgeItemGetItemsByBaseIdMock,
  knowledgeItemUpdateSnapshotRelativePathMock,
  listMock,
  loadKnowledgeItemDocumentsMock,
  prepareKnowledgeItemMock,
  fetchKnowledgeWebPageMock,
  captureUrlSnapshotFileMock,
  captureNoteSnapshotFileMock,
  rebuildMaterialMock,
  deleteMaterialMock,
  listExistingEmbeddingHashesMock,
  embedKnowledgeTextsMock,
  loggerWarnMock,
  scheduleItemMock
} = mocks

/**
 * Deterministic, text-distinguishable fake embedding: a hash↔vector mis-pairing
 * in the handler produces a vector that no longer matches `fakeEmbedVector(body)`
 * for the body its hash derives from, so tests can detect it. (The real embed
 * call is mocked out; only ordering/pairing is under test here.)
 */
export function fakeEmbedVector(text: string): number[] {
  let codePointSum = 0
  for (const ch of text) {
    codePointSum += ch.codePointAt(0) ?? 0
  }
  return [text.length, codePointSum, text.codePointAt(0) ?? 0]
}

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      cancel: cancelMock,
      enqueue: enqueueMock,
      get: getJobMock,
      list: listMock
    },
    KnowledgeVectorStoreService: {
      getIndexStore: getIndexStoreMock,
      getIndexStoreIfExists: getIndexStoreIfExistsMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: mocks.loggerWarnMock
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
    getItemsByBaseId: knowledgeItemGetItemsByBaseIdMock,
    deleteItemsByIds: deleteItemsByIdsMock,
    setSubtreeStatus: knowledgeItemSetSubtreeStatusMock,
    updateIndexedRelativePath: knowledgeItemUpdateIndexedRelativePathMock,
    updateSnapshotRelativePath: knowledgeItemUpdateSnapshotRelativePathMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
}))

vi.mock('../../utils/sources/prepare', () => ({
  prepareKnowledgeItem: prepareKnowledgeItemMock
}))

vi.mock('../../utils/sources/url', () => ({
  fetchKnowledgeWebPage: fetchKnowledgeWebPageMock
}))

vi.mock('../../utils/sources/urlSnapshot', () => ({
  captureUrlSnapshotFile: captureUrlSnapshotFileMock
}))

vi.mock('../../utils/sources/noteSnapshot', () => ({
  captureNoteSnapshotFile: captureNoteSnapshotFileMock
}))

vi.mock('../../utils/storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../../utils/storage/pathStorage')
  return {
    ...actual,
    // Stub the best-effort cleanup the handlers call. Its swallow-on-failure
    // contract is unit-tested directly in pathStorage's own test; here we only
    // need handlers to route cleanup through it and still delete rows.
    deleteKnowledgeItemFilesBestEffort: deleteKnowledgeItemFilesBestEffortMock,
    // Stub the on-disk source probes (used by classifyKnowledgeItemSource /
    // canKnowledgeItemRebuildSource in the reindex source guard) so tests control
    // rebuildability without touching the real filesystem; default to 'readable' in beforeEach.
    probeKnowledgeFile: probeKnowledgeFileMock,
    probeKnowledgeSourcePath: probeKnowledgeSourcePathMock
  }
})

vi.mock('../../utils/indexing/embed', () => ({
  embedKnowledgeTexts: embedKnowledgeTextsMock
}))

export const { createDeleteSubtreeJobHandler } = await import('../deleteSubtreeJobHandler')
export const { createCheckFileProcessingResultJobHandler } = await import('../checkFileProcessingResultJobHandler')
export const { createIndexDocumentsJobHandler } = await import('../indexDocumentsJobHandler')
export const { createPrepareRootJobHandler } = await import('../prepareRootJobHandler')
export const { createReindexSubtreeJobHandler } = await import('../reindexSubtreeJobHandler')

export const NOTE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
export const FILE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abd'
export const FILE_RELATIVE_PATH = 'source.pdf'
export const PROCESSED_RELATIVE_PATH = 'source.md'
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
    searchMode: 'vector',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

export function createNoteItem(
  id = 'note-1',
  groupId: string | null = null,
  status: Exclude<KnowledgeItemOf<'note'>['status'], 'failed'> = 'processing',
  // Default to an already-captured snapshot so the item is a valid indexable
  // leaf that passes straight through ensureNoteSnapshot; pass undefined (or
  // override `data`) to exercise the first-index capture path.
  relativePath: string | undefined = `${id}.md`
): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'note',
    data: { source: id, content: `hello ${id}`, ...(relativePath ? { relativePath } : {}) },
    status,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

export function createUrlItem(
  id = 'url-1',
  relativePath?: string,
  status: Exclude<KnowledgeItemOf<'url'>['status'], 'failed'> = 'processing'
): KnowledgeItemOf<'url'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'url',
    data: { source: 'https://example.com', url: 'https://example.com', ...(relativePath ? { relativePath } : {}) },
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
    data: { source: '/docs/source.pdf', relativePath: FILE_RELATIVE_PATH },
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
    data: { source: id, relativePath: `/docs/${id}` },
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
  knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([])
  knowledgeItemSetSubtreeStatusMock.mockResolvedValue([])
  knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem())
  fetchKnowledgeWebPageMock.mockResolvedValue('# Example page\n\nbody text')
  captureUrlSnapshotFileMock.mockResolvedValue('example-page.md')
  captureNoteSnapshotFileMock.mockResolvedValue('note-snapshot.md')
  knowledgeItemUpdateSnapshotRelativePathMock.mockImplementation(
    async (id: string, type: 'url' | 'note', relativePath: string) =>
      type === 'url' ? createUrlItem(id, relativePath) : createNoteItem(id, null, 'processing', relativePath)
  )
  loadKnowledgeItemDocumentsMock.mockResolvedValue([
    {
      text: 'hello world',
      metadata: { source: 'note-1' }
    }
  ])
  prepareKnowledgeItemMock.mockResolvedValue([createNoteItem('leaf-1', 'dir-1')])
  const indexStore = {
    rebuildMaterial: rebuildMaterialMock,
    deleteMaterial: deleteMaterialMock,
    listExistingEmbeddingHashes: listExistingEmbeddingHashesMock
  }
  getIndexStoreMock.mockResolvedValue(indexStore)
  getIndexStoreIfExistsMock.mockResolvedValue(indexStore)
  rebuildMaterialMock.mockResolvedValue(undefined)
  deleteMaterialMock.mockResolvedValue(undefined)
  // No vectors stored yet by default → every chunk is embedded (prior behavior).
  listExistingEmbeddingHashesMock.mockResolvedValue(new Set<string>())
  embedKnowledgeTextsMock.mockImplementation(async (_base: KnowledgeBase, values: string[]) =>
    values.map(fakeEmbedVector)
  )
  listMock.mockResolvedValue([])
  getJobMock.mockResolvedValue(null)
  enqueueMock.mockResolvedValue({ id: 'job-index', snapshot: {}, finished: Promise.resolve({}) })
  knowledgeItemUpdateIndexedRelativePathMock.mockResolvedValue(createFileItem())
  deleteItemsByIdsMock.mockResolvedValue(undefined)
  deleteKnowledgeItemFilesBestEffortMock.mockResolvedValue(undefined)
  probeKnowledgeFileMock.mockResolvedValue('readable')
  probeKnowledgeSourcePathMock.mockResolvedValue('readable')
  cancelMock.mockResolvedValue({ outcome: 'cancelled' })
  workflowService.scheduleFileProcessingCheck.mockResolvedValue(undefined)
  workflowService.scheduleIndexing.mockResolvedValue(undefined)
  scheduleItemMock.mockResolvedValue({ id: 'scheduled-job' })
})
