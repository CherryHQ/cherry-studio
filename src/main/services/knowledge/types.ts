import type { KnowledgeItem } from '@shared/data/types/knowledge'

export type KnowledgeJobHandle = {
  id: string
}

export type KnowledgeAddResult = {
  items: KnowledgeItem[]
  jobs: KnowledgeJobHandle[]
}

export type KnowledgeWorkflowJobType =
  | 'knowledge.prepare-root'
  | 'knowledge.index-documents'
  | 'knowledge.delete-subtree'
  | 'knowledge.reindex-subtree'

export const KNOWLEDGE_ACTIVE_JOB_STATUSES = ['pending', 'delayed', 'running'] as const
export const KNOWLEDGE_ACTIVE_JOB_LIMIT = 5000

export function knowledgeQueueName(baseId: string): string {
  return `base.${baseId}`
}
