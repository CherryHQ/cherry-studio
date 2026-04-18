import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'
import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'

import { type AppProviderId, appProviderIds } from '../types'
import { getBaseUrl } from '../utils/provider'
import { extensions } from './extensions'

const logger = loggerService.withContext('ProviderFactory')

for (const extension of extensions) {
  if (!extensionRegistry.has(extension.config.name)) {
    extensionRegistry.register(extension)
  }
}

/**
 * Get AI SDK Provider ID from a v2 Provider.
 *
 * Uses provider.id for direct lookup, provider.presetProviderId as fallback
 * (replaces old provider.type), and endpoint baseUrl for OpenAI domain detection.
 */
export function getAiSdkProviderId(provider: Provider): AppProviderId {
  // 1. Azure responses endpoint detection
  if (isAzureOpenAIProvider(provider)) {
    return isAzureResponsesEndpoint(provider) ? appProviderIds['azure-responses'] : appProviderIds.azure
  }

  if (provider.id === SystemProviderIds.grok) {
    return appProviderIds['xai-responses']
  }

  // 2. Direct ID match
  if (provider.id in appProviderIds) {
    return appProviderIds[provider.id]
  }

  // 3. Fallback to presetProviderId (v2 replacement for provider.type)
  const presetId = provider.presetProviderId
  if (presetId && presetId !== 'openai' && presetId in appProviderIds) {
    return appProviderIds[presetId]
  }

  // 4. Detect OpenAI by endpoint baseUrl
  const baseUrl = getBaseUrl(provider)
  if (baseUrl.includes('api.openai.com')) {
    return appProviderIds['openai-chat']
  }

  logger.warn('Provider ID not found in registered extensions, using as-is', {
    providerId: provider.id,
    presetProviderId: provider.presetProviderId,
    registeredIds: Object.keys(appProviderIds)
  })
  return provider.id
}
