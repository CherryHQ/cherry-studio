import { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import express, { Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'
import { messagesService } from '../services/messages'
import { validateModelId } from '../utils'

const logger = loggerService.withContext('ApiServerMessagesRoutes')

const router = express.Router()

/**
 * @swagger
 * /v1/messages:
 *   post:
 *     summary: Create message
 *     description: Create a message response using Anthropic's API format
 *     tags: [Messages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - max_tokens
 *               - messages
 *             properties:
 *               model:
 *                 type: string
 *                 description: Model ID in format "provider:model_id"
 *                 example: "my-anthropic:claude-3-5-sonnet-20241022"
 *               max_tokens:
 *                 type: integer
 *                 minimum: 1
 *                 description: Maximum number of tokens to generate
 *                 example: 1024
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant]
 *                     content:
 *                       oneOf:
 *                         - type: string
 *                         - type: array
 *               system:
 *                 type: string
 *                 description: System message
 *               temperature:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1
 *                 description: Sampling temperature
 *               top_p:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1
 *                 description: Nucleus sampling
 *               top_k:
 *                 type: integer
 *                 minimum: 0
 *                 description: Top-k sampling
 *               stream:
 *                 type: boolean
 *                 description: Whether to stream the response
 *               tools:
 *                 type: array
 *                 description: Available tools for the model
 *     responses:
 *       200:
 *         description: Message response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 type:
 *                   type: string
 *                   example: message
 *                 role:
 *                   type: string
 *                   example: assistant
 *                 content:
 *                   type: array
 *                   items:
 *                     type: object
 *                 model:
 *                   type: string
 *                 stop_reason:
 *                   type: string
 *                 stop_sequence:
 *                   type: string
 *                 usage:
 *                   type: object
 *                   properties:
 *                     input_tokens:
 *                       type: integer
 *                     output_tokens:
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
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   example: error
 *                 error:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     message:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal server error
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const request: MessageCreateParams = req.body

    if (!request) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Request body is required'
        }
      })
    }

    logger.info('Anthropic message request:', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream,
      max_tokens: request.max_tokens,
      temperature: request.temperature
    })

    // Validate request
    const validation = messagesService.validateRequest(request)
    if (!validation.isValid) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: validation.errors.join('; ')
        }
      })
    }

    // Validate model ID and get provider
    const modelValidation = await validateModelId(request.model)
    if (!modelValidation.valid) {
      const error = modelValidation.error!
      logger.warn(`Model validation failed for '${request.model}':`, error)
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: error.message
        }
      })
    }

    const provider = modelValidation.provider!

    // Ensure provider is Anthropic type
    if (provider.type !== 'anthropic') {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `Invalid provider type '${provider.type}' for messages endpoint. Expected 'anthropic' provider.`
        }
      })
    }

    const modelId = modelValidation.modelId!
    request.model = modelId

    logger.info('Model validation successful:', {
      provider: provider.id,
      providerType: provider.type,
      modelId: modelId,
      fullModelId: request.model
    })

    // Handle streaming
    if (request.stream) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      try {
        for await (const chunk of messagesService.processStreamingMessage(request, provider)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        res.write('data: [DONE]\n\n')
        res.end()
      } catch (streamError: any) {
        logger.error('Stream error:', streamError)
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: 'Stream processing error'
            }
          })}\n\n`
        )
        res.end()
      }
      return
    }

    // Handle non-streaming
    const response = await messagesService.processMessage(request, provider)
    return res.json(response)
  } catch (error: any) {
    logger.error('Anthropic message error:', error)

    let statusCode = 500
    let errorType = 'api_error'
    let errorMessage = 'Internal server error'

    if (error instanceof Error) {
      errorMessage = error.message

      if (error.message.includes('API key') || error.message.includes('authentication')) {
        statusCode = 401
        errorType = 'authentication_error'
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        statusCode = 429
        errorType = 'rate_limit_error'
      } else if (error.message.includes('timeout') || error.message.includes('connection')) {
        statusCode = 502
        errorType = 'api_error'
      } else if (error.message.includes('validation') || error.message.includes('invalid')) {
        statusCode = 400
        errorType = 'invalid_request_error'
      }
    }

    return res.status(statusCode).json({
      type: 'error',
      error: {
        type: errorType,
        message: errorMessage
      }
    })
  }
})

export { router as messagesRoutes }
