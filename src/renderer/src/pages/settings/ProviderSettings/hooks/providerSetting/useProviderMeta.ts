import { useProvider, useProviderPresetMetadata } from '@renderer/hooks/useProviders'
import {
  getFancyProviderName,
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isSystemProvider
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Boundary rule: this is a domain-cohesive read-only provider metadata hook.
 * It should internalize provider lookup and translation access, and expose only minimal presentation metadata.
 * Callers should pass only providerId, never provider snapshots plus language plumbing that this hook can resolve itself.
 *
 * Intent: expose the small set of shared, read-only provider presentation metadata used across the settings page.
 * Scope: use in Provider Settings components that need links, labels, and visibility toggles.
 * Does not handle: endpoint previews, persistence, or any effectful state.
 *
 * @example
 * ```tsx
 * const meta = useProviderMeta(providerId)
 * <ProviderHeader name={meta.fancyProviderName} docsWebsite={meta.docsWebsite} />
 * ```
 */
export function useProviderMeta(providerId: string) {
  const { provider } = useProvider(providerId)
  const { data: presetMetadata } = useProviderPresetMetadata(providerId)
  const { i18n } = useTranslation()

  return useMemo(() => {
    const hideApiInput = provider ? provider.id === 'aws-bedrock' : false
    const hideApiKeyInput = provider ? provider.id === 'copilot' || provider.id === 'vertexai' : false
    const isAnthropicOAuth = provider?.id === 'anthropic' && provider.authType === 'oauth'

    return {
      fancyProviderName: provider ? getFancyProviderName(provider) : '',
      officialWebsite: presetMetadata?.websites?.official,
      apiKeyWebsite: presetMetadata?.websites?.apiKey,
      docsWebsite: presetMetadata?.websites?.docs,
      modelsWebsite: presetMetadata?.websites?.models,
      isAzureOpenAI: provider ? isAzureOpenAIProvider(provider) : false,
      isCherryIN: provider?.id === 'cherryin',
      isDmxapi: provider?.id === 'dmxapi',
      isChineseUser: i18n.language.startsWith('zh'),
      isAnthropicOAuth,
      showApiOptionsButton: provider ? !isSystemProvider(provider) || isAnthropicSupportedProvider(provider) : false,
      isApiKeyFieldVisible: !hideApiInput && !isAnthropicOAuth && !hideApiKeyInput,
      isConnectionFieldVisible: !hideApiInput && !isAnthropicOAuth && provider?.id !== 'dmxapi'
    }
  }, [i18n.language, presetMetadata, provider])
}
