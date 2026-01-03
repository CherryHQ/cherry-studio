/**
 * 模型解析器 - models模块的核心
 * 负责将modelId解析为AI SDK的LanguageModel实例
 *
 * 支持两种格式:
 * 1. 传统格式: 'gpt-4' (直接使用当前provider)
 * 2. 命名空间格式: 'hub|provider|model' (HubProvider内部路由)
 */

import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
  LanguageModelV3Middleware,
  ProviderV3
} from '@ai-sdk/provider'

import { wrapModelWithMiddlewares } from '../middleware/wrapper'

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
   * @param middlewares 可选的中间件数组，会应用到最终模型上
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
  async resolveLanguageModel(modelId: string, middlewares?: LanguageModelV3Middleware[]): Promise<LanguageModelV3> {
    // 直接将完整的modelId传给provider
    // - 如果是普通provider，会直接使用modelId
    // - 如果是HubProvider，会解析命名空间并路由到正确的provider
    let model = this.provider.languageModel(modelId)

    // 应用中间件
    if (middlewares && middlewares.length > 0) {
      model = wrapModelWithMiddlewares(model, middlewares)
    }

    return model
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
