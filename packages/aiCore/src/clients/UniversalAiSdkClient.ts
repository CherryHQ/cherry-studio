/**
 * Universal AI SDK Client
 * 统一的AI SDK客户端实现
 *
 * ## 使用方式
 *
 * ### 1. 官方提供商
 * ```typescript
 * import { UniversalAiSdkClient } from '@cherrystudio/ai-core'
 *
 * // OpenAI
 * const openai = UniversalAiSdkClient.create('openai', {
 *   name: 'openai',
 *   apiHost: 'https://api.openai.com/v1',
 *   apiKey: process.env.OPENAI_API_KEY
 * })
 *
 * // Anthropic
 * const anthropic = UniversalAiSdkClient.create('anthropic', {
 *   name: 'anthropic',
 *   apiHost: 'https://api.anthropic.com',
 *   apiKey: process.env.ANTHROPIC_API_KEY
 * })
 * ```
 *
 * ### 2. OpenAI Compatible 第三方提供商
 * ```typescript
 * // LM Studio (本地运行)
 * const lmStudio = UniversalAiSdkClient.createOpenAICompatible({
 *   name: 'lm-studio',
 *   baseURL: 'http://localhost:1234/v1'
 * })
 *
 * // Ollama (本地运行)
 * const ollama = UniversalAiSdkClient.createOpenAICompatible({
 *   name: 'ollama',
 *   baseURL: 'http://localhost:11434/v1'
 * })
 *
 * // 自定义第三方 API
 * const customProvider = UniversalAiSdkClient.createOpenAICompatible({
 *   name: 'my-provider',
 *   apiKey: process.env.CUSTOM_API_KEY,
 *   baseURL: 'https://api.customprovider.com/v1',
 *   headers: {
 *     'X-Custom-Header': 'value',
 *     'User-Agent': 'MyApp/1.0'
 *   },
 *   queryParams: {
 *     'api-version': '2024-01'
 *   }
 * })
 * ```
 *
 * ### 3. 使用客户端进行 AI 调用
 * ```typescript
 * // 流式文本生成
 * const stream = await client.streamText('gpt-4', {
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * })
 *
 * // 生成文本
 * const { text } = await client.generateText('gpt-4', {
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * })
 *
 * // 生成结构化对象
 * const { object } = await client.generateObject('gpt-4', {
 *   messages: [{ role: 'user', content: 'Generate a user profile' }],
 *   schema: z.object({
 *     name: z.string(),
 *     age: z.number()
 *   })
 * })
 * ```
 */

import { experimental_generateImage as generateImage, generateObject, generateText, streamObject, streamText } from 'ai'

import { ApiClientFactory } from './ApiClientFactory'
import { type ProviderId, type ProviderSettingsMap } from './types'

/**
 * 通用 AI SDK 客户端
 * 为特定 AI 提供商创建的客户端实例
 */
export class UniversalAiSdkClient<T extends ProviderId = ProviderId> {
  constructor(
    private readonly providerId: T,
    private readonly options: ProviderSettingsMap[T]
  ) {}

  /**
   * 流式文本生成
   * 直接使用 AI SDK 的 streamText 参数类型
   */
  async streamText(modelId: string, params: Omit<Parameters<typeof streamText>[0], 'model'>) {
    const model = await ApiClientFactory.createClient(this.providerId, modelId, this.options)
    return await streamText({
      model,
      ...params
    })
  }

  /**
   * 生成文本
   * 直接使用 AI SDK 的 generateText 参数类型
   */
  async generateText(modelId: string, params: Omit<Parameters<typeof generateText>[0], 'model'>) {
    const model = await ApiClientFactory.createClient(this.providerId, modelId, this.options)
    return await generateText({
      model,
      ...params
    })
  }

  /**
   * 生成结构化对象
   * 直接使用 AI SDK 的 generateObject 参数类型
   */
  async generateObject(modelId: string, params: Omit<Parameters<typeof generateObject>[0], 'model'>) {
    const model = await ApiClientFactory.createClient(this.providerId, modelId, this.options)
    return await generateObject({
      model,
      ...params
    })
  }

  /**
   * 流式生成结构化对象
   * 直接使用 AI SDK 的 streamObject 参数类型
   */
  async streamObject(modelId: string, params: Omit<Parameters<typeof streamObject>[0], 'model'>) {
    const model = await ApiClientFactory.createClient(this.providerId, modelId, this.options)
    return await streamObject({
      model,
      ...params
    })
  }

  async generateImage(
    modelId: string,
    params: Omit<Parameters<typeof generateImage>[0], 'model'>
  ): Promise<ReturnType<typeof generateImage>> {
    const model = await ApiClientFactory.createImageClient(this.providerId, modelId, this.options)
    return generateImage({
      model,
      ...params
    })
  }

  /**
   * 获取客户端信息
   */
  getClientInfo() {
    return ApiClientFactory.getClientInfo(this.providerId)
  }

  // === 静态工厂方法 ===

  /**
   * 创建 OpenAI Compatible 客户端
   * 用于那些实现 OpenAI API 的第三方提供商
   */
  static createOpenAICompatible(
    config: ProviderSettingsMap['openai-compatible']
  ): UniversalAiSdkClient<'openai-compatible'> {
    return new UniversalAiSdkClient('openai-compatible', config)
  }

  /**
   * 创建标准提供商客户端
   * 对于已知的 Provider 使用严格类型检查，未知的 Provider 默认使用 openai-compatible
   */
  static create<T extends ProviderId>(providerId: T, options: ProviderSettingsMap[T]): UniversalAiSdkClient<T>

  static create(
    providerId: string,
    options: ProviderSettingsMap['openai-compatible']
  ): UniversalAiSdkClient<'openai-compatible'>

  static create(providerId: string, options: any): UniversalAiSdkClient {
    if (providerId in ({} as ProviderSettingsMap)) {
      return new UniversalAiSdkClient(providerId as ProviderId, options)
    } else {
      // 对于未知 provider，使用 openai-compatible
      return new UniversalAiSdkClient('openai-compatible', options)
    }
  }
}

/**
 * 创建客户端实例的工厂函数
 */
export function createUniversalClient<T extends ProviderId>(
  providerId: T,
  options: ProviderSettingsMap[T]
): UniversalAiSdkClient<T>

export function createUniversalClient(
  providerId: string,
  options: ProviderSettingsMap['openai-compatible']
): UniversalAiSdkClient<'openai-compatible'>

export function createUniversalClient(providerId: string, options: any): UniversalAiSdkClient {
  return UniversalAiSdkClient.create(providerId, options)
}

/**
 * 创建 OpenAI Compatible 客户端的便捷函数
 */
export function createOpenAICompatibleClient(
  config: ProviderSettingsMap['openai-compatible']
): UniversalAiSdkClient<'openai-compatible'> {
  return UniversalAiSdkClient.createOpenAICompatible(config)
}
