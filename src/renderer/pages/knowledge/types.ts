import type { KnowledgeChunkStrategy } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'

export type KnowledgeTabKey = 'data' | 'rag' | 'recall'

export interface KnowledgeSelectOption {
  label: string
  value: string
}

export interface KnowledgeFilePreviewTarget {
  readonly fileName: string
  readonly filePath: AbsoluteFilePath
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
}
