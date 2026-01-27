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
import { cloneDeep, isEmpty } from 'lodash'

import { customFetch } from '../../utils/customFetch'
import { mergeHeaders } from '../../utils/headers'
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

  const isCopilotProvider = actualProvider.id === SystemProviderIds.copilot
  if (isCopilotProvider) {
    const storedHeaders = store.getState().copilot.defaultHeaders ?? {}
    const options = ProviderConfigFactory.fromProvider('github-copilot-openai-compatible', baseConfig, {
      headers: mergeHeaders(COPILOT_DEFAULT_HEADERS, storedHeaders, actualProvider.extra_headers),
      fetch: customFetch,
      name: actualProvider.id,
      includeUsage
    })

    return {
      providerId: 'github-copilot-openai-compatible',
      options
    }
  }

  if (isOllamaProvider(actualProvider)) {
    return {
      providerId: 'ollama',
      options: {
        ...baseConfig,
        fetch: customFetch,
        headers: mergeHeaders(actualProvider.extra_headers ?? {}, {
          Authorization: !isEmpty(baseConfig.apiKey) ? `Bearer ${baseConfig.apiKey}` : undefined
        })
      }
    }
  }

  // 处理OpenAI模式
  const extraOptions: any = {
    fetch: customFetch // 使用自定义 fetch 以支持 User-Agent header
  }
  extraOptions.endpoint = endpoint
  if (actualProvider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(model)) {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'openai' || (aiSdkProviderId === 'cherryin' && actualProvider.type === 'openai')) {
    extraOptions.mode = 'chat'
  }

  // NOTE: default app header在streamText就添加好了
  extraOptions.headers = actualProvider.extra_headers

  if (aiSdkProviderId === 'openai') {
    extraOptions.headers['X-Api-Key'] = baseConfig.apiKey
  }
  // azure
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/latest
  // https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses?tabs=python-key#responses-api
  if (aiSdkProviderId === 'azure-responses') {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'azure') {
    extraOptions.mode = 'chat'
  }
  if (isAzureOpenAIProvider(actualProvider)) {
    const apiVersion = actualProvider.apiVersion?.trim()
    if (apiVersion) {
      extraOptions.apiVersion = apiVersion
      if (!['preview', 'v1'].includes(apiVersion)) {
        extraOptions.useDeploymentBasedUrls = true
      }
    }
  }

  // bedrock
  if (aiSdkProviderId === 'bedrock') {
    const authType = getAwsBedrockAuthType()
    extraOptions.region = getAwsBedrockRegion()

    if (authType === 'apiKey') {
      extraOptions.apiKey = getAwsBedrockApiKey()
    } else {
      extraOptions.accessKeyId = getAwsBedrockAccessKeyId()
      extraOptions.secretAccessKey = getAwsBedrockSecretAccessKey()
    }
  }
  // google-vertex
  if (aiSdkProviderId === 'google-vertex' || aiSdkProviderId === 'google-vertex-anthropic') {
    if (!isVertexAIConfigured()) {
      throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
    }
    const { project, location, googleCredentials } = createVertexProvider(actualProvider)
    extraOptions.project = project
    extraOptions.location = location
    extraOptions.googleCredentials = {
      ...googleCredentials,
      privateKey: formatPrivateKey(googleCredentials.privateKey)
    }
    baseConfig.baseURL += aiSdkProviderId === 'google-vertex' ? '/publishers/google' : '/publishers/anthropic/models'
  }

  // cherryin
  if (aiSdkProviderId === 'cherryin') {
    if (model.endpoint_type) {
      extraOptions.endpointType = model.endpoint_type
    }
    // CherryIN API Host
    const cherryinProvider = getProviderById(SystemProviderIds.cherryin)
    if (cherryinProvider) {
      extraOptions.anthropicBaseURL = cherryinProvider.anthropicApiHost + '/v1'
      extraOptions.geminiBaseURL = cherryinProvider.apiHost + '/v1beta/models'
    }
  }

  // Apply developer-to-system role conversion for providers that don't support developer role
  // bug: https://github.com/vercel/ai/issues/10982
  // fixPR: https://github.com/vercel/ai/pull/11127
  // TODO: but the PR don't backport to v5, the code will be removed when upgrading to v6
  if (!isSupportDeveloperRoleProvider(actualProvider) || !isOpenAIReasoningModel(model)) {
    extraOptions.fetch = createDeveloperToSystemFetch(extraOptions.fetch)
  }

  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, baseConfig, extraOptions)
    return {
      providerId: aiSdkProviderId,
      options
    }
  }

  // 否则fallback到openai-compatible
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
      const headers = mergeHeaders(COPILOT_DEFAULT_HEADERS, defaultHeaders)
      const { token } = await window.api.copilot.getToken(headers)
      config.options.apiKey = token
      config.options.headers = mergeHeaders(headers, config.options.headers)
      break
    }
    case 'cherryai': {
      config.options.fetch = async (url: RequestInfo | URL, options: RequestInit) => {
        // 在这里对最终参数进行签名
        const signature = await window.api.cherryai.generateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: JSON.parse(options.body as string)
        })
        return customFetch(url, {
          ...options,
          headers: mergeHeaders((options.headers as Record<string, string>) ?? {}, signature)
        })
      }
      break
    }
    case 'anthropic': {
      if (provider.authType === 'oauth') {
        const oauthToken = await window.api.anthropic_oauth.getAccessToken()
        config.options = {
          ...config.options,
          headers: mergeHeaders(config.options.headers ?? {}, {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            Authorization: `Bearer ${oauthToken}`
          }),
          baseURL: 'https://api.anthropic.com/v1',
          apiKey: ''
        }
      }
    }
  }

  return config
}
