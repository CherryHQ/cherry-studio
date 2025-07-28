import { loggerService } from '@main/services/LoggerService'
import { reduxService } from '@main/services/ReduxService'
import { Model, Provider } from '@types'

const logger = loggerService.withContext('ApiServerUtils')

// OpenAI compatible model format
export interface OpenAICompatibleModel {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export async function getAvailableProviders(): Promise<Provider[]> {
  try {
    // Wait for store to be ready before accessing providers
    const providers = await reduxService.select('state.llm.providers')
    if (!providers || !Array.isArray(providers)) {
      logger.warn('No providers found in Redux store, returning empty array')
      return []
    }
    return providers.filter((p: Provider) => p.enabled)
  } catch (error: any) {
    logger.error('Failed to get providers from Redux store:', error)
    return []
  }
}

export async function listAllAvailableModels(): Promise<Model[]> {
  try {
    const providers = await getAvailableProviders()
    return providers.map((p: Provider) => p.models || []).flat() as Model[]
  } catch (error: any) {
    logger.error('Failed to list available models:', error)
    return []
  }
}

export async function getProviderByModel(model: string): Promise<Provider | undefined> {
  try {
    if (!model || typeof model !== 'string') {
      logger.warn(`Invalid model parameter: ${model}`)
      return undefined
    }

    const providers = await getAvailableProviders()
    const modelInfo = model.split(':')

    if (modelInfo.length < 2) {
      logger.warn(`Invalid model format, expected "provider:model": ${model}`)
      return undefined
    }

    const providerId = modelInfo[0]
    const provider = providers.find((p: Provider) => p.id === providerId)

    if (!provider) {
      logger.warn(`Provider not found for model: ${model}`)
      return undefined
    }

    return provider
  } catch (error: any) {
    logger.error('Failed to get provider by model:', error)
    return undefined
  }
}

export function getRealProviderModel(modelStr: string): string {
  return modelStr.split(':').slice(1).join(':')
}

export function transformModelToOpenAI(model: Model): OpenAICompatibleModel {
  return {
    id: `${model.provider}:${model.id}`,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.owned_by || model.provider
  }
}

export function validateProvider(provider: Provider): boolean {
  try {
    if (!provider) {
      return false
    }

    // Check required fields
    if (!provider.id || !provider.type || !provider.apiKey || !provider.apiHost) {
      logger.warn('Provider missing required fields:', {
        id: !!provider.id,
        type: !!provider.type,
        apiKey: !!provider.apiKey,
        apiHost: !!provider.apiHost
      })
      return false
    }

    // Check if provider is enabled
    if (!provider.enabled) {
      logger.debug(`Provider is disabled: ${provider.id}`)
      return false
    }

    return true
  } catch (error: any) {
    logger.error('Error validating provider:', error)
    return false
  }
}
