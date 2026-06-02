import OpenAI from '@cherrystudio/openai'
import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from '@cherrystudio/openai/resources'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { ENDPOINT_TYPE, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

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
  constructor(message: string) {
    super(message)
    this.name = 'ChatCompletionModelError'
  }
}

export type PrepareRequestResult =
  | { status: 'validation_error'; errors: string[] }
  | { status: 'model_error'; message: string }
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
  ): Promise<{ ok: false; message: string } | { ok: true; provider: Provider; modelId: string; client: OpenAI }> {
    let providerId: string
    let modelId: string
    try {
      const parsed = parseUniqueModelId(model as UniqueModelId)
      providerId = parsed.providerId
      modelId = parsed.modelId
    } catch {
      return { ok: false, message: `Invalid model format. Expected 'providerId::modelId', got: ${model}` }
    }

    const provider = await providerService.getByProviderId(providerId).catch(() => null)
    if (!provider) {
      return { ok: false, message: `Provider '${providerId}' not found or not enabled` }
    }

    const apiKey = await providerService.getRotatedApiKey(provider.id)
    // OpenAI-compatible chat-completions route — pick by key, not Object.values()[0].
    // Mixed providers (aihubmix, new-api, cherryin) ship multiple endpoint keys;
    // the previous code could hand an Anthropic baseURL to an OpenAI client.
    const endpointConfig = provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    const baseURL = endpointConfig?.baseUrl || undefined

    const client = new OpenAI({
      ...(baseURL ? { baseURL } : {}),
      apiKey
    })

    return { ok: true, provider, modelId, client }
  }

  async prepareRequest(request: ChatCompletionCreateParams, stream: boolean): Promise<PrepareRequestResult> {
    const requestValidation = this.validateRequest(request)
    if (!requestValidation.isValid) {
      return {
        status: 'validation_error',
        errors: requestValidation.errors
      }
    }

    const providerContext = await this.resolveProviderContext(request.model)
    if (!providerContext.ok) {
      return {
        status: 'model_error',
        message: providerContext.message
      }
    }

    const { provider, modelId, client } = providerContext

    logger.debug('Model validation successful', {
      provider: provider.id,
      authType: provider.authType,
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

    // Only validate minimal structure required for routing.
    // Detailed message validation is delegated to the upstream provider.
    if (!request.messages) {
      errors.push('Messages array is required')
    } else if (!Array.isArray(request.messages)) {
      errors.push('Messages must be an array')
    } else if (request.messages.length === 0) {
      errors.push('Messages array cannot be empty')
    }

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
        throw new ChatCompletionModelError(preparation.message)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending request to provider', { provider: provider.id, model: modelId })

      const response = (await client.chat.completions.create(providerRequest)) as OpenAI.Chat.Completions.ChatCompletion

      logger.info('Chat completion processed', { modelId, provider: provider.id })
      return {
        provider,
        modelId,
        response
      }
    } catch (error) {
      logger.error('Error processing chat completion', error as Error, { model: request.model })
      throw error
    }
  }

  async processStreamingCompletion(
    request: ChatCompletionCreateParams,
    signal?: AbortSignal
  ): Promise<{
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
        throw new ChatCompletionModelError(preparation.message)
      }

      const { provider, modelId, client, providerRequest } = preparation

      logger.debug('Sending streaming request to provider', { provider: provider.id, model: modelId })

      const streamRequest = providerRequest as ChatCompletionCreateParamsStreaming
      // `signal` lets the route abort the upstream stream when the HTTP
      // client disconnects mid-response so we don't keep consuming (and
      // billing for) provider tokens.
      const stream = (await client.chat.completions.create(streamRequest, {
        signal
      })) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

      logger.info('Streaming chat completion started', {
        modelId,
        provider: provider.id
      })
      return {
        provider,
        modelId,
        stream
      }
    } catch (error) {
      logger.error('Error processing streaming chat completion', error as Error, { model: request.model })
      throw error
    }
  }
}

// Export singleton instance
export const chatCompletionService = new ChatCompletionService()
