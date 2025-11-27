import type Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParams, MessageStreamEvent } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import anthropicService from '@main/services/AnthropicService'
import { buildClaudeCodeSystemMessage, getSdkClient } from '@shared/anthropic'
import type { Provider } from '@types'
import { net } from 'electron'
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
    // Create Anthropic client for the provider
    // Wrap net.fetch to handle compatibility issues:
    // 1. net.fetch expects string URLs, not Request objects
    // 2. net.fetch doesn't support 'agent' option from Node.js http module
    const electronFetch: typeof globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      // Remove unsupported options for Electron's net.fetch
      if (init) {
        const initWithAgent = init as RequestInit & { agent?: unknown }
        delete initWithAgent.agent
        const headers = new Headers(initWithAgent.headers)
        if (headers.has('content-length')) {
          headers.delete('content-length')
        }
        initWithAgent.headers = headers
        return net.fetch(url, initWithAgent)
      }
      return net.fetch(url)
    }
    const context = { fetch: electronFetch }
    if (provider.authType === 'oauth') {
      const oauthToken = await anthropicService.getValidAccessToken()
      return getSdkClient(provider, oauthToken, extraHeaders, context)
    }
    return getSdkClient(provider, null, extraHeaders, context)
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
    if (provider.type === 'anthropic' && provider.authType === 'oauth') {
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
        apiHost: provider.apiHost,
        anthropicApiHost: provider.anthropicApiHost
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

    // Infer error type from message if not from Anthropic API
    if (!anthropicStatus && error instanceof Error) {
      const errorMessageText = error.message ?? ''

      if (errorMessageText.includes('API key') || errorMessageText.includes('authentication')) {
        statusCode = 401
        errorType = 'authentication_error'
      } else if (errorMessageText.includes('rate limit') || errorMessageText.includes('quota')) {
        statusCode = 429
        errorType = 'rate_limit_error'
      } else if (errorMessageText.includes('timeout') || errorMessageText.includes('connection')) {
        statusCode = 502
        errorType = 'api_error'
      } else if (errorMessageText.includes('validation') || errorMessageText.includes('invalid')) {
        statusCode = 400
        errorType = 'invalid_request_error'
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
      apiHost: provider.apiHost,
      anthropicApiHost: provider.anthropicApiHost,
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
