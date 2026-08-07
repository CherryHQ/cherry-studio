import './jobTypes'

import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import {
  type FileProcessingJobPayload,
  getFileProcessingFailureMessage,
  getFileProcessingMarkdownArtifactPath
} from '@main/features/fileProcessing'
import { isTerminalStatus, type JobSnapshot } from '@shared/data/api/schemas/jobs'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeCheckFileProcessingResultPayload } from './jobTypes'
import { cancelJobOrThrow } from './utils/cancel'
import { resolveLiveKnowledgeItem } from './utils/liveItem'
import { markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:CheckFileProcessingResultJobHandler')
// Remote document processors can be slow, but a stale paid job should not poll forever.
const FILE_PROCESSING_MAX_WAIT_MS = 30 * 60 * 1000
const FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON = 'knowledge-file-processing-item-unavailable'

export function createCheckFileProcessingResultJobHandler(
  knowledgeLockManager: KeyedMutex,
  ingestionService: KnowledgeItemScheduler
): JobHandler<KnowledgeCheckFileProcessingResultPayload> {
  return {
    // Don't auto-resume on restart — a deliberate app quit must not re-spend the
    // embedding API; the item is parked at `failed` and reindexed on demand.
    recovery: 'abandon',
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
      const firstScheduledAt = ctx.input.firstScheduledAt
      const workflowParentJobId = ctx.parentId ?? ctx.jobId
      ctx.signal.throwIfAborted()

      if (shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
        await cancelJobOrThrow(fileProcessingJobId, FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON)
        return
      }

      // A job persisted before `processedRelativePath` became a required payload field
      // (see jobInput.ts) can still be claimed inside the startup quiet window before
      // recovery abandons it. Its indexed path is unrecoverable — deriving it from the
      // completed file-processing artifact would give the processor's OUTPUT path, not
      // the KB raw path this item is addressed by — so fail the item loudly instead of
      // indexing at an `undefined` path. Cancel the linked file-processing job first
      // (recovery: 'retry', so it is live again after restart and keeps polling/paying);
      // this handler is its only consumer, and the cancel helpers can't reap it either
      // (jobInput.ts rejects the legacy payload, so getLinkedFileProcessingJobIds drops it).
      if (typeof ctx.input.processedRelativePath !== 'string' || ctx.input.processedRelativePath.length === 0) {
        await cancelJobOrThrow(fileProcessingJobId, 'knowledge-file-processing-legacy-payload')
        markItemFailed(
          itemId,
          `Knowledge file-processing check for '${itemId}' has no processedRelativePath (legacy job payload)`
        )
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      const jobManager = application.get('JobManager')
      const snapshot = await jobManager.get(fileProcessingJobId)

      if (!snapshot) {
        markItemFailed(itemId, `File processing job not found: ${fileProcessingJobId}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      if (!isExpectedFileProcessingJob(snapshot, itemId)) {
        markItemFailed(itemId, `Invalid file processing job for knowledge item: ${fileProcessingJobId}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      if (!isTerminalStatus(snapshot.status)) {
        if (Date.now() - firstScheduledAt >= FILE_PROCESSING_MAX_WAIT_MS) {
          await cancelJobOrThrow(fileProcessingJobId, 'knowledge-file-processing-timeout')
          markItemFailed(itemId, `File processing job ${fileProcessingJobId} did not finish within 30 minutes`)
          reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
          return
        }

        const nextPollRound = ctx.input.pollRound + 1
        await ingestionService.scheduleFileProcessingCheck(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          fileProcessingJobId,
          {
            pollRound: nextPollRound,
            firstScheduledAt,
            parentJobId: workflowParentJobId,
            processedRelativePath: ctx.input.processedRelativePath
          }
        )
        reportWaitingProgress(ctx, fileProcessingJobId, nextPollRound)
        return
      }

      if (snapshot.status !== 'completed') {
        markItemFailed(
          itemId,
          `File processing job ${fileProcessingJobId} ${snapshot.status}: ${getFileProcessingFailureMessage(snapshot)}`
        )
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      if (!isCompletedMarkdownArtifact(snapshot)) {
        markItemFailed(itemId, `Invalid file processing result for job ${fileProcessingJobId}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }
      const indexedRelativePath = ctx.input.processedRelativePath

      const canContinue = await knowledgeLockManager.runExclusive(baseId, async () => {
        if (shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
          return false
        }

        knowledgeItemService.updateIndexedRelativePath(itemId, indexedRelativePath)
        await ingestionService.scheduleIndexing(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          workflowParentJobId
        )
        return true
      })
      if (!canContinue) {
        return
      }
      reportKnowledgeProgress(ctx, 100, { stage: 'done' })
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
    reportKnowledgeProgress(ctx, 0, { stage: 'waiting', pollRound })
    return
  }

  reportKnowledgeProgress(ctx, childProgress.progress, {
    stage: 'waiting',
    pollRound,
    fileProcessingJobId,
    fileProcessing: childProgress
  })
}

function isExpectedFileProcessingJob(snapshot: JobSnapshot, itemId: string): boolean {
  if (snapshot.type !== 'file-processing.background' && snapshot.type !== 'file-processing.remote-poll') {
    return false
  }
  if (!snapshot.input || typeof snapshot.input !== 'object') {
    return false
  }
  const input = snapshot.input as FileProcessingJobPayload
  return input.feature === 'document_to_markdown' && input.context?.dataId === itemId && input.output?.kind === 'path'
}

function shouldSkipMissingOrDeletingItem(baseId: string, itemId: string, jobId: string): boolean {
  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping file-processing check for deleting item', { baseId, itemId, jobId })
    } else {
      logger.info('Skipping file-processing check for missing item', { baseId, itemId, jobId })
    }
    return true
  }
  if (result.item.baseId !== baseId) {
    throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
  }
  return false
}

function markItemFailed(itemId: string, error: string): void {
  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping mark failed for deleting item', { itemId, error })
    } else {
      logger.info('Skipping mark failed for missing item', { itemId, error })
    }
    return
  }
  knowledgeItemService.updateStatus(itemId, 'failed', { error })
}

/**
 * Validates that a completed file-processing job actually produced a markdown-file
 * artifact (not a degraded inline-text result) — the item's `indexedRelativePath`
 * is the job's own `processedRelativePath` input, not derived from this artifact.
 */
function isCompletedMarkdownArtifact(snapshot: JobSnapshot): boolean {
  try {
    getFileProcessingMarkdownArtifactPath(snapshot)
    return true
  } catch (error) {
    logger.warn('Invalid file-processing result for knowledge item', {
      jobId: snapshot.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
