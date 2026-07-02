import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeRagConfigFormValues, KnowledgeSelectOption } from '../types'
import { parseRequiredInteger } from './validate'

const DEFAULT_KNOWLEDGE_DOCUMENT_COUNT = 6
const DEFAULT_KNOWLEDGE_THRESHOLD = 0.0

type KnowledgeSearchModeTranslator = (
  key: 'knowledge.rag.search_mode.bm25' | 'knowledge.rag.search_mode.hybrid' | 'knowledge.rag.search_mode.vector'
) => string

/**
 * Options for the search-mode picker, keyed on the *pending* embeddingModelId (the
 * form's current value, not the base's persisted one) so picking a model and a
 * search mode in the same edit works — vector/hybrid retrieval needs a model.
 */
export const buildKnowledgeSearchModeOptions = (
  embeddingModelId: string | null,
  t: KnowledgeSearchModeTranslator
): KnowledgeSelectOption[] => {
  const bm25Option = { value: 'bm25', label: t('knowledge.rag.search_mode.bm25') }
  if (embeddingModelId === null) {
    return [bm25Option]
  }

  return [
    { value: 'hybrid', label: t('knowledge.rag.search_mode.hybrid') },
    { value: 'vector', label: t('knowledge.rag.search_mode.vector') },
    bm25Option
  ]
}

export const createKnowledgeRagConfigFormValues = (base: KnowledgeBase): KnowledgeRagConfigFormValues => ({
  fileProcessorId: base.fileProcessorId ?? null,
  chunkSize: String(base.chunkSize),
  chunkOverlap: String(base.chunkOverlap),
  chunkStrategy: base.chunkStrategy,
  chunkSeparator: base.chunkSeparator,
  embeddingModelId: base.embeddingModelId,
  rerankModelId: base.rerankModelId ?? null,
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

  if (currentValues.fileProcessorId !== initialValues.fileProcessorId) {
    patch.fileProcessorId = currentValues.fileProcessorId
  }

  if (currentValues.chunkSize !== initialValues.chunkSize) {
    patch.chunkSize = parseRequiredInteger(currentValues.chunkSize)
  }

  if (currentValues.chunkOverlap !== initialValues.chunkOverlap) {
    patch.chunkOverlap = parseRequiredInteger(currentValues.chunkOverlap)
  }

  if (currentValues.chunkStrategy !== initialValues.chunkStrategy) {
    patch.chunkStrategy = currentValues.chunkStrategy
  }

  if (currentValues.chunkSeparator !== initialValues.chunkSeparator) {
    patch.chunkSeparator = currentValues.chunkSeparator
  }

  if (currentValues.rerankModelId !== initialValues.rerankModelId) {
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
