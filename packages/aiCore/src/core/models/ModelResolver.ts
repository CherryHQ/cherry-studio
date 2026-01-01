/**
 * 模型解析器 - models模块的核心
 * 负责将modelId解析为AI SDK的LanguageModel实例
 * 支持传统格式和命名空间格式
 * 集成了来自 ModelCreator 的特殊处理逻辑
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider'

import { wrapModelWithMiddlewares } from '../middleware/wrapper'
import { globalProviderStorage } from '../providers/core/ProviderExtension'
import { DEFAULT_SEPARATOR } from '../providers/features/HubProvider'

export class ModelResolver {
  /**
   * 从 globalProviderStorage 获取 provider
   * @param providerId - Provider explicit ID
   * @throws Error if provider not found
   */
  private getProvider(providerId: string) {
    const provider = globalProviderStorage.get(providerId)
    if (!provider) {
      throw new Error(
        `Provider "${providerId}" not found. Please ensure it has been initialized with extension.createProvider(settings, "${providerId}")`
      )
    }
    return provider
  }

  /**
   * 解析完整的模型ID (providerId:modelId 格式)
   * @returns { providerId, modelId }
   */
  private parseFullModelId(fullModelId: string): { providerId: string; modelId: string } {
    const parts = fullModelId.split(DEFAULT_SEPARATOR)
    if (parts.length < 2) {
      throw new Error(`Invalid model ID format: "${fullModelId}". Expected "providerId${DEFAULT_SEPARATOR}modelId"`)
    }
    // 支持多个分隔符的情况（如 hub:provider:model）
    const providerId = parts[0]
    const modelId = parts.slice(1).join(DEFAULT_SEPARATOR)
    return { providerId, modelId }
  }

  /**
   * 核心方法：解析任意格式的modelId为语言模型
   *
   * @param modelId 模型ID，支持 'gpt-4' 和 'anthropic>claude-3' 两种格式
   * @param fallbackProviderId 当modelId为传统格式时使用的providerId
   * @param providerOptions provider配置选项（用于OpenAI模式选择等）
   * @param middlewares 中间件数组，会应用到最终模型上
   */
  async resolveLanguageModel(
    modelId: string,
    fallbackProviderId: string,
    providerOptions?: any,
    middlewares?: LanguageModelV3Middleware[]
  ): Promise<LanguageModelV3> {
    let finalProviderId = fallbackProviderId
    let model: LanguageModelV3
    // 🎯 处理 OpenAI 模式选择逻辑 (从 ModelCreator 迁移)
    if ((fallbackProviderId === 'openai' || fallbackProviderId === 'azure') && providerOptions?.mode === 'chat') {
      finalProviderId = `${fallbackProviderId}-chat`
    }

    // 检查是否是命名空间格式
    if (modelId.includes(DEFAULT_SEPARATOR)) {
      model = this.resolveNamespacedModel(modelId)
    } else {
      // 传统格式：使用处理后的 providerId + modelId
      model = this.resolveTraditionalModel(finalProviderId, modelId)
    }

    // 🎯 应用中间件（如果有）
    if (middlewares && middlewares.length > 0) {
      model = wrapModelWithMiddlewares(model, middlewares)
    }

    return model
  }

  /**
   * 解析文本嵌入模型
   */
  async resolveTextEmbeddingModel(modelId: string, fallbackProviderId: string): Promise<EmbeddingModelV3> {
    if (modelId.includes(DEFAULT_SEPARATOR)) {
      return this.resolveNamespacedEmbeddingModel(modelId)
    }

    return this.resolveTraditionalEmbeddingModel(fallbackProviderId, modelId)
  }

  /**
   * 解析图像模型
   */
  async resolveImageModel(modelId: string, fallbackProviderId: string): Promise<ImageModelV3> {
    if (modelId.includes(DEFAULT_SEPARATOR)) {
      return this.resolveNamespacedImageModel(modelId)
    }

    return this.resolveTraditionalImageModel(fallbackProviderId, modelId)
  }

  /**
   * 解析命名空间格式的语言模型
   * aihubmix:anthropic:claude-3 -> 从 globalProviderStorage 获取 'aihubmix' provider，调用 languageModel('anthropic:claude-3')
   */
  private resolveNamespacedModel(fullModelId: string): LanguageModelV3 {
    const { providerId, modelId } = this.parseFullModelId(fullModelId)
    const provider = this.getProvider(providerId)
    return provider.languageModel(modelId)
  }

  /**
   * 解析传统格式的语言模型
   * providerId: 'openai', modelId: 'gpt-4' -> 从 globalProviderStorage 获取 'openai' provider，调用 languageModel('gpt-4')
   */
  private resolveTraditionalModel(providerId: string, modelId: string): LanguageModelV3 {
    const provider = this.getProvider(providerId)
    return provider.languageModel(modelId)
  }

  /**
   * 解析命名空间格式的嵌入模型
   */
  private resolveNamespacedEmbeddingModel(fullModelId: string): EmbeddingModelV3 {
    const { providerId, modelId } = this.parseFullModelId(fullModelId)
    const provider = this.getProvider(providerId)
    return provider.embeddingModel(modelId)
  }

  /**
   * 解析传统格式的嵌入模型
   */
  private resolveTraditionalEmbeddingModel(providerId: string, modelId: string): EmbeddingModelV3 {
    const provider = this.getProvider(providerId)
    return provider.embeddingModel(modelId)
  }

  /**
   * 解析命名空间格式的图像模型
   */
  private resolveNamespacedImageModel(fullModelId: string): ImageModelV3 {
    const { providerId, modelId } = this.parseFullModelId(fullModelId)
    const provider = this.getProvider(providerId)
    return provider.imageModel(modelId)
  }

  /**
   * 解析传统格式的图像模型
   */
  private resolveTraditionalImageModel(providerId: string, modelId: string): ImageModelV3 {
    const provider = this.getProvider(providerId)
    return provider.imageModel(modelId)
  }
}

/**
 * 全局模型解析器实例
 */
export const globalModelResolver = new ModelResolver()
