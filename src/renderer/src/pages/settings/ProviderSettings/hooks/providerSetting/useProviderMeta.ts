import { useProvider } from '@renderer/hooks/useProviders'
import {
  getFancyProviderName,
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isSystemProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Exposes read-only provider presentation metadata used across provider settings. */
export function useProviderMeta(providerId: string) {
  const { provider } = useProvider(providerId)
  const { i18n } = useTranslation()

  return useMemo(() => {
    const hideApiInput = provider ? provider.id === 'aws-bedrock' : false
    const hideApiKeyInput = provider ? provider.id === 'copilot' || provider.id === 'vertexai' : false
    const isAnthropicOAuth = provider?.id === 'anthropic' && provider.authType === 'oauth'

    return {
      fancyProviderName: provider ? getFancyProviderName(provider) : '',
      officialWebsite: provider?.websites?.official,
      apiKeyWebsite: provider?.websites?.apiKey,
      docsWebsite: provider?.websites?.docs,
      modelsWebsite: provider?.websites?.models,
      isAzureOpenAI: provider ? isAzureOpenAIProvider(provider) : false,
      isCherryIN: provider?.id === 'cherryin',
      isDmxapi: provider?.id === 'dmxapi',
      isChineseUser: i18n.language.startsWith('zh'),
      isAnthropicOAuth,
      showApiOptionsButton: provider ? !isSystemProvider(provider) || isAnthropicSupportedProvider(provider) : false,
      isApiKeyFieldVisible: !hideApiInput && !isAnthropicOAuth && !hideApiKeyInput,
      isConnectionFieldVisible: !hideApiInput && !isAnthropicOAuth && provider?.id !== 'dmxapi'
    }
  }, [i18n.language, provider])
}
