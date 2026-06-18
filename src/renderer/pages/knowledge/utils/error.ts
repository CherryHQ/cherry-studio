import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemErrorCode,
  KnowledgeItemErrorCodeSchema
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

/** Localized copy for a known item error code. Exhaustive over `KnowledgeItemErrorCode`. */
const translateKnowledgeItemErrorCode = (code: KnowledgeItemErrorCode, t: KnowledgeErrorTranslator): string => {
  switch (code) {
    case 'directory_not_migrated':
      return t('knowledge.error.directory_not_migrated')
    default:
      return code satisfies never
  }
}

/** Failed item tooltip text: known error codes map to localized copy, free-form messages pass through. */
export const getKnowledgeItemFailureReason = (item: Pick<KnowledgeItem, 'error'>, t: KnowledgeErrorTranslator) => {
  const parsedCode = KnowledgeItemErrorCodeSchema.safeParse(item.error)
  if (parsedCode.success) {
    return translateKnowledgeItemErrorCode(parsedCode.data, t)
  }

  return item.error
}

export const normalizeKnowledgeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
