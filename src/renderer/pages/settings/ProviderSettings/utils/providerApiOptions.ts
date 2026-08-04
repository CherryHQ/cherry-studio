import type { Provider } from '@shared/data/types/provider'
import {
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isOpenAICompatibleProvider,
  isSystemProvider
} from '@shared/utils/provider'

function isOpenAIOptionsProvider(provider: Provider): boolean {
  return isOpenAICompatibleProvider(provider) || isAzureOpenAIProvider(provider)
}

export function getProviderApiOptionsVisibility(provider: Provider) {
  const showApiFeatureSettings = !isSystemProvider(provider)
  const isSupportAnthropicPromptCache = isAnthropicSupportedProvider(provider)
  const isOpenAIProvider = isOpenAIOptionsProvider(provider)

  return {
    isOpenAIProvider,
    isSupportAnthropicPromptCache,
    showApiFeatureSettings,
    hasVisibleApiOptions: showApiFeatureSettings || isSupportAnthropicPromptCache
  }
}

export function hasVisibleProviderApiOptions(provider: Provider): boolean {
  return getProviderApiOptionsVisibility(provider).hasVisibleApiOptions
}
