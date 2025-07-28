import { isOpenAILLMModel } from '@renderer/config/models'
import { Model, Provider } from '@renderer/types'

import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { MixedBaseAPIClient } from './MixedBaseApiClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'

/**
 * AihubmixAPIClient - 根据模型类型自动选择合适的ApiClient
 * 使用装饰器模式实现，在ApiClient层面进行模型路由
 */
export class AihubmixAPIClient extends MixedBaseAPIClient {
  // 使用联合类型而不是any，保持类型安全
  protected clients: Map<string, AnthropicAPIClient | GeminiAPIClient | OpenAIResponseAPIClient | OpenAIAPIClient> =
    new Map()
  protected defaultClient: OpenAIAPIClient
  protected currentClient: BaseApiClient

  constructor(provider: Provider) {
    super(provider)

    const providerExtraHeaders = {
      ...provider,
      extra_headers: {
        ...provider.extra_headers,
        'APP-Code': 'MLTG2087'
      }
    }

    // 初始化各个client - 现在有类型安全
    const claudeClient = new AnthropicAPIClient(providerExtraHeaders)
    const geminiClient = new GeminiAPIClient({ ...providerExtraHeaders, apiHost: 'https://aihubmix.com/gemini' })
    const openaiClient = new OpenAIResponseAPIClient(providerExtraHeaders)
    const defaultClient = new OpenAIAPIClient(providerExtraHeaders)

    this.clients.set('claude', claudeClient)
    this.clients.set('gemini', geminiClient)
    this.clients.set('openai', openaiClient)
    this.clients.set('default', defaultClient)

    // 设置默认client
    this.defaultClient = defaultClient
    this.currentClient = this.defaultClient as BaseApiClient
  }

  override getBaseURL(): string {
    if (!this.currentClient) {
      return this.provider.apiHost
    }
    return this.currentClient.getBaseURL()
  }

  /**
   * 根据模型获取合适的client
   */
  protected getClient(model: Model): BaseApiClient {
    const id = model.id.toLowerCase()

    // claude开头
    if (id.startsWith('claude')) {
      const client = this.clients.get('claude')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Claude client not properly initialized')
      }
      return client
    }

    // gemini开头 且不以-nothink、-search结尾
    if (
      (id.startsWith('gemini') || id.startsWith('imagen')) &&
      !id.endsWith('-nothink') &&
      !id.endsWith('-search') &&
      !id.includes('embedding')
    ) {
      const client = this.clients.get('gemini')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Gemini client not properly initialized')
      }
      return client
    }

    // OpenAI系列模型
    if (isOpenAILLMModel(model)) {
      const client = this.clients.get('openai')
      if (!client || !this.isValidClient(client)) {
        throw new Error('OpenAI client not properly initialized')
      }
      return client
    }

    return this.defaultClient as BaseApiClient
  }
}
