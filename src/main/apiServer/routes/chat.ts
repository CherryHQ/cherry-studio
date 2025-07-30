import express, { Request, Response } from 'express'
import OpenAI from 'openai'
import { ChatCompletionCreateParams } from 'openai/resources'

import { loggerService } from '../../services/LoggerService'
import { chatCompletionService } from '../services/chat-completion'
import { getProviderByModel, getRealProviderModel } from '../utils'

const logger = loggerService.withContext('ApiServerChatRoutes')

const router = express.Router()

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
 *           text/plain:
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

    logger.info('Chat completion request:', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream
    })

    // Validate request
    const validation = chatCompletionService.validateRequest(request)
    if (!validation.isValid) {
      return res.status(400).json({
        error: {
          message: validation.errors.join('; '),
          type: 'invalid_request_error',
          code: 'validation_failed'
        }
      })
    }

    // Get provider
    const provider = await getProviderByModel(request.model)
    if (!provider) {
      return res.status(400).json({
        error: {
          message: `Model "${request.model}" not found`,
          type: 'invalid_request_error',
          code: 'model_not_found'
        }
      })
    }

    // Validate model availability
    const modelId = getRealProviderModel(request.model)
    const model = provider.models?.find((m) => m.id === modelId)
    if (!model) {
      return res.status(400).json({
        error: {
          message: `Model "${modelId}" not available in provider "${provider.id}"`,
          type: 'invalid_request_error',
          code: 'model_not_available'
        }
      })
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

      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      try {
        for await (const chunk of streamResponse as any) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        res.write('data: [DONE]\n\n')
        res.end()
      } catch (streamError: any) {
        logger.error('Stream error:', streamError)
        res.write(
          `data: ${JSON.stringify({
            error: {
              message: 'Stream processing error',
              type: 'server_error',
              code: 'stream_error'
            }
          })}\n\n`
        )
        res.end()
      }
      return
    }

    // Handle non-streaming
    const response = await client.chat.completions.create(request)
    return res.json(response)
  } catch (error: any) {
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

    return res.status(statusCode).json({
      error: {
        message: errorMessage,
        type: errorType,
        code: errorCode
      }
    })
  }
})

export { router as chatRoutes }
