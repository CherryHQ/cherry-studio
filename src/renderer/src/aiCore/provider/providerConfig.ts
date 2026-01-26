import { formatPrivateKey, hasProviderConfig, ProviderConfigFactory } from '@cherrystudio/ai-core/provider'
import { isOpenAIChatCompletionOnlyModel, isOpenAIReasoningModel } from '@renderer/config/models'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockApiKey,
  getAwsBedrockAuthType,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getProviderById } from '@renderer/services/ProviderService'
import store from '@renderer/store'
import type { EndpointType } from '@renderer/types'
import { isSystemProvider, type Model, type Provider, SystemProviderIds } from '@renderer/types'
import type { OpenAICompletionsStreamOptions } from '@renderer/types/aiCoreTypes'
import {
  formatApiHost,
  formatAzureOpenAIApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  isWithTrailingSharp,
  routeToEndpoint
} from '@renderer/utils/api'
import {
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isSupportDeveloperRoleProvider,
  isSupportStreamOptionsProvider,
  isVertexProvider
} from '@renderer/utils/provider'
import { defaultAppHeaders } from '@shared/utils'
import { cloneDeep, isEmpty } from 'lodash'

import type { AiSdkConfig } from '../types'
import { aihubmixProviderCreator, newApiResolverCreator, vertexAnthropicProviderCreator } from './config'
import { azureAnthropicProviderCreator } from './config/azure-anthropic'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'

/**
 * 处理特殊provider的转换逻辑
 */
function handleSpecialProviders(model: Model, provider: Provider): Provider {
  if (isNewApiProvider(provider)) {
    return newApiResolverCreator(model, provider)
  }

  if (isSystemProvider(provider)) {
    if (provider.id === 'aihubmix') {
      return aihubmixProviderCreator(model, provider)
    }
    if (provider.id === 'vertexai') {
      return vertexAnthropicProviderCreator(model, provider)
    }
  }
  if (isAzureOpenAIProvider(provider)) {
    return azureAnthropicProviderCreator(model, provider)
  }
  return provider
}

/**
 * Format and normalize the API host URL for a provider.
 * Handles provider-specific URL formatting rules (e.g., appending version paths, Azure formatting).
 *
 * @param provider - The provider whose API host is to be formatted.
 * @returns A new provider instance with the formatted API host.
 */
export function formatProviderApiHost(provider: Provider): Provider {
  const formatted = { ...provider }
  const appendApiVersion = !isWithTrailingSharp(provider.apiHost)
  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatApiHost(formatted.anthropicApiHost, appendApiVersion)
  }

  if (isAnthropicProvider(provider)) {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    // AI SDK needs /v1 in baseURL, Anthropic SDK will strip it in getSdkClient
    formatted.apiHost = formatApiHost(baseHost, appendApiVersion)
    if (!formatted.anthropicApiHost) {
      formatted.anthropicApiHost = formatted.apiHost
    }
  } else if (formatted.id === SystemProviderIds.copilot || formatted.id === SystemProviderIds.github) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else if (isOllamaProvider(formatted)) {
    formatted.apiHost = formatOllamaApiHost(formatted.apiHost)
  } else if (isGeminiProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, appendApiVersion, 'v1beta')
  } else if (isAzureOpenAIProvider(formatted)) {
    formatted.apiHost = formatAzureOpenAIApiHost(formatted.apiHost)
  } else if (isVertexProvider(formatted)) {
    formatted.apiHost = formatVertexApiHost(formatted)
  } else if (isCherryAIProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else if (isPerplexityProvider(formatted)) {
    formatted.apiHost = formatApiHost(formatted.apiHost, false)
  } else {
    formatted.apiHost = formatApiHost(formatted.apiHost, appendApiVersion)
  }
  return formatted
}

