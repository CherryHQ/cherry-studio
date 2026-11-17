import { describe, expect, it } from 'vitest'

import type { FileProcessingTask, FileProcessingTaskId } from '@main/features/fileProcessing'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { KnowledgeCheckFileProcessingResultPayload } from '../jobTypes'
import {
  cancelFileProcessingTaskMock,
  createCheckFileProcessingResultJobHandler,
  createCtx,
  createFileItem,
  FILE_ITEM_ID,
  getFileProcessingTaskMock,
  ingestionService,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateIndexedRelativePathMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  PROCESSED_RELATIVE_PATH
} from './jobHandlerTestUtils'

const TASK_ID = 'fp-task-1' as FileProcessingTaskId
const MARKDOWN_ARTIFACT = {
  kind: 'file',
  format: 'markdown',
  path: '/mock/feature.knowledgebase.data/kb-1/raw/source.md' as AbsoluteFilePath
} as const

type SettledTaskFields =
  | { status: 'completed'; artifact: Extract<FileProcessingTask, { status: 'completed' }>['artifact'] }
  | { status: 'failed' | 'cancelled'; error: string }

function createTask(fields: SettledTaskFields): FileProcessingTask {
  return { id: TASK_ID, feature: 'document_to_markdown', processorId: 'doc2x', ...fields }
}

function createCheckPayload(
  overrides: Partial<KnowledgeCheckFileProcessingResultPayload> = {}
): KnowledgeCheckFileProcessingResultPayload {
  return {
    baseId: 'kb-1',
    itemId: FILE_ITEM_ID,
    fileProcessingTaskId: TASK_ID,
    processedRelativePath: PROCESSED_RELATIVE_PATH,
    ...overrides
  }
}

describe('check-file-processing-result job handler', () => {
  it('stores the processed relative path and indexes under the check job when the add had no parent', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    getFileProcessingTaskMock.mockResolvedValue(createTask({ status: 'completed', artifact: MARKDOWN_ARTIFACT }))

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateIndexedRelativePathMock).toHaveBeenCalledWith(FILE_ITEM_ID, PROCESSED_RELATIVE_PATH)
    expect(ingestionService.scheduleIndexing).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'job-1')
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('schedules indexing under the original workflow parent once file processing completes', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    getFileProcessingTaskMock.mockResolvedValue(createTask({ status: 'completed', artifact: MARKDOWN_ARTIFACT }))

    await handler.execute(createCtx(createCheckPayload(), 'job-1', 'reindex-job'))

    expect(ingestionService.scheduleIndexing).toHaveBeenCalledWith('kb-1', FILE_ITEM_ID, 'reindex-job')
  })

  it('marks the item failed when its task cannot be found', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'File processing task not found: fp-task-1'
    })
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('skips attaching artifacts when the item becomes deleting before continuation side effects', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(createFileItem())
      .mockReturnValueOnce(createFileItem(FILE_ITEM_ID, 'deleting'))
    getFileProcessingTaskMock.mockResolvedValue(createTask({ status: 'completed', artifact: MARKDOWN_ARTIFACT }))

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateIndexedRelativePathMock).not.toHaveBeenCalled()
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).not.toHaveBeenCalledWith(100, { stage: 'done' })
  })

  it('marks an over-limit PDF failed with manual split guidance and does not index it', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    const pageLimitError = '该 PDF 超过当前文档解析服务的 1000 页上限，请手动拆分 PDF 后重新添加。'
    getFileProcessingTaskMock.mockResolvedValue(createTask({ status: 'failed', error: pageLimitError }))

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: `File processing task fp-task-1 failed: ${pageLimitError}`
    })
    expect(knowledgeItemUpdateIndexedRelativePathMock).not.toHaveBeenCalled()
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'failed' })
  })

  it('marks the item failed with the reason when its task was cancelled', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    getFileProcessingTaskMock.mockResolvedValue(createTask({ status: 'cancelled', error: 'JobManager shutdown' }))

    await handler.execute(createCtx(createCheckPayload()))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'File processing task fp-task-1 cancelled: JobManager shutdown'
    })
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('marks the item failed when the completed task has no markdown artifact', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())
    getFileProcessingTaskMock.mockResolvedValue(
      createTask({ status: 'completed', artifact: { kind: 'text', format: 'plain', text: 'hello' } })
    )

    const ctx = createCtx(createCheckPayload())
    await handler.execute(ctx)

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: 'Invalid file processing result for task fp-task-1'
    })
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('cancels linked file-processing work before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID, 'deleting'))

    await handler.execute(createCtx(createCheckPayload()))

    expect(cancelFileProcessingTaskMock).toHaveBeenCalledWith(TASK_ID, 'knowledge-file-processing-item-unavailable')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('surfaces cancel failures before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID, 'deleting'))
    cancelFileProcessingTaskMock.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(handler.execute(createCtx(createCheckPayload()))).rejects.toThrow('cancel failed')

    expect(getFileProcessingTaskMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('surfaces cancel timeouts before skipping deleting items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID, 'deleting'))
    cancelFileProcessingTaskMock.mockResolvedValue('timed-out')

    await expect(handler.execute(createCtx(createCheckPayload()))).rejects.toThrow(
      'File processing task cancel timed out: fp-task-1'
    )

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('cancels linked file-processing work before skipping missing items', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('KnowledgeItem', FILE_ITEM_ID)
    })

    await handler.execute(createCtx(createCheckPayload()))

    expect(cancelFileProcessingTaskMock).toHaveBeenCalledWith(TASK_ID, 'knowledge-file-processing-item-unavailable')
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
    expect(ingestionService.scheduleIndexing).not.toHaveBeenCalled()
  })

  it('onSettled marks active items failed when the check job fails', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())

    await handler.onSettled?.({
      jobId: 'job-1',
      type: 'knowledge.check-file-processing-result',
      scheduleId: null,
      parentId: null,
      status: 'failed',
      input: createCheckPayload(),
      error: { code: 'FAILED', message: 'check failed', retryable: false },
      attempt: 3,
      metadata: {}
    })

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', { error: 'check failed' })
  })

  it('onSettled falls back to the terminal status when a failed job has no error message', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())

    await handler.onSettled?.({
      jobId: 'job-1',
      type: 'knowledge.check-file-processing-result',
      scheduleId: null,
      parentId: null,
      status: 'failed',
      input: createCheckPayload(),
      error: null,
      attempt: 1,
      metadata: {}
    })

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', { error: 'Job failed' })
  })

  it('onSettled marks a cancelled (app-quit) item failed with the reindex-to-finish message', async () => {
    const handler = createCheckFileProcessingResultJobHandler(knowledgeLockManager as never, ingestionService)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem())

    await handler.onSettled?.({
      jobId: 'job-1',
      type: 'knowledge.check-file-processing-result',
      scheduleId: null,
      parentId: null,
      status: 'cancelled',
      input: createCheckPayload(),
      error: { code: 'CANCELLED', message: 'JobManager shutdown', retryable: false },
      attempt: 1,
      metadata: {}
    })

    // The raw 'JobManager shutdown' abort message is replaced with the localized error code.
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(FILE_ITEM_ID, 'failed', {
      error: KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
    })
  })
})
