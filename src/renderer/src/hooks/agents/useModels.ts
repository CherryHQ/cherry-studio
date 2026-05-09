import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { Model } from '@renderer/types'
import type { Model as SharedModel } from '@shared/data/types/model'
import { useMemo } from 'react'

/**
 * Adapter: DataApi `Model` → renderer-local `Model` shape consumed by the
 * agent model picker / navbar button. We project from `/models` and keep
 * `id` in canonical UniqueModelId form so it matches `agent.model` (which
 * is the same FK target).
 */
function toRendererModel(model: SharedModel): Model {
  return {
    id: model.id,
    provider: model.providerId,
    name: model.name,
    group: model.group ?? '',
    owned_by: model.ownedBy
  }
}

export const useApiModels = () => {
  const { data, error, isLoading } = useQuery('/models')
  const models = useMemo(() => (data ?? []).map(toRendererModel), [data])
  return { models, error, isLoading }
}
