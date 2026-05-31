import './jobTypes'

import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import { isTerminalStatus, type JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'
import { FileEntryIdSchema } from '@shared/data/types/file'

import {
  getFileProcessingFailureMessage,
  getFileProcessingMarkdownArtifactFileEntryId
} from '../../fileProcessing/persistence/artifacts'
import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import type { KnowledgeWorkflowService } from '../KnowledgeWorkflowService'
import { knowledgeQueueName, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeCheckFileProcessingResultPayload } from './jobTypes'
import { cancelJobOrThrow } from './utils/cancel'
import { isDataApiNotFoundError, markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:CheckFileProcessingResultJobHandler')
// Remote document processors can be slow, but a stale paid job should not poll forever.
const FILE_PROCESSING_MAX_WAIT_MS = 30 * 60 * 1000
const FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON = 'knowledge-file-processing-item-unavailable'

export function createCheckFileProcessingResultJobHandler(
  knowledgeLockManager: KnowledgeLockManager,
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
      const firstScheduledAt = ctx.input.firstScheduledAt
      const workflowParentJobId = ctx.input.parentJobId ?? ctx.jobId
      ctx.signal.throwIfAborted()

      if (await shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
        await cancelJobOrThrow(fileProcessingJobId, FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON)
        return
      }

      const jobManager = application.get('JobManager')
      const snapshot = await jobManager.get(fileProcessingJobId)

      if (!snapshot) {
        await markItemFailed(itemId, `File processing job not found: ${fileProcessingJobId}`)
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      if (!isExpectedFileProcessingJob(snapshot, sourceFileEntryId)) {
        await markItemFailed(itemId, `Invalid file processing job for knowledge item: ${fileProcessingJobId}`)
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      if (!isTerminalStatus(snapshot.status)) {
        if (Date.now() - firstScheduledAt >= FILE_PROCESSING_MAX_WAIT_MS) {
          await cancelJobOrThrow(fileProcessingJobId, 'knowledge-file-processing-timeout')
          await markItemFailed(itemId, `File processing job ${fileProcessingJobId} did not finish within 30 minutes`)
          ctx.reportProgress(100, { stage: 'failed' })
          return
        }

        const nextPollRound = ctx.input.pollRound + 1
        await workflowService.scheduleFileProcessingCheck(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          fileProcessingJobId,
          sourceFileEntryId,
          {
            pollRound: nextPollRound,
            firstScheduledAt,
            parentJobId: workflowParentJobId
          }
        )
        reportWaitingProgress(ctx, fileProcessingJobId, nextPollRound)
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

      const processedFileEntryId = parseMarkdownArtifactFileEntryIdOrNull(snapshot)
      if (!processedFileEntryId) {
        await markItemFailed(itemId, `Invalid file processing result for job ${fileProcessingJobId}`)
        ctx.reportProgress(100, { stage: 'failed' })
        return
      }

      const canContinue = await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
        if (await shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
          return false
        }

        await knowledgeItemService.replaceFileRef(itemId, processedFileEntryId, 'processed_artifact')
        await workflowService.scheduleIndexing(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          processedFileEntryId,
          workflowParentJobId
        )
        return true
      })
      if (!canContinue) {
        return
      }
      ctx.reportProgress(100, { stage: 'done' })
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(
        event,
        logger,
        'Failed to flip knowledge file-processing check target to failed in onSettled'
      )
    }
  }
}

function reportWaitingProgress(
  ctx: JobContext<KnowledgeCheckFileProcessingResultPayload>,
  fileProcessingJobId: string,
  pollRound: number
): void {
  const childProgress = application.get('CacheService').getShared(`${JOB_PROGRESS_KEY_PREFIX}${fileProcessingJobId}`)
  if (!childProgress) {
    ctx.reportProgress(0, { stage: 'waiting', pollRound })
    return
  }

  ctx.reportProgress(childProgress.progress, {
    stage: 'waiting',
    pollRound,
    fileProcessingJobId,
    fileProcessing: childProgress
  })
}

function isExpectedFileProcessingJob(snapshot: JobSnapshot, sourceFileEntryId: FileEntryId): boolean {
  if (snapshot.type !== 'file-processing.background' && snapshot.type !== 'file-processing.remote-poll') {
    return false
  }
  if (!snapshot.input || typeof snapshot.input !== 'object') {
    return false
  }
  return (
    'feature' in snapshot.input &&
    snapshot.input.feature === 'document_to_markdown' &&
    'fileEntryId' in snapshot.input &&
    snapshot.input.fileEntryId === sourceFileEntryId
  )
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
      logger.info('Skipping mark failed for deleting item', { itemId, error })
      return
    }
    await knowledgeItemService.updateStatus(itemId, 'failed', { error })
  } catch (updateError) {
    if (isDataApiNotFoundError(updateError)) {
      logger.info('Skipping mark failed for missing item', { itemId, error })
      return
    }
    throw updateError
  }
}

function parseMarkdownArtifactFileEntryIdOrNull(snapshot: JobSnapshot): FileEntryId | null {
  try {
    return getFileProcessingMarkdownArtifactFileEntryId(snapshot)
  } catch (error) {
    logger.warn('Invalid file-processing result for knowledge item', {
      jobId: snapshot.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
