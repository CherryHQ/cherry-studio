import OpenAI from 'openai'
import { ChatCompletionCreateParams } from 'openai/resources'

import { loggerService } from '../../services/LoggerService'
import { getProviderByModel, getRealProviderModel, validateProvider } from '../utils'

const logger = loggerService.withContext('ChatCompletionService')

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class ChatCompletionService {
  validateRequest(request: ChatCompletionCreateParams): ValidationResult {
    const errors: string[] = []

    // Validate model
    if (!request.model) {
      errors.push('Model is required')
    } else if (typeof request.model !== 'string') {
      errors.push('Model must be a string')
    } else if (!request.model.includes(':')) {
      errors.push('Model must be in format "provider:model_id"')
    }

    // Validate messages
    if (!request.messages) {
      errors.push('Messages array is required')
    } else if (!Array.isArray(request.messages)) {
      errors.push('Messages must be an array')
    } else if (request.messages.length === 0) {
      errors.push('Messages array cannot be empty')
    } else {
      // Validate each message
      request.messages.forEach((message, index) => {
        if (!message.role) {
          errors.push(`Message ${index}: role is required`)
        }
        if (!message.content) {
          errors.push(`Message ${index}: content is required`)
        }
      })
    }

    // Validate optional parameters

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async processCompletion(request: ChatCompletionCreateParams): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    try {
      logger.info('Processing chat completion request:', {
        model: request.model,
        messageCount: request.messages.length,
        stream: request.stream
      })

      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.isValid) {
        throw new Error(`Request validation failed: ${validation.errors.join(', ')}`)
      }

      // Get provider for the model
      const provider = await getProviderByModel(request.model!)
      if (!provider) {
        throw new Error(`Provider not found for model: ${request.model}`)
      }

      // Validate provider
      if (!validateProvider(provider)) {
        throw new Error(`Provider validation failed for: ${provider.id}`)
      }

      // Extract model ID from the full model string
      const modelId = getRealProviderModel(request.model)

      // Create OpenAI client for the provider
      const client = new OpenAI({
        baseURL: provider.apiHost,
        apiKey: provider.apiKey
      })

      // Prepare request with the actual model ID
      const providerRequest = {
        ...request,
        model: modelId,
        stream: false
      }

      logger.debug('Sending request to provider:', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const response = (await client.chat.completions.create(providerRequest)) as OpenAI.Chat.Completions.ChatCompletion

      logger.info('Successfully processed chat completion')
      return response
    } catch (error: any) {
      logger.error('Error processing chat completion:', error)
      throw error
    }
  }

  async *processStreamingCompletion(
    request: ChatCompletionCreateParams
  ): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
    try {
      logger.info('Processing streaming chat completion request:', {
        model: request.model,
        messageCount: request.messages.length
      })

      // Validate request
      const validation = this.validateRequest(request)
      if (!validation.isValid) {
        throw new Error(`Request validation failed: ${validation.errors.join(', ')}`)
      }

      // Get provider for the model
      const provider = await getProviderByModel(request.model!)
      if (!provider) {
        throw new Error(`Provider not found for model: ${request.model}`)
      }

      // Validate provider
      if (!validateProvider(provider)) {
        throw new Error(`Provider validation failed for: ${provider.id}`)
      }

      // Extract model ID from the full model string
      const modelId = getRealProviderModel(request.model)

      // Create OpenAI client for the provider
      const client = new OpenAI({
        baseURL: provider.apiHost,
        apiKey: provider.apiKey
      })

      // Prepare streaming request
      const streamingRequest = {
        ...request,
        model: modelId,
        stream: true as const
      }

      logger.debug('Sending streaming request to provider:', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const stream = await client.chat.completions.create(streamingRequest)

      for await (const chunk of stream) {
        yield chunk
      }

      logger.info('Successfully completed streaming chat completion')
    } catch (error: any) {
      logger.error('Error processing streaming chat completion:', error)
      throw error
    }
  }
}

// Export singleton instance
export const chatCompletionService = new ChatCompletionService()
