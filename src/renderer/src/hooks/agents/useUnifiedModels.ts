import { useProviders } from '@renderer/hooks/useProvider'
import type { AdaptedApiModel, ApiModelsFilter, Model } from '@renderer/types'
import { useMemo } from 'react'

import { useApiModels } from './useModels'

/**
 * Unified hook that returns both local models and API models
 * Local models are prioritized and come first
 */
export const useUnifiedModels = (apiFilter?: ApiModelsFilter) => {
  const { providers } = useProviders()
  const { models: apiModels, isLoading: isLoadingApiModels } = useApiModels(apiFilter)

  // Get all local models from providers
  const localModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((m): m is Model => m !== undefined)
  }, [providers])

  // Convert API models to a format compatible with local models
  const adaptedApiModels = useMemo((): AdaptedApiModel[] => {
    return apiModels.map((model) => ({
      ...model,
      id: model.id,
      name: model.name,
      provider: model.provider || model.provider_name || 'unknown',
      group: model.provider || model.provider_name || 'Unknown',
      origin: model
    }))
  }, [apiModels])

  // Combine local models and API models
  // Local models come first for priority
  const allModels = useMemo(() => {
    // Create a Map to deduplicate models by ID
    const modelMap = new Map<string, AdaptedApiModel>()

    // Add local models first (priority)
    localModels.forEach((model) => {
      modelMap.set(model.id, {
        ...model,
        group: model.provider,
        origin: {
          id: model.id,
          object: 'model',
          created: Date.now(),
          name: model.name,
          owned_by: model.provider
        }
      } as AdaptedApiModel)
    })

    // Add API models (will only add if not already present from local models)
    adaptedApiModels.forEach((model) => {
      if (!modelMap.has(model.id)) {
        modelMap.set(model.id, model)
      }
    })

    return Array.from(modelMap.values())
  }, [localModels, adaptedApiModels])

  return {
    models: allModels,
    localModels,
    apiModels: adaptedApiModels,
    isLoading: isLoadingApiModels
  }
}
