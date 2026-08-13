import { useProvider } from '@renderer/hooks/useProvider'
import { hasVisibleProviderApiOptions } from '@renderer/pages/settings/ProviderSettings/utils/providerApiOptions'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { isManagedCherryAiProviderId } from '@shared/data/presets/cherryai'
import { isAwsBedrockProvider, isAzureOpenAIProvider, isVertexProvider, matchesPreset } from '@shared/utils/provider'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Exposes read-only provider presentation metadata used across provider settings. */
export function useProviderMeta(providerId: string) {
  const { provider } = useProvider(providerId)
  const { i18n } = useTranslation()

  return useMemo(() => {
    const hideApiInput = provider ? isAwsBedrockProvider(provider) : false
    const hideApiKeyInput = provider ? matchesPreset(provider, 'copilot') || isVertexProvider(provider) : false
    const isDmxapi = provider ? matchesPreset(provider, 'dmxapi') : false
    // The managed CherryAI free-trial provider is protected default data: it
    // uses a built-in key, so its credential/host editors are read-only.
    const isManagedReadOnly = provider ? isManagedCherryAiProviderId(provider.id) : false

    return {
      provider,
      fancyProviderName: provider ? getFancyProviderName(provider) : '',
      officialWebsite: provider?.websites?.official,
      apiKeyWebsite: provider?.websites?.apiKey,
      docsWebsite: provider?.websites?.docs,
      modelsWebsite: provider?.websites?.models,
      isAzureOpenAI: provider ? isAzureOpenAIProvider(provider) : false,
      isCherryIN: provider ? matchesPreset(provider, 'cherryin') : false,
      isDmxapi,
      isManagedReadOnly,
      isChineseUser: i18n.language.startsWith('zh'),
      showApiOptionsButton: provider ? hasVisibleProviderApiOptions(provider) : false,
      isApiKeyFieldVisible: !hideApiInput && !hideApiKeyInput && !isManagedReadOnly,
      isConnectionFieldVisible: !hideApiInput && !isDmxapi && !isManagedReadOnly
    }
  }, [i18n.language, provider])
}
