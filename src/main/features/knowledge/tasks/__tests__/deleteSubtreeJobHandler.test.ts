import { describe, expect, it } from 'vitest'

import type { KnowledgeItem } from '@shared/data/types/knowledge'

import {
  cancelMock,
  createCtx,
  createDeleteSubtreeJobHandler,
  createDirectoryItem,
  createExternalItem,
  createFileItem,
  createJobSnapshot,
  createNoteItem,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesMock,
  deleteKnowledgeItemFilesBestEffortMock,
  deleteMaterialsMock,
  FILE_ITEM_ID,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeLockManager,
  listMock,
  reclaimSpaceMock
} from './jobHandlerTestUtils'

describe('delete-subtree job handler', () => {
  it('cancels active subtree jobs, clears vectors, detaches refs, and hard deletes rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'current-job',
        type: 'knowledge.delete-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['dir-1'] }
      }),
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      }),
      createJobSnapshot({
        id: 'check-job',
        type: 'knowledge.check-file-processing-result',
        input: {
          baseId: 'kb-1',
          itemId: 'note-1',
          fileProcessingJobId: 'fp-job-1',
          pollRound: 0,
          firstScheduledAt: 1779811200000,
          processedRelativePath: 'source.md'
        }
      }),
      createJobSnapshot({
        id: 'unrelated-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'other' }
      })
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'current-job'))

    expect(cancelMock).toHaveBeenCalledWith('index-job', 'knowledge-delete-subtree')
    expect(cancelMock).toHaveBeenCalledWith('check-job', 'knowledge-delete-subtree')
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-delete-subtree')
    expect(cancelMock).not.toHaveBeenCalledWith('unrelated-job', expect.anything())
    expect(deleteMaterialsMock).toHaveBeenCalledWith(['note-1'])
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
    // The freed index pages are reclaimed once, after the purge.
    expect(reclaimSpaceMock).toHaveBeenCalledTimes(1)
  })

  it('does not cancel an overlapping delete-subtree job and no-ops after that sibling wins the lock', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [createNoteItem('note-1', null, 'deleting')]
    knowledgeItemGetSubtreeItemsMock
      .mockReturnValueOnce(subtreeItems)
      .mockReturnValueOnce(subtreeItems)
      .mockReturnValueOnce([])
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'sibling-delete-job',
        type: 'knowledge.delete-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['note-1', 'note-2'] }
      })
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['note-1'] }, 'current-delete-job'))

    expect(cancelMock).not.toHaveBeenCalledWith('sibling-delete-job', expect.anything())
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('routes file cleanup through best-effort delete before hard-deleting rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createFileItem(FILE_ITEM_ID, 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', subtreeItems, {
      baseId: 'kb-1',
      jobId: 'delete-job'
    })
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', FILE_ITEM_ID])
    // Cleanup is best-effort (swallows failures — see pathStorage test); row deletion must run after it.
    expect(deleteKnowledgeItemFilesBestEffortMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteItemsByIdsMock.mock.invocationCallOrder[0]
    )
  })

  it('keeps deleting external rows when strict snapshot cleanup fails', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const externalItem = createExternalItem('external-1', 'deleting')
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([externalItem])
    deleteKnowledgeItemFilesMock.mockRejectedValue(new Error('snapshot cleanup failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: [externalItem.id] }, 'delete-job'))
    ).rejects.toThrow('snapshot cleanup failed')

    expect(deleteMaterialsMock).toHaveBeenCalledWith([externalItem.id])
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('uses strict cleanup for external items and best-effort cleanup for ordinary items', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const directory = createDirectoryItem('dir-1', 'deleting')
    const file = createFileItem(FILE_ITEM_ID, 'deleting')
    const externalItem = createExternalItem('external-1', 'deleting')
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([directory, file, externalItem])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1', externalItem.id] }, 'delete-job'))

    expect(deleteKnowledgeItemFilesMock).toHaveBeenCalledWith('kb-1', [externalItem])
    expect(deleteKnowledgeItemFilesBestEffortMock).toHaveBeenCalledWith('kb-1', [directory, file], {
      baseId: 'kb-1',
      jobId: 'delete-job'
    })
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', FILE_ITEM_ID, externalItem.id])
  })

  it('deletes deleting rows by id', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
  })

  it('stops before cleanup when subtree job cancellation fails', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      })
    ])
    cancelMock.mockRejectedValue(new Error('cancel failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'cancel failed'
    )

    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('stops before cleanup when subtree job cancellation times out', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1' }
      })
    ])
    cancelMock.mockResolvedValue({ outcome: 'timed-out' })

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'Job cancel timed out: index-job'
    )

    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('completes when the subtree is already gone', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['missing-root'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('no-ops when a stale job targets visible rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [createDirectoryItem('dir-1'), createNoteItem('note-1', 'dir-1')]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })
})
