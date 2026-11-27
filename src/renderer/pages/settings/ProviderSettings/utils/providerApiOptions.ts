import type { Provider } from '@shared/data/types/provider'
import {
  isAIGatewayProvider,
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isOpenAICompatibleProvider,
  isSystemProvider
} from '@shared/utils/provider'

function isOpenAIOptionsProvider(provider: Provider): boolean {
  return isOpenAICompatibleProvider(provider) || isAzureOpenAIProvider(provider)
}

export function getProviderApiOptionsVisibility(provider: Provider) {
  const showDialectSettings = !isSystemProvider(provider)
  // The Vercel AI Gateway caches through its own request option, not an Anthropic endpoint.
  const isSupportAnthropicPromptCache = isAnthropicSupportedProvider(provider) || isAIGatewayProvider(provider)
  const isOpenAIProvider = isOpenAIOptionsProvider(provider)

  return {
    isOpenAIProvider,
    isSupportAnthropicPromptCache,
    showDialectSettings,
    hasVisibleApiOptions: showDialectSettings || isSupportAnthropicPromptCache
  }
}

export function hasVisibleProviderApiOptions(provider: Provider): boolean {
  return getProviderApiOptionsVisibility(provider).hasVisibleApiOptions
}
