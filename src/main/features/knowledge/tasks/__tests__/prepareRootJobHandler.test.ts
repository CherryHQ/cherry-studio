import { describe, expect, it } from 'vitest'

import {
  createCtx,
  createDirectoryItem,
  createNoteItem,
  createPrepareRootJobHandler,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesBestEffortMock,
  deleteMaterialsMock,
  ingestionService,
  knowledgeItemGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeItemSetSubtreeStatusMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  prepareKnowledgeItemMock,
  scheduleItemMock
} from './jobHandlerTestUtils'

describe('prepare-root job handler', () => {
  it('clears stale expansion and schedules recreated leaves', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(knowledgeItemGetSubtreeItemsMock).toHaveBeenCalledWith('kb-1', ['dir-1'])
    // Nothing to purge (no prior expansion) — purgeKnowledgeSubtreeWithinLock is a no-op for an empty subtree.
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
    expect(prepareKnowledgeItemMock).toHaveBeenCalledWith(expect.objectContaining({ baseId: 'kb-1' }))
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-1', 'prepare-job')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: 'dir-1' })).toBe('base.kb-1')
  })

  it('clears stale expansion vectors before deleting rows', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    const activeChild = createNoteItem('active-note', 'dir-1')
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([activeChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(deleteMaterialsMock).toHaveBeenCalledWith(['active-note'])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(deleteMaterialsMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
    )
  })

  it('routes stale-expansion cleanup through best-effort delete before deleting rows', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    const activeChild = createNoteItem('active-note', 'dir-1')
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([activeChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', [activeChild], {
      baseId: 'kb-1',
      itemId: 'dir-1'
    })
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    // Cleanup is best-effort (swallows failures — see pathStorage test); row deletion must run after it.
    expect(deleteKnowledgeItemFilesBestEffortMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
    )
  })

  it('leaves deleting descendants for delete-subtree cleanup', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    const activeChild = createNoteItem('active-note', 'dir-1')
    const deletingChild = createNoteItem('deleting-note', 'dir-1', 'deleting')
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([activeChild, deletingChild])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(deleteMaterialsMock).toHaveBeenCalledWith(['active-note'])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['active-note'])
    expect(deleteMaterialsMock).not.toHaveBeenCalledWith(expect.arrayContaining(['deleting-note']))
    expect(deleteItemsByIdsMock).not.toHaveBeenCalledWith('kb-1', expect.arrayContaining(['deleting-note']))
  })

  it('skips expansion when the root becomes deleting inside the mutation lock', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(createDirectoryItem())
      .mockReturnValueOnce(createDirectoryItem('dir-1', 'deleting'))

    const ctx = createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job')
    await handler.execute(ctx)

    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'processing')
    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting' })
  })

  it('keeps terminal failure from an empty expansion', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    prepareKnowledgeItemMock.mockResolvedValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'processing')
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('marks unscheduled child leaves failed when enqueueing a child fails', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    const leaves = [
      createNoteItem('leaf-1', 'dir-1'),
      createNoteItem('leaf-2', 'dir-1'),
      createNoteItem('leaf-3', 'dir-1')
    ]
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    prepareKnowledgeItemMock.mockResolvedValue(leaves)
    scheduleItemMock.mockResolvedValueOnce({ id: 'job-leaf-1' }).mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))).rejects.toThrow(
      'enqueue failed'
    )

    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-1', 'prepare-job')
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', 'leaf-2', 'prepare-job')
    expect(scheduleItemMock).not.toHaveBeenCalledWith('kb-1', 'leaf-3', 'prepare-job')
    expect(knowledgeItemSetSubtreeStatusMock).not.toHaveBeenCalledWith('kb-1', ['leaf-1'], 'failed', expect.anything())
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['leaf-2'], 'failed', {
      error: 'Failed to schedule knowledge child item job: enqueue failed'
    })
    expect(knowledgeItemSetSubtreeStatusMock).toHaveBeenCalledWith('kb-1', ['leaf-3'], 'failed', {
      error: 'Failed to schedule knowledge child item job: enqueue failed'
    })
  })

  it('reports unrecovered leaves when failed status cleanup also fails', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    const leaves = [createNoteItem('leaf-1', 'dir-1')]
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem())
    prepareKnowledgeItemMock.mockResolvedValue(leaves)
    scheduleItemMock.mockRejectedValueOnce(new Error('enqueue failed'))
    knowledgeItemSetSubtreeStatusMock.mockImplementationOnce(() => {
      throw new Error('subtree busy')
    })

    await expect(handler.execute(createCtx({ baseId: 'kb-1', itemId: 'dir-1' }, 'prepare-job'))).rejects.toThrow(
      'unrecovered item ids: leaf-1'
    )
  })

  it('onSettled skips failed status when the item is deleting', async () => {
    const handler = createPrepareRootJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createDirectoryItem('dir-1', 'deleting'))

    await handler.onSettled?.({
      jobId: 'prepare-job',
      type: 'knowledge.prepare-root',
      scheduleId: null,
      parentId: null,
      status: 'cancelled',
      input: { baseId: 'kb-1', itemId: 'dir-1' },
      error: { code: 'CANCELLED', message: 'cancelled', retryable: false },
      attempt: 1,
      metadata: {}
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('dir-1', 'failed', expect.anything())
  })
})
