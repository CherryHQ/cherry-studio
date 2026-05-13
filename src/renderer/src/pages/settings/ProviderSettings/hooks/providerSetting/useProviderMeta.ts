import { useProvider } from '@renderer/hooks/useProviders'
import {
  getFancyProviderName,
  isAnthropicSupportedProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isSystemProvider,
  isVertexProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Match either the canonical preset row or any user-cloned variant of it. */
function matchesPreset(provider: Provider, presetId: string): boolean {
  return provider.id === presetId || provider.presetProviderId === presetId
}

/** Exposes read-only provider presentation metadata used across provider settings. */
export function useProviderMeta(providerId: string) {
  const { provider } = useProvider(providerId)
  const { i18n } = useTranslation()

  return useMemo(() => {
    const hideApiInput = provider ? isAwsBedrockProvider(provider) : false
    const hideApiKeyInput = provider ? matchesPreset(provider, 'copilot') || isVertexProvider(provider) : false
    const isAnthropicOAuth = provider ? matchesPreset(provider, 'anthropic') && provider.authType === 'oauth' : false
    const isDmxapi = provider ? matchesPreset(provider, 'dmxapi') : false

    return {
      fancyProviderName: provider ? getFancyProviderName(provider) : '',
      officialWebsite: provider?.websites?.official,
      apiKeyWebsite: provider?.websites?.apiKey,
      docsWebsite: provider?.websites?.docs,
      modelsWebsite: provider?.websites?.models,
      isAzureOpenAI: provider ? isAzureOpenAIProvider(provider) : false,
      isCherryIN: provider ? matchesPreset(provider, 'cherryin') : false,
      isDmxapi,
      isChineseUser: i18n.language.startsWith('zh'),
      isAnthropicOAuth,
      showApiOptionsButton: provider ? !isSystemProvider(provider) || isAnthropicSupportedProvider(provider) : false,
      isApiKeyFieldVisible: !hideApiInput && !isAnthropicOAuth && !hideApiKeyInput,
      isConnectionFieldVisible: !hideApiInput && !isAnthropicOAuth && !isDmxapi
    }
  }, [i18n.language, provider])
}
