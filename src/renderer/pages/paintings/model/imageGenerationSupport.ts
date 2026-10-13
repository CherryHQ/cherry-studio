import { ipcApi } from '@renderer/ipc'
import { createUniqueModelId } from '@shared/data/types/model'

export function fetchImageGenerationSupport(providerId: string, modelId: string) {
  return ipcApi.request('ai.image.support.get', { uniqueModelId: createUniqueModelId(providerId, modelId) })
}
