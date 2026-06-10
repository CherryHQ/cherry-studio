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
  searchMode: base.searchMode
})

export const buildKnowledgeRagConfigPatch = (
  initialValues: KnowledgeRagConfigFormValues,
  currentValues: KnowledgeRagConfigFormValues
): UpdateKnowledgeBaseDto => {
  const patch: UpdateKnowledgeBaseDto = {}

  if (currentValues.fileProcessorId !== initialValues.fileProcessorId) {
    patch.fileProcessorId = currentValues.fileProcessorId
  }

  if (currentValues.chunkSize !== initialValues.chunkSize) {
    patch.chunkSize = parseRequiredInteger(currentValues.chunkSize)
  }

  if (currentValues.chunkOverlap !== initialValues.chunkOverlap) {
    patch.chunkOverlap = parseRequiredInteger(currentValues.chunkOverlap)
  }

  if (currentValues.rerankModelId !== initialValues.rerankModelId) {
    patch.rerankModelId = currentValues.rerankModelId
  }

  if (currentValues.searchMode !== initialValues.searchMode) {
    patch.searchMode = currentValues.searchMode
  }

  return patch
}
