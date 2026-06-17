import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isOpenAICompatibleProvider,
  isSystemProvider
} from '@shared/utils/provider'

const GROQ_PROVIDER_ID = 'groq'
const AIHUBMIX_PROVIDER_ID = 'aihubmix'
const OPENAI_RESPONSES_ENDPOINTS = new Set<string>(['openai-response', ENDPOINT_TYPE.OPENAI_RESPONSES])

function isOpenAIOptionsProvider(provider: Provider): boolean {
  return isOpenAICompatibleProvider(provider) || isAzureOpenAIProvider(provider)
}

function providerHasEndpoint(provider: Provider, endpoints: Set<string>): boolean {
  return (
    (provider.defaultChatEndpoint ? endpoints.has(provider.defaultChatEndpoint) : false) ||
    Object.keys(provider.endpointConfigs ?? {}).some((endpointType) => endpoints.has(endpointType))
  )
}

export function getProviderApiOptionsVisibility(provider: Provider) {
  const showApiFeatureSettings = !isSystemProvider(provider)
  const isSupportAnthropicPromptCache = isAnthropicSupportedProvider(provider)
  const isOpenAIProvider = isOpenAIOptionsProvider(provider)
  const isGroqProvider = provider.id === GROQ_PROVIDER_ID
  const hasOpenAIResponsesProtocol = providerHasEndpoint(provider, OPENAI_RESPONSES_ENDPOINTS)
  const showOpenAIServiceTierSetting = isOpenAIProvider && provider.apiFeatures.serviceTier && !isGroqProvider
  const showGroqServiceTierSetting = isGroqProvider && provider.apiFeatures.serviceTier
  const showSummaryTextSetting =
    isOpenAIProvider && (hasOpenAIResponsesProtocol || provider.id === AIHUBMIX_PROVIDER_ID)
  const showVerbositySetting = isOpenAIProvider && provider.apiFeatures.verbosity
  const showOpenAISettings = showOpenAIServiceTierSetting || showSummaryTextSetting || showVerbositySetting
  const showProviderValueSettings = showOpenAISettings || showGroqServiceTierSetting

  return {
    isOpenAIProvider,
    isSupportAnthropicPromptCache,
    showApiFeatureSettings,
    showOpenAIServiceTierSetting,
    showGroqServiceTierSetting,
    showSummaryTextSetting,
    showVerbositySetting,
    showOpenAISettings,
    showProviderValueSettings,
    hasVisibleApiOptions: showApiFeatureSettings || showProviderValueSettings || isSupportAnthropicPromptCache
  }
}

export function hasVisibleProviderApiOptions(provider: Provider): boolean {
  return getProviderApiOptionsVisibility(provider).hasVisibleApiOptions
}
