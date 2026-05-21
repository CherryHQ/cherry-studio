import type { JobContext } from '@main/core/job/types'
import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  chunkDocumentsMock,
  createVectorStoreMock,
  embedDocumentsMock,
  getEmbedModelMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  loadKnowledgeItemDocumentsMock,
  replaceByExternalIdMock,
  runWithBaseWriteLockForBaseMock
} = vi.hoisted(() => ({
  chunkDocumentsMock: vi.fn(),
  createVectorStoreMock: vi.fn(),
  embedDocumentsMock: vi.fn(),
  getEmbedModelMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  loadKnowledgeItemDocumentsMock: vi.fn(),
  replaceByExternalIdMock: vi.fn(),
  runWithBaseWriteLockForBaseMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeRuntimeService: {
      runWithBaseWriteLockForBase: runWithBaseWriteLockForBaseMock
    },
    KnowledgeVectorStoreService: {
      createStore: createVectorStoreMock
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

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getById: knowledgeItemGetByIdMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../../readers/KnowledgeReader', () => ({
  loadKnowledgeItemDocuments: loadKnowledgeItemDocumentsMock
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

const { indexLeafJobHandler } = await import('../indexLeafJobHandler')

function createLeafItem(id = 'note-1', status: KnowledgeItem['status'] = 'processing'): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { source: id, content: `body of ${id}` },
    status,
    phase: status === 'processing' ? 'reading' : null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as KnowledgeItemOf<'note'>
}

function createCtx(
  overrides: Partial<JobContext<unknown>> = {}
): JobContext<{ baseId: string; itemId: string; parentJobId: string | null }> {
  const controller = new AbortController()
  return {
    jobId: 'job-leaf-1',
    input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null },
    attempt: 1,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    } as unknown as JobContext['logger'],
    ...overrides
  } as JobContext<{ baseId: string; itemId: string; parentJobId: string | null }>
}

describe('indexLeafJobHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeBaseGetByIdMock.mockResolvedValue({ id: 'kb-1' })
    knowledgeItemGetByIdMock.mockResolvedValue(createLeafItem('note-1', 'processing'))
    knowledgeItemUpdateStatusMock.mockImplementation(async (id: string) => createLeafItem(id, 'processing'))
    loadKnowledgeItemDocumentsMock.mockResolvedValue([{ text: 'doc-1' }])
    chunkDocumentsMock.mockReturnValue([{ text: 'chunk-1' }])
    embedDocumentsMock.mockResolvedValue([{ id_: 'chunk-1', getContent: vi.fn() }])
    getEmbedModelMock.mockReturnValue({ id: 'embed-model' })
    createVectorStoreMock.mockResolvedValue({
      replaceByExternalId: replaceByExternalIdMock
    })
    replaceByExternalIdMock.mockResolvedValue(['chunk-1'])
    runWithBaseWriteLockForBaseMock.mockImplementation(async (_baseId: string, task: () => Promise<unknown>) => task())
  })

  it('exposes the documented handler configuration', () => {
    expect(indexLeafJobHandler.recovery).toBe('retry')
    expect(indexLeafJobHandler.defaultConcurrency).toBe(5)
    expect(indexLeafJobHandler.defaultTimeoutMs).toBe(5 * 60 * 1000)
    expect(indexLeafJobHandler.defaultRetryPolicy).toEqual({
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    })
    expect(indexLeafJobHandler.defaultQueue?.({ baseId: 'kb-99', itemId: 'x', parentJobId: null })).toBe('base.kb-99')
  })

  it('runs read → chunk → embed → replaceByExternalId → completed in order', async () => {
    await indexLeafJobHandler.execute(createCtx())

    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledOnce()
    expect(chunkDocumentsMock).toHaveBeenCalledOnce()
    expect(embedDocumentsMock).toHaveBeenCalledOnce()
    expect(replaceByExternalIdMock).toHaveBeenCalledWith('note-1', [expect.objectContaining({ id_: 'chunk-1' })])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenLastCalledWith('note-1', 'completed')

    const order = {
      load: loadKnowledgeItemDocumentsMock.mock.invocationCallOrder[0],
      chunk: chunkDocumentsMock.mock.invocationCallOrder[0],
      embed: embedDocumentsMock.mock.invocationCallOrder[0],
      replace: replaceByExternalIdMock.mock.invocationCallOrder[0]
    }
    expect(order.load).toBeLessThan(order.chunk)
    expect(order.chunk).toBeLessThan(order.embed)
    expect(order.embed).toBeLessThan(order.replace)
  })

  it('skips embedding when the item is already completed', async () => {
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createLeafItem('note-1', 'completed'))
    const reportProgress = vi.fn()

    await indexLeafJobHandler.execute(createCtx({ reportProgress }))

    expect(loadKnowledgeItemDocumentsMock).not.toHaveBeenCalled()
    expect(embedDocumentsMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(reportProgress).toHaveBeenCalledWith(100, {
      stage: 'already-completed',
      currentFile: 1,
      totalFiles: 1
    })
  })

  it('throws KNOWLEDGE_EMPTY_CONTENT when the reader returns nothing', async () => {
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([])

    await expect(indexLeafJobHandler.execute(createCtx())).rejects.toThrow('KNOWLEDGE_EMPTY_CONTENT')
    expect(embedDocumentsMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
  })

  it('propagates replaceByExternalId errors so JobManager can retry', async () => {
    const writeError = new Error('disk full')
    replaceByExternalIdMock.mockRejectedValueOnce(writeError)

    await expect(indexLeafJobHandler.execute(createCtx())).rejects.toBe(writeError)
    // status should never be flipped to completed when replace fails
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'completed')
  })

  it('aborts mid-flight when the signal fires', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))

    await expect(indexLeafJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(
      'user cancelled'
    )
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
  })

  it('refuses to process a non-leaf item type', async () => {
    knowledgeItemGetByIdMock.mockResolvedValueOnce({
      ...createLeafItem('note-1', 'processing'),
      type: 'directory'
    } as unknown as KnowledgeItem)

    await expect(indexLeafJobHandler.execute(createCtx())).rejects.toThrow(
      /indexLeafJobHandler received non-leaf knowledge item/
    )
  })
})
