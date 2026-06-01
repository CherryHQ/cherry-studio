import type { JobType } from '@main/core/job/jobRegistry'

export type KnowledgeWorkflowJobType = Extract<JobType, `knowledge.${string}`>
export const KNOWLEDGE_JOB_TYPES = [
  'knowledge.prepare-root',
  'knowledge.index-documents',
  'knowledge.check-file-processing-result',
  'knowledge.delete-subtree',
  'knowledge.reindex-subtree'
] as const satisfies readonly KnowledgeWorkflowJobType[]
declare const knowledgeBaseIdBrand: unique symbol
declare const knowledgeItemIdBrand: unique symbol

export type KnowledgeBaseId = string & { readonly [knowledgeBaseIdBrand]: true }
export type KnowledgeItemId = string & { readonly [knowledgeItemIdBrand]: true }

export type KnowledgeProgressDetail =
  | {
      stage: 'reading' | 'embedding' | 'writing' | 'enqueuing' | 'already-completed'
      currentFile: number
      totalFiles: number
    }
  | {
      stage: 'scanning'
    }
  | {
      stage: 'deleting' | 'done' | 'item-gone'
      currentFile?: number
      totalFiles?: number
    }
  | {
      stage: 'waiting'
      pollRound: number
      fileProcessingJobId?: string
      fileProcessing?: unknown
    }
  | {
      stage: 'failed'
    }

export const KNOWLEDGE_ACTIVE_JOB_STATUSES = ['pending', 'delayed', 'running'] as const
export const KNOWLEDGE_ACTIVE_JOB_LIMIT = 5000

export function toKnowledgeBaseId(baseId: string): KnowledgeBaseId {
  return baseId as KnowledgeBaseId
}

export function toKnowledgeItemId(itemId: string): KnowledgeItemId {
  return itemId as KnowledgeItemId
}

export function toKnowledgeItemIds(itemIds: string[]): KnowledgeItemId[] {
  return itemIds.map(toKnowledgeItemId)
}

export function reportKnowledgeProgress(
  ctx: { reportProgress(progress: number, detail?: unknown): void },
  progress: number,
  detail: KnowledgeProgressDetail
): void {
  ctx.reportProgress(progress, detail)
}

export function knowledgeQueueName(baseId: KnowledgeBaseId): string {
  return `base.${baseId}`
}

export function knowledgeDeleteSubtreeIdempotencyKey(baseId: KnowledgeBaseId, rootItemIds: KnowledgeItemId[]): string {
  const rootKey = [...rootItemIds].sort().join(',')
  return `knowledge:${baseId}:${rootKey}:delete`
}

export function knowledgeReindexSubtreeIdempotencyKey(baseId: KnowledgeBaseId, rootItemIds: KnowledgeItemId[]): string {
  const rootKey = [...rootItemIds].sort().join(',')
  return `knowledge:${baseId}:${rootKey}:reindex`
}

export function knowledgePrepareIdempotencyKey(baseId: KnowledgeBaseId, itemId: KnowledgeItemId): string {
  return `knowledge:${baseId}:${itemId}:prepare`
}

export function knowledgeIndexIdempotencyKey(
  baseId: KnowledgeBaseId,
  itemId: KnowledgeItemId,
  parentJobId?: string | null
): string {
  const runKey = parentJobId ? `:${parentJobId}` : ''
  return `knowledge:${baseId}:${itemId}:index${runKey}`
}

export function knowledgeFileProcessingCheckIdempotencyKey(
  baseId: KnowledgeBaseId,
  itemId: KnowledgeItemId,
  fileProcessingJobId: string,
  pollRound: number
): string {
  return `knowledge:${baseId}:${itemId}:fp-check:${fileProcessingJobId}:${pollRound}`
}
