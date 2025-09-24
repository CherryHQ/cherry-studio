import { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import express, { Request, Response } from 'express'

import { messagesService } from '../services/messages'
import { getProviderById, validateModelId } from '../utils'

const logger = loggerService.withContext('ApiServerMessagesRoutes')

const router = express.Router()
const providerRouter = express.Router({ mergeParams: true })

// Helper functions for shared logic
async function validateRequestBody(req: Request): Promise<{ valid: boolean; error?: any }> {
  logger.debug('Validating message request body', {
    hasBody: Boolean(req.body)
  })
  const request: MessageCreateParams = req.body

  if (!request) {
    return {
      valid: false,
      error: {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Request body is required'
        }
      }
    }
  }

  return { valid: true }
}

async function handleStreamingResponse(
  res: Response,
  request: MessageCreateParams,
  provider: any,
  messagesService: any,
  logger: any
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    for await (const chunk of messagesService.processStreamingMessage(request, provider)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (streamError: any) {
    logger.error('Stream error', { error: streamError })
    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Stream processing error'
        }
      })}\n\n`
    )
  } finally {
    res.end()
  }
}

function handleErrorResponse(res: Response, error: any, logger: any): Response {
  logger.error('Message processing error', { error })

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

  if (!anthropicStatus && error instanceof Error) {
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
      message: errorMessage,
      requestId: error?.request_id
    }
  })
}

async function processMessageRequest(
  req: Request,
  res: Response,
  provider: any,
  modelId?: string
): Promise<Response | void> {
  try {
    const request: MessageCreateParams = req.body

    // Use provided modelId or keep original model
    if (modelId) {
      request.model = modelId
    }

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

    // Handle streaming
    if (request.stream) {
      await handleStreamingResponse(res, request, provider, messagesService, logger)
      return
    }

    // Handle non-streaming
    const response = await messagesService.processMessage(request, provider)
    return res.json(response)
  } catch (error: any) {
    return handleErrorResponse(res, error, logger)
  }
}

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
 *           text/event-stream:
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
  // Validate request body
  const bodyValidation = await validateRequestBody(req)
  if (!bodyValidation.valid) {
    return res.status(400).json(bodyValidation.error)
  }

  try {
    const request: MessageCreateParams = req.body

    // Validate model ID and get provider
    const modelValidation = await validateModelId(request.model)
    if (!modelValidation.valid) {
      const error = modelValidation.error!
      logger.warn('Model validation failed', {
        model: request.model,
        error
      })
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: error.message
        }
      })
    }

    const provider = modelValidation.provider!
    const modelId = modelValidation.modelId!

    // Use shared processing function
    return await processMessageRequest(req, res, provider, modelId)
  } catch (error: any) {
    return handleErrorResponse(res, error, logger)
  }
})

/**
 * @swagger
 * /{provider_id}/v1/messages:
 *   post:
 *     summary: Create message with provider in path
 *     description: Create a message response using provider ID from URL path
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: provider_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider ID (e.g., "my-anthropic")
 *         example: "my-anthropic"
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
 *                 description: Model ID without provider prefix
 *                 example: "claude-3-5-sonnet-20241022"
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
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-sent events stream (when stream=true)
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal server error
 */
providerRouter.post('/', async (req: Request, res: Response) => {
  // Validate request body
  const bodyValidation = await validateRequestBody(req)
  if (!bodyValidation.valid) {
    return res.status(400).json(bodyValidation.error)
  }

  try {
    const providerId = req.params.provider

    if (!providerId) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Provider ID is required in URL path'
        }
      })
    }

    // Get provider directly by ID from URL path
    const provider = await getProviderById(providerId)
    if (!provider) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `Provider '${providerId}' not found or not enabled`
        }
      })
    }

    // Use shared processing function (no modelId override needed)
    return await processMessageRequest(req, res, provider)
  } catch (error: any) {
    return handleErrorResponse(res, error, logger)
  }
})

export { providerRouter as messagesProviderRoutes, router as messagesRoutes }
