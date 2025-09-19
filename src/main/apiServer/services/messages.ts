import Anthropic from '@anthropic-ai/sdk'
import { Message, MessageCreateParams, RawMessageStreamEvent } from '@anthropic-ai/sdk/resources'
import { Provider } from '@types'

import { loggerService } from '../../services/LoggerService'

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

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async processMessage(request: MessageCreateParams, provider: Provider): Promise<Message> {
    try {
      logger.info('Processing Anthropic message request:', {
        model: request.model,
        messageCount: request.messages.length,
        stream: request.stream,
        max_tokens: request.max_tokens
      })

      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.isValid) {
        throw new Error(`Request validation failed: ${validation.errors.join(', ')}`)
      }

      // Create Anthropic client for the provider
      const client = new Anthropic({
        baseURL: provider.apiHost,
        apiKey: provider.apiKey
      })

      // Prepare request with the actual model ID
      const anthropicRequest: MessageCreateParams = {
        ...request,
        stream: false
      }

      logger.debug('Sending request to Anthropic provider:', {
        provider: provider.id,
        apiHost: provider.apiHost
      })

      const response = await client.messages.create(anthropicRequest)

      logger.info('Successfully processed Anthropic message')
      return response
    } catch (error: any) {
      logger.error('Error processing Anthropic message:', error)
      throw error
    }
  }

  async *processStreamingMessage(
    request: MessageCreateParams,
    provider: Provider
  ): AsyncIterable<RawMessageStreamEvent> {
    try {
      logger.info('Processing streaming Anthropic message request:', {
        model: request.model,
        messageCount: request.messages.length
      })

      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.isValid) {
        throw new Error(`Request validation failed: ${validation.errors.join(', ')}`)
      }

      // Create Anthropic client for the provider
      const client = new Anthropic({
        baseURL: provider.apiHost,
        apiKey: provider.apiKey
      })

      // Prepare streaming request
      const streamingRequest: MessageCreateParams = {
        ...request,
        stream: true
      }

      logger.debug('Sending streaming request to Anthropic provider:', {
        provider: provider.id,
        apiHost: provider.apiHost
      })

      const stream = client.messages.stream(streamingRequest)

      for await (const chunk of stream) {
        yield chunk
      }

      logger.info('Successfully completed streaming Anthropic message')
    } catch (error: any) {
      logger.error('Error processing streaming Anthropic message:', error)
      throw error
    }
  }
}

// Export singleton instance
export const messagesService = new MessagesService()
