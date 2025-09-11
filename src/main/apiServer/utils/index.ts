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
  provider?: string
  provider_model_id?: string
}

export async function getAvailableProviders(): Promise<Provider[]> {
  try {
    // Wait for store to be ready before accessing providers
    const providers = await reduxService.select('state.llm.providers')
    if (!providers || !Array.isArray(providers)) {
      logger.warn('No providers found in Redux store, returning empty array')
      return []
    }

    // Only support OpenAI type providers for API server
    const openAIProviders = providers.filter((p: Provider) => p.enabled && p.type === 'openai')

    logger.info(`Filtered to ${openAIProviders.length} OpenAI providers from ${providers.length} total providers`)

    return openAIProviders
  } catch (error: any) {
    logger.error('Failed to get providers from Redux store:', error)
    return []
  }
}

export async function listAllAvailableModels(): Promise<Model[]> {
  try {
    const providers = await getAvailableProviders()
    return providers.map((p: Provider) => p.models || []).flat()
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

    // Validate model format first
    if (!model.includes(':')) {
      logger.warn(
        `Invalid model format, must contain ':' separator. Expected format "provider:model_id", got: ${model}`
      )
      return undefined
    }

    const providers = await getAvailableProviders()
    const modelInfo = model.split(':')

    if (modelInfo.length < 2 || modelInfo[0].length === 0 || modelInfo[1].length === 0) {
      logger.warn(`Invalid model format, expected "provider:model_id" with non-empty parts, got: ${model}`)
      return undefined
    }

    const providerId = modelInfo[0]
    const provider = providers.find((p: Provider) => p.id === providerId)

    if (!provider) {
      logger.warn(
        `Provider '${providerId}' not found or not enabled. Available providers: ${providers.map((p) => p.id).join(', ')}`
      )
      return undefined
    }

    logger.debug(`Found provider '${providerId}' for model: ${model}`)
    return provider
  } catch (error: any) {
    logger.error('Failed to get provider by model:', error)
    return undefined
  }
}

export function getRealProviderModel(modelStr: string): string {
  return modelStr.split(':').slice(1).join(':')
}

export interface ModelValidationError {
  type: 'invalid_format' | 'provider_not_found' | 'model_not_available' | 'unsupported_provider_type'
  message: string
  code: string
}

export async function validateModelId(
  model: string
): Promise<{ valid: boolean; error?: ModelValidationError; provider?: Provider; modelId?: string }> {
  try {
    if (!model || typeof model !== 'string') {
      return {
        valid: false,
        error: {
          type: 'invalid_format',
          message: 'Model must be a non-empty string',
          code: 'invalid_model_parameter'
        }
      }
    }

    if (!model.includes(':')) {
      return {
        valid: false,
        error: {
          type: 'invalid_format',
          message: "Invalid model format. Expected format: 'provider:model_id' (e.g., 'my-openai:gpt-4')",
          code: 'invalid_model_format'
        }
      }
    }

    const modelInfo = model.split(':')
    if (modelInfo.length < 2 || modelInfo[0].length === 0 || modelInfo[1].length === 0) {
      return {
        valid: false,
        error: {
          type: 'invalid_format',
          message: "Invalid model format. Both provider and model_id must be non-empty. Expected: 'provider:model_id'",
          code: 'invalid_model_format'
        }
      }
    }

    const providerId = modelInfo[0]
    const modelId = getRealProviderModel(model)
    const provider = await getProviderByModel(model)

    if (!provider) {
      return {
        valid: false,
        error: {
          type: 'provider_not_found',
          message: `Provider '${providerId}' not found, not enabled, or not supported. Only OpenAI providers are currently supported.`,
          code: 'provider_not_found'
        }
      }
    }

    // Check if model exists in provider
    const modelExists = provider.models?.some((m) => m.id === modelId)
    if (!modelExists) {
      const availableModels = provider.models?.map((m) => m.id).join(', ') || 'none'
      return {
        valid: false,
        error: {
          type: 'model_not_available',
          message: `Model '${modelId}' not available in provider '${providerId}'. Available models: ${availableModels}`,
          code: 'model_not_available'
        }
      }
    }

    return {
      valid: true,
      provider,
      modelId
    }
  } catch (error: any) {
    logger.error('Error validating model ID:', error)
    return {
      valid: false,
      error: {
        type: 'invalid_format',
        message: 'Failed to validate model ID',
        code: 'validation_error'
      }
    }
  }
}

export function transformModelToOpenAI(model: Model): OpenAICompatibleModel {
  return {
    id: `${model.provider}:${model.id}`,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.owned_by || model.provider,
    provider: model.provider,
    provider_model_id: model.id
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

    // Only support OpenAI type providers
    if (provider.type !== 'openai') {
      logger.debug(
        `Provider type '${provider.type}' not supported, only 'openai' type is currently supported: ${provider.id}`
      )
      return false
    }

    return true
  } catch (error: any) {
    logger.error('Error validating provider:', error)
    return false
  }
}
