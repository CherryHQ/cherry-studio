import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'

export type KnowledgeTabKey = 'data' | 'rag' | 'recall'

export interface KnowledgeSelectOption {
  label: string
  value: string
}

export interface KnowledgeRagConfigFormValues {
  fileProcessorId: string | null
  chunkSize: string
  chunkOverlap: string
  embeddingModelId: string | null
  rerankModelId: string | null
  dimensions: string
  documentCount: number
  threshold: number
  searchMode: KnowledgeSearchMode
  hybridAlpha: number | null
}
