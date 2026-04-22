import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchMode } from '@shared/data/types/knowledge'

export type KnowledgeV2TabKey = 'dataSource' | 'ragConfig' | 'recallTest'

export type KnowledgeV2BaseListStatus = 'completed' | 'processing' | 'failed'
export type KnowledgeV2Item = KnowledgeItem & { parentId?: string | null }

export interface KnowledgeV2SelectOption {
  label: string
  value: string
}

export interface KnowledgeV2RagConfigFormValues {
  fileProcessorId: string | null
  chunkSize: string
  chunkOverlap: string
  embeddingModelId: string | null
  rerankModelId: string | null
  dimensions: number
  documentCount: number
  threshold: number
  searchMode: KnowledgeSearchMode
  hybridAlpha: number | null
}

export interface KnowledgeV2BaseListItem {
  base: KnowledgeBase
  itemCount: number
  status: KnowledgeV2BaseListStatus
}
