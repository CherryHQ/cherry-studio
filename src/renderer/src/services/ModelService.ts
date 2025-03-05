import { isEmbeddingModel } from '@renderer/config/models'
import AiProvider from '@renderer/providers/AiProvider'
import store from '@renderer/store'
import { Model, Provider } from '@renderer/types'
import { t } from 'i18next'
import { pick } from 'lodash'

import { checkApiProvider } from './ApiService'

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

// Generic function to perform model checks
// Abstracts provider validation and error handling, allowing different types of check logic
async function performModelCheck<T>(
  provider: Provider,
  model: Model,
  checkFn: (ai: AiProvider, model: Model) => Promise<T>,
  processResult: (result: T) => { valid: boolean; error: Error | null }
): Promise<{ valid: boolean; error: Error | null; latency?: number }> {
  const validation = checkApiProvider(provider)
  if (!validation.valid) {
    return {
      valid: validation.valid,
      error: validation.error
    }
  }

  const AI = new AiProvider(provider)

  try {
    const startTime = performance.now()
    const result = await checkFn(AI, model)
    const latency = performance.now() - startTime

    return {
      ...processResult(result),
      latency
    }
  } catch (error: any) {
    return {
      valid: false,
      error
    }
  }
}

// Unified model check function
// Automatically selects appropriate check method based on model type
export async function checkModel(provider: Provider, model: Model) {
  if (isEmbeddingModel(model)) {
    return performModelCheck(
      provider,
      model,
      (ai, model) => ai.getEmbeddingDimensions(model),
      (dimensions) => ({ valid: dimensions > 0, error: null })
    )
  } else {
    return performModelCheck(
      provider,
      model,
      (ai, model) => ai.check(model),
      ({ valid, error }) => ({ valid, error: error || null })
    )
  }
}
