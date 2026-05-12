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

  // 5. Final fallback — must mirror `providerToAiSdkConfig` so feature gates
  // that key on the returned id (`reasoningExtraction.applies`, etc.) see
  // the same provider the SDK adapter does.
  logger.debug('Provider id not in registered extensions; falling back to openai-compatible', {
    providerId: provider.id,
    presetProviderId: provider.presetProviderId
  })
  return appProviderIds['openai-compatible']
}
