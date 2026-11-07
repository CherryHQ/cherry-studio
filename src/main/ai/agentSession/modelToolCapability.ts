import { modelService } from '@data/services/ModelService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isFunctionCallingModel } from '@shared/utils/model'

export function modelSupportsTools(modelId: UniqueModelId): boolean {
  const { providerId, modelId: rawModelId } = parseUniqueModelId(modelId)
  try {
    return isFunctionCallingModel(modelService.getByKey(providerId, rawModelId))
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return true
    throw error
  }
}
