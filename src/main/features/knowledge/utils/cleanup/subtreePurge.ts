import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

import { cancelJobOrThrow } from '../../tasks/utils/cancel'
import { narrowKnowledgeJobInput } from '../../tasks/utils/jobInput'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  knowledgeQueueName,
  toKnowledgeBaseId
} from '../../types'
import { isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeItemFilesBestEffort } from '../storage/pathStorage'
import { deleteKnowledgeItemVectors } from './vectorCleanup'

/**
 * Cancel any in-flight job touching the given subtree (the roots plus their
 * descendants). MUST run OUTSIDE the base mutation lock: `cancel` awaits each
 * running handler's settlement, and knowledge index/prepare/reindex handlers
 * themselves acquire `withBaseMutationLock`, so cancelling while holding the lock
 * would deadlock (the handler can never reach its abort check). This is why both
 * the delete job and the replace-on-add path cancel first, then purge under the
 * lock.
 */
export async function cancelActiveKnowledgeSubtreeJobs(
  baseId: string,
  rootItemIds: string[],
  reason: string,
  currentJobId?: string
): Promise<void> {
  const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
  const subtreeIds = new Set(subtreeItems.map((item) => item.id))
  if (subtreeIds.size === 0) {
    return
  }

  const jobManager = application.get('JobManager')
  const activeJobs = await jobManager.list({
    queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
    status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
    limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
  })
  const jobIds = activeJobs
    .filter((job) => job.id !== currentJobId && jobTouchesSubtree(job, subtreeIds))
    .map((job) => job.id)
  const fileProcessingJobIds = activeJobs.flatMap((job) => getFileProcessingJobIdsForTouchedSubtree(job, subtreeIds))

  await Promise.all([
    ...jobIds.map((jobId) => cancelJobOrThrow(jobId, reason)),
    ...fileProcessingJobIds.map((jobId) => cancelJobOrThrow(jobId, reason))
  ])
}

/**
 * Remove a resolved subtree's vectors, on-disk files, and DB rows, in that order.
 * MUST run INSIDE the base mutation lock so no indexer can write vectors for the
 * rows being removed, and so a caller (e.g. replace-on-add) can purge and then
 * recreate within one lock acquisition — keeping the freed name available to the
 * incoming source. Callers resolve and filter `subtreeItems` themselves (the
 * delete job keeps only `deleting` rows; replace passes the conflicting roots'
 * subtrees), then run vector cleanup before DB deletion so a retry can still
 * discover affected ids.
 */
export async function purgeKnowledgeSubtreeWithinLock(
  base: KnowledgeBase,
  subtreeItems: KnowledgeItem[],
  logContext: Record<string, unknown>
): Promise<void> {
  const subtreeItemIds = subtreeItems.map((item) => item.id)
  if (subtreeItemIds.length === 0) {
    return
  }
  const leafItemIds = subtreeItems.filter((item) => isIndexableKnowledgeItem(item)).map((item) => item.id)

  // Vector cleanup precedes DB deletion so a retry can still discover affected item ids.
  await deleteKnowledgeItemVectors(base, leafItemIds)
  // Best-effort: a file-removal failure must not abort the row deletion below,
  // which would otherwise strand rows after their vectors are gone.
  await deleteKnowledgeItemFilesBestEffort(base.id, subtreeItems, logContext)

  await knowledgeItemService.deleteItemsByIds(base.id, subtreeItemIds)
}

function jobTouchesSubtree(job: { type: string; input: unknown }, subtreeIds: Set<string>): boolean {
  const narrowed = narrowKnowledgeJobInput(job)
  if (!narrowed) {
    return false
  }
  if ('itemId' in narrowed.input && subtreeIds.has(narrowed.input.itemId)) {
    return true
  }
  return 'rootItemIds' in narrowed.input && narrowed.input.rootItemIds.some((itemId) => subtreeIds.has(itemId))
}

function getFileProcessingJobIdsForTouchedSubtree(
  job: { type: string; input: unknown },
  subtreeIds: Set<string>
): string[] {
  const narrowed = narrowKnowledgeJobInput(job)
  if (
    narrowed?.type === 'knowledge.check-file-processing-result' &&
    subtreeIds.has(narrowed.input.itemId) &&
    narrowed.input.fileProcessingJobId
  ) {
    return [narrowed.input.fileProcessingJobId]
  }
  return []
}
