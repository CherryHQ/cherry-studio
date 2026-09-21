import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueTx: vi.fn(),
  getDeletingRootGroups: vi.fn(),
  loggerError: vi.fn(),
  withWriteTx: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { withWriteTx: mocks.withWriteTx },
    JobManager: { enqueueTx: mocks.enqueueTx }
  })
})

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getDeletingRootGroups: mocks.getDeletingRootGroups }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError })
  }
}))

const { enqueueKnowledgeSubtreeDeletionTx, recoverDeletingKnowledgeItems } = await import('../subtreeDeletion')

describe('knowledge subtree deletion admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withWriteTx.mockImplementation((callback) => callback({ transaction: Symbol('tx') }))
    mocks.getDeletingRootGroups.mockReturnValue([])
  })

  it('deduplicates roots and uses the canonical idempotency key and base queue', () => {
    const tx = { transaction: Symbol('tx') }

    enqueueKnowledgeSubtreeDeletionTx(tx as never, 'kb-1', ['note-2', 'dir-1', 'note-2'])

    expect(mocks.enqueueTx).toHaveBeenCalledWith(
      tx,
      'knowledge.delete-subtree',
      { baseId: 'kb-1', rootItemIds: ['note-2', 'dir-1'] },
      { idempotencyKey: 'knowledge:kb-1:dir-1,note-2:delete', queue: 'base.kb-1' }
    )
  })

  it('does not enqueue an empty deletion', () => {
    enqueueKnowledgeSubtreeDeletionTx({} as never, 'kb-1', [])

    expect(mocks.enqueueTx).not.toHaveBeenCalled()
  })

  it('filters by base and admits at most 500 roots per transaction', () => {
    const roots = Array.from({ length: 501 }, (_, index) => `root-${index}`)
    mocks.getDeletingRootGroups.mockReturnValue([
      { baseId: 'kb-1', rootItemIds: roots },
      { baseId: 'kb-2', rootItemIds: ['other-root'] }
    ])

    recoverDeletingKnowledgeItems('kb-1')

    expect(mocks.withWriteTx).toHaveBeenCalledTimes(2)
    expect(mocks.enqueueTx).toHaveBeenCalledTimes(2)
    expect(mocks.enqueueTx.mock.calls[0][2]).toEqual({ baseId: 'kb-1', rootItemIds: roots.slice(0, 500) })
    expect(mocks.enqueueTx.mock.calls[1][2]).toEqual({ baseId: 'kb-1', rootItemIds: roots.slice(500) })
  })

  it('logs a failed chunk and continues admitting later chunks', () => {
    const roots = Array.from({ length: 501 }, (_, index) => `root-${index}`)
    mocks.getDeletingRootGroups.mockReturnValue([{ baseId: 'kb-1', rootItemIds: roots }])
    mocks.withWriteTx.mockImplementationOnce(() => {
      throw new Error('first chunk failed')
    })
    mocks.withWriteTx.mockImplementationOnce((callback) => callback({ transaction: Symbol('tx') }))

    recoverDeletingKnowledgeItems()

    expect(mocks.withWriteTx).toHaveBeenCalledTimes(2)
    expect(mocks.enqueueTx).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueTx.mock.calls[0][2]).toEqual({ baseId: 'kb-1', rootItemIds: ['root-500'] })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to enqueue recovered knowledge delete cleanup',
      expect.any(Error),
      { baseId: 'kb-1', rootItemIds: roots.slice(0, 500) }
    )
  })

  it('logs a scan failure without attempting admission', () => {
    mocks.getDeletingRootGroups.mockImplementation(() => {
      throw new Error('scan failed')
    })

    recoverDeletingKnowledgeItems()

    expect(mocks.withWriteTx).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to scan deleting knowledge items for recovery',
      expect.any(Error)
    )
  })
})
