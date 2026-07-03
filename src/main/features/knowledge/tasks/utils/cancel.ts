import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'

import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  KNOWLEDGE_JOB_TYPES,
  knowledgeQueueName,
  toKnowledgeBaseId
} from '../../types'
import { narrowKnowledgeJobInput } from './jobInput'

const KNOWLEDGE_JOB_TYPE_SET = new Set<string>(KNOWLEDGE_JOB_TYPES)

export async function cancelJobOrThrow(jobId: string, reason: string): Promise<void> {
  const result = await application.get('JobManager').cancel(jobId, reason)
  if (result.outcome === 'timed-out') {
    throw new Error(`Job cancel timed out: ${jobId}`)
  }
}

export interface CancelActiveKnowledgeJobsOptions {
  /** Scope cancellation to jobs touching these roots + their descendants (resolved via
   *  `getSubtreeItems`; an empty resolved subtree is a no-op). Omit for base-wide
   *  cancellation — every active knowledge job in the base's queue (used by deleteBase). */
  rootItemIds?: string[]
  /** Exclude this job id from cancellation (the job initiating the cancel, e.g. reindex
   *  cancelling other jobs on the same base). */
  excludeJobId?: string
  /** 'throw': `cancelJobOrThrow` semantics — a cancel timeout throws, because subtree
   *  cleanup cannot proceed while the handler it is racing is still running.
   *  'proceed': cancel without checking outcome — base deletion must not get stuck on
   *  one slow-to-cancel job. */
  onCancelTimeout: 'throw' | 'proceed'
}

/**
 * Cancel any in-flight knowledge job in `baseId`'s queue (optionally scoped to a
 * subtree). MUST run OUTSIDE the base mutation lock: `cancel` awaits each running
 * handler's settlement, and knowledge index/prepare/reindex handlers themselves
 * acquire `withBaseMutationLock`, so cancelling while holding the lock would
 * deadlock (the handler can never reach its abort check). This is why every
 * caller (delete-base, delete-subtree, replace-on-add) cancels first, then
 * purges/locks.
 */
export async function cancelActiveKnowledgeJobs(
  baseId: string,
  reason: string,
  options: CancelActiveKnowledgeJobsOptions
): Promise<void> {
  const { rootItemIds, excludeJobId, onCancelTimeout } = options

  let subtreeItemIds: Set<string> | undefined
  if (rootItemIds) {
    const subtreeItems = knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
    subtreeItemIds = new Set(subtreeItems.map((item) => item.id))
    if (subtreeItemIds.size === 0) {
      return
    }
  }

  const jobManager = application.get('JobManager')
  const activeJobs = await jobManager.list({
    queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
    status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
    limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
  })

  const jobIds = activeJobs
    .filter((job) => job.id !== excludeJobId)
    .filter((job) => (subtreeItemIds ? jobTouchesSubtree(job, subtreeItemIds) : KNOWLEDGE_JOB_TYPE_SET.has(job.type)))
    .map((job) => job.id)
  const fileProcessingJobIds = activeJobs.flatMap((job) => getLinkedFileProcessingJobIds(job, subtreeItemIds))

  const cancelOne: (jobId: string) => Promise<unknown> =
    onCancelTimeout === 'throw'
      ? (jobId) => cancelJobOrThrow(jobId, reason)
      : (jobId) => jobManager.cancel(jobId, reason)

  await Promise.all([...jobIds, ...fileProcessingJobIds].map(cancelOne))
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

/** Linked file-processing jobs for a knowledge job, optionally filtered to a subtree scope. */
function getLinkedFileProcessingJobIds(
  job: { type: string; input: unknown },
  subtreeIds: Set<string> | undefined
): string[] {
  const narrowed = narrowKnowledgeJobInput(job)
  if (
    narrowed?.type === 'knowledge.check-file-processing-result' &&
    (!subtreeIds || subtreeIds.has(narrowed.input.itemId)) &&
    narrowed.input.fileProcessingJobId
  ) {
    return [narrowed.input.fileProcessingJobId]
  }
  return []
}
