export type KnowledgeWorkflowJobType =
  | 'knowledge.prepare-root'
  | 'knowledge.index-documents'
  | 'knowledge.check-file-processing-result'
  | 'knowledge.delete-subtree'
  | 'knowledge.reindex-subtree'

export const KNOWLEDGE_ACTIVE_JOB_STATUSES = ['pending', 'delayed', 'running'] as const
export const KNOWLEDGE_ACTIVE_JOB_LIMIT = 5000

export function knowledgeQueueName(baseId: string): string {
  return `base.${baseId}`
}

export function knowledgeDeleteSubtreeIdempotencyKey(baseId: string, rootItemIds: string[]): string {
  const rootKey = [...rootItemIds].sort().join(',')
  return `knowledge:${baseId}:${rootKey}:delete`
}

export function knowledgeFileProcessingCheckIdempotencyKey(
  baseId: string,
  itemId: string,
  fileProcessingJobId: string,
  checkCount: number
): string {
  return `knowledge:${baseId}:${itemId}:fp-check:${fileProcessingJobId}:${checkCount}`
}
