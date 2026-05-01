import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeRagConfigFormValues } from '../types'
import { parseRequiredInteger } from './validate'

export const createKnowledgeRagConfigFormValues = (base: KnowledgeBase): KnowledgeRagConfigFormValues => ({
  fileProcessorId: base.fileProcessorId ?? null,
  chunkSize: String(base.chunkSize),
  chunkOverlap: String(base.chunkOverlap),
  embeddingModelId: base.embeddingModelId,
  rerankModelId: base.rerankModelId ?? null,
  dimensions: base.dimensions ?? 0,
  documentCount: base.documentCount ?? DEFAULT_KNOWLEDGE_DOCUMENT_COUNT,
  threshold: base.threshold ?? DEFAULT_KNOWLEDGE_THRESHOLD,
  searchMode: base.searchMode,
  hybridAlpha: base.hybridAlpha ?? null
})

export const buildKnowledgeRagConfigPatch = (
  initialValues: KnowledgeRagConfigFormValues,
  currentValues: KnowledgeRagConfigFormValues
): UpdateKnowledgeBaseDto => {
  const patch: UpdateKnowledgeBaseDto = {}

  if (currentValues.fileProcessorId !== initialValues.fileProcessorId && currentValues.fileProcessorId != null) {
    patch.fileProcessorId = currentValues.fileProcessorId
  }

  if (currentValues.chunkSize !== initialValues.chunkSize) {
    patch.chunkSize = parseRequiredInteger(currentValues.chunkSize)
  }

  if (currentValues.chunkOverlap !== initialValues.chunkOverlap) {
    patch.chunkOverlap = parseRequiredInteger(currentValues.chunkOverlap)
  }

  if (currentValues.rerankModelId !== initialValues.rerankModelId && currentValues.rerankModelId != null) {
    patch.rerankModelId = currentValues.rerankModelId
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

  if (currentValues.searchMode === 'hybrid' && currentValues.hybridAlpha !== initialValues.hybridAlpha) {
    patch.hybridAlpha = currentValues.hybridAlpha ?? undefined
  }

  return patch
}
