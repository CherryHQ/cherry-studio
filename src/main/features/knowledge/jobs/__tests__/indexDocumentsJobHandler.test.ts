import { describe, expect, it } from 'vitest'

import {
  createAbortedCtx,
  createCtx,
  createFileItem,
  createIndexDocumentsJobHandler,
  createJobSnapshot,
  createNoteItem,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  loadKnowledgeItemDocumentsMock,
  NOTE_ITEM_ID,
  replaceByExternalIdMock
} from './jobHandlerTestUtils'

describe('index-documents job handler', () => {
  it('updates statuses, writes vectors, and completes the item', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(replaceByExternalIdMock).toHaveBeenCalledWith(NOTE_ITEM_ID, expect.any(Array))
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null })).toBe('base.kb-1')
  })

  it('passes file items to the reader without a fileEntry override', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID))

    await handler.execute(
      createCtx({
        baseId: 'kb-1',
        itemId: FILE_ITEM_ID,
        parentJobId: null
      })
    )

    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: FILE_ITEM_ID }),
      expect.any(AbortSignal)
    )
  })

  it('completes with empty vectors when the reader returns no documents', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(replaceByExternalIdMock).toHaveBeenCalledWith(NOTE_ITEM_ID, [])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('skips vector write when the item becomes deleting inside the mutation lock', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock
      .mockResolvedValueOnce(createNoteItem(NOTE_ITEM_ID))
      .mockResolvedValueOnce(createNoteItem(NOTE_ITEM_ID, null, 'deleting'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('does not mark completed when vector replacement fails', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    replaceByExternalIdMock.mockRejectedValueOnce(new Error('vector write failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    ).rejects.toThrow('vector write failed')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('stops before side effects when aborted before execution', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)

    await expect(
      handler.execute(createAbortedCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    ).rejects.toThrow()

    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(replaceByExternalIdMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('onSettled skips failed status when the item is deleting', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    )
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', null, 'deleting'))

    await handler.onSettled?.({
      jobId: 'index-job',
      type: 'knowledge.index-documents',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'cancelled', retryable: false },
      attempt: 1
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', expect.anything())
  })
})
