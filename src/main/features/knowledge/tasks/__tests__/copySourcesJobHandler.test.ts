import { describe, expect, it } from 'vitest'

import { KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'
import { KeyedMutex } from '@shared/utils/async'

import type { KnowledgeCopySourcesPayload } from '../jobTypes'
import {
  createCopySourcesJobHandler,
  createCtx,
  createFileItem,
  createPreparedCopy,
  FILE_ITEM_ID,
  FILE_RELATIVE_PATH,
  ingestionService,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  prepareFileCopyIntoKnowledgeBaseAtMock,
  scheduleItemMock
} from './jobHandlerTestUtils'

const payload: KnowledgeCopySourcesPayload = {
  baseId: 'kb-1',
  itemId: FILE_ITEM_ID,
  copies: [{ from: '/docs/source.pdf' as AbsoluteFilePath, relativePath: FILE_RELATIVE_PATH }]
}

function settledEvent(status: 'failed' | 'cancelled', message: string) {
  return {
    jobId: 'copy-job',
    type: 'knowledge.copy-sources',
    scheduleId: null,
    parentId: null,
    status,
    input: payload,
    error: { code: status === 'cancelled' ? 'CANCELLED' : 'JOB_HANDLER_THREW', message, retryable: false },
    attempt: 1,
    metadata: {}
  }
}

describe('copy-sources job handler', () => {
  it('commits the copy under the base lock and only then hands the item to its next stage', async () => {
    const prepared = createPreparedCopy()
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    let inLock = false
    knowledgeLockManager.runExclusive.mockImplementation(async (_key: string, task: () => Promise<unknown>) => {
      inLock = true
      try {
        return await task()
      } finally {
        inLock = false
      }
    })
    prepareFileCopyIntoKnowledgeBaseAtMock.mockImplementationOnce(async () => {
      expect(inLock).toBe(false)
      return prepared
    })
    prepared.commit.mockImplementationOnce(async () => {
      expect(inLock).toBe(true)
      return { mtime: 0, size: 0 }
    })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.execute(createCtx(payload, 'copy-job'))

    expect(prepareFileCopyIntoKnowledgeBaseAtMock).toHaveBeenCalledWith(
      'kb-1',
      '/docs/source.pdf',
      FILE_RELATIVE_PATH,
      expect.any(AbortSignal)
    )
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID)
    expect(prepared.commit.mock.invocationCallOrder[0]).toBeLessThan(scheduleItemMock.mock.invocationCallOrder[0])
    expect(handler.defaultQueue?.(payload)).toBe('base.kb-1')
  })

  it('moves a preparing file to processing in the same locked section as its commit', async () => {
    const prepared = createPreparedCopy()
    prepareFileCopyIntoKnowledgeBaseAtMock.mockResolvedValueOnce(prepared)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID, 'preparing'))
    let inLock = false
    knowledgeLockManager.runExclusive.mockImplementation(async (_key: string, task: () => Promise<unknown>) => {
      inLock = true
      try {
        return await task()
      } finally {
        inLock = false
      }
    })
    knowledgeItemUpdateStatusMock.mockImplementationOnce(() => {
      expect(inLock).toBe(true)
      return createFileItem(FILE_ITEM_ID, 'processing')
    })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.execute(createCtx(payload, 'copy-job'))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'processing')
    expect(prepared.commit.mock.invocationCallOrder[0]).toBeLessThan(
      knowledgeItemUpdateStatusMock.mock.invocationCallOrder[0]
    )
    expect(knowledgeItemUpdateStatusMock.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleItemMock.mock.invocationCallOrder[0]
    )
  })

  it('keeps the status of an item that was not waiting in preparing', async () => {
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID, 'processing'))
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.execute(createCtx(payload, 'copy-job'))

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID)
  })

  it('leaves the base lock free while the bytes stream', async () => {
    const lock = new KeyedMutex()
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    let finishCopy!: () => void
    const copyStarted = new Promise<void>((resolveStarted) => {
      prepareFileCopyIntoKnowledgeBaseAtMock.mockImplementationOnce(
        () =>
          new Promise((resolveCopy) => {
            finishCopy = () => resolveCopy(createPreparedCopy())
            resolveStarted()
          })
      )
    })
    const handler = createCopySourcesJobHandler(lock, ingestionService)

    const execution = handler.execute(createCtx(payload, 'copy-job'))
    await copyStarted

    // Any other mutation on the same base (delete, add, an index write) gets the lock mid-copy.
    await expect(lock.runExclusive('kb-1', () => 'other mutation')).resolves.toBe('other mutation')

    finishCopy()
    await execution
    expect(scheduleItemMock).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID)
  })

  it('fails the job without committing anything when a source cannot be copied', async () => {
    const first = createPreparedCopy()
    prepareFileCopyIntoKnowledgeBaseAtMock
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("ENOENT: no such file or directory, open '/docs/source.md'"))
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await expect(
      handler.execute(
        createCtx(
          {
            ...payload,
            copies: [
              ...payload.copies,
              { from: '/docs/source.md' as AbsoluteFilePath, relativePath: FILE_RELATIVE_PATH }
            ]
          },
          'copy-job'
        )
      )
    ).rejects.toThrow('ENOENT')

    // The temp copy that did finish is discarded rather than left beside its target.
    expect(first.abort).toHaveBeenCalled()
    expect(first.commit).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('discards the copy when the item is deleted before it can commit', async () => {
    const prepared = createPreparedCopy()
    prepareFileCopyIntoKnowledgeBaseAtMock.mockResolvedValueOnce(prepared)
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(createFileItem())
      .mockReturnValue({ ...createFileItem(), status: 'deleting' })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)
    const ctx = createCtx(payload, 'copy-job')

    await handler.execute(ctx)

    expect(prepared.commit).not.toHaveBeenCalled()
    expect(prepared.abort).toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'deleting' })
  })

  it('discards the copy when a delete cancels the job while it waits for the lock', async () => {
    const prepared = createPreparedCopy()
    prepareFileCopyIntoKnowledgeBaseAtMock.mockResolvedValueOnce(prepared)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    const controller = new AbortController()
    knowledgeLockManager.runExclusive.mockImplementation(async (_key: string, task: () => Promise<unknown>) => {
      controller.abort(new Error('Job cancelled: knowledge-delete-subtree'))
      return await task()
    })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await expect(handler.execute({ ...createCtx(payload, 'copy-job'), signal: controller.signal })).rejects.toThrow(
      'Job cancelled'
    )

    expect(prepared.commit).not.toHaveBeenCalled()
    expect(prepared.abort).toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('skips an item that was deleted before its copy started', async () => {
    knowledgeItemGetByIdMock.mockReturnValue({ ...createFileItem(), status: 'deleting' })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.execute(createCtx(payload, 'copy-job'))

    expect(prepareFileCopyIntoKnowledgeBaseAtMock).not.toHaveBeenCalled()
    expect(scheduleItemMock).not.toHaveBeenCalled()
  })

  it('marks only its own item failed with the copy error', async () => {
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.onSettled?.(settledEvent('failed', "ENOENT: no such file or directory, open '/docs/source.pdf'"))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledTimes(1)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: "ENOENT: no such file or directory, open '/docs/source.pdf'"
    })
  })

  it('parks an interrupted copy as indexing_interrupted so reindex can redo it', async () => {
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.onSettled?.(settledEvent('cancelled', 'Job cancelled: JobManager shutdown'))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
    })
    expect(handler.recovery).toBe('abandon')
  })

  it('does not fail a copy whose item is already being deleted', async () => {
    knowledgeItemGetByIdMock.mockReturnValue({ ...createFileItem(), status: 'deleting' })
    const handler = createCopySourcesJobHandler(knowledgeLockManager as never, ingestionService)

    await handler.onSettled?.(settledEvent('cancelled', 'Job cancelled: knowledge-delete-subtree'))

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })
})
