import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParams, MessageStreamEvent } from '@anthropic-ai/sdk/resources'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { anthropicService } from '@main/services/AnthropicService'
import { buildClaudeCodeSystemMessage } from '@shared/anthropic'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { Response } from 'express'

const logger = loggerService.withContext('MessagesService')
const EXCLUDED_FORWARD_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'x-api-key',
  'authorization',
  'sentry-trace',
  'baggage',
  'content-length',
  'connection'
])

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export interface ErrorResponse {
  type: 'error'
  error: {
    type: string
    message: string
    requestId?: string
  }
}

export interface StreamConfig {
  response: Response
  onChunk?: (chunk: MessageStreamEvent) => void
  onError?: (error: any) => void
  onComplete?: () => void
}

export interface ProcessMessageOptions {
  provider: Provider
  request: MessageCreateParams
  extraHeaders?: Record<string, string | string[]>
  modelId?: string
}

export interface ProcessMessageResult {
  client: Anthropic
  anthropicRequest: MessageCreateParams
}

export class MessagesService {
  validateRequest(request: MessageCreateParams): ValidationResult {
    // TODO: Implement comprehensive request validation
    const errors: string[] = []

    if (!request.model || typeof request.model !== 'string') {
      errors.push('Model is required')
    }

    if (typeof request.max_tokens !== 'number' || !Number.isFinite(request.max_tokens) || request.max_tokens < 1) {
      errors.push('max_tokens is required and must be a positive number')
    }

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      errors.push('messages is required and must be a non-empty array')
    } else {
      request.messages.forEach((message, index) => {
        if (!message || typeof message !== 'object') {
          errors.push(`messages[${index}] must be an object`)
          return
        }

        if (!('role' in message) || typeof message.role !== 'string' || message.role.trim().length === 0) {
          errors.push(`messages[${index}].role is required`)
        }

        const content: unknown = message.content
        if (content === undefined || content === null) {
          errors.push(`messages[${index}].content is required`)
          return
        }

        if (typeof content === 'string' && content.trim().length === 0) {
          errors.push(`messages[${index}].content cannot be empty`)
        } else if (Array.isArray(content) && content.length === 0) {
          errors.push(`messages[${index}].content must include at least one item when using an array`)
        }
      })
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async getClient(provider: Provider, extraHeaders?: Record<string, string | string[]>): Promise<Anthropic> {
    const anthropicConfig = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    const baseURL = anthropicConfig?.baseUrl || 'https://api.anthropic.com'

    if (provider.authType === 'oauth') {
      const oauthToken = await anthropicService.getValidAccessToken()
      if (!oauthToken) throw new Error('OAuth token is not available')
      return new Anthropic({
        authToken: oauthToken,
        baseURL: 'https://api.anthropic.com',
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...extraHeaders
        }
      })
    }

    const apiKey = await providerService.getRotatedApiKey(provider.id)
    // Flatten string[] headers to string for Anthropic SDK compatibility
    const flatHeaders: Record<string, string> = {}
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        flatHeaders[k] = Array.isArray(v) ? v.join(', ') : v
      }
    }
    return new Anthropic({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
      defaultHeaders: flatHeaders
    })
  }

  prepareHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
    const extraHeaders: Record<string, string | string[]> = {}

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue
      }

      const normalizedKey = key.toLowerCase()
      if (EXCLUDED_FORWARD_HEADERS.has(normalizedKey)) {
        continue
      }

      extraHeaders[normalizedKey] = value
    }

    return extraHeaders
  }

  createAnthropicRequest(request: MessageCreateParams, provider: Provider, modelId?: string): MessageCreateParams {
    const anthropicRequest: MessageCreateParams = {
      ...request,
      stream: !!request.stream
    }

    // Override model if provided
    if (modelId) {
      anthropicRequest.model = modelId
    }

    // Add Claude Code system message for OAuth providers
    if (provider.authType === 'oauth') {
      anthropicRequest.system = buildClaudeCodeSystemMessage(request.system)
    }

    return anthropicRequest
  }

  async handleStreaming(
    client: Anthropic,
    request: MessageCreateParams,
    config: StreamConfig,
    provider: Provider
  ): Promise<void> {
    const { response, onChunk, onError, onComplete } = config

    // Set streaming headers
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()

    const flushableResponse = response as Response & { flush?: () => void }
    const flushStream = () => {
      if (typeof flushableResponse.flush !== 'function') {
        return
      }
      try {
        flushableResponse.flush()
      } catch (flushError: unknown) {
        logger.warn('Failed to flush streaming response', { error: flushError })
      }
    }

    const writeSse = (eventType: string | undefined, payload: unknown) => {
      if (response.writableEnded || response.destroyed) {
        return
      }

      if (eventType) {
        response.write(`event: ${eventType}\n`)
      }

      const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
      response.write(`data: ${data}\n\n`)
      flushStream()
    }

    try {
      const stream = client.messages.stream(request)
      for await (const chunk of stream) {
        if (response.writableEnded || response.destroyed) {
          logger.warn('Streaming response ended before stream completion', {
            provider: provider.id,
            model: request.model
          })
          break
        }

        writeSse(chunk.type, chunk)

        if (onChunk) {
          onChunk(chunk)
        }
      }
      writeSse(undefined, '[DONE]')

      if (onComplete) {
        onComplete()
      }
    } catch (streamError: any) {
      logger.error('Stream error', {
        error: streamError,
        provider: provider.id,
        model: request.model,
        apiHost: provider.id,
        anthropicApiHost: provider.presetProviderId
      })
      writeSse(undefined, {
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Stream processing error'
        }
      })

      if (onError) {
        onError(streamError)
      }
    } finally {
      if (!response.writableEnded) {
        response.end()
      }
    }
  }

  transformError(error: any): { statusCode: number; errorResponse: ErrorResponse } {
    let statusCode = 500
    let errorType = 'api_error'
    let errorMessage = 'Internal server error'

    const anthropicStatus = typeof error?.status === 'number' ? error.status : undefined
    const anthropicError = error?.error

    if (anthropicStatus) {
      statusCode = anthropicStatus
    }

    if (anthropicError?.type) {
      errorType = anthropicError.type
    }

    if (anthropicError?.message) {
      errorMessage = anthropicError.message
    } else if (error instanceof Error && error.message) {
      errorMessage = error.message
    }

    // Without a structured Anthropic error, fall back to a generic 500.
    // Don't regex-match `error.message`: the SDK and other upstreams already
    // expose `.status`/`.code` (see anthropicStatus branch above), and a
    // genuine 500 whose message happens to mention "connection" must not
    // be remapped to 502.
    if (!anthropicStatus && error instanceof Error) {
      const errAny = error as unknown as { status?: unknown }
      const status = typeof errAny.status === 'number' ? errAny.status : null
      if (status !== null) {
        statusCode = status
        errorType =
          status === 401 || status === 403
            ? 'authentication_error'
            : status === 429
              ? 'rate_limit_error'
              : status >= 500 && status < 600
                ? 'api_error'
                : 'invalid_request_error'
      }
    }

    const safeErrorMessage =
      typeof errorMessage === 'string' && errorMessage.length > 0 ? errorMessage : 'Internal server error'

    return {
      statusCode,
      errorResponse: {
        type: 'error',
        error: {
          type: errorType,
          message: safeErrorMessage,
          requestId: error?.request_id
        }
      }
    }
  }

  async processMessage(options: ProcessMessageOptions): Promise<ProcessMessageResult> {
    const { provider, request, extraHeaders, modelId } = options

    const client = await this.getClient(provider, extraHeaders)
    const anthropicRequest = this.createAnthropicRequest(request, provider, modelId)

    const messageCount = Array.isArray(request.messages) ? request.messages.length : 0

    logger.info('Processing anthropic messages request', {
      provider: provider.id,
      apiHost: provider.id,
      anthropicApiHost: provider.presetProviderId,
      model: anthropicRequest.model,
      stream: !!anthropicRequest.stream,
      // systemPrompt: JSON.stringify(!!request.system),
      // messages: JSON.stringify(request.messages),
      messageCount,
      toolCount: Array.isArray(request.tools) ? request.tools.length : 0
    })

    // Return client and request for route layer to handle streaming/non-streaming
    return {
      client,
      anthropicRequest
    }
  }
}

// Export singleton instance
export const messagesService = new MessagesService()
