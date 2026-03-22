import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useAllProviders } from '@renderer/hooks/useProvider'
import type { AdaptedApiModel, ApiModel, ApiModelsFilter, Model, Provider } from '@renderer/types'
import { apiModelAdapter } from '@renderer/utils/model'
import { groupBy, sortBy } from 'lodash'
import React, { useMemo } from 'react'

import SelectModelPopupView, { createModelPopup } from './base-popup'

interface PopupParams {
  model?: ApiModel
  /** Api models filter */
  apiFilter?: ApiModelsFilter
  /** model filter */
  modelFilter?: (model: Model) => boolean
  /** Show tag filter section */
  showTagFilter?: boolean
}

interface Props extends PopupParams {
  resolve: (value: ApiModel | undefined) => void
}

const buildFallbackProvider = (providerId: string, model: AdaptedApiModel): Provider => {
  return {
    id: providerId,
    type: model.origin.provider_type ?? 'openai',
    name: model.origin.provider_name || providerId || 'Unknown Provider',
    apiKey: '',
    apiHost: '',
    models: [model],
    enabled: true
  }
}

const PopupContainer: React.FC<Props> = ({ model, apiFilter, modelFilter, showTagFilter = true, resolve }) => {
  const { models, isLoading } = useApiModels(apiFilter)
  const allProviders = useAllProviders()

  const providers = useMemo(() => {
    const providerOrderMap = new Map(allProviders.map((provider, index) => [provider.id, index]))
    const adaptedModels = models
      .map((item) => apiModelAdapter(item))
      .filter((item) => (modelFilter ? modelFilter(item) : true))
    const groupedModels = groupBy(adaptedModels, (item) => item.provider)

    // 按照 provider 配置顺序排序 group keys
    return sortBy(Object.keys(groupedModels), (providerId) => providerOrderMap.get(providerId) ?? Infinity)
      .map((providerId) => {
        const provider = allProviders.find((item) => item.id === providerId)
        const providerModels = groupedModels[providerId]

        if (!providerModels?.length) {
          return provider
        }

        if (provider) {
          return { ...provider, models: providerModels }
        }

        const [firstModel] = providerModels
        return {
          ...buildFallbackProvider(providerId, firstModel),
          models: providerModels
        }
      })
      .filter((provider): provider is Provider => !!provider && provider.models.length > 0)
  }, [allProviders, modelFilter, models])

  const selectedModel = useMemo(() => (model ? apiModelAdapter(model) : undefined), [model])

  return (
    <SelectModelPopupView
      providers={providers}
      model={selectedModel}
      loading={isLoading}
      showTagFilter={showTagFilter}
      showPinnedModels={false}
      prioritizedProviderIds={['cherryin']}
      resolve={(value) => resolve((value as AdaptedApiModel | undefined)?.origin)}
    />
  )
}

export const SelectAgentModelPopup = createModelPopup<PopupParams, ApiModel>(PopupContainer)
