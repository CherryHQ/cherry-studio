import { loggerService } from '@logger'
import { isSupportedModel } from '@renderer/config/models'
import { Model, Provider } from '@renderer/types'
import { NewApiModel } from '@renderer/types/sdk'

import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { MixedBaseAPIClient } from './MixedBaseApiClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'

const logger = loggerService.withContext('NewAPIClient')

export class NewAPIClient extends MixedBaseAPIClient {
  // 使用联合类型而不是any，保持类型安全
  protected clients: Map<string, AnthropicAPIClient | GeminiAPIClient | OpenAIResponseAPIClient | OpenAIAPIClient> =
    new Map()
  protected defaultClient: OpenAIAPIClient
  protected currentClient: BaseApiClient

  constructor(provider: Provider) {
    super(provider)

    const claudeClient = new AnthropicAPIClient(provider)
    const geminiClient = new GeminiAPIClient(provider)
    const openaiClient = new OpenAIAPIClient(provider)
    const openaiResponseClient = new OpenAIResponseAPIClient(provider)

    this.clients.set('claude', claudeClient)
    this.clients.set('gemini', geminiClient)
    this.clients.set('openai', openaiClient)
    this.clients.set('openai-response', openaiResponseClient)

    // 设置默认client
    this.defaultClient = openaiClient
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
    if (!model.endpoint_type) {
      throw new Error('Model endpoint type is not defined')
    }

    if (model.endpoint_type === 'anthropic') {
      const client = this.clients.get('claude')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get claude client')
      }
      return client
    }

    if (model.endpoint_type === 'openai-response') {
      const client = this.clients.get('openai-response')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get openai-response client')
      }
      return client
    }

    if (model.endpoint_type === 'gemini') {
      const client = this.clients.get('gemini')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get gemini client')
      }
      return client
    }

    if (model.endpoint_type === 'openai' || model.endpoint_type === 'image-generation') {
      const client = this.clients.get('openai')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get openai client')
      }
      return client
    }

    throw new Error('Invalid model endpoint type: ' + model.endpoint_type)
  }

  override async listModels(): Promise<NewApiModel[]> {
    try {
      const sdk = await this.defaultClient.getSdkInstance()
      // Explicitly type the expected response shape so that `data` is recognised.
      const response = await sdk.request<{ data: NewApiModel[] }>({
        method: 'get',
        path: '/models'
      })
      const models: NewApiModel[] = response.data ?? []

      models.forEach((model) => {
        model.id = model.id.trim()
      })

      return models.filter(isSupportedModel)
    } catch (error) {
      logger.error('Error listing models:', error as Error)
      return []
    }
  }
}
