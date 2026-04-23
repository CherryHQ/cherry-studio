import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'

export type KnowledgeTabKey = 'data' | 'rag' | 'recall'
export type KnowledgeDataSourceType = 'file' | 'note' | 'directory' | 'url' | 'sitemap'

export interface KnowledgeSelectOption {
  label: string
  value: string
}

export interface CreateKnowledgeBaseInput {
  name: string
  emoji: string
  groupId?: string
  embeddingModelId: string | null
  dimensions: string
}

export interface KnowledgeRagConfigFormValues {
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
