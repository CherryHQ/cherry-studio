/**
 * 模型解析器 - models模块的核心
 * 负责将modelId解析为AI SDK的LanguageModel实例
 * 支持传统格式和命名空间格式
 * 集成了来自 ModelCreator 的特殊处理逻辑
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'

import { DEFAULT_SEPARATOR, globalRegistryManagement } from '../providers/RegistryManagement'

export class ModelResolver {
  /**
   * 核心方法：解析任意格式的modelId为语言模型
   *
   * @param modelId 模型ID，支持 'gpt-4' 和 'anthropic>claude-3' 两种格式
   * @param fallbackProviderId 当modelId为传统格式时使用的providerId
   * @param providerOptions provider配置选项（用于OpenAI模式选择等）
   */
  async resolveLanguageModel(
    modelId: string,
    fallbackProviderId: string,
    providerOptions?: any
  ): Promise<LanguageModelV3> {
    let finalProviderId = fallbackProviderId

    // 🎯 处理 OpenAI 模式选择逻辑 (从 ModelCreator 迁移)
    if ((fallbackProviderId === 'openai' || fallbackProviderId === 'azure') && providerOptions?.mode === 'chat') {
      finalProviderId = `${fallbackProviderId}-chat`
    }

    // 检查是否是命名空间格式
    if (modelId.includes(DEFAULT_SEPARATOR)) {
      return this.resolveNamespacedModel(modelId)
    } else {
      // 传统格式：使用处理后的 providerId + modelId
      return this.resolveTraditionalModel(finalProviderId, modelId)
    }
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
   * aihubmix:anthropic:claude-3 -> globalRegistryManagement.languageModel('aihubmix:anthropic:claude-3')
   */
  private resolveNamespacedModel(modelId: string): LanguageModelV3 {
    return globalRegistryManagement.languageModel(modelId as any)
  }

  /**
   * 解析传统格式的语言模型
   * providerId: 'openai', modelId: 'gpt-4' -> globalRegistryManagement.languageModel('openai:gpt-4')
   */
  private resolveTraditionalModel(providerId: string, modelId: string): LanguageModelV3 {
    const fullModelId = `${providerId}${DEFAULT_SEPARATOR}${modelId}`
    return globalRegistryManagement.languageModel(fullModelId as any)
  }

  /**
   * 解析命名空间格式的嵌入模型
   */
  private resolveNamespacedEmbeddingModel(modelId: string): EmbeddingModelV3 {
    return globalRegistryManagement.embeddingModel(modelId as any)
  }

  /**
   * 解析传统格式的嵌入模型
   */
  private resolveTraditionalEmbeddingModel(providerId: string, modelId: string): EmbeddingModelV3 {
    const fullModelId = `${providerId}${DEFAULT_SEPARATOR}${modelId}`
    return globalRegistryManagement.embeddingModel(fullModelId as any)
  }

  /**
   * 解析命名空间格式的图像模型
   */
  private resolveNamespacedImageModel(modelId: string): ImageModelV3 {
    return globalRegistryManagement.imageModel(modelId as any)
  }

  /**
   * 解析传统格式的图像模型
   */
  private resolveTraditionalImageModel(providerId: string, modelId: string): ImageModelV3 {
    const fullModelId = `${providerId}${DEFAULT_SEPARATOR}${modelId}`
    return globalRegistryManagement.imageModel(fullModelId as any)
  }
}

/**
 * 全局模型解析器实例
 */
export const globalModelResolver = new ModelResolver()
