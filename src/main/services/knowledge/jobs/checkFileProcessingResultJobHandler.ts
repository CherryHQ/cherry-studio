import './jobTypes'

import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import { isTerminalStatus, type JobProgress, type JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import {
  getFileProcessingFailureMessage,
  getFileProcessingMarkdownArtifactPath
} from '../../fileProcessing/persistence/artifacts'
import type { KnowledgeWorkflowService } from '../KnowledgeWorkflowService'
import { knowledgeQueueName, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeCheckFileProcessingResultPayload } from './jobTypes'
import { isDataApiNotFoundError } from './utils/settled'

const logger = loggerService.withContext('Knowledge:CheckFileProcessingResultJobHandler')

export function createCheckFileProcessingResultJobHandler(
  workflowService: KnowledgeWorkflowService
): JobHandler<KnowledgeCheckFileProcessingResultPayload> {
  return {
    recovery: 'retry',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    defaultRetryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    },
    defaultTimeoutMs: 2 * 60 * 1000,

    async execute(ctx) {
      const { baseId, itemId, fileProcessingJobId } = ctx.input
      const sourceFileEntryId = FileEntryIdSchema.parse(ctx.input.sourceFileEntryId)
      ctx.signal.throwIfAborted()

      if (await shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
        return
      }

      const jobManager = application.get('JobManager')
      const snapshot = await jobManager.get(fileProcessingJobId)

      if (!snapshot) {
        await markItemFailed(itemId, `File processing job not found: ${fileProcessingJobId}`)
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      if (!isTerminalStatus(snapshot.status)) {
        const nextCheckCount = (ctx.input.checkCount ?? 0) + 1
        await workflowService.scheduleFileProcessingCheck(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          fileProcessingJobId,
          sourceFileEntryId,
          {
            checkCount: nextCheckCount,
            firstScheduledAt: ctx.input.firstScheduledAt,
            parentJobId: ctx.jobId
          }
        )
        reportWaitingProgress(ctx, fileProcessingJobId, nextCheckCount)
        return
      }

      if (snapshot.status !== 'completed') {
        await markItemFailed(
          itemId,
          `File processing job ${fileProcessingJobId} ${snapshot.status}: ${getFileProcessingFailureMessage(snapshot)}`
        )
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      const artifactPath = parseMarkdownArtifactPathOrNull(snapshot)
      if (!artifactPath) {
        await markItemFailed(itemId, `Invalid file processing result for job ${fileProcessingJobId}`)
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      const processedFileEntryId = await createProcessedArtifactFileEntryId(artifactPath)
      await knowledgeItemService.attachFileRef(itemId, processedFileEntryId, 'processed_artifact')
      await workflowService.scheduleIndexing(
        toKnowledgeBaseId(baseId),
        toKnowledgeItemId(itemId),
        processedFileEntryId,
        ctx.jobId
      )
      ctx.reportProgress(100, { stage: 'done' })
    }
  }
}

function reportWaitingProgress(
  ctx: JobContext<KnowledgeCheckFileProcessingResultPayload>,
  fileProcessingJobId: string,
  checkCount: number
): void {
  const childProgress = getFileProcessingJobProgress(fileProcessingJobId)
  if (!childProgress) {
    ctx.reportProgress(100, { stage: 'waiting', checkCount })
    return
  }

  ctx.reportProgress(childProgress.progress, {
    stage: 'waiting',
    checkCount,
    fileProcessingJobId,
    fileProcessing: childProgress
  })
}

function getFileProcessingJobProgress(fileProcessingJobId: string): JobProgress | undefined {
  return application.get('CacheService').getShared(`${JOB_PROGRESS_KEY_PREFIX}${fileProcessingJobId}`)
}

async function shouldSkipMissingOrDeletingItem(baseId: string, itemId: string, jobId: string): Promise<boolean> {
  try {
    const item = await knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
    }
    if (item.status === 'deleting') {
      logger.info('Skipping file-processing check for deleting item', { baseId, itemId, jobId })
      return true
    }
    return false
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      logger.info('Skipping file-processing check for missing item', { baseId, itemId, jobId })
      return true
    }
    throw error
  }
}

async function markItemFailed(itemId: string, error: string): Promise<void> {
  try {
    const item = await knowledgeItemService.getById(itemId)
    if (item.status === 'deleting') {
      return
    }
    await knowledgeItemService.updateStatus(itemId, 'failed', { error })
  } catch (updateError) {
    if (isDataApiNotFoundError(updateError)) {
      return
    }
    throw updateError
  }
}

function parseMarkdownArtifactPathOrNull(snapshot: JobSnapshot): FilePath | null {
  try {
    return getFileProcessingMarkdownArtifactPath(snapshot)
  } catch (error) {
    logger.warn('Invalid file-processing result for knowledge item', {
      jobId: snapshot.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function createProcessedArtifactFileEntryId(artifactPath: FilePath): Promise<FileEntryId> {
  const fileManager = application.get('FileManager')
  const processedFile = await fileManager.createInternalEntry({
    source: 'path',
    path: artifactPath
  })

  return FileEntryIdSchema.parse(processedFile.id)
}
