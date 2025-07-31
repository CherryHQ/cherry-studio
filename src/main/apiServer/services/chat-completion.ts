import OpenAI from 'openai'
import { ChatCompletionCreateParams } from 'openai/resources'

import { loggerService } from '../../services/LoggerService'
import {
  getProviderByModel,
  getRealProviderModel,
  listAllAvailableModels,
  OpenAICompatibleModel,
  transformModelToOpenAI,
  validateProvider
} from '../utils'

const logger = loggerService.withContext('ChatCompletionService')

export interface ModelData extends OpenAICompatibleModel {
  provider_id: string
  model_id: string
  name: string
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class ChatCompletionService {
  async getModels(): Promise<ModelData[]> {
    try {
      logger.info('Getting available models from providers')

      const models = await listAllAvailableModels()

      const modelData: ModelData[] = models.map((model) => {
        const openAIModel = transformModelToOpenAI(model)
        return {
          ...openAIModel,
          provider_id: model.provider,
          model_id: model.id,
          name: model.name
        }
      })

      logger.info(`Successfully retrieved ${modelData.length} models`)
      return modelData
    } catch (error: any) {
      logger.error('Error getting models:', error)
      return []
    }
  }

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
    if (request.temperature !== undefined) {
      if (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2) {
        errors.push('Temperature must be a number between 0 and 2')
      }
    }

    if (request.max_tokens !== undefined) {
      if (typeof request.max_tokens !== 'number' || request.max_tokens < 1) {
        errors.push('max_tokens must be a positive number')
      }
    }

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
