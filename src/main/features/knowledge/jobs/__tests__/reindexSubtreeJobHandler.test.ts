import { describe, expect, it } from 'vitest'

import {
  cancelMock,
  createCtx,
  createDirectoryItem,
  createFileItem,
  createJobSnapshot,
  createNoteItem,
  createReindexSubtreeJobHandler,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesBestEffortMock,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  listMock,
  replaceByExternalIdMock,
  scheduleItemMock,
  workflowService
} from './jobHandlerTestUtils'

describe('reindex-subtree job handler', () => {
  it('clears old artifacts, resets selected roots, and schedules selected roots', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
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

  it('routes container descendant cleanup through best-effort delete before deleting rows', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
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

    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', [child], {
      baseId: 'kb-1',
      jobId: 'reindex-job'
    })
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    // Cleanup is best-effort (swallows failures — see pathStorage test); row deletion must run after it.
    expect(deleteKnowledgeItemFilesBestEffortMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
    )
  })

  it('skips deleting subtrees before reset', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
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

  it('skips reset when the subtree becomes deleting inside the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
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

  it('clears old artifacts for selected leaf roots', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    const root = createNoteItem('note-1')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [root]
        if (options.includeRoots) return [root]
        return []
      }
    )

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'reindex-job'))

    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('note-1', 'processing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'note-1', 'reindex-job')
  })

  it('marks only unscheduled reset roots failed when rescheduling fails', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    const firstRoot = createDirectoryItem('dir-1')
    const secondRoot = createDirectoryItem('dir-2')
    const firstChild = createNoteItem('note-1', 'dir-1')
    const secondChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [firstChild, secondChild]
        if (options.includeRoots) return [firstRoot, firstChild, secondRoot, secondChild]
        return [firstChild, secondChild]
      }
    )
    scheduleItemMock.mockResolvedValueOnce({ id: 'job-dir-1' }).mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job'))
    ).rejects.toThrow('enqueue failed')

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-2', 'preparing')
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-2'], 'failed', {
      error: 'Failed to schedule reindex after reset: enqueue failed'
    })
  })

  it('onSettled marks active roots without follow-up jobs failed', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'reindex-job',
        type: 'knowledge.reindex-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'note-1'] }
      })
    )
    listMock.mockResolvedValue([])
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([
      createDirectoryItem('dir-1', 'preparing'),
      createNoteItem('note-1', null, 'processing')
    ])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'reset failed', retryable: false },
      attempt: 3
    })

    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'], 'failed', {
      error: 'Reindex job failed: reset failed'
    })
  })

  it('onSettled skips deleting roots and roots with follow-up jobs', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'reindex-job',
        type: 'knowledge.reindex-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['dir-1', 'note-1'] }
      })
    )
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'prepare-dir-1',
        type: 'knowledge.prepare-root',
        parentId: 'reindex-job',
        input: { baseId: 'kb-1', itemId: 'dir-1' }
      })
    ])
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([
      createDirectoryItem('dir-1', 'preparing'),
      createNoteItem('note-1', null, 'deleting')
    ])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      status: 'cancelled',
      error: { code: 'CANCELLED', message: 'cancelled', retryable: false },
      attempt: 1
    })

    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })

  it('onSettled treats file-processing check jobs as follow-up jobs', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'reindex-job',
        type: 'knowledge.reindex-subtree',
        input: { baseId: 'kb-1', rootItemIds: [FILE_ITEM_ID] }
      })
    )
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'check-file-1',
        type: 'knowledge.check-file-processing-result',
        parentId: 'reindex-job',
        input: {
          baseId: 'kb-1',
          itemId: FILE_ITEM_ID,
          fileProcessingJobId: 'fp-job-1',
          pollRound: 0,
          firstScheduledAt: 1779811200000,
          parentJobId: 'reindex-job'
        }
      })
    ])
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([createFileItem(FILE_ITEM_ID, 'processing')])

    await handler.onSettled?.({
      jobId: 'reindex-job',
      type: 'knowledge.reindex-subtree',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'reset failed', retryable: false },
      attempt: 3
    })

    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalled()
  })
})
