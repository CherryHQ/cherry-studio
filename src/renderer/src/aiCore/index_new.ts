/**
 * Cherry Studio AI Core - 新版本入口
 * 集成 @cherrystudio/ai-core 库的渐进式重构方案
 *
 * 融合方案：简化实现，专注于核心功能
 * 1. 优先使用新AI SDK
 * 2. 失败时fallback到原有实现
 * 3. 暂时保持接口兼容性
 */

import {
  AiClient,
  createClient,
  ProviderConfigFactory,
  type ProviderId,
  type ProviderSettingsMap,
  smoothStream,
  StreamTextParams
} from '@cherrystudio/ai-core'
import { isDedicatedImageGenerationModel } from '@renderer/config/models'
import { createVertexProvider, isVertexAIConfigured, isVertexProvider } from '@renderer/hooks/useVertexAI'
import type { GenerateImageParams, Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { cloneDeep } from 'lodash'

import AiSdkToChunkAdapter from './AiSdkToChunkAdapter'
import LegacyAiProvider from './index'
import { AiSdkMiddlewareConfig, buildAiSdkMiddlewares } from './middleware/aisdk/AiSdkMiddlewareBuilder'
import { CompletionsResult } from './middleware/schemas'
import { getAiSdkProviderId } from './provider/factory'

/**
 * 将 Provider 配置转换为新 AI SDK 格式
 */
function providerToAiSdkConfig(provider: Provider): {
  providerId: ProviderId | 'openai-compatible'
  options: ProviderSettingsMap[keyof ProviderSettingsMap]
} {
  // 如果是 vertexai 类型且没有 googleCredentials，转换为 VertexProvider
  let actualProvider = cloneDeep(provider)
  if (provider.type === 'vertexai' && !isVertexProvider(provider)) {
    if (!isVertexAIConfigured()) {
      throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
    }
    actualProvider = createVertexProvider(provider)
  }

  if (actualProvider.type === 'openai' || actualProvider.type === 'anthropic') {
    actualProvider.apiHost = formatApiHost(actualProvider.apiHost)
  }

  const aiSdkProviderId = getAiSdkProviderId(actualProvider)

  if (aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, {
      ...actualProvider,
      baseURL: actualProvider.apiHost
    })

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
function isModernSdkSupported(provider: Provider, model?: Model): boolean {
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

  // 检查是否为图像生成模型（暂时不支持）
  if (model && isDedicatedImageGenerationModel(model)) {
    return false
  }

  return true
}

export default class ModernAiProvider {
  private modernClient?: AiClient
  private legacyProvider: LegacyAiProvider
  private provider: Provider

  constructor(provider: Provider) {
    this.provider = provider
    this.legacyProvider = new LegacyAiProvider(provider)

    // 初始化时不构建中间件，等到需要时再构建
    const config = providerToAiSdkConfig(provider)
    this.modernClient = createClient(config.providerId, config.options)
  }

  public async completions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiSdkMiddlewareConfig
  ): Promise<CompletionsResult> {
    // const model = params.assistant.model

    // 检查是否应该使用现代化客户端
    // if (this.modernClient && model && isModernSdkSupported(this.provider, model)) {
    // try {
    console.log('completions', modelId, params, middlewareConfig)
    return await this.modernCompletions(modelId, params, middlewareConfig)
    // } catch (error) {
    // console.warn('Modern client failed, falling back to legacy:', error)
    // fallback到原有实现
    // }
    // }

    // 使用原有实现
    // return this.legacyProvider.completions(params, options)
  }

  /**
   * 使用现代化AI SDK的completions实现
   * 使用建造者模式动态构建中间件
   */
  private async modernCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiSdkMiddlewareConfig
  ): Promise<CompletionsResult> {
    if (!this.modernClient) {
      throw new Error('Modern AI SDK client not initialized')
    }

    try {
      // 合并传入的配置和实例配置
      const finalConfig: AiSdkMiddlewareConfig = {
        ...middlewareConfig,
        provider: this.provider,
        // 工具相关信息从 params 中获取
        enableTool: !!Object.keys(params.tools || {}).length
      }

      // 动态构建中间件数组
      const middlewares = buildAiSdkMiddlewares(finalConfig)
      console.log(
        '构建的中间件:',
        middlewares.map((m) => m.name)
      )

      // 创建带有中间件的客户端
      const config = providerToAiSdkConfig(this.provider)
      const clientWithMiddlewares = createClient(config.providerId, config.options, middlewares)

      if (middlewareConfig.onChunk) {
        // 流式处理 - 使用适配器
        const adapter = new AiSdkToChunkAdapter(middlewareConfig.onChunk)
        const streamResult = await clientWithMiddlewares.streamText(modelId, {
          ...params,
          experimental_transform: smoothStream({
            delayInMs: 80,
            // 中文3个字符一个chunk,英文一个单词一个chunk
            chunking: /([\u4E00-\u9FFF]{3})|\S+\s+/
          })
        })
        const finalText = await adapter.processStream(streamResult)

        return {
          getText: () => finalText
        }
      } else {
        // 流式处理但没有 onChunk 回调
        const streamResult = await clientWithMiddlewares.streamText(modelId, params)
        const finalText = await streamResult.text

        return {
          getText: () => finalText
        }
      }
    } catch (error) {
      console.error('Modern AI SDK error:', error)
      throw error
    }
  }

  // 代理其他方法到原有实现
  public async models() {
    return this.legacyProvider.models()
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.legacyProvider.getEmbeddingDimensions(model)
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.legacyProvider.generateImage(params)
  }

  public getBaseURL(): string {
    return this.legacyProvider.getBaseURL()
  }

  public getApiKey(): string {
    return this.legacyProvider.getApiKey()
  }
}

// 为了方便调试，导出一些工具函数
export { isModernSdkSupported, providerToAiSdkConfig }
