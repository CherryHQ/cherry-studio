import store from '@renderer/store'
import { Model } from '@renderer/types'
import { ApiModel } from '@renderer/types/apiModels'
import { pick } from 'lodash'

import { getProviderName } from './ProviderService'

export const getModelUniqId = (m?: Model) => {
  return m?.id ? JSON.stringify(pick(m, ['id', 'provider'])) : ''
}

export const hasModel = (m?: Model) => {
  const allModels = store
    .getState()
    .llm.providers.filter((p) => p.enabled)
    .map((p) => p.models)
    .flat()

  return allModels.find((model) => model.id === m?.id)
}

export function getModelName(model?: Model | ApiModel) {
  const modelName = model?.name || model?.id || ''

  // For API models that have provider_name field, use it directly
  const apiModel = model as ApiModel
  if (apiModel?.provider_name) {
    return `${modelName} | ${apiModel.provider_name}`
  }

  // For legacy models, look up the provider in the store
  const provider = store.getState().llm.providers.find((p) => p.id === model?.provider)
  if (provider) {
    const providerName = getProviderName(model as Model)
    return `${modelName} | ${providerName}`
  }

  return modelName
}
