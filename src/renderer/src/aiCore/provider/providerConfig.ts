import { hasProviderConfig } from '@cherrystudio/ai-core/provider'
import { isOpenAIChatCompletionOnlyModel } from '@renderer/config/models'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockApiKey,
  getAwsBedrockAuthType,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import store from '@renderer/store'
import { isSystemProvider, type Model, type Provider } from '@renderer/types'
import {
  type AiSdkConfigContext,
  formatProviderApiHost as sharedFormatProviderApiHost,
  type ProviderFormatContext,
  providerToAiSdkConfig as sharedProviderToAiSdkConfig,
  resolveActualProvider
} from '@shared/provider'
import { cloneDeep } from 'lodash'

import type { AiSdkConfig } from '../types'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'

/**
 * Renderer-specific context for providerToAiSdkConfig
 * Provides implementations using browser APIs, store, and hooks
 */
function createRendererSdkContext(model: Model): AiSdkConfigContext {
  return {
    isOpenAIChatCompletionOnlyModel: () => isOpenAIChatCompletionOnlyModel(model),
    getCopilotDefaultHeaders: () => COPILOT_DEFAULT_HEADERS,
    getCopilotStoredHeaders: () => store.getState().copilot.defaultHeaders ?? {},
    getAwsBedrockConfig: () => {
      const authType = getAwsBedrockAuthType()
      return {
        authType,
        region: getAwsBedrockRegion(),
        apiKey: authType === 'apiKey' ? getAwsBedrockApiKey() : undefined,
        accessKeyId: authType === 'iam' ? getAwsBedrockAccessKeyId() : undefined,
        secretAccessKey: authType === 'iam' ? getAwsBedrockSecretAccessKey() : undefined
      }
    },
    getVertexConfig: (provider) => {
      if (!isVertexAIConfigured()) {
        return undefined
      }
      return createVertexProvider(provider as Provider)
    },
    getEndpointType: () => model.endpoint_type
  }
}

/**
 * 主要用来对齐AISdk的BaseURL格式
 * Uses shared implementation with renderer-specific context
 */
function getRendererFormatContext(): ProviderFormatContext {
  const vertexSettings = store.getState().llm.settings.vertexai
  return {
    vertex: {
      project: vertexSettings.projectId || 'default-project',
      location: vertexSettings.location || 'us-central1'
    }
  }
}

/**
 * Format and normalize the API host URL for a provider.
 * Handles provider-specific URL formatting rules (e.g., appending version paths, Azure formatting).
 *
 * @param provider - The provider whose API host is to be formatted.
 * @returns A new provider instance with the formatted API host.
 */
function formatProviderApiHost(provider: Provider): Provider {
  return sharedFormatProviderApiHost(provider, getRendererFormatContext())
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
    adaptedProvider = resolveActualProvider(adaptedProvider, model, {
      isSystemProvider
    })
  }
  adaptedProvider = formatProviderApiHost(adaptedProvider)

  return adaptedProvider
}

/**
 * 将 Provider 配置转换为新 AI SDK 格式
 * Uses shared implementation with renderer-specific context
 */
export function providerToAiSdkConfig(actualProvider: Provider, model: Model): AiSdkConfig {
  const context = createRendererSdkContext(model)
  return sharedProviderToAiSdkConfig(actualProvider, model.id, context) as AiSdkConfig
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
      config.options.fetch = async (url: RequestInfo | URL, options: RequestInit) => {
        // 在这里对最终参数进行签名
        const signature = await window.api.cherryai.generateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: JSON.parse(options.body as string)
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
