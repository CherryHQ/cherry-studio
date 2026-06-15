import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import { DataApiErrorFactory } from '@shared/data/api'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { describe, expect, it } from 'vitest'

import type { KnowledgeCheckFileProcessingResultPayload } from '../jobTypes'
import {
  cancelMock,
  createCheckFileProcessingResultJobHandler,
  createCtx,
  createFileItem,
  createJobSnapshot,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateIndexedRelativePathMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  PROCESSED_RELATIVE_PATH,
  workflowService
} from './jobHandlerTestUtils'

function createFileProcessingJobSnapshot(overrides: Partial<ReturnType<typeof createJobSnapshot>> = {}) {
  const snapshot = createJobSnapshot({
    id: 'fp-job-1',
    type: 'file-processing.remote-poll',
    input: {
      feature: 'document_to_markdown',
      file: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.pdf' },
      output: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' },
      context: { dataId: FILE_ITEM_ID },
      processorId: 'doc2x'
    }
  })
  return {
    ...snapshot,
    ...overrides
  }
}

function createCheckPayload(
  overrides: Partial<KnowledgeCheckFileProcessingResultPayload> = {}
): KnowledgeCheckFileProcessingResultPayload {
  return {
    baseId: 'kb-1',
    itemId: FILE_ITEM_ID,
    fileProcessingJobId: 'fp-job-1',
    pollRound: 0,
    firstScheduledAt: Date.now(),
    parentJobId: null,
    ...overrides
  }
}

