import OpenAI from '@cherrystudio/openai'
import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from '@cherrystudio/openai/resources'
import { loggerService } from '@logger'
import type { Provider } from '@types'

import { type ModelValidationError, validateModelId } from '../utils'

const logger = loggerService.withContext('ChatCompletionService')

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class ChatCompletionValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Request validation failed: ${errors.join('; ')}`)
    this.name = 'ChatCompletionValidationError'
  }
}

export class ChatCompletionModelError extends Error {
  constructor(public readonly error: ModelValidationError) {
    super(`Model validation failed: ${error.message}`)
    this.name = 'ChatCompletionModelError'
  }
}

export type PrepareRequestResult =
  | { status: 'validation_error'; errors: string[] }
  | { status: 'model_error'; error: ModelValidationError }
  | {
      status: 'ok'
      provider: Provider
      modelId: string
      client: OpenAI
      providerRequest: ChatCompletionCreateParams
    }

export class ChatCompletionService {
  async resolveProviderContext(
    model: string
  ): Promise<
    { ok: false; error: ModelValidationError } | { ok: true; provider: Provider; modelId: string; client: OpenAI }
  > {
    const modelValidation = await validateModelId(model)
    if (!modelValidation.valid) {
      return {
        ok: false,
        error: modelValidation.error!
      }
    }

    const provider = modelValidation.provider!

    if (provider.type !== 'openai') {
      return {
        ok: false,
        error: {
          type: 'unsupported_provider_type',
          message: `Provider '${provider.id}' of type '${provider.type}' is not supported for OpenAI chat completions`,
          code: 'unsupported_provider_type'
        }
      }
    }

    const modelId = modelValidation.modelId!

    const client = new OpenAI({
      baseURL: provider.apiHost,
      apiKey: provider.apiKey
    })

    return {
      ok: true,
      provider,
      modelId,
      client
    }
  }

  async prepareRequest(request: ChatCompletionCreateParams, stream: boolean): Promise<PrepareRequestResult> {
    const requestValidation = this.validateRequest(request)
    if (!requestValidation.isValid) {
      return {
        status: 'validation_error',
        errors: requestValidation.errors
      }
    }

    const providerContext = await this.resolveProviderContext(request.model!)
    if (!providerContext.ok) {
      return {
        status: 'model_error',
        error: providerContext.error
      }
    }

    const { provider, modelId, client } = providerContext

    logger.debug('Model validation successful', {
      provider: provider.id,
      providerType: provider.type,
      modelId,
      fullModelId: request.model
    })

    return {
      status: 'ok',
      provider,
      modelId,
      client,
      providerRequest: stream
        ? {
            ...request,
            model: modelId,
            stream: true as const
          }
        : {
            ...request,
            model: modelId,
            stream: false as const
          }
    }
  }

  validateRequest(request: ChatCompletionCreateParams): ValidationResult {
    const errors: string[] = []

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

  async processCompletion(request: ChatCompletionCreateParams): Promise<{
    provider: Provider
    modelId: string
    response: OpenAI.Chat.Completions.ChatCompletion
  }> {
    try {
      logger.debug('Processing chat completion request', {
        model: request.model,
        messageCount: request.messages.length,
        stream: request.stream
      })

      const preparation = await this.prepareRequest(request, false)
      if (preparation.status === 'validation_error') {
        throw new ChatCompletionValidationError(preparation.errors)
      }

      if (preparation.status === 'model_error') {
        throw new ChatCompletionModelError(preparation.error)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending request to provider', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const response = (await client.chat.completions.create(providerRequest)) as OpenAI.Chat.Completions.ChatCompletion

      logger.info('Chat completion processed', {
        modelId,
        provider: provider.id
      })
      return {
        provider,
        modelId,
        response
      }
    } catch (error: any) {
      logger.error('Error processing chat completion', {
        error,
        model: request.model
      })
      throw error
    }
  }

  async processStreamingCompletion(request: ChatCompletionCreateParams): Promise<{
    provider: Provider
    modelId: string
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  }> {
    try {
      logger.debug('Processing streaming chat completion request', {
        model: request.model,
        messageCount: request.messages.length
      })

      const preparation = await this.prepareRequest(request, true)
      if (preparation.status === 'validation_error') {
        throw new ChatCompletionValidationError(preparation.errors)
      }

      if (preparation.status === 'model_error') {
        throw new ChatCompletionModelError(preparation.error)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending streaming request to provider', {
        provider: provider.id,
        model: modelId,
        apiHost: provider.apiHost
      })

      const streamRequest = providerRequest as ChatCompletionCreateParamsStreaming
      const stream = (await client.chat.completions.create(
        streamRequest
      )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      logger.info('Streaming chat completion started', {
        modelId,
        provider: provider.id
      })
      return {
        provider,
        modelId,
        stream
      }
    } catch (error: any) {
      logger.error('Error processing streaming chat completion', {
        error,
        model: request.model
      })
      throw error
    }
  }
}

// Export singleton instance
export const chatCompletionService = new ChatCompletionService()
