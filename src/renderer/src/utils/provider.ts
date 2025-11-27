import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code'
import type { ProviderType } from '@renderer/types'
import { isSystemProvider, type Provider, type SystemProviderId, SystemProviderIds } from '@renderer/types'
export {
  isAIGatewayProvider,
  isAnthropicProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isAzureResponsesEndpoint,
  isCherryAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider,
  isPerplexityProvider,
  isVertexProvider
} from '@shared/provider'

export const getClaudeSupportedProviders = (providers: Provider[]) => {
  return providers.filter(
    (p) => p.type === 'anthropic' || !!p.anthropicApiHost || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id)
  )
}

const NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS = [
  'deepseek',
  'baichuan',
  'minimax',
  'xirang',
  'poe',
  'cephalon'
] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 message 的 content 为数组类型。 Only for OpenAI Chat Completions API.
 */
export const isSupportArrayContentProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportArrayContent !== true &&
    !NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS = ['poe', 'qiniu'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 developer 作为 message role。 Only for OpenAI API.
 */
export const isSupportDeveloperRoleProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportDeveloperRole === true ||
    (isSystemProvider(provider) && !NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS = ['mistral'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 stream_options 参数。Only for OpenAI API.
 */
export const isSupportStreamOptionsProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportStreamOptions !== true &&
    !NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDER = [
  'ollama',
  'lmstudio',
  'nvidia'
] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持使用 enable_thinking 参数来控制 Qwen3 等模型的思考。 Only for OpenAI Chat Completions API.
 */
export const isSupportEnableThinkingProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportEnableThinking !== true &&
    !NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDER.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_SERVICE_TIER_PROVIDERS = ['github', 'copilot', 'cerebras'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 service_tier 设置。 Only for OpenAI API.
 */
export const isSupportServiceTierProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportServiceTier === true ||
    (isSystemProvider(provider) && !NOT_SUPPORT_SERVICE_TIER_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const NOT_SUPPORT_VERBOSITY_PROVIDERS = ['groq'] as const satisfies SystemProviderId[]

/**
 * Determines whether the provider supports the verbosity option.
 * Only applies to system providers that are not in the exclusion list.
 * @param provider - The provider to check
 * @returns true if the provider supports verbosity, false otherwise
 */
export const isSupportVerbosityProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportVerbosity !== true &&
    !NOT_SUPPORT_VERBOSITY_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const SUPPORT_URL_CONTEXT_PROVIDER_TYPES = [
  'gemini',
  'vertexai',
  'anthropic',
  'new-api'
] as const satisfies ProviderType[]

export const isSupportUrlContextProvider = (provider: Provider) => {
  return (
    SUPPORT_URL_CONTEXT_PROVIDER_TYPES.some((type) => type === provider.type) ||
    provider.id === SystemProviderIds.cherryin
  )
}

const SUPPORT_GEMINI_NATIVE_WEB_SEARCH_PROVIDERS = ['gemini', 'vertexai'] as const satisfies SystemProviderId[]

/** 判断是否是使用 Gemini 原生搜索工具的 provider. 目前假设只有官方 API 使用原生工具 */
export const isGeminiWebSearchProvider = (provider: Provider) => {
  return SUPPORT_GEMINI_NATIVE_WEB_SEARCH_PROVIDERS.some((id) => id === provider.id)
}

const NOT_SUPPORT_API_VERSION_PROVIDERS = ['github', 'copilot', 'perplexity'] as const satisfies SystemProviderId[]

export const isSupportAPIVersionProvider = (provider: Provider) => {
  if (isSystemProvider(provider)) {
    return !NOT_SUPPORT_API_VERSION_PROVIDERS.some((pid) => pid === provider.id)
  }
  return provider.apiOptions?.isNotSupportAPIVersion !== false
}