describe('check-file-processing-result job handler', () => {
  it('declares the knowledge check job contract', () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)

    expect(handler.recovery).toBe('retry')
    expect(handler.defaultQueue?.(createCheckPayload())).toBe('base.kb-1')
    expect(handler.defaultRetryPolicy).toEqual({
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    })
    expect(handler.defaultTimeoutMs).toBe(2 * 60 * 1000)
  })

  it('reschedules delayed polling while file processing is active', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(createFileProcessingJobSnapshot({ status: 'running' }))

    const firstScheduledAt = Date.now()
    const ctx = createCtx(
      createCheckPayload({
        pollRound: 2,
        firstScheduledAt
      })
    )
    await handler.execute(ctx)

    expect(workflowService.scheduleFileProcessingCheck).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'fp-job-1', {
      pollRound: 3,
      firstScheduledAt,
      parentJobId: 'job-1'
    })
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(0, { stage: 'waiting', pollRound: 3 })
  })

  it('keeps polling follow-ups attached to the original workflow parent', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(createFileProcessingJobSnapshot({ status: 'running' }))

    const firstScheduledAt = Date.now()
    await handler.execute(
      createCtx(
        createCheckPayload({
          pollRound: 2,
          firstScheduledAt,
          parentJobId: 'reindex-job'
        }),
        'check-job-2'
      )
    )

    expect(workflowService.scheduleFileProcessingCheck).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'fp-job-1', {
      pollRound: 3,
      firstScheduledAt,
      parentJobId: 'reindex-job'
    })
  })

  it('mirrors file-processing progress while polling', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(createFileProcessingJobSnapshot({ status: 'running' }))
    MockMainCacheServiceUtils.setSharedCacheValue(`${JOB_PROGRESS_KEY_PREFIX}fp-job-1`, {
      progress: 42,
      detail: { stage: 'polling' }
    })

    const firstScheduledAt = Date.now()
    const ctx = createCtx(
      createCheckPayload({
        pollRound: 2,
        firstScheduledAt
      })
    )
    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(42, {
      stage: 'waiting',
      pollRound: 3,
      fileProcessingJobId: 'fp-job-1',
      fileProcessing: {
        progress: 42,
        detail: { stage: 'polling' }
      }
    })
  })

  it('marks the item failed when file processing exceeds the wait limit', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(createFileProcessingJobSnapshot({ status: 'running' }))

    const ctx = createCtx(
      createCheckPayload({
        pollRound: 360,
        firstScheduledAt: Date.now() - 30 * 60 * 1000
      })
    )
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'File processing job fp-job-1 did not finish within 30 minutes'
    })
    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-file-processing-timeout')
    expect(workflowService.scheduleFileProcessingCheck).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('stores the processed artifact relative path and schedules indexing on completion', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        status: 'completed',
        output: {
          artifact: { kind: 'file', format: 'markdown', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' }
        }
      })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateIndexedRelativePathMock).toHaveBeenCalledWith(FILE_ITEM_ID, PROCESSED_RELATIVE_PATH)
    expect(workflowService.scheduleIndexing).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'job-1')
    expect(workflowService.scheduleFileProcessingCheck).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('schedules indexing under the original workflow parent after polling completion', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        status: 'completed',
        output: {
          artifact: { kind: 'file', format: 'markdown', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' }
        }
      })
    )

    await handler.execute(
      createCtx(
        createCheckPayload({
          parentJobId: 'reindex-job'
        })
      )
    )

    expect(workflowService.scheduleIndexing).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'reindex-job')
  })

  it('marks the item failed when the linked job is not the expected file-processing job', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        input: {
          feature: 'document_to_markdown',
          file: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.pdf' },
          output: { kind: 'path', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' },
          context: { dataId: 'other-item' },
          processorId: 'doc2x'
        }
      })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'Invalid file processing job for knowledge item: fp-job-1'
    })
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('skips attaching artifacts when the item becomes deleting before continuation side effects', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock
      .mockResolvedValueOnce(createFileItem())
      .mockResolvedValueOnce(createFileItem(FILE_ITEM_ID, 'deleting'))
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        status: 'completed',
        output: {
          artifact: { kind: 'file', format: 'markdown', path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' }
        }
      })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateIndexedRelativePathMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).not.toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('marks the item failed when file processing fails', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        status: 'failed',
        error: { code: 'FAILED', message: 'processor failed', retryable: false }
      })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'File processing job fp-job-1 failed: processor failed'
    })
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('marks the item failed when the completed output has no markdown artifact', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue(
      createFileProcessingJobSnapshot({
        status: 'completed',
        output: {
          artifact: { kind: 'text', format: 'plain', text: 'hello' }
        }
      })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'Invalid file processing result for job fp-job-1'
    })
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('cancels linked file-processing work before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID, 'deleting'))

    await handler.execute(createCtx(createCheckPayload()))

    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-file-processing-item-unavailable')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('surfaces cancel failures before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID, 'deleting'))
    cancelMock.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(handler.execute(createCtx(createCheckPayload()))).rejects.toThrow('cancel failed')

    expect(getJobMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('surfaces cancel timeouts before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID, 'deleting'))
    cancelMock.mockResolvedValue({ outcome: 'timed-out' })

    await expect(handler.execute(createCtx(createCheckPayload()))).rejects.toThrow('Job cancel timed out: fp-job-1')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('cancels linked file-processing work before skipping missing items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    knowledgeItemGetByIdMock.mockRejectedValue(DataApiErrorFactory.notFound('KnowledgeItem', FILE_ITEM_ID))

    await handler.execute(createCtx(createCheckPayload()))

    expect(cancelMock).toHaveBeenCalledWith('fp-job-1', 'knowledge-file-processing-item-unavailable')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('onSettled marks active items failed when the check job fails', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    getJobMock.mockResolvedValue({
      id: 'job-1',
      status: 'failed',
      priority: 0,
      queue: 'base.kb-1',
      idempotencyKey: null,
      scheduleId: null,
      scheduledAt: '2026-04-08T00:00:00.000Z',
      startedAt: '2026-04-08T00:00:00.000Z',
      finishedAt: null,
      attempt: 1,
      maxAttempts: 3,
      output: null,
      error: null,
      parentId: null,
      cancelRequested: false,
      metadata: {},
      timeoutMs: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      type: 'knowledge.check-file-processing-result',
      input: createCheckPayload()
    })
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())

    await handler.onSettled?.({
      jobId: 'job-1',
      type: 'knowledge.check-file-processing-result',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'check failed', retryable: false },
      attempt: 3
    })

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', { error: 'check failed' })
  })

  it('onSettled falls back to the terminal status when no error message is available', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, workflowService as never)
    getJobMock.mockResolvedValue({
      id: 'job-1',
      status: 'cancelled',
      priority: 0,
      queue: 'base.kb-1',
      idempotencyKey: null,
      scheduleId: null,
      scheduledAt: '2026-04-08T00:00:00.000Z',
      startedAt: '2026-04-08T00:00:00.000Z',
      finishedAt: null,
      attempt: 1,
      maxAttempts: 3,
      output: null,
      error: null,
      parentId: null,
      cancelRequested: false,
      metadata: {},
      timeoutMs: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      type: 'knowledge.check-file-processing-result',
      input: createCheckPayload()
    })
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())

    await handler.onSettled?.({
      jobId: 'job-1',
      type: 'knowledge.check-file-processing-result',
      scheduleId: null,
      status: 'cancelled',
      error: null,
      attempt: 1
    })

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', { error: 'Job cancelled' })
  })
})
