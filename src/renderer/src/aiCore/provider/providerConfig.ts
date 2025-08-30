import {
  hasProviderConfig,
  ProviderConfigFactory,
  type ProviderId,
  type ProviderSettingsMap
} from '@cherrystudio/ai-core/provider'
import { isOpenAIChatCompletionOnlyModel } from '@renderer/config/models'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured, isVertexProvider } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { loggerService } from '@renderer/services/LoggerService'
import store from '@renderer/store'
import type { Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { cloneDeep } from 'lodash'

import { aihubmixProviderCreator, newApiResolverCreator } from './config'
import { getAiSdkProviderId } from './factory'

const logger = loggerService.withContext('ProviderConfigProcessor')

/**
 * 处理特殊provider的转换逻辑
 */
function handleSpecialProviders(model: Model, provider: Provider): Provider {
  if (provider.type === 'vertexai' && !isVertexProvider(provider)) {
    if (!isVertexAIConfigured()) {
      throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
    }
    return createVertexProvider(provider)
  }

  if (provider.id === 'aihubmix') {
    return aihubmixProviderCreator(model, provider)
  }
  if (provider.id === 'newapi') {
    return newApiResolverCreator(model, provider)
  }
  return provider
}

/**
 * 格式化provider的API Host
 */
function formatProviderApiHost(provider: Provider): Provider {
  const formatted = { ...provider }
  if (formatted.type === 'gemini') {
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
    baseURL: actualProvider.apiHost,
    apiKey: actualProvider.apiKey
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
  }

  // copilot
  if (actualProvider.id === 'copilot') {
    extraOptions.headers = {
      ...extraOptions.extra_headers,
      'editor-version': 'vscode/1.97.2',
      'copilot-vision-request': 'true'
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

  // 如果AI SDK支持该provider，使用原生配置
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
      ...extraOptions
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
  if (provider.id === 'copilot') {
    const defaultHeaders = store.getState().copilot.defaultHeaders
    const { token } = await window.api.copilot.getToken(defaultHeaders)
    config.options.apiKey = token
  }
  return config
}