/**
 * Retrieve the effective Provider configuration for the given model.
 * Applies all necessary transformations (special-provider handling, URL formatting, etc.).
 *
 * @param model - The model whose provider is to be resolved.
 * @returns A new Provider instance with all adaptations applied.
 */
export function getActualProvider(model: Model): Provider {
  const baseProvider = getProviderByModel(model)

  return adaptProvider({ provider: baseProvider, model })
}

/**
 * Transforms a provider configuration by applying model-specific adaptations and normalizing its API host.
 * The transformations are applied in the following order:
 * 1. Model-specific provider handling (e.g., New-API, system providers, Azure OpenAI)
 * 2. API host formatting (provider-specific URL normalization)
 *
 * @param provider - The base provider configuration to transform.
 * @param model - The model associated with the provider; optional but required for special-provider handling.
 * @returns A new Provider instance with all transformations applied.
 */
export function adaptProvider({ provider, model }: { provider: Provider; model?: Model }): Provider {
  let adaptedProvider = cloneDeep(provider)

  // Apply transformations in order
  if (model) {
    adaptedProvider = handleSpecialProviders(model, adaptedProvider)
  }
  adaptedProvider = formatProviderApiHost(adaptedProvider)

  return adaptedProvider
}

interface BaseExtraOptions {
  fetch?: typeof fetch
  endpoint: string
  mode?: 'responses' | 'chat'
  headers: Record<string, string>
}

interface AzureOpenAIExtraOptions extends BaseExtraOptions {
  apiVersion: string
  useDeploymentBasedUrls: true | undefined
}

interface BedrockApiKeyExtraOptions extends BaseExtraOptions {
  region: string
  apiKey: string
}

interface BedrockAccessKeyExtraOptions extends BaseExtraOptions {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

type BedrockExtraOptions = BedrockApiKeyExtraOptions | BedrockAccessKeyExtraOptions

interface VertexExtraOptions extends BaseExtraOptions {
  project: string
  location: string
  googleCredentials: {
    privateKey: string
    clientEmail: string
  }
}

interface CherryInExtraOptions extends BaseExtraOptions {
  endpointType?: EndpointType
  anthropicBaseURL?: string
  geminiBaseURL?: string
}

type ExtraOptions = BedrockExtraOptions | AzureOpenAIExtraOptions | VertexExtraOptions | CherryInExtraOptions

/**
 * 将 Provider 配置转换为新 AI SDK 格式
 * 简化版：利用新的别名映射系统
 */
export function providerToAiSdkConfig(actualProvider: Provider, model: Model): AiSdkConfig {
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)

  // 构建基础配置
  const { baseURL, endpoint } = routeToEndpoint(actualProvider.apiHost)
  const baseConfig = {
    baseURL: baseURL,
    apiKey: actualProvider.apiKey
  }
  let includeUsage: OpenAICompletionsStreamOptions['include_usage'] = undefined
  if (isSupportStreamOptionsProvider(actualProvider)) {
    includeUsage = store.getState().settings.openAI?.streamOptions?.includeUsage
  }

  // Specially, some providers which need to early return
  // Copilot
  const isCopilotProvider = actualProvider.id === SystemProviderIds.copilot
  if (isCopilotProvider) {
    const storedHeaders = store.getState().copilot.defaultHeaders ?? {}
    const options = ProviderConfigFactory.fromProvider('github-copilot-openai-compatible', baseConfig, {
      headers: {
        ...COPILOT_DEFAULT_HEADERS,
        ...storedHeaders,
        ...actualProvider.extra_headers
      },
      name: actualProvider.id,
      includeUsage
    })

    return {
      providerId: 'github-copilot-openai-compatible',
      options
    }
  }

  // Ollama
  if (isOllamaProvider(actualProvider)) {
    return {
      providerId: 'ollama',
      options: {
        ...baseConfig,
        headers: {
          ...actualProvider.extra_headers,
          Authorization: !isEmpty(baseConfig.apiKey) ? `Bearer ${baseConfig.apiKey}` : undefined
        }
      }
    }
  }

