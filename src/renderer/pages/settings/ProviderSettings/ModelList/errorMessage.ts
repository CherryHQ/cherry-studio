import { ErrorCode, isDataApiError, isSerializedDataApiError, toDataApiError } from '@shared/data/api'

const MODEL_IN_USE_BY_KNOWLEDGE_BASE_REASON = 'model is in use by a knowledge base'

interface ModelOperationErrorMessages {
  fallback: string
  modelInUseByKnowledgeBase: string
}

function getInvalidOperationReason(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('reason' in details)) {
    return undefined
  }

  const reason = details.reason
  return typeof reason === 'string' ? reason : undefined
}

export function getModelOperationErrorMessage(error: unknown, messages: ModelOperationErrorMessages): string {
  if (isDataApiError(error) || isSerializedDataApiError(error)) {
    const dataError = toDataApiError(error)
    if (
      dataError.code === ErrorCode.INVALID_OPERATION &&
      getInvalidOperationReason(dataError.details) === MODEL_IN_USE_BY_KNOWLEDGE_BASE_REASON
    ) {
      return messages.modelInUseByKnowledgeBase
    }

    if (
      dataError.code === ErrorCode.INVALID_OPERATION ||
      dataError.code === ErrorCode.CONFLICT ||
      dataError.code === ErrorCode.NOT_FOUND
    ) {
      return dataError.message
    }
  }

  return messages.fallback
}
