/**
 * OpenAI Responses API Service
 *
 * Provides direct passthrough to OpenAI Responses API for native OpenAI providers,
 * bypassing AI SDK conversion for optimal performance.
 *
 * Similar to MessagesService for Anthropic, this service handles:
 * - Request validation
 * - Client creation with proper authentication
 * - Streaming with SSE event forwarding
 * - Non-streaming request handling
 */

import OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import type { Provider } from '@types'
import { net } from 'electron'
import type { Response } from 'express'

// Use SDK namespace types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams
type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent
type ResponseObject = OpenAI.Responses.Response

const logger = loggerService.withContext('ResponsesService')

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export interface ErrorResponse {
  error: {
    message: string
    type: string
    code: string
  }
}

export interface StreamConfig {
  response: Response
  onChunk?: (chunk: ResponseStreamEvent) => void
  onError?: (error: unknown) => void
  onComplete?: () => void
}

export interface ProcessResponseOptions {
  provider: Provider
  request: ResponseCreateParams
  modelId?: string
}

export interface ProcessResponseResult {
  client: OpenAI
  openaiRequest: ResponseCreateParams
}

export class ResponsesService {
  validateRequest(request: ResponseCreateParams): ValidationResult {
    const errors: string[] = []

    if (!request.model || typeof request.model !== 'string') {
      errors.push('Model is required')
    }

    if (request.input === undefined || request.input === null) {
      errors.push('Input is required')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async getClient(provider: Provider): Promise<OpenAI> {
    // Create OpenAI client with Electron's net.fetch
    const electronFetch: typeof globalThis.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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

    const baseURL = provider.apiHost?.replace(/\/$/, '')

    return new OpenAI({
      apiKey: provider.apiKey || '',
      baseURL,
      fetch: electronFetch
    })
  }

  createOpenAIRequest(request: ResponseCreateParams, modelId?: string): ResponseCreateParams {
    const openaiRequest: ResponseCreateParams = {
      ...request
    }

    if (modelId) {
      openaiRequest.model = modelId
    }

    return openaiRequest
  }

  async handleStreaming(
    client: OpenAI,
    request: ResponseCreateParams,
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

    const writeSse = (event: ResponseStreamEvent) => {
      if (response.writableEnded || response.destroyed) {
        return
      }

      // Responses API uses named events
      response.write(`event: ${event.type}\n`)
      response.write(`data: ${JSON.stringify(event)}\n\n`)
      flushStream()
    }

    try {
      // Use stream: true to get Stream<ResponseStreamEvent>
      const stream = await client.responses.create({
        ...request,
        stream: true
      } as OpenAI.Responses.ResponseCreateParamsStreaming)

      for await (const chunk of stream) {
        if (response.writableEnded || response.destroyed) {
          logger.warn('Streaming response ended before stream completion', {
            provider: provider.id,
            model: request.model
          })
          break
        }

        writeSse(chunk)

        if (onChunk) {
          onChunk(chunk)
        }
      }

      // Send done marker
      if (!response.writableEnded) {
        response.write('data: [DONE]\n\n')
        flushStream()
      }

      if (onComplete) {
        onComplete()
      }
    } catch (streamError: unknown) {
      logger.error('Stream error', {
        error: streamError,
        provider: provider.id,
        model: request.model
      })

      if (!response.writableEnded) {
        const errorEvent = {
          type: 'error',
          error: {
            message: streamError instanceof Error ? streamError.message : 'Stream processing error',
            type: 'api_error',
            code: 'stream_error'
          }
        }
        response.write(`event: error\n`)
        response.write(`data: ${JSON.stringify(errorEvent)}\n\n`)
        flushStream()
      }

      if (onError) {
        onError(streamError)
      }
    } finally {
      if (!response.writableEnded) {
        response.end()
      }
    }
  }

  async handleNonStreaming(client: OpenAI, request: ResponseCreateParams): Promise<ResponseObject> {
    return client.responses.create({
      ...request,
      stream: false
    } as OpenAI.Responses.ResponseCreateParamsNonStreaming)
  }

  transformError(error: unknown): { statusCode: number; errorResponse: ErrorResponse } {
    let statusCode = 500
    let errorType = 'server_error'
    let errorCode = 'internal_error'
    let errorMessage = 'Internal server error'

    if (error instanceof OpenAI.APIError) {
      statusCode = error.status || 500
      errorMessage = error.message

      if (statusCode === 400) {
        errorType = 'invalid_request_error'
        errorCode = 'bad_request'
      } else if (statusCode === 401) {
        errorType = 'authentication_error'
        errorCode = 'invalid_api_key'
      } else if (statusCode === 403) {
        errorType = 'forbidden_error'
        errorCode = 'forbidden'
      } else if (statusCode === 404) {
        errorType = 'not_found_error'
        errorCode = 'not_found'
      } else if (statusCode === 429) {
        errorType = 'rate_limit_error'
        errorCode = 'rate_limit_exceeded'
      }
    } else if (error instanceof Error) {
      errorMessage = error.message

      if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
        statusCode = 401
        errorType = 'authentication_error'
        errorCode = 'invalid_api_key'
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
        statusCode = 429
        errorType = 'rate_limit_error'
        errorCode = 'rate_limit_exceeded'
      } else if (errorMessage.includes('timeout') || errorMessage.includes('connection')) {
        statusCode = 502
        errorType = 'server_error'
        errorCode = 'upstream_error'
      }
    }

    return {
      statusCode,
      errorResponse: {
        error: {
          message: errorMessage,
          type: errorType,
          code: errorCode
        }
      }
    }
  }

  async processResponse(options: ProcessResponseOptions): Promise<ProcessResponseResult> {
    const { provider, request, modelId } = options

    const client = await this.getClient(provider)
    const openaiRequest = this.createOpenAIRequest(request, modelId)

    logger.info('Processing OpenAI Responses API request', {
      provider: provider.id,
      apiHost: provider.apiHost,
      model: openaiRequest.model,
      stream: !!request.stream,
      inputType: typeof request.input
    })

    return {
      client,
      openaiRequest
    }
  }
}

export const responsesService = new ResponsesService()
