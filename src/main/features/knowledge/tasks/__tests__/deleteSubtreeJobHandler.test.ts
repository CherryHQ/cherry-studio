import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import {
  cancelMock,
  createCtx,
  createDeleteSubtreeJobHandler,
  createDirectoryItem,
  createFileItem,
  createJobSnapshot,
  createNoteItem,
  deleteItemsByIdsMock,
  deleteKnowledgeItemFilesBestEffortMock,
  deleteMaterialMock,
  FILE_ITEM_ID,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetSubtreeItemsMock,
  knowledgeLockManager,
  listMock
} from './jobHandlerTestUtils'

describe('delete-subtree job handler', () => {
  it('cancels active subtree jobs, clears vectors, detaches refs, and hard deletes rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'current-job',
        type: 'knowledge.delete-subtree',
        input: { baseId: 'kb-1', rootItemIds: ['dir-1'] }
      }),
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
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
          parentJobId: null
        }
      }),
      createJobSnapshot({
        id: 'unrelated-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'other', parentJobId: null }
      })
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'current-job'))

    expect(cancelMock).toHaveBeenCalledWith('index-job', 'knowledge-delete-subtree')
    expect(cancelMock).toHaveBeenCalledWith('check-job', 'knowledge-delete-subtree')
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-delete-subtree')
    expect(cancelMock).not.toHaveBeenCalledWith('unrelated-job', expect.anything())
    expect(deleteMaterialMock).toHaveBeenCalledWith('note-1')
    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
  })

  it('routes file cleanup through best-effort delete before hard-deleting rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createFileItem(FILE_ITEM_ID, 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

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

  it('deletes deleting rows by id', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(deleteItemsByIdsMock).toHaveBeenCalledWith('kb-1', ['dir-1', 'note-1'])
  })

  it('stops before cleanup when subtree job cancellation fails', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    ])
    cancelMock.mockRejectedValue(new Error('cancel failed'))

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'cancel failed'
    )

    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('stops before cleanup when subtree job cancellation times out', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [
      createDirectoryItem('dir-1', 'deleting'),
      createNoteItem('note-1', 'dir-1', 'deleting')
    ]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)
    listMock.mockResolvedValue([
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    ])
    cancelMock.mockResolvedValue({ outcome: 'timed-out' })

    await expect(handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))).rejects.toThrow(
      'Job cancel timed out: index-job'
    )

    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('completes when the subtree is already gone', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue([])

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['missing-root'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })

  it('no-ops when a stale job targets visible rows', async () => {
    const handler = createDeleteSubtreeJobHandler(knowledgeLockManager as never)
    const subtreeItems: KnowledgeItem[] = [createDirectoryItem('dir-1'), createNoteItem('note-1', 'dir-1')]
    knowledgeItemGetSubtreeItemsMock.mockResolvedValue(subtreeItems)

    await handler.execute(createCtx({ baseId: 'kb-1', rootItemIds: ['dir-1'] }, 'delete-job'))

    expect(listMock).not.toHaveBeenCalled()
    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(deleteMaterialMock).not.toHaveBeenCalled()
    expect(deleteItemsByIdsMock).not.toHaveBeenCalled()
  })
})
