import {
  formatPrivateKey,
  hasProviderConfig,
  ProviderConfigFactory,
  type ProviderId,
  type ProviderSettingsMap
} from '@cherrystudio/ai-core/provider'
import { cacheService } from '@data/CacheService'
import { isOpenAIChatCompletionOnlyModel } from '@renderer/config/models'
import { isNewApiProvider } from '@renderer/config/providers'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import store from '@renderer/store'
import { isSystemProvider, type Model, type Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { cloneDeep, trim } from 'lodash'

import { aihubmixProviderCreator, newApiResolverCreator, vertexAnthropicProviderCreator } from './config'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'
const logger = loggerService.withContext('ProviderConfigProcessor')

/**
 * 获取轮询的API key
 * 复用legacy架构的多key轮询逻辑
 */
function getRotatedApiKey(provider: Provider): string {
  const keys = provider.apiKey.split(',').map((key) => key.trim())
  const keyName = `provider:${provider.id}:last_used_key`

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = cacheService.getShared(keyName) as string | undefined
  if (lastUsedKey === undefined) {
    cacheService.setShared(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  cacheService.setShared(keyName, nextKey)

  return nextKey
}

/**
 * 处理特殊provider的转换逻辑
 */
function handleSpecialProviders(model: Model, provider: Provider): Provider {
  // if (provider.type === 'vertexai' && !isVertexProvider(provider)) {
  //   if (!isVertexAIConfigured()) {
  //     throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
  //   }
  //   return createVertexProvider(provider)
  // }

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
  return provider
}

/**
 * 格式化provider的API Host
 */
function formatAnthropicApiHost(host: string): string {
  const trimmedHost = host?.trim()

  if (!trimmedHost) {
    return ''
  }

  if (trimmedHost.endsWith('/')) {
    return trimmedHost
  }

  if (trimmedHost.endsWith('/v1')) {
    return `${trimmedHost}/`
  }

  return formatApiHost(trimmedHost)
}

function formatProviderApiHost(provider: Provider): Provider {
  const formatted = { ...provider }
  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatAnthropicApiHost(formatted.anthropicApiHost)
  }

  if (formatted.type === 'anthropic') {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    formatted.apiHost = formatAnthropicApiHost(baseHost)
    if (!formatted.anthropicApiHost) {
      formatted.anthropicApiHost = formatted.apiHost
    }
  } else if (formatted.id === 'copilot') {
    const trimmed = trim(formatted.apiHost)
    formatted.apiHost = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  } else if (formatted.type === 'gemini') {
    formatted.apiHost = formatApiHost(formatted.apiHost, 'v1beta')
  } else {
    formatted.apiHost = formatApiHost(formatted.apiHost)
  }
  return formatted
}

/**
 * 获取实际的Provider配置
 * 简化版：将逻辑分解为小函数
 */
export function getActualProvider(model: Model): Provider {
  const baseProvider = getProviderByModel(model)

  // 按顺序处理各种转换
  let actualProvider = cloneDeep(baseProvider)
  actualProvider = handleSpecialProviders(model, actualProvider)
  actualProvider = formatProviderApiHost(actualProvider)

  return actualProvider
}

/**
 * 将 Provider 配置转换为新 AI SDK 格式
 * 简化版：利用新的别名映射系统
 */
export function providerToAiSdkConfig(
  actualProvider: Provider,
  model: Model
): {
  providerId: ProviderId | 'openai-compatible'
  options: ProviderSettingsMap[keyof ProviderSettingsMap]
} {
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)
  logger.debug('providerToAiSdkConfig', { aiSdkProviderId })

  // 构建基础配置
  const baseConfig = {
    baseURL: trim(actualProvider.apiHost),
    apiKey: getRotatedApiKey(actualProvider)
  }

  const isCopilotProvider = actualProvider.id === 'copilot'
  if (isCopilotProvider) {
    const storedHeaders = store.getState().copilot.defaultHeaders ?? {}
    const options = ProviderConfigFactory.fromProvider('github-copilot-openai-compatible', baseConfig, {
      headers: {
        ...COPILOT_DEFAULT_HEADERS,
        ...storedHeaders,
        ...actualProvider.extra_headers
      },
      name: actualProvider.id,
      includeUsage: true
    })

    return {
      providerId: 'github-copilot-openai-compatible',
      options
    }
  }

  // 处理OpenAI模式
  const extraOptions: any = {}
  if (actualProvider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(model)) {
    extraOptions.mode = 'responses'
  } else if (aiSdkProviderId === 'openai') {
    extraOptions.mode = 'chat'
  }

  // 添加额外headers
  if (actualProvider.extra_headers) {
    extraOptions.headers = actualProvider.extra_headers
    // copy from openaiBaseClient/openaiResponseApiClient
    if (aiSdkProviderId === 'openai') {
      extraOptions.headers = {
        ...extraOptions.headers,
        'HTTP-Referer': 'https://cherry-ai.com',
        'X-Title': 'Cherry Studio',
        'X-Api-Key': baseConfig.apiKey
      }
    }
  }
  // azure
  if (aiSdkProviderId === 'azure' || actualProvider.type === 'azure-openai') {
    extraOptions.apiVersion = actualProvider.apiVersion
    baseConfig.baseURL += '/openai'
    if (actualProvider.apiVersion === 'preview') {
      extraOptions.mode = 'responses'
    } else {
      extraOptions.mode = 'chat'
      extraOptions.useDeploymentBasedUrls = true
    }
  }

  // bedrock
  if (aiSdkProviderId === 'bedrock') {
    extraOptions.region = getAwsBedrockRegion()
    extraOptions.accessKeyId = getAwsBedrockAccessKeyId()
    extraOptions.secretAccessKey = getAwsBedrockSecretAccessKey()
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
    // extraOptions.headers = window.api.vertexAI.getAuthHeaders({
    //   projectId: project,
    //   serviceAccount: {
    //     privateKey: googleCredentials.privateKey,
    //     clientEmail: googleCredentials.clientEmail
    //   }
    // })
    if (baseConfig.baseURL.endsWith('/v1/')) {
      baseConfig.baseURL = baseConfig.baseURL.slice(0, -4)
    } else if (baseConfig.baseURL.endsWith('/v1')) {
      baseConfig.baseURL = baseConfig.baseURL.slice(0, -3)
    }

    if (baseConfig.baseURL && !baseConfig.baseURL.includes('publishers/google')) {
      baseConfig.baseURL = `${baseConfig.baseURL}/v1/projects/${project}/locations/${location}/publishers/google`
    }
  }

  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, baseConfig, extraOptions)
    return {
      providerId: aiSdkProviderId as ProviderId,
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
      includeUsage: true
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
            'anthropic-beta': 'oauth-2025-04-20',
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
