import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { describe, expect, it } from 'vitest'

import {
  createCheckFileProcessingResultJobHandler,
  createCtx,
  createFileItem,
  createInternalEntryMock,
  FILE_ENTRY_ID,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeItemAttachFileRefMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  PROCESSED_FILE_ENTRY_ID,
  workflowService
} from './jobHandlerTestUtils'

describe('check-file-processing-result job handler', () => {
  it('reschedules delayed polling while file processing is active', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'running'
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: FILE_ITEM_ID,
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID,
      checkCount: 2,
      firstScheduledAt: 1779811200000
    })
    await handler.execute(ctx)

    expect(workflowService.scheduleFileProcessingCheck).toHaveBeenCalledWith(
      'kb-1',
      FILE_ITEM_ID,
      'fp-job-1',
      FILE_ENTRY_ID,
      {
        checkCount: 3,
        firstScheduledAt: 1779811200000,
        parentJobId: 'job-1'
      }
    )
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'waiting', checkCount: 3 })
  })

  it('mirrors file-processing progress while polling', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'running'
    })
    MockMainCacheServiceUtils.setSharedCacheValue(`${JOB_PROGRESS_KEY_PREFIX}fp-job-1`, {
      progress: 42,
      detail: { stage: 'polling' }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: FILE_ITEM_ID,
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID,
      checkCount: 2,
      firstScheduledAt: 1779811200000
    })
    await handler.execute(ctx)

    expect(ctx.reportProgress).toHaveBeenCalledWith(42, {
      stage: 'waiting',
      checkCount: 3,
      fileProcessingJobId: 'fp-job-1',
      fileProcessing: {
        progress: 42,
        detail: { stage: 'polling' }
      }
    })
  })

  it('creates a processed artifact ref and schedules indexing on completion', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'completed',
      output: {
        artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/fp-result/result.md' }]
      }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: FILE_ITEM_ID,
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/fp-result/result.md'
    })
    expect(knowledgeItemAttachFileRefMock).toHaveBeenCalledWith(
      FILE_ITEM_ID,
      PROCESSED_FILE_ENTRY_ID,
      'processed_artifact'
    )
    expect(workflowService.scheduleIndexing).toHaveBeenCalledWith(
      'kb-1',
      FILE_ITEM_ID,
      PROCESSED_FILE_ENTRY_ID,
      'job-1'
    )
    expect(workflowService.scheduleFileProcessingCheck).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('marks the item failed when file processing fails', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'failed',
      error: { code: 'FAILED', message: 'processor failed', retryable: false }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: FILE_ITEM_ID,
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'File processing job fp-job-1 failed: processor failed'
    })
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('marks the item failed when the completed output has no markdown artifact', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem())
    getJobMock.mockResolvedValue({
      id: 'fp-job-1',
      status: 'completed',
      output: {
        artifacts: [{ kind: 'text', format: 'plain', text: 'hello' }]
      }
    })

    const ctx = createCtx({
      baseId: 'kb-1',
      itemId: FILE_ITEM_ID,
      fileProcessingJobId: 'fp-job-1',
      sourceFileEntryId: FILE_ENTRY_ID
    })
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'Invalid file processing result for job fp-job-1'
    })
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('skips missing or deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(workflowService as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID, 'deleting'))

    await handler.execute(
      createCtx({
        baseId: 'kb-1',
        itemId: FILE_ITEM_ID,
        fileProcessingJobId: 'fp-job-1',
        sourceFileEntryId: FILE_ENTRY_ID
      })
    )

    expect(getJobMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(workflowService.scheduleIndexing).not.toHaveBeenCalled()
  })
})
