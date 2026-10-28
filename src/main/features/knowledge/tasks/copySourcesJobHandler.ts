import './jobTypes'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import type { PreparedAtomicWrite } from '@main/utils/file'
import type { KeyedMutex } from '@shared/utils/async'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { prepareFileCopyIntoKnowledgeBaseAt } from '../pathStorage'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeCopySourcesPayload } from './jobTypes'
import { resolveLiveKnowledgeItem } from './utils/liveItem'
import { markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:CopySourcesJobHandler')

/**
 * Copies an added item's source bytes into its reserved `raw/` names, then hands the item to the
 * next stage. `addItems` only reserves the names and creates the row, so the copy — the slow part
 * of an import — runs here, off the base mutation lock; only the final renames take the lock.
 */
export function createCopySourcesJobHandler(
  knowledgeLockManager: KeyedMutex,
  ingestionService: KnowledgeItemScheduler
): JobHandler<KnowledgeCopySourcesPayload> {
  return {
    // Same recovery story as the indexing jobs it feeds: an interrupted copy parks the item at
    // `failed` (onSettled / boot sweep) and reindex redoes it from the original source.
    recovery: 'abandon',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    // A missing or unreadable source does not heal by retrying.
    defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
    defaultTimeoutMs: 30 * 60 * 1000,

    async execute(ctx) {
      const { baseId, itemId, copies } = ctx.input
      ctx.signal.throwIfAborted()
      if ('skip' in resolveLiveKnowledgeItem(itemId)) {
        logger.info('Skipping source copy for a missing or deleting item', { baseId, itemId, jobId: ctx.jobId })
        reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
        return
      }

      reportKnowledgeProgress(ctx, 0, { stage: 'copying' })
      const prepared: PreparedAtomicWrite[] = []
      try {
        for (const copy of copies) {
          prepared.push(await prepareFileCopyIntoKnowledgeBaseAt(baseId, copy.from, copy.relativePath, ctx.signal))
        }

        const committed = await knowledgeLockManager.runExclusive(baseId, async () => {
          // A delete that landed while the bytes were streaming must win over the commit.
          ctx.signal.throwIfAborted()
          const live = resolveLiveKnowledgeItem(itemId)
          if ('skip' in live) {
            return false
          }
          for (const write of prepared) {
            await write.commit()
          }
          // The bytes are in raw/ now, so the item leaves `preparing` in the same section.
          if (live.item.status === 'preparing') {
            knowledgeItemService.updateStatus(itemId, 'processing')
          }
          return true
        })
        if (!committed) {
          await abortPreparedCopies(prepared)
          logger.info('Discarding source copy for an item deleted during the copy', {
            baseId,
            itemId,
            jobId: ctx.jobId
          })
          reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
          return
        }
      } catch (error) {
        await abortPreparedCopies(prepared)
        throw error
      }

      await ingestionService.scheduleItem(toKnowledgeBaseId(baseId), toKnowledgeItemId(itemId))
      reportKnowledgeProgress(ctx, 100, { stage: 'done', currentFile: 1, totalFiles: 1 })
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(event, logger, 'Failed to flip knowledge item to failed after its copy')
    }
  }
}

// Committed writes ignore abort, so this only removes temp files that never reached their target.
async function abortPreparedCopies(prepared: PreparedAtomicWrite[]): Promise<void> {
  await Promise.all(prepared.map((write) => write.abort()))
}
