import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { ApiModel, ApiModelsFilter } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { useMemo } from 'react'

/**
 * Adapter: DataApi `Model` → legacy `ApiModel` shape consumed by the agent
 * model picker / navbar button. We project from `/models` (DataApi) and
 * keep the surface stable for callers.
 *
 * The `filter` parameter is currently a no-op — `getModelFilterByAgentType`
 * already returns `{}` (provider-type filtering went away with v1's
 * ProviderTypeSchema removal). Kept for API compatibility.
 */
function toApiModel(model: Model): ApiModel {
  return {
    id: model.id,
    object: 'model',
    created: 0,
    name: model.name,
    owned_by: model.ownedBy ?? model.providerId,
    provider: model.providerId,
    provider_name: model.providerId,
    provider_model_id: model.apiModelId ?? model.id
  }
}

export const useApiModels = (_filter?: ApiModelsFilter) => {
  const { data, error, isLoading } = useQuery('/models')
  const models = useMemo(() => (data ?? []).map(toApiModel), [data])
  return { models, error, isLoading }
}
