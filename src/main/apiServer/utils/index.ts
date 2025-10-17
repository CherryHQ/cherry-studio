import { CacheService } from '@main/services/CacheService'
import { loggerService } from '@main/services/LoggerService'
import { reduxService } from '@main/services/ReduxService'
import { ApiModel, Model, Provider } from '@types'

const logger = loggerService.withContext('ApiServerUtils')

// Cache configuration
const PROVIDERS_CACHE_KEY = 'api-server:providers'
const PROVIDERS_CACHE_TTL = 10 * 1000 // 10 seconds

export async function getAvailableProviders(): Promise<Provider[]> {
  try {
    // Try to get from cache first (faster)
    const cachedSupportedProviders = CacheService.get<Provider[]>(PROVIDERS_CACHE_KEY)
    if (cachedSupportedProviders && cachedSupportedProviders.length > 0) {
      logger.debug('Providers resolved from cache', {
        count: cachedSupportedProviders.length
      })
      return cachedSupportedProviders
    }

    // If cache is not available, get fresh data from Redux
    const providers = await reduxService.select('state.llm.providers')
    if (!providers || !Array.isArray(providers)) {
      logger.warn('No providers found in Redux store')
      return []
    }

    // Support OpenAI and Anthropic type providers for API server
    const supportedProviders = providers.filter(
      (p: Provider) => p.enabled && (p.type === 'openai' || p.type === 'anthropic')
    )

    // Cache the filtered results
    CacheService.set(PROVIDERS_CACHE_KEY, supportedProviders, PROVIDERS_CACHE_TTL)

    logger.info('Providers filtered', {
      supported: supportedProviders.length,
      total: providers.length
    })

    return supportedProviders
  } catch (error: any) {
    logger.error('Failed to get providers from Redux store', { error })
    return []
  }
}

export async function listAllAvailableModels(providers?: Provider[]): Promise<Model[]> {
  try {
    if (!providers) {
      providers = await getAvailableProviders()
    }
    return providers.map((p: Provider) => p.models || []).flat()
  } catch (error: any) {
    logger.error('Failed to list available models', { error })
    return []
  }
}

export async function getProviderByModel(model: string): Promise<Provider | undefined> {
  try {
    if (!model || typeof model !== 'string') {
      logger.warn('Invalid model parameter', { model })
      return undefined
    }

    // Validate model format first
    if (!model.includes(':')) {
      logger.warn('Invalid model format missing separator', { model })
      return undefined
    }

    const providers = await getAvailableProviders()
    const modelInfo = model.split(':')

    if (modelInfo.length < 2 || modelInfo[0].length === 0 || modelInfo[1].length === 0) {
      logger.warn('Invalid model format with empty parts', { model })
      return undefined
    }

    const providerId = modelInfo[0]
    const provider = providers.find((p: Provider) => p.id === providerId)

    if (!provider) {
      logger.warn('Provider not found for model', {
        providerId,
        available: providers.map((p) => p.id)
      })
      return undefined
    }

    logger.debug('Provider resolved for model', { providerId, model })
    return provider
  } catch (error: any) {
    logger.error('Failed to get provider by model', { error, model })
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

export async function validateModelId(model: string): Promise<{
  valid: boolean
  error?: ModelValidationError
  provider?: Provider
  modelId?: string
}> {
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
    logger.error('Error validating model ID', { error, model })
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

export function transformModelToOpenAI(model: Model, provider?: Provider): ApiModel {
  const providerDisplayName = provider?.name
  return {
    id: `${model.provider}:${model.id}`,
    object: 'model',
    name: model.name,
    created: Math.floor(Date.now() / 1000),
    owned_by: model.owned_by || providerDisplayName || model.provider,
    provider: model.provider,
    provider_name: providerDisplayName,
    provider_type: provider?.type,
    provider_model_id: model.id
  }
}

export async function getProviderById(providerId: string): Promise<Provider | undefined> {
  try {
    if (!providerId || typeof providerId !== 'string') {
      logger.warn('Invalid provider ID parameter', { providerId })
      return undefined
    }

    const providers = await getAvailableProviders()
    const provider = providers.find((p: Provider) => p.id === providerId)

    if (!provider) {
      logger.warn('Provider not found by ID', {
        providerId,
        available: providers.map((p) => p.id)
      })
      return undefined
    }

    logger.debug('Provider found by ID', { providerId })
    return provider
  } catch (error: any) {
    logger.error('Failed to get provider by ID', { error, providerId })
    return undefined
  }
}

export function validateProvider(provider: Provider): boolean {
  try {
    if (!provider) {
      return false
    }

    // Check required fields
    if (!provider.id || !provider.type || !provider.apiKey || !provider.apiHost) {
      logger.warn('Provider missing required fields', {
        id: !!provider.id,
        type: !!provider.type,
        apiKey: !!provider.apiKey,
        apiHost: !!provider.apiHost
      })
      return false
    }

    // Check if provider is enabled
    if (!provider.enabled) {
      logger.debug('Provider is disabled', { providerId: provider.id })
      return false
    }

    // Support OpenAI and Anthropic type providers
    if (provider.type !== 'openai' && provider.type !== 'anthropic') {
      logger.debug('Provider type not supported', {
        providerId: provider.id,
        providerType: provider.type
      })
      return false
    }

    return true
  } catch (error: any) {
    logger.error('Error validating provider', {
      error,
      providerId: provider?.id
    })
    return false
  }
}

export const getProviderAnthropicModelChecker = (providerId: string): ((m: Model) => boolean) => {
  switch (providerId) {
    case 'cherryin':
    case 'new-api':
      return (m: Model) => m.endpoint_type === 'anthropic'
    case 'aihubmix':
      return (m: Model) => m.id.includes('claude')
    default:
      // allow all models when checker not configured
      return () => true
  }
}
