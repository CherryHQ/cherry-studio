import type { JobContext } from '@main/core/job/types'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelMock,
  deleteLeafDescendantItemsMock,
  enqueueMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  listMock,
  commitPreparedKnowledgeItemMock,
  expandKnowledgeItemForRuntimeMock,
  runWithBaseWriteLockForBaseMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  deleteLeafDescendantItemsMock: vi.fn(),
  enqueueMock: vi.fn(),
  knowledgeBaseGetByIdMock: vi.fn(),
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  listMock: vi.fn(),
  commitPreparedKnowledgeItemMock: vi.fn(),
  expandKnowledgeItemForRuntimeMock: vi.fn(),
  runWithBaseWriteLockForBaseMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeRuntimeService: {
      runWithBaseWriteLockForBase: runWithBaseWriteLockForBaseMock
    },
    JobManager: {
      enqueue: enqueueMock,
      cancel: cancelMock,
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
    deleteLeafDescendantItems: deleteLeafDescendantItemsMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../../runtime/utils/prepare', () => ({
  commitPreparedKnowledgeItem: commitPreparedKnowledgeItemMock,
  expandKnowledgeItemForRuntime: expandKnowledgeItemForRuntimeMock
}))

const { prepareRootJobHandler } = await import('../prepareRootJobHandler')

function createDirectoryItem(id = 'dir-1'): KnowledgeItemOf<'directory'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    status: 'processing',
    phase: 'preparing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as KnowledgeItemOf<'directory'>
}

