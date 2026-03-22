import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import type { Model, Provider } from '@renderer/types'
import { sortBy } from 'lodash'
import React, { useMemo } from 'react'

import SelectModelPopupView, { createModelPopup } from './base-popup'

interface PopupParams {
  model?: Model
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
}

interface Props extends PopupParams {
  resolve: (value: Model | undefined) => void
}

const PopupContainer: React.FC<Props> = ({ model, filter, showTagFilter = true, resolve }) => {
  const { providers } = useProviders()
  const allProviders = useAllProviders()

  const filteredProviders = useMemo(() => {
    const providerOrderMap = new Map(allProviders.map((provider, i) => [provider.id, i]))
    const filtered = providers.reduce<Provider[]>((result, provider) => {
      const models = filter ? provider.models.filter(filter) : provider.models
      if (models.length === 0) return result
      result.push({ ...provider, models })
      return result
    }, [])
    return sortBy(filtered, (provider) => providerOrderMap.get(provider.id) ?? Infinity)
  }, [providers, allProviders, filter])

  return (
    <SelectModelPopupView
      providers={filteredProviders}
      model={model}
      showTagFilter={showTagFilter}
      showPinnedModels={true}
      resolve={resolve}
    />
  )
}

export const SelectChatModelPopup = createModelPopup<PopupParams, Model>(PopupContainer)
