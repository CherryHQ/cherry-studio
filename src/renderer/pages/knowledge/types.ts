import type { KnowledgeChunkStrategy, KnowledgeSearchMode } from '@shared/data/types/knowledge'

export type KnowledgeTabKey = 'data' | 'rag' | 'recall'

export interface KnowledgeSelectOption {
  label: string
  value: string
}

export interface KnowledgeRagConfigFormValues {
  fileProcessorId: string | null
  chunkSize: string
  chunkOverlap: string
  chunkStrategy: KnowledgeChunkStrategy
  chunkSeparator: string
  embeddingModelId: string | null
  rerankModelId: string | null
  documentCount: number
  threshold: number
  searchMode: KnowledgeSearchMode
  hybridAlpha: number | null
}
