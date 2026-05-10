import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL, type KnowledgeBase } from '@shared/data/types/knowledge'

type KnowledgeErrorTranslator = (
  key: 'knowledge_v2.error.failed_base_unknown' | 'knowledge_v2.error.missing_embedding_model'
) => string

export const getKnowledgeBaseFailureReason = (base: Pick<KnowledgeBase, 'error'>, t: KnowledgeErrorTranslator) => {
  if (base.error === KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL) {
    return t('knowledge_v2.error.missing_embedding_model')
  }

  return base.error ?? t('knowledge_v2.error.failed_base_unknown')
}

export const normalizeKnowledgeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
