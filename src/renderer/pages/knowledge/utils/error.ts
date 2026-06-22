import {
  type KnowledgeBase,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCodeSchema,
  type KnowledgeItem,
  type KnowledgeItemErrorCode,
  KnowledgeItemErrorCodeSchema
} from '@shared/data/types/knowledge'

type KnowledgeErrorTranslator = (
  key:
    | 'knowledge.error.failed_base_unknown'
    | 'knowledge.error.missing_embedding_model'
    | 'knowledge.error.missing_vector_store'
    | 'knowledge.error.directory_not_migrated'
) => string

/** Localized copy for a known base error code. Exhaustive over `KnowledgeBaseErrorCode`. */
const translateKnowledgeBaseErrorCode = (code: KnowledgeBaseErrorCode, t: KnowledgeErrorTranslator): string => {
  switch (code) {
    case 'missing_embedding_model':
      return t('knowledge.error.missing_embedding_model')
    case 'missing_vector_store':
      return t('knowledge.error.missing_vector_store')
    default:
      return code satisfies never
  }
}

/**
 * Failed-base tooltip text. `KnowledgeBase.error` is a nullable error-code enum
 * (`KnowledgeBaseErrorCodeSchema.nullable()`), so a recognized code maps to localized copy and the
 * only other reachable value — `null` — falls back to the generic reason. (Unlike the item helper
 * below, a base never carries a free-form message to pass through.)
 */
export const getKnowledgeBaseFailureReason = (base: Pick<KnowledgeBase, 'error'>, t: KnowledgeErrorTranslator) => {
  const parsedCode = KnowledgeBaseErrorCodeSchema.safeParse(base.error)
  if (parsedCode.success) {
    return translateKnowledgeBaseErrorCode(parsedCode.data, t)
  }

  return t('knowledge.error.failed_base_unknown')
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
