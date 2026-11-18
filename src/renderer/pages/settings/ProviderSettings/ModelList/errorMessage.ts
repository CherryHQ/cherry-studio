import { ErrorCode, isDataApiError, isSerializedDataApiError, toDataApiError } from '@shared/data/api/errors'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

const MODEL_IN_USE_BY_KNOWLEDGE_BASE_REASON = 'model is in use by a knowledge base'
const MODEL_IN_USE_AS_DEFAULT_REASON = 'model is in use as the default model'

interface ModelOperationErrorMessages {
  fallback: string
  modelInUseByKnowledgeBase: string
  modelInUseAsDefault: string
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- DataApi INVALID_OPERATION details vary by operation; require a string reason before matching model-deletion guidance.
function getInvalidOperationReason(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('reason' in details)) {
    return undefined
  }

  const reason = details.reason
  return typeof reason === 'string' ? reason : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- DataApi details are not code-discriminated at this boundary; require a string operation before extracting a blocked model identifier.
function getInvalidOperationOperation(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('operation' in details)) {
    return undefined
  }

  const operation = details.operation
  return typeof operation === 'string' ? operation : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Model-pull reconciliation catches arbitrary mutation failures; DataApi guards, code, reason and operation checks establish the blocked default-model identity.
export function getModelInUseAsDefaultUniqueModelId(error: unknown): UniqueModelId | undefined {
  if (!isDataApiError(error) && !isSerializedDataApiError(error)) {
    return undefined
  }

  const dataError = toDataApiError(error)
  if (
    dataError.code !== ErrorCode.INVALID_OPERATION ||
    getInvalidOperationReason(dataError.details) !== MODEL_IN_USE_AS_DEFAULT_REASON
  ) {
    return undefined
  }

  const operation = getInvalidOperationOperation(dataError.details)
  const modelPath = operation?.startsWith('delete model ') ? operation.slice('delete model '.length) : undefined
  const separatorIndex = modelPath?.indexOf('/')
  if (!modelPath || separatorIndex === undefined || separatorIndex <= 0 || separatorIndex === modelPath.length - 1) {
    return undefined
  }

  return createUniqueModelId(modelPath.slice(0, separatorIndex), modelPath.slice(separatorIndex + 1))
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Model-list item and group mutations can reject any value; classify DataApi codes and checked reasons before choosing guidance or the caller fallback.
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
      dataError.code === ErrorCode.INVALID_OPERATION &&
      getInvalidOperationReason(dataError.details) === MODEL_IN_USE_AS_DEFAULT_REASON
    ) {
      return messages.modelInUseAsDefault
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
