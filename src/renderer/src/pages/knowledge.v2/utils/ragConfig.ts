import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeV2RagConfigFormValues } from '../types'

export const createKnowledgeV2RagConfigFormValues = (base: KnowledgeBase): KnowledgeV2RagConfigFormValues => ({
  fileProcessorId: base.fileProcessorId ?? null,
  chunkSize: String(base.chunkSize),
  chunkOverlap: String(base.chunkOverlap),
  embeddingModelId: base.embeddingModelId,
  rerankModelId: base.rerankModelId ?? null,
  dimensions: base.dimensions,
  documentCount: base.documentCount ?? DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
  threshold: base.threshold ?? DEFAULT_KNOWLEDGE_THRESHOLD,
  searchMode: base.searchMode ?? 'default',
  hybridAlpha: base.hybridAlpha ?? null
})

const parseIntegerString = (value: string): number => {
  const parsed = Number(value)

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected integer string, received "${value}"`)
  }

  return parsed
}

export const buildKnowledgeV2RagConfigPatch = (
  initialValues: KnowledgeV2RagConfigFormValues,
  currentValues: KnowledgeV2RagConfigFormValues
): UpdateKnowledgeBaseDto => {
  const patch: UpdateKnowledgeBaseDto = {}

  if (currentValues.fileProcessorId !== initialValues.fileProcessorId) {
    patch.fileProcessorId = currentValues.fileProcessorId ?? null
  }

  if (currentValues.chunkSize !== initialValues.chunkSize) {
    patch.chunkSize = parseIntegerString(currentValues.chunkSize)
  }

  if (currentValues.chunkOverlap !== initialValues.chunkOverlap) {
    patch.chunkOverlap = parseIntegerString(currentValues.chunkOverlap)
  }

  if (currentValues.embeddingModelId !== initialValues.embeddingModelId && currentValues.embeddingModelId != null) {
    patch.embeddingModelId = currentValues.embeddingModelId
  }

  if (currentValues.rerankModelId !== initialValues.rerankModelId) {
    patch.rerankModelId = currentValues.rerankModelId ?? null
  }

  if (currentValues.documentCount !== initialValues.documentCount) {
    patch.documentCount = currentValues.documentCount
  }

  if (currentValues.threshold !== initialValues.threshold) {
    patch.threshold = currentValues.threshold
  }

  if (currentValues.searchMode !== initialValues.searchMode) {
    patch.searchMode = currentValues.searchMode
  }

  if (currentValues.searchMode !== 'hybrid') {
    patch.hybridAlpha = null
  } else if (currentValues.hybridAlpha !== initialValues.hybridAlpha) {
    patch.hybridAlpha = currentValues.hybridAlpha ?? null
  }

  return patch
}
