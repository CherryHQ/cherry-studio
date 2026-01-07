import type { Request, Response } from 'express'
import express from 'express'

import { loggerService } from '../../services/LoggerService'
import type { ExtendedChatCompletionCreateParams } from '../adapters'
import { processMessage } from '../services/ProxyStreamService'
import { validateModelId } from '../utils'

const logger = loggerService.withContext('ApiGatewayChatRoutes')

const router = express.Router()

interface ErrorResponseBody {
  error: {
    message: string
    type: string
    code: string
  }
}

const mapChatCompletionError = (error: unknown): { status: number; body: ErrorResponseBody } => {
  if (error instanceof Error) {
    let statusCode = 500
    let errorType = 'server_error'
    let errorCode = 'internal_error'

    // Model validation errors
    if (error.message.includes('Model') && error.message.includes('not found')) {
      statusCode = 400
      errorType = 'invalid_request_error'
      errorCode = 'model_not_found'
    } else if (error.message.includes('API key') || error.message.includes('authentication')) {
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
    const request = req.body as ExtendedChatCompletionCreateParams

    if (!request) {
      return res.status(400).json({
        error: {
          message: 'Request body is required',
          type: 'invalid_request_error',
          code: 'missing_body'
        }
      })
    }

    if (!request.model) {
      return res.status(400).json({
        error: {
          message: 'Model is required',
          type: 'invalid_request_error',
          code: 'missing_model'
        }
      })
    }

    if (!request.messages || request.messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Messages are required',
          type: 'invalid_request_error',
          code: 'missing_messages'
        }
      })
    }

    logger.debug('Chat completion request', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream,
      temperature: request.temperature
    })

    // Validate model and get provider
    const modelValidation = await validateModelId(request.model)
    if (!modelValidation.valid) {
      return res.status(400).json({
        error: {
          message: modelValidation.error?.message || 'Model not found',
          type: 'invalid_request_error',
          code: modelValidation.error?.code || 'model_not_found'
        }
      })
    }

    const provider = modelValidation.provider!
    const modelId = modelValidation.modelId!

    return processMessage({
      response: res,
      provider,
      modelId,
      params: request,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
  } catch (error: unknown) {
    const { status, body } = mapChatCompletionError(error)
    return res.status(status).json(body)
  }
})

export { router as chatRoutes }