  // Generally, construct extraOptions according to provider & model
  // Consider as OpenAI like provider

  // Construct baseExtraOptions first
  // About mode of azure:
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/latest
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses?tabs=python-key#responses-api
  let mode: BaseExtraOptions['mode']
  if (
    (actualProvider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(model)) ||
    aiSdkProviderId === 'azure-responses'
  ) {
    mode = 'responses'
  } else if (
    aiSdkProviderId === 'openai' ||
    (aiSdkProviderId === 'cherryin' && actualProvider.type === 'openai') ||
    aiSdkProviderId === 'azure'
  ) {
    mode = 'chat'
  }

  const headers: BaseExtraOptions['headers'] = {
    ...defaultAppHeaders(),
    ...actualProvider.extra_headers
  }
  if (aiSdkProviderId === 'openai') {
    if (actualProvider.extra_headers?.['X-Api-Key'] === undefined) {
      headers['X-Api-Key'] = baseConfig.apiKey
    }
  }

  let _fetch: typeof fetch | undefined

  // Apply developer-to-system role conversion for providers that don't support developer role
  // bug: https://github.com/vercel/ai/issues/10982
  // fixPR: https://github.com/vercel/ai/pull/11127
  // TODO: but the PR don't backport to v5, the code will be removed when upgrading to v6
  if (!isSupportDeveloperRoleProvider(actualProvider) || !isOpenAIReasoningModel(model)) {
    _fetch = createDeveloperToSystemFetch(fetch)
  }

  const baseExtraOptions = {
    fetch: _fetch,
    endpoint,
    mode,
    headers
  } as const satisfies BaseExtraOptions

  // Create specifical fields in extraOptions for different provider
  let extraOptions: ExtraOptions | undefined
  if (isAzureOpenAIProvider(actualProvider)) {
    const apiVersion = actualProvider.apiVersion?.trim()
    let useDeploymentBasedUrls: true | undefined
    if (apiVersion) {
      if (!['preview', 'v1'].includes(apiVersion)) {
        useDeploymentBasedUrls = true
      }
    }
    extraOptions = {
      ...baseExtraOptions,
      apiVersion,
      useDeploymentBasedUrls
    } satisfies AzureOpenAIExtraOptions
  } else if (aiSdkProviderId === 'bedrock') {
    // bedrock
    const authType = getAwsBedrockAuthType()
    const region = getAwsBedrockRegion()

    if (authType === 'apiKey') {
      extraOptions = {
        ...baseExtraOptions,
        region,
        apiKey: getAwsBedrockApiKey()
      } satisfies BedrockApiKeyExtraOptions
    } else {
      extraOptions = {
        ...baseExtraOptions,
        region,
        accessKeyId: getAwsBedrockAccessKeyId(),
        secretAccessKey: getAwsBedrockSecretAccessKey()
      } satisfies BedrockAccessKeyExtraOptions
    }
  } else if (aiSdkProviderId === 'google-vertex' || aiSdkProviderId === 'google-vertex-anthropic') {
    // google-vertex
    if (!isVertexAIConfigured()) {
      throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
    }
    const { project, location, googleCredentials } = createVertexProvider(actualProvider)
    extraOptions = {
      ...baseExtraOptions,
      project,
      location,
      googleCredentials: {
        ...googleCredentials,
        privateKey: formatPrivateKey(googleCredentials.privateKey)
      }
    } satisfies VertexExtraOptions
    baseConfig.baseURL += aiSdkProviderId === 'google-vertex' ? '/publishers/google' : '/publishers/anthropic/models'
  } else if (aiSdkProviderId === 'cherryin') {
    // CherryIN API Host
    const cherryinProvider = getProviderById(SystemProviderIds.cherryin)
    const endpointType: EndpointType | undefined = model.endpoint_type
    let anthropicBaseURL: string | undefined
    let geminiBaseURL: string | undefined
    if (cherryinProvider) {
      anthropicBaseURL = cherryinProvider.anthropicApiHost + '/v1'
      geminiBaseURL = cherryinProvider.apiHost + '/v1beta/models'
    }
    extraOptions = {
      ...baseExtraOptions,
      endpointType,
      anthropicBaseURL,
      geminiBaseURL
    } satisfies CherryInExtraOptions
  } else {
    extraOptions = baseExtraOptions
  }

  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    // if the provider has a specific aisdk provider
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, baseConfig, extraOptions)
    return {
      providerId: aiSdkProviderId,
      options
    }
  } else {
    // otherwise, fallback to openai-compatible
    const options = ProviderConfigFactory.createOpenAICompatible(baseConfig.baseURL, baseConfig.apiKey)
    return {
      providerId: 'openai-compatible',
      options: {
        ...options,
        name: actualProvider.id,
        ...extraOptions,
        includeUsage
      }
    }
  }
}

