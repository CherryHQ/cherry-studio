import store from '@renderer/store'
import { Model, Provider } from '@renderer/types'
import { t } from 'i18next'
import { pick } from 'lodash'

import { checkApi } from './ApiService'

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

// Generic function to perform model checks with exception handling
async function performModelCheck<T>(
  provider: Provider,
  model: Model,
  checkFn: (provider: Provider, model: Model) => Promise<T>
): Promise<{ latency: number }> {
  const startTime = performance.now()
  await checkFn(provider, model)
  const latency = performance.now() - startTime

  return { latency }
}

// Unified model check function
// Automatically selects appropriate check method based on model type
export async function checkModel(provider: Provider, model: Model): Promise<{ latency: number }> {
  return performModelCheck(provider, model, async (provider, model) => {
    await checkApi(provider, model)
  })
}
