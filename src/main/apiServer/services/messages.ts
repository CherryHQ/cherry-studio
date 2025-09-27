import Anthropic from '@anthropic-ai/sdk'
import { Message, MessageCreateParams, RawMessageStreamEvent } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import anthropicService from '@main/services/AnthropicService'
import { buildClaudeCodeSystemMessage, getSdkClient } from '@shared/anthropic'
import { Provider } from '@types'

const logger = loggerService.withContext('MessagesService')

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class MessagesService {
  // oxlint-disable-next-line no-unused-vars
  validateRequest(request: MessageCreateParams): ValidationResult {
    // TODO: Implement comprehensive request validation
    const errors: string[] = []

    if (!request.model) {
      errors.push('Model is required')
    }

    if (!request.max_tokens || request.max_tokens < 1) {
      errors.push('max_tokens is required and must be at least 1')
    }

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      errors.push('messages is required and must be a non-empty array')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async getClient(provider: Provider): Promise<Anthropic> {
    // Create Anthropic client for the provider
    if (provider.authType === 'oauth') {
      const oauthToken = await anthropicService.getValidAccessToken()
      return getSdkClient(provider, oauthToken)
    }
    return getSdkClient(provider)
  }

  async processMessage(request: MessageCreateParams, provider: Provider): Promise<Message> {
    logger.debug('Preparing Anthropic message request', {
      model: request.model,
      messageCount: request.messages.length,
      stream: request.stream,
      maxTokens: request.max_tokens,
      provider: provider.id
    })

    // Create Anthropic client for the provider
    const client = await this.getClient(provider)

    // Prepare request with the actual model ID
    const anthropicRequest: MessageCreateParams = {
      ...request,
      stream: false
    }

    if (provider.authType === 'oauth') {
      anthropicRequest.system = buildClaudeCodeSystemMessage(request.system || '')
    }

    const response = await client.messages.create(anthropicRequest)

    logger.info('Anthropic message completed', {
      model: request.model,
      provider: provider.id
    })
    return response
  }

  async *processStreamingMessage(
    request: MessageCreateParams,
    provider: Provider
  ): AsyncIterable<RawMessageStreamEvent> {
    logger.debug('Preparing streaming Anthropic message request', {
      model: request.model,
      messageCount: request.messages.length,
      provider: provider.id
    })

    // Create Anthropic client for the provider
    const client = await this.getClient(provider)

    // Prepare streaming request
    const streamingRequest: MessageCreateParams = {
      ...request,
      stream: true
    }

    if (provider.authType === 'oauth') {
      streamingRequest.system = buildClaudeCodeSystemMessage(request.system || '')
    }

    const stream = client.messages.stream(streamingRequest)

    for await (const chunk of stream) {
      yield chunk
    }

    logger.info('Completed streaming Anthropic message', {
      model: request.model,
      provider: provider.id
    })
  }
}

// Export singleton instance
export const messagesService = new MessagesService()
