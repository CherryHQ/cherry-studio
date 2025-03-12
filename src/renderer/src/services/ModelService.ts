import store from '@renderer/store'
import { Model } from '@renderer/types'
import { t } from 'i18next'
import { pick } from 'lodash'

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

export function getModelName(model?: Model) {
  const provider = store.getState().llm.providers.find((p) => p.id === model?.provider)
  const modelName = model?.name || model?.id || ''

  if (provider) {
    const providerName = provider?.isSystem ? t(`provider.${provider.id}`) : provider?.name
    return `${modelName} | ${providerName}`
  }

  return modelName
}