/**
 * 检查是否支持使用新的AI SDK
 * 简化版：利用新的别名映射和动态provider系统
 */
export function isModernSdkSupported(provider: Provider): boolean {
  // 特殊检查：vertexai需要配置完整
  if (provider.type === 'vertexai' && !isVertexAIConfigured()) {
    return false
  }

  // 使用getAiSdkProviderId获取映射后的providerId，然后检查AI SDK是否支持
  const aiSdkProviderId = getAiSdkProviderId(provider)

  // 如果映射到了支持的provider，则支持现代SDK
  return hasProviderConfig(aiSdkProviderId)
}

/**
 * Creates a custom fetch wrapper that converts 'developer' role to 'system' role in request body.
 * This is needed for providers that don't support the 'developer' role (e.g., Azure DeepSeek R1).
 *
 * @param originalFetch - Optional original fetch function to wrap
 * @returns A fetch function that transforms the request body
 */
function createDeveloperToSystemFetch(originalFetch?: typeof fetch): typeof fetch {
  const baseFetch = originalFetch ?? fetch
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let options = init
    if (options?.body && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body)
        if (body.input && Array.isArray(body.input)) {
          let hasChanges = false
          body.input = body.input.map((msg: { role: string }) => {
            if (msg.role === 'developer') {
              hasChanges = true
              return { ...msg, role: 'system' }
            }
            return msg
          })
          if (hasChanges) {
            options = {
              ...options,
              body: JSON.stringify(body)
            }
          }
        }
      } catch {
        // If parsing fails, just use original body
      }
    }
    return baseFetch(input, options)
  }
}

/**
 * 准备特殊provider的配置,主要用于异步处理的配置
 */
export async function prepareSpecialProviderConfig(
  provider: Provider,
  config: ReturnType<typeof providerToAiSdkConfig>
) {
  switch (provider.id) {
    case 'copilot': {
      const defaultHeaders = store.getState().copilot.defaultHeaders ?? {}
      const headers = {
        ...COPILOT_DEFAULT_HEADERS,
        ...defaultHeaders
      }
      const { token } = await window.api.copilot.getToken(headers)
      config.options.apiKey = token
      config.options.headers = {
        ...headers,
        ...config.options.headers
      }
      break
    }
    case 'cherryai': {
      config.options.fetch = async (url, options) => {
        // 在这里对最终参数进行签名
        const signature = await window.api.cherryai.generateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: JSON.parse(options.body)
        })
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            ...signature
          }
        })
      }
      break
    }
    case 'anthropic': {
      if (provider.authType === 'oauth') {
        const oauthToken = await window.api.anthropic_oauth.getAccessToken()
        config.options = {
          ...config.options,
          headers: {
            ...(config.options.headers ? config.options.headers : {}),
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            Authorization: `Bearer ${oauthToken}`
          },
          baseURL: 'https://api.anthropic.com/v1',
          apiKey: ''
        }
      }
    }
  }

  return config
}
