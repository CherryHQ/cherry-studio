import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code'
import type { AzureOpenAIProvider, ProviderType, VertexProvider } from '@renderer/types'
import { isSystemProvider, type Provider, type SystemProviderId, SystemProviderIds } from '@renderer/types'

export const isAzureResponsesEndpoint = (provider: AzureOpenAIProvider) => {
  return provider.apiVersion === 'preview' || provider.apiVersion === 'v1'
}

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

const SUPPORT_SERVICE_TIER_PROVIDERS = [
  SystemProviderIds.openai,
  SystemProviderIds['azure-openai'],
  SystemProviderIds.groq
  // TODO: 等待上游支持aws-bedrock
]

/**
 * 判断提供商是否支持 service_tier 设置
 */
export const isSupportServiceTierProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportServiceTier === true ||
    provider.type === 'azure-openai' ||
    (isSystemProvider(provider) && SUPPORT_SERVICE_TIER_PROVIDERS.some((pid) => pid === provider.id))
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
  'azure-openai',
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

export const isNewApiProvider = (provider: Provider) => {
  return ['new-api', 'cherryin'].includes(provider.id) || provider.type === 'new-api'
}

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai'
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity'
}

/**
 * 判断是否为 OpenAI 兼容的提供商
 * @param {Provider} provider 提供商对象
 * @returns {boolean} 是否为 OpenAI 兼容提供商
 */
export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return ['openai', 'new-api', 'mistral'].includes(provider.type)
}

export function isAzureOpenAIProvider(provider: Provider): provider is AzureOpenAIProvider {
  return provider.type === 'azure-openai'
}

export function isOpenAIProvider(provider: Provider): boolean {
  return provider.type === 'openai-response'
}

export function isVertexProvider(provider: Provider): provider is VertexProvider {
  return provider.type === 'vertexai'
}

export function isAwsBedrockProvider(provider: Provider): boolean {
  return provider.type === 'aws-bedrock'
}

export function isAnthropicProvider(provider: Provider): boolean {
  return provider.type === 'anthropic'
}

export function isGeminiProvider(provider: Provider): boolean {
  return provider.type === 'gemini'
}

export function isAIGatewayProvider(provider: Provider): boolean {
  return provider.type === 'gateway'
}

export function isOllamaProvider(provider: Provider): boolean {
  return provider.type === 'ollama'
}

const NOT_SUPPORT_API_VERSION_PROVIDERS = ['github', 'copilot', 'perplexity'] as const satisfies SystemProviderId[]

export const isSupportAPIVersionProvider = (provider: Provider) => {
  if (isSystemProvider(provider)) {
    return !NOT_SUPPORT_API_VERSION_PROVIDERS.some((pid) => pid === provider.id)
  }
  return provider.apiOptions?.isNotSupportAPIVersion !== false
}

export const NOT_SUPPORT_API_KEY_PROVIDERS: readonly SystemProviderId[] = [
  'ollama',
  'lmstudio',
  'vertexai',
  'aws-bedrock',
  'copilot'
]

export const NOT_SUPPORT_API_KEY_PROVIDER_TYPES: readonly ProviderType[] = ['vertexai', 'aws-bedrock']
