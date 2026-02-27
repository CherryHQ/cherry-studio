/**
 * 模型解析器 - models模块的核心
 * 负责将modelId解析为AI SDK的LanguageModel实例
 *
 * 支持两种格式:
 * 1. 传统格式: 'gpt-4' (直接使用当前provider)
 * 2. 命名空间格式: 'hub|provider|model' (HubProvider内部路由)
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'

export class ModelResolver {
  private provider: ProviderV3

  /**
   * 构造函数接受provider实例
   * Provider可以是普通provider或HubProvider
   */
  constructor(provider: ProviderV3) {
    this.provider = provider
  }

  /**
   * 解析语言模型
   *
   * @param modelId 模型ID，支持传统格式('gpt-4')或命名空间格式('hub|provider|model')
   * @returns 解析后的语言模型实例
   *
   * @example
   * ```typescript
   * // 传统格式
   * const model = await resolver.resolveLanguageModel('gpt-4')
   *
   * // 命名空间格式 (需要HubProvider)
   * const model = await resolver.resolveLanguageModel('hub|openai|gpt-4')
   * ```
   */
  async resolveLanguageModel(modelId: string): Promise<LanguageModelV3> {
    return this.provider.languageModel(modelId)
  }

  /**
   * 解析文本嵌入模型
   *
   * @param modelId 模型ID
   * @returns 解析后的嵌入模型实例
   */
  async resolveEmbeddingModel(modelId: string): Promise<EmbeddingModelV3> {
    return this.provider.embeddingModel(modelId)
  }

  /**
   * 解析图像生成模型
   *
   * @param modelId 模型ID
   * @returns 解析后的图像模型实例
   */
  async resolveImageModel(modelId: string): Promise<ImageModelV3> {
    return this.provider.imageModel(modelId)
  }
}
