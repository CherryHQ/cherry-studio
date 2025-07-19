import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import OpenAI from 'openai'
import { ChatCompletionCreateParams } from 'openai/resources'

import { loggerService } from '../../services/LoggerService'
import { chatCompletionService } from '../services/ChatCompletionService'
import { getProviderByModel } from '../utils'

const logger = loggerService.withContext('ApiServerChatRoutes')

const app = new Hono()

app.post('/completions', async (c) => {
  try {
    const request: ChatCompletionCreateParams = await c.req.json()

    if (!request) {
      return c.json(
        {
          error: {
            message: 'Request body is required',
            type: 'invalid_request_error',
            code: 'missing_body'
          }
        },
        400
      )
    }

    logger.info('Chat completion request:', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream
    })

    // Validate request
    const validation = chatCompletionService.validateRequest(request)
    if (!validation.isValid) {
      return c.json(
        {
          error: {
            message: validation.errors.join('; '),
            type: 'invalid_request_error',
            code: 'validation_failed'
          }
        },
        400
      )
    }

    // Get provider
    const provider = await getProviderByModel(request.model)
    if (!provider) {
      return c.json(
        {
          error: {
            message: `Model "${request.model}" not found`,
            type: 'invalid_request_error',
            code: 'model_not_found'
          }
        },
        400
      )
    }

    // Validate model availability
    const modelId = request.model.split(':')[1]
    const model = provider.models?.find((m) => m.id === modelId)
    if (!model) {
      return c.json(
        {
          error: {
            message: `Model "${modelId}" not available in provider "${provider.id}"`,
            type: 'invalid_request_error',
            code: 'model_not_available'
          }
        },
        400
      )
    }

    // Create OpenAI client
    const client = new OpenAI({
      baseURL: provider.apiHost,
      apiKey: provider.apiKey
    })
    request.model = modelId

    // Handle streaming
    if (request.stream) {
      const streamResponse = await client.chat.completions.create(request)

      c.header('Content-Type', 'text/plain; charset=utf-8')
      c.header('Cache-Control', 'no-cache')
      c.header('Connection', 'keep-alive')

      return stream(c, async (stream) => {
        try {
          for await (const chunk of streamResponse as any) {
            await stream.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
          await stream.write('data: [DONE]\n\n')
        } catch (streamError) {
          logger.error('Stream error:', streamError)
          await stream.write(
            `data: ${JSON.stringify({
              error: {
                message: 'Stream processing error',
                type: 'server_error',
                code: 'stream_error'
              }
            })}\n\n`
          )
        }
      })
    }

    // Handle non-streaming
    const response = await client.chat.completions.create(request)
    return c.json(response)
  } catch (error) {
    logger.error('Chat completion error:', error)

    let statusCode = 500
    let errorType = 'server_error'
    let errorCode = 'internal_error'
    let errorMessage = 'Internal server error'

    if (error instanceof Error) {
      errorMessage = error.message

      if (error.message.includes('API key') || error.message.includes('authentication')) {
        statusCode = 401
        errorType = 'authentication_error'
        errorCode = 'invalid_api_key'
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        statusCode = 429
        errorType = 'rate_limit_error'
        errorCode = 'rate_limit_exceeded'
      } else if (error.message.includes('timeout') || error.message.includes('connection')) {
        statusCode = 502
        errorType = 'server_error'
        errorCode = 'upstream_error'
      }
    }

    return c.json(
      {
        error: {
          message: errorMessage,
          type: errorType,
          code: errorCode
        }
      },
      statusCode as any
    )
  }
})

export { app as chatRoutes }
