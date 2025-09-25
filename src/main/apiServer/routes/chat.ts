import express, { Request, Response } from 'express'
import { ChatCompletionCreateParams } from 'openai/resources'

import { loggerService } from '../../services/LoggerService'
import {
  ChatCompletionModelError,
  chatCompletionService,
  ChatCompletionValidationError
} from '../services/chat-completion'

const logger = loggerService.withContext('ApiServerChatRoutes')

const router = express.Router()

interface ErrorResponseBody {
  error: {
    message: string
    type: string
    code: string
  }
}

const mapChatCompletionError = (error: unknown): { status: number; body: ErrorResponseBody } => {
  if (error instanceof ChatCompletionValidationError) {
    logger.warn('Chat completion validation error', {
      errors: error.errors
    })

    return {
      status: 400,
      body: {
        error: {
          message: error.errors.join('; '),
          type: 'invalid_request_error',
          code: 'validation_failed'
        }
      }
    }
  }

  if (error instanceof ChatCompletionModelError) {
    logger.warn('Chat completion model error', error.error)

    return {
      status: 400,
      body: {
        error: {
          message: error.error.message,
          type: 'invalid_request_error',
          code: error.error.code
        }
      }
    }
  }

  if (error instanceof Error) {
    let statusCode = 500
    let errorType = 'server_error'
    let errorCode = 'internal_error'

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

    logger.error('Chat completion error', { error })

    return {
      status: statusCode,
      body: {
        error: {
          message: error.message || 'Internal server error',
          type: errorType,
          code: errorCode
        }
      }
    }
  }

  logger.error('Chat completion unknown error', { error })

  return {
    status: 500,
    body: {
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    }
  }
}

/**
 * @swagger
 * /v1/chat/completions:
 *   post:
 *     summary: Create chat completion
 *     description: Create a chat completion response, compatible with OpenAI API
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCompletionRequest'
 *     responses:
 *       200:
 *         description: Chat completion response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 object:
 *                   type: string
 *                   example: chat.completion
 *                 created:
 *                   type: integer
 *                 model:
 *                   type: string
 *                 choices:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       index:
 *                         type: integer
 *                       message:
 *                         $ref: '#/components/schemas/ChatMessage'
 *                       finish_reason:
 *                         type: string
 *                 usage:
 *                   type: object
 *                   properties:
 *                     prompt_tokens:
 *                       type: integer
 *                     completion_tokens:
 *                       type: integer
 *                     total_tokens:
 *                       type: integer
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-sent events stream (when stream=true)
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/completions', async (req: Request, res: Response) => {
  try {
    const request: ChatCompletionCreateParams = req.body

    if (!request) {
      return res.status(400).json({
        error: {
          message: 'Request body is required',
          type: 'invalid_request_error',
          code: 'missing_body'
        }
      })
    }

    logger.debug('Chat completion request', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream,
      temperature: request.temperature
    })

    const isStreaming = !!request.stream

    if (isStreaming) {
      const { stream } = await chatCompletionService.processStreamingCompletion(request)

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      try {
        for await (const chunk of stream) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        res.write('data: [DONE]\n\n')
      } catch (streamError: any) {
        logger.error('Stream error', { error: streamError })
        res.write(
          `data: ${JSON.stringify({
            error: {
              message: 'Stream processing error',
              type: 'server_error',
              code: 'stream_error'
            }
          })}\n\n`
        )
      } finally {
        res.end()
      }
      return
    }

    const { response } = await chatCompletionService.processCompletion(request)
    return res.json(response)
  } catch (error: unknown) {
    const { status, body } = mapChatCompletionError(error)
    return res.status(status).json(body)
  }
})

export { router as chatRoutes }
