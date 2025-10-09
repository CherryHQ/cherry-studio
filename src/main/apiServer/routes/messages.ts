import { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import { Provider } from '@types'
import express, { Request, Response } from 'express'

import { messagesService } from '../services/messages'
import { getProviderById, validateModelId } from '../utils'

const logger = loggerService.withContext('ApiServerMessagesRoutes')

const router = express.Router()
const providerRouter = express.Router({ mergeParams: true })

// Helper function for basic request validation
async function validateRequestBody(req: Request): Promise<{ valid: boolean; error?: any }> {
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

interface HandleMessageProcessingOptions {
  req: Request
  res: Response
  provider: Provider
  request: MessageCreateParams
  modelId?: string
}

async function handleMessageProcessing({
  req,
  res,
  provider,
  request,
  modelId
}: HandleMessageProcessingOptions): Promise<void> {
  try {
    const validation = messagesService.validateRequest(request)
    if (!validation.isValid) {
      res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: validation.errors.join('; ')
        }
      })
      return
    }

    const extraHeaders = messagesService.prepareHeaders(req.headers)
    const { client, anthropicRequest } = await messagesService.processMessage({
      provider,
      request,
      extraHeaders,
      modelId
    })

    if (request.stream) {
      await messagesService.handleStreaming(client, anthropicRequest, { response: res }, provider)
      return
    }

    const response = await client.messages.create(anthropicRequest)
    res.json(response)
  } catch (error: any) {
    logger.error('Message processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    res.status(statusCode).json(errorResponse)
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

    return handleMessageProcessing({ req, res, provider, request, modelId })
  } catch (error: any) {
    logger.error('Message processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    return res.status(statusCode).json(errorResponse)
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

    const request: MessageCreateParams = req.body

    return handleMessageProcessing({ req, res, provider, request })
  } catch (error: any) {
    logger.error('Message processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    return res.status(statusCode).json(errorResponse)
  }
})

export { providerRouter as messagesProviderRoutes, router as messagesRoutes }
