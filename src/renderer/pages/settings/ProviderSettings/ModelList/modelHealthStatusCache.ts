import { cacheService } from '@data/CacheService'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useSyncExternalStore } from 'react'

// Per-model keys in the window memory cache: a row subscribes to its own model only,
// so one streamed result never invalidates the other rows.
const keyFor = (modelId: UniqueModelId) => `model-health-status.${modelId}`

export function readModelHealthStatus(modelId: UniqueModelId) {
  return cacheService.getCasual<ModelWithStatus>(keyFor(modelId))
}

export function writeModelHealthStatus(status: ModelWithStatus) {
  cacheService.setCasual(keyFor(status.model.id), status)
}

export function clearModelHealthStatus(modelId: UniqueModelId) {
  cacheService.deleteCasual(keyFor(modelId))
}

export function useModelHealthStatus(modelId: UniqueModelId) {
  const subscribe = useCallback((listener: () => void) => cacheService.subscribe(keyFor(modelId), listener), [modelId])
  const getSnapshot = useCallback(() => readModelHealthStatus(modelId), [modelId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
