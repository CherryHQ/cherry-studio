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
  AiCore,
  AiPlugin,
  createExecutor,
  ProviderConfigFactory,
  type ProviderId,
  type ProviderSettingsMap,
  StreamTextParams
} from '@cherrystudio/ai-core'
import { createMCPPromptPlugin } from '@cherrystudio/ai-core/core/plugins/built-in'
import { isDedicatedImageGenerationModel } from '@renderer/config/models'
import { createVertexProvider, isVertexAIConfigured, isVertexProvider } from '@renderer/hooks/useVertexAI'
import type { GenerateImageParams, Model, Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { cloneDeep } from 'lodash'

import AiSdkToChunkAdapter from './AiSdkToChunkAdapter'
import LegacyAiProvider from './index'
import { AiSdkMiddlewareConfig, buildAiSdkMiddlewares } from './middleware/aisdk/AiSdkMiddlewareBuilder'
import { CompletionsResult } from './middleware/schemas'
import reasoningTimePlugin from './plugins/reasoningTimePlugin'
import smoothReasoningPlugin from './plugins/smoothReasoningPlugin'
import textPlugin from './plugins/textPlugin'
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

  if (AiCore.isSupported(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    const options = ProviderConfigFactory.fromProvider(aiSdkProviderId, actualProvider)

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
  private legacyProvider: LegacyAiProvider
  private config: ReturnType<typeof providerToAiSdkConfig>

  constructor(provider: Provider) {
    this.legacyProvider = new LegacyAiProvider(provider)

    // 只保存配置，不预先创建executor
    this.config = providerToAiSdkConfig(provider)

    console.log('[Modern AI Provider] Creating executor with MCP Prompt plugin enabled')
  }

  /**
   * 根据条件构建插件数组
   */
  private buildPlugins(middlewareConfig: AiSdkMiddlewareConfig) {
    const plugins: AiPlugin[] = []
    // 1. 总是添加通用插件
    plugins.push(textPlugin)

    // 2. 推理模型时添加推理插件
    if (middlewareConfig.enableReasoning) {
      plugins.push(
        smoothReasoningPlugin({
          delayInMs: 80,
          chunkingRegex: /([\u4E00-\u9FFF]{3})|\S+\s+/
        }),
        reasoningTimePlugin
      )
    }

    // 3. 启用Prompt工具调用时添加工具插件
    if (middlewareConfig.enableTool && middlewareConfig.mcpTools && middlewareConfig.mcpTools.length > 0) {
      plugins.push(
        createMCPPromptPlugin({
          enabled: true,
          createSystemMessage: (systemPrompt, params, context) => {
            console.log('createSystemMessage_context', context.isRecursiveCall)
            if (context.modelId.includes('o1-mini') || context.modelId.includes('o1-preview')) {
              if (context.isRecursiveCall) {
                return null
              }
              params.messages = [
                {
                  role: 'assistant',
                  content: systemPrompt
                },
                ...params.messages
              ]
              return null
            }
            return systemPrompt
          }
        })
      )
    }

    console.log(
      '最终插件列表:',
      plugins.map((p) => p.name)
    )
    return plugins
  }

  public async completions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiSdkMiddlewareConfig
  ): Promise<CompletionsResult> {
    console.log('completions', modelId, params, middlewareConfig)
    return await this.modernCompletions(modelId, params, middlewareConfig)
  }

  /**
   * 使用现代化AI SDK的completions实现
   */
  private async modernCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiSdkMiddlewareConfig
  ): Promise<CompletionsResult> {
    // try {
    // 根据条件构建插件数组
    const plugins = this.buildPlugins(middlewareConfig)

    // 用构建好的插件数组创建executor
    const executor = createExecutor(this.config.providerId, this.config.options, plugins)

    // 动态构建中间件数组
    const middlewares = buildAiSdkMiddlewares(middlewareConfig)
    console.log('构建的中间件:', middlewares)

    // 创建带有中间件的执行器
    if (middlewareConfig.onChunk) {
      // 流式处理 - 使用适配器
      const adapter = new AiSdkToChunkAdapter(middlewareConfig.onChunk)

      const streamResult = await executor.streamText(
        modelId,
        params,
        middlewares.length > 0 ? { middlewares } : undefined
      )

      const finalText = await adapter.processStream(streamResult)

      return {
        getText: () => finalText
      }
    } else {
      // 流式处理但没有 onChunk 回调
      const streamResult = await executor.streamText(
        modelId,
        params,
        middlewares.length > 0 ? { middlewares } : undefined
      )
      const finalText = await streamResult.text

      return {
        getText: () => finalText
      }
    }
    // }
    // catch (error) {
    //   console.error('Modern AI SDK error:', error)
    //   throw error
    // }
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
