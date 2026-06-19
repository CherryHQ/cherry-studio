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
  deleteMaterialMock,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  listMock,
  loggerWarnMock,
  probeKnowledgeSourcePathMock,
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

    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    await handler.execute(ctx)

    expect(deleteMaterialMock).toHaveBeenCalledWith('note-1')
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job')
    // A clean rebuild with nothing skipped omits skippedMissingSource entirely (exact-object match).
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 1 })
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
    expect(deleteMaterialMock).not.toHaveBeenCalled()
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
    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('leaves a root untouched when its source vanished before the mutation lock', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    const root = createDirectoryItem('dir-1')
    const child = createNoteItem('note-1', 'dir-1')
    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'reindex-job')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, _rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.leafOnly) return [child]
        if (options.includeRoots) return [root, child]
        return [child]
      }
    )
    // The directory's on-disk source is gone, so the in-lock re-check must keep its
    // existing vectors instead of wiping them with nothing left to rebuild from.
    probeKnowledgeSourcePathMock.mockResolvedValue('missing')

    await handler.execute(ctx)

    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Skipping reindex for roots whose source could not be read before the mutation lock',
      expect.objectContaining({ baseId: 'kb-1', missingSourceRootIds: ['dir-1'], jobId: 'reindex-job' })
    )
    // The skipped-source count is threaded into the done detail so the partial no-op is visible.
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 0, skippedMissingSource: 1 })
  })

  it('reindexes only the roots whose source still exists', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    const presentRoot = createDirectoryItem('dir-1')
    const presentChild = createNoteItem('note-1', 'dir-1')
    const missingRoot = createDirectoryItem('dir-2')
    const missingChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.includeRoots && options.leafOnly) return rootIds.includes('dir-1') ? [presentChild] : []
        if (options.includeRoots) return [presentRoot, presentChild, missingRoot, missingChild]
        return rootIds.includes('dir-1') ? [presentChild] : []
      }
    )
    probeKnowledgeSourcePathMock.mockImplementation(async (absolutePath: string) =>
      absolutePath === 'dir-1' ? 'readable' : 'missing'
    )

    const ctx = createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job')
    await handler.execute(ctx)

    // Only the surviving root's subtree is wiped and rescheduled; the vanished root keeps its vectors.
    expect(deleteMaterialMock).toHaveBeenCalledWith('note-1')
    expect(deleteMaterialMock).not.toHaveBeenCalledWith('note-2')
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith('dir-1', 'preparing')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-2', 'preparing')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'dir-1', 'reindex-job')
    expect(scheduleItemMock).not.toHaveBeenCalledWith('kb-1', 'dir-2', 'reindex-job')
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Skipping reindex for roots whose source could not be read before the mutation lock',
      expect.objectContaining({ baseId: 'kb-1', missingSourceRootIds: ['dir-2'], jobId: 'reindex-job' })
    )
    // One root rebuilt, one skipped — the done detail surfaces the skip alongside the rebuilt count.
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done', totalFiles: 1, skippedMissingSource: 1 })
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

  it('never fails a left-untouched missing-source root when rescheduling a rebuildable root fails', async () => {
    const handler = createReindexSubtreeJobHandler(knowledgeLockManager as never, workflowService as never)
    const presentRoot = createDirectoryItem('dir-1')
    const presentChild = createNoteItem('note-1', 'dir-1')
    const missingRoot = createDirectoryItem('dir-2')
    const missingChild = createNoteItem('note-2', 'dir-2')
    knowledgeItemGetSubtreeItemsMock.mockImplementation(
      async (_baseId: string, rootIds: string[], options: { includeRoots?: boolean; leafOnly?: boolean } = {}) => {
        if (options.includeRoots && options.leafOnly) return rootIds.includes('dir-1') ? [presentChild] : []
        if (options.includeRoots) return [presentRoot, presentChild, missingRoot, missingChild]
        return rootIds.includes('dir-1') ? [presentChild] : []
      }
    )
    probeKnowledgeSourcePathMock.mockImplementation(async (absolutePath: string) =>
      absolutePath === 'dir-1' ? 'readable' : 'missing'
    )
    scheduleItemMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', 'dir-2'] }, 'reindex-job'))
    ).rejects.toThrow('enqueue failed')

    // Only the rebuildable root that was reset-but-not-scheduled is failed; the missing-source
    // root (dir-2) was never reset and keeps its vectors, so it must not be flipped to failed.
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['dir-1'], 'failed', {
      error: 'Failed to schedule reindex after reset: enqueue failed'
    })
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith(
      'kb-1',
      ['dir-1', 'dir-2'],
      'failed',
      expect.anything()
    )
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
