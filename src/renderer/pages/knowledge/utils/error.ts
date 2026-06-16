import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  type KnowledgeBase,
  type KnowledgeItem
} from '@shared/data/types/knowledge'

type KnowledgeErrorTranslator = (
  key:
    | 'knowledge.error.failed_base_unknown'
    | 'knowledge.error.missing_embedding_model'
    | 'knowledge.error.directory_not_migrated'
) => string

export const getKnowledgeBaseFailureReason = (base: Pick<KnowledgeBase, 'error'>, t: KnowledgeErrorTranslator) => {
  if (base.error === KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL) {
    return t('knowledge.error.missing_embedding_model')
  }

  return base.error ?? t('knowledge.error.failed_base_unknown')
}

/** Failed or warning item tooltip text: known error codes map to localized copy, free-form messages pass through. */
export const getKnowledgeItemFailureReason = (item: Pick<KnowledgeItem, 'error'>, t: KnowledgeErrorTranslator) => {
  if (item.error === KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED) {
    return t('knowledge.error.directory_not_migrated')
  }

  return item.error
}

export const normalizeKnowledgeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
