import { formatPrivateKey, hasProviderConfig } from '@cherrystudio/ai-core/provider'
import type { AppProviderId } from '@renderer/aiCore/types'
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
  isSupportStreamOptionsProvider,
  isVertexProvider
} from '@renderer/utils/provider'
import { defaultAppHeaders } from '@shared/utils'
import { cloneDeep, isEmpty } from 'lodash'

import type { ProviderConfig } from '../types'
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
 * 使用类型安全的辅助函数构建provider-specific配置
 *
 * @param actualProvider - Cherry Studio provider配置
 * @param model - 模型配置
 * @returns 类型安全的 Provider 配置
 */
export function providerToAiSdkConfig(actualProvider: Provider, model: Model): ProviderConfig {
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)
  const { baseURL, endpoint } = routeToEndpoint(actualProvider.apiHost)

  // 构建上下文
  const ctx: BuilderContext = {
    actualProvider,
    model,
    baseConfig: {
      baseURL,
      apiKey: actualProvider.apiKey
    },
    endpoint,
    aiSdkProviderId
  }

  // 路由到专门的构建器
  if (actualProvider.id === SystemProviderIds.copilot) {
    return buildCopilotConfig(ctx)
  }

  if (isOllamaProvider(actualProvider)) {
    return buildOllamaConfig(ctx)
  }

  if (isAzureOpenAIProvider(actualProvider)) {
    return buildAzureConfig(ctx)
  }

  if (aiSdkProviderId === 'bedrock') {
    return buildBedrockConfig(ctx)
  }

  if (aiSdkProviderId === 'google-vertex' || aiSdkProviderId === 'google-vertex-anthropic') {
    return buildVertexConfig(ctx)
  }

  if (aiSdkProviderId === 'cherryin') {
    return buildCherryinConfig(ctx)
  }

  // 有 SDK 支持的 provider
  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    return buildGenericProviderConfig(ctx)
  }

  // 默认 fallback 到 openai-compatible
  return buildOpenAICompatibleConfig(ctx)
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
 * 准备特殊provider的配置,主要用于异步处理的配置
 */