function createLeafItem(id: string): KnowledgeItem {
  return {
    id,
    baseId: 'kb-1',
    groupId: 'dir-1',
    type: 'note',
    data: { source: id, content: `body of ${id}` },
    status: 'processing',
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as KnowledgeItem
}

function createCtx(overrides: Partial<JobContext<unknown>> = {}): JobContext<{
  baseId: string
  itemId: string
}> {
  const controller = new AbortController()
  return {
    jobId: 'job-prepare-root-1',
    input: { baseId: 'kb-1', itemId: 'dir-1' },
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
  } as JobContext<{ baseId: string; itemId: string }>
}

describe('prepareRootJobHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeBaseGetByIdMock.mockResolvedValue({ id: 'kb-1' })
    knowledgeItemGetByIdMock.mockResolvedValue(createDirectoryItem())
    knowledgeItemUpdateStatusMock.mockResolvedValue(createDirectoryItem())
    deleteLeafDescendantItemsMock.mockResolvedValue(undefined)
    listMock.mockResolvedValue([])
    cancelMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue({ id: 'leaf-job', snapshot: {}, finished: Promise.resolve({}) })
    expandKnowledgeItemForRuntimeMock.mockResolvedValue({ kind: 'directory', children: [] })
    commitPreparedKnowledgeItemMock.mockResolvedValue([])
    runWithBaseWriteLockForBaseMock.mockImplementation(async (_baseId: string, task: () => Promise<unknown>) => task())
  })

  it('exposes the documented handler configuration', () => {
    expect(prepareRootJobHandler.recovery).toBe('retry')
    expect(prepareRootJobHandler.defaultConcurrency).toBe(5)
    expect(prepareRootJobHandler.defaultTimeoutMs).toBe(10 * 60 * 1000)
    expect(prepareRootJobHandler.defaultRetryPolicy).toEqual({
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 2000,
      maxDelayMs: 60_000
    })
    expect(prepareRootJobHandler.defaultQueue?.({ baseId: 'kb-42', itemId: 'x' })).toBe('base.kb-42')
  })

  it('expands the container and enqueues one knowledge.index-leaf job per leaf', async () => {
    const leaves = [createLeafItem('leaf-a'), createLeafItem('leaf-b')]
    const prepared = { kind: 'directory', children: [{ type: 'file', data: leaves[0].data }] }
    expandKnowledgeItemForRuntimeMock.mockResolvedValueOnce(prepared)
    commitPreparedKnowledgeItemMock.mockResolvedValueOnce(leaves)

    await prepareRootJobHandler.execute(createCtx())

    expect(expandKnowledgeItemForRuntimeMock).toHaveBeenCalledWith({
      item: createDirectoryItem(),
      signal: expect.any(AbortSignal)
    })
    expect(commitPreparedKnowledgeItemMock).toHaveBeenCalledWith({
      baseId: 'kb-1',
      item: createDirectoryItem(),
      prepared,
      onCreatedItem: expect.any(Function),
      runMutation: expect.any(Function),
      signal: expect.any(AbortSignal)
    })
    expect(enqueueMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock).toHaveBeenNthCalledWith(
      1,
      'knowledge.index-leaf',
      { baseId: 'kb-1', itemId: 'leaf-a', parentJobId: 'job-prepare-root-1' },
      { idempotencyKey: 'knowledge:kb-1:leaf-a', parentId: 'job-prepare-root-1' }
    )
    expect(enqueueMock).toHaveBeenNthCalledWith(
      2,
      'knowledge.index-leaf',
      { baseId: 'kb-1', itemId: 'leaf-b', parentJobId: 'job-prepare-root-1' },
      { idempotencyKey: 'knowledge:kb-1:leaf-b', parentId: 'job-prepare-root-1' }
    )
  })

  it('cancels only orphan child jobs that match parentJobId === ctx.jobId on retry', async () => {
    listMock.mockResolvedValueOnce([
      // Child of THIS prepare-root from a previous attempt — must be cancelled.
      { id: 'orphan-of-mine', input: { parentJobId: 'job-prepare-root-1' } },
      // Child of a different prepare-root running on this same queue — leave alone.
      { id: 'sibling-prepare-root-orphan', input: { parentJobId: 'job-other-prepare-root' } },
      // Directly-enqueued leaf (e.g. addItems on a file) — leave alone.
      { id: 'unrelated-leaf', input: { parentJobId: null } },
      // The row representing this very prepare-root execution — must not self-cancel.
      { id: 'job-prepare-root-1', input: { parentJobId: null } }
    ])

    await prepareRootJobHandler.execute(createCtx())

    const cancelledIds = cancelMock.mock.calls.map((call) => call[0])
    expect(cancelledIds).toEqual(['orphan-of-mine'])
    expect(cancelMock).toHaveBeenCalledWith('orphan-of-mine', 'prepare-root-retry')
  })

  it('expands outside the base lock and commits prepared children inside it', async () => {
    const leaves = [createLeafItem('leaf-a')]
    expandKnowledgeItemForRuntimeMock.mockResolvedValueOnce({ kind: 'directory', children: [] })
    commitPreparedKnowledgeItemMock.mockResolvedValueOnce(leaves)

    await prepareRootJobHandler.execute(createCtx())

    expect(deleteLeafDescendantItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1'])
    expect(expandKnowledgeItemForRuntimeMock.mock.invocationCallOrder[0]).toBeLessThan(
      runWithBaseWriteLockForBaseMock.mock.invocationCallOrder[0]
    )
    expect(deleteLeafDescendantItemsMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      runWithBaseWriteLockForBaseMock.mock.invocationCallOrder[0]
    )
    expect(commitPreparedKnowledgeItemMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      deleteLeafDescendantItemsMock.mock.invocationCallOrder[0]
    )
    expect(enqueueMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      commitPreparedKnowledgeItemMock.mock.invocationCallOrder[0]
    )
  })

  it('treats expansion that yields zero leaves as success', async () => {
    commitPreparedKnowledgeItemMock.mockResolvedValueOnce([])
    const reportProgress = vi.fn()

    await prepareRootJobHandler.execute(createCtx({ reportProgress }))

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(reportProgress).toHaveBeenLastCalledWith(100, {
      stage: 'done',
      currentFile: 0,
      totalFiles: 0
    })
  })

  it('propagates abort errors raised by signal.throwIfAborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('aborted by test'))

    await expect(prepareRootJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(
      'aborted by test'
    )
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips commit when the base is deleted after expansion', async () => {
    const notFoundError = DataApiErrorFactory.notFound('KnowledgeBase', 'kb-1')
    knowledgeBaseGetByIdMock.mockResolvedValueOnce({ id: 'kb-1' }).mockRejectedValueOnce(notFoundError)

    await prepareRootJobHandler.execute(createCtx())

    expect(expandKnowledgeItemForRuntimeMock).toHaveBeenCalledOnce()
    expect(deleteLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(commitPreparedKnowledgeItemMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips commit when the root item is deleted after expansion', async () => {
    const notFoundError = DataApiErrorFactory.notFound('KnowledgeItem', 'dir-1')
    knowledgeItemGetByIdMock.mockResolvedValueOnce(createDirectoryItem()).mockRejectedValueOnce(notFoundError)

    await prepareRootJobHandler.execute(createCtx())

    expect(expandKnowledgeItemForRuntimeMock).toHaveBeenCalledOnce()
    expect(deleteLeafDescendantItemsMock).not.toHaveBeenCalled()
    expect(commitPreparedKnowledgeItemMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
