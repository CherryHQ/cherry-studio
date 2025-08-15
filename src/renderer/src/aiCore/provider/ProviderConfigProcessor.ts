import { AiCore, ProviderConfigFactory, type ProviderId, type ProviderSettingsMap } from '@cherrystudio/ai-core'
import { isDedicatedImageGenerationModel } from '@renderer/config/models'
import { createVertexProvider, isVertexAIConfigured, isVertexProvider } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { cloneDeep } from 'lodash'

import { createAihubmixProvider } from './aihubmix'
import { getAiSdkProviderId } from './factory'

export function getActualProvider(model: Model): Provider {
  const provider = getProviderByModel(model)
  // 如果是 vertexai 类型且没有 googleCredentials，转换为 VertexProvider
  let actualProvider = cloneDeep(provider)
  if (provider.type === 'vertexai' && !isVertexProvider(provider)) {
    if (!isVertexAIConfigured()) {
      throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
    }
    actualProvider = createVertexProvider(provider)
  }

  if (provider.id === 'aihubmix') {
    actualProvider = createAihubmixProvider(model, actualProvider)
  }
  if (actualProvider.type === 'gemini') {
    actualProvider.apiHost = formatApiHost(actualProvider.apiHost, 'v1beta')
  } else {
    actualProvider.apiHost = formatApiHost(actualProvider.apiHost)
  }
  return actualProvider
}

/**
 * 将 Provider 配置转换为新 AI SDK 格式
 */
export function providerToAiSdkConfig(actualProvider: Provider): {
  providerId: ProviderId | 'openai-compatible'
  options: ProviderSettingsMap[keyof ProviderSettingsMap]
} {
  // console.log('actualProvider', actualProvider)
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)
  // console.log('aiSdkProviderId', aiSdkProviderId)
  // 如果provider是openai，则使用strict模式并且默认responses api
  const actualProviderType = actualProvider.type
  const openaiResponseOptions =
    // 对于实际是openai的需要走responses,aiCore内部会判断model是否可用responses
    actualProviderType === 'openai-response'
      ? {
          mode: 'responses'
        }
      : aiSdkProviderId === 'openai'
        ? {
            mode: 'chat'
          }
        : undefined
  console.log('openaiResponseOptions', openaiResponseOptions)
  console.log('actualProvider', actualProvider)
  console.log('aiSdkProviderId', aiSdkProviderId)
  if (AiCore.isSupported(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(
      aiSdkProviderId,
      {
        baseURL: actualProvider.apiHost,
        apiKey: actualProvider.apiKey
      },
      { ...openaiResponseOptions, headers: actualProvider.extra_headers }
    )

    return {
      providerId: aiSdkProviderId as ProviderId,
      options
    }
  } else {
    console.log(`Using openai-compatible fallback for provider: ${actualProvider.type}`)
    const options = ProviderConfigFactory.createOpenAICompatible(actualProvider.apiHost, actualProvider.apiKey)

    return {
      providerId: 'openai-compatible',
      options: {
        ...options,
        name: actualProvider.id
      }
    }
  }
}

/**
 * 检查是否支持使用新的AI SDK
 */
export function isModernSdkSupported(provider: Provider, model?: Model): boolean {
  // 目前支持主要的providers
  const supportedProviders = ['openai', 'anthropic', 'gemini', 'azure-openai', 'vertexai']

  // 检查provider类型
  if (!supportedProviders.includes(provider.type)) {
    return false
  }

  // 对于 vertexai，检查配置是否完整
  if (provider.type === 'vertexai' && !isVertexAIConfigured()) {
    return false
  }

  // 图像生成模型现在支持新的 AI SDK
  // （但需要确保 provider 是支持的

  if (model && isDedicatedImageGenerationModel(model)) {
    return true
  }

  return true
}