export async function prepareSpecialProviderConfig(provider: Provider, config: ProviderConfig) {
  switch (provider.id) {
    case 'copilot': {
      const defaultHeaders = store.getState().copilot.defaultHeaders ?? {}
      const headers = {
        ...COPILOT_DEFAULT_HEADERS,
        ...defaultHeaders
      }
      const { token } = await window.api.copilot.getToken(headers)
      const settings = config.providerSettings as any
      settings.apiKey = token
      settings.headers = {
        ...headers,
        ...settings.headers
      }
      break
    }
    case 'cherryai': {
      const settings = config.providerSettings as any
      settings.fetch = async (url: string, options: any) => {
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
        const settings = config.providerSettings as any
        config.providerSettings = {
          ...settings,
          headers: {
            ...(settings.headers ? settings.headers : {}),
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

/**
 * 基础配置
 */
interface BaseConfig {
  baseURL: string
  apiKey: string
}

/**
 * 构建器上下文
 */
interface BuilderContext {
  actualProvider: Provider
  model: Model
  baseConfig: BaseConfig
  endpoint?: string
  aiSdkProviderId: AppProviderId
}

/**
 * GitHub Copilot 配置构建器
 */
function buildCopilotConfig(ctx: BuilderContext): ProviderConfig<'github-copilot-openai-compatible'> {
  const storedHeaders = store.getState().copilot.defaultHeaders ?? {}

  return {
    providerId: 'github-copilot-openai-compatible',
    providerSettings: {
      ...ctx.baseConfig,
      headers: {
        ...COPILOT_DEFAULT_HEADERS,
        ...storedHeaders,
        ...ctx.actualProvider.extra_headers
      },
      name: ctx.actualProvider.id
    }
  }
}

/**
 * Ollama 配置构建器
 */
function buildOllamaConfig(ctx: BuilderContext): ProviderConfig<'ollama'> {
  const headers: ProviderConfig<'ollama'>['providerSettings']['headers'] = {
    ...ctx.actualProvider.extra_headers
  }

  if (!isEmpty(ctx.baseConfig.apiKey)) {
    headers.Authorization = `Bearer ${ctx.baseConfig.apiKey}`
  }

  return {
    providerId: 'ollama',
    providerSettings: {
      ...ctx.baseConfig,
      headers
    }
  }
}

/**
 * AWS Bedrock 配置构建器
 */
function buildBedrockConfig(ctx: BuilderContext): ProviderConfig<'bedrock'> {
  const authType = getAwsBedrockAuthType()
  const region = getAwsBedrockRegion()

  if (authType === 'apiKey') {
    return {
      providerId: 'bedrock',
      providerSettings: {
        ...ctx.baseConfig,
        region,
        apiKey: getAwsBedrockApiKey()
      }
    }
  }

  return {
    providerId: 'bedrock',
    providerSettings: {
      ...ctx.baseConfig,
      region,
      accessKeyId: getAwsBedrockAccessKeyId(),
      secretAccessKey: getAwsBedrockSecretAccessKey()
    }
  }
}

/**
 * Google Vertex AI 配置构建器
 */
function buildVertexConfig(
  ctx: BuilderContext
): ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'> {
  if (!isVertexAIConfigured()) {
    throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
  }

  const { project, location, googleCredentials } = createVertexProvider(ctx.actualProvider)
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic'

  const baseURL = ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')

  if (isAnthropic) {
    return {
      providerId: 'google-vertex-anthropic',
      providerSettings: {
        ...ctx.baseConfig,
        baseURL,
        project,
        location,
        googleCredentials: {
          ...googleCredentials,
          privateKey: formatPrivateKey(googleCredentials.privateKey)
        }
      }
    }
  }

  return {
    providerId: 'google-vertex',
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      project,
      location,
      googleCredentials: {
        ...googleCredentials,
        privateKey: formatPrivateKey(googleCredentials.privateKey)
      }
    }
  }
}

/**
 * CherryIN 配置构建器
 */
function buildCherryinConfig(ctx: BuilderContext): ProviderConfig<'cherryin'> {
  const cherryinProvider = getProviderById(SystemProviderIds.cherryin)

  return {
    providerId: 'cherryin',
    providerSettings: {
      ...ctx.baseConfig,
      endpointType: ctx.model.endpoint_type,
      anthropicBaseURL: cherryinProvider ? cherryinProvider.anthropicApiHost + '/v1' : undefined,
      geminiBaseURL: cherryinProvider ? cherryinProvider.apiHost + '/v1beta/models' : undefined,
      headers: {
        ...defaultAppHeaders(),
        ...ctx.actualProvider.extra_headers
      }
    }
  }
}

/**
 * Azure OpenAI 配置构建器
 */
function buildAzureConfig(ctx: BuilderContext): ProviderConfig<'azure'> | ProviderConfig<'azure-responses'> {
  const apiVersion = ctx.actualProvider.apiVersion?.trim()

  // 根据 apiVersion 决定使用 azure 还是 azure-responses
  const useResponsesMode = apiVersion && ['preview', 'v1'].includes(apiVersion)

  const providerSettings: Record<string, any> = {
    ...ctx.baseConfig,
    endpoint: ctx.endpoint,
    headers: {
      ...defaultAppHeaders(),
      ...ctx.actualProvider.extra_headers
    }
  }

  if (apiVersion) {
    providerSettings.apiVersion = apiVersion
    // 只有非 preview/v1 版本才使用 deployment-based URLs
    if (!useResponsesMode) {
      providerSettings.useDeploymentBasedUrls = true
    }
  }

  if (useResponsesMode) {
    return {
      providerId: 'azure-responses',
      providerSettings
    }
  }

  return {
    providerId: 'azure',
    providerSettings
  }
}

/**
 * 构建通用的 OpenAI-compatible 或特定 provider 的额外选项
 */
function buildCommonOptions(ctx: BuilderContext) {
  const options: Record<string, any> = {
    endpoint: ctx.endpoint,
    headers: {
      ...defaultAppHeaders(),
      ...ctx.actualProvider.extra_headers
    }
  }

  // OpenAI 特殊 header
  if (ctx.aiSdkProviderId === 'openai') {
    options.headers['X-Api-Key'] = ctx.baseConfig.apiKey
  }

  return options
}

/**
 * OpenAI-compatible 配置构建器
 */
function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'openai-compatible',
    providerSettings: {
      ...ctx.baseConfig,
      ...commonOptions,
      name: ctx.actualProvider.id,
      includeUsage
    }
  }
}

/**
 * 通用 provider 配置构建器（有 SDK 支持的 provider）
 */
function buildGenericProviderConfig(ctx: BuilderContext): ProviderConfig {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: ctx.aiSdkProviderId,
    providerSettings: {
      ...ctx.baseConfig,
      ...commonOptions
    }
  }
}
