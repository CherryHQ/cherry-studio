import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import type { Provider } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

import { messagesService } from '../services/messages'
import { generateUnifiedMessage, streamUnifiedMessages } from '../services/unified-messages'
import { getProviderById, isModelAnthropicCompatible, validateModelId } from '../utils'

/**
 * Check if a specific model on a provider should use direct Anthropic SDK
 *
 * A provider+model combination is considered "Anthropic-compatible" if:
 * 1. It's a native Anthropic provider (type === 'anthropic'), OR
 * 2. It has anthropicApiHost configured AND the specific model supports Anthropic API
 *    (for aggregated providers like Silicon, only certain models support Anthropic endpoint)
 *
 * @param provider - The provider to check
 * @param modelId - The model ID to check (without provider prefix)
 * @returns true if should use direct Anthropic SDK, false for unified SDK
 */
function shouldUseDirectAnthropic(provider: Provider, modelId: string): boolean {
  // Native Anthropic provider - always use direct SDK
  if (provider.type === 'anthropic') {
    return true
  }

  // No anthropicApiHost configured - use unified SDK
  if (!provider.anthropicApiHost?.trim()) {
    return false
  }

  // Has anthropicApiHost - check model-level compatibility
  // For aggregated providers, only specific models support Anthropic API
  return isModelAnthropicCompatible(provider, modelId)
}

const logger = loggerService.withContext('ApiServerMessagesRoutes')

const router = express.Router()
const providerRouter = express.Router({ mergeParams: true })

/**
 * Estimate token count from messages
 * Simple approximation: ~4 characters per token for English text
 */
interface CountTokensInput {
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
  system?: string | Array<{ type: string; text?: string }>
}

function estimateTokenCount(input: CountTokensInput): number {
  const { messages, system } = input
  let totalChars = 0

  // Count system message tokens
  if (system) {
    if (typeof system === 'string') {
      totalChars += system.length
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block.type === 'text' && block.text) {
          totalChars += block.text.length
        }
      }
    }
  }

  // Count message tokens
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          totalChars += block.text.length
        }
      }
    }
    // Add overhead for role
    totalChars += 10
  }

  // Estimate tokens (~4 chars per token, with some overhead)
  return Math.ceil(totalChars / 4) + messages.length * 3
}

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
  res: Response
  provider: Provider
  request: MessageCreateParams
  modelId?: string
}

/**
 * Handle message processing using direct Anthropic SDK
 * Used for providers with anthropicApiHost or native Anthropic providers
 * This bypasses AI SDK conversion and uses native Anthropic protocol
 */
async function handleDirectAnthropicProcessing({
  res,
  provider,
  request,
  modelId,
  extraHeaders
}: HandleMessageProcessingOptions & { extraHeaders?: Record<string, string | string[]> }): Promise<void> {
  const actualModelId = modelId || request.model

  logger.info('Processing message via direct Anthropic SDK', {
    providerId: provider.id,
    providerType: provider.type,
    modelId: actualModelId,
    stream: !!request.stream,
    anthropicApiHost: provider.anthropicApiHost
  })

  try {
    // Validate request
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

    // Process message using messagesService (native Anthropic SDK)
    const { client, anthropicRequest } = await messagesService.processMessage({
      provider,
      request,
      extraHeaders,
      modelId: actualModelId
    })

    if (request.stream) {
      // Use native Anthropic streaming
      await messagesService.handleStreaming(client, anthropicRequest, { response: res }, provider)
    } else {
      // Use native Anthropic non-streaming
      const response = await client.messages.create(anthropicRequest)
      res.json(response)
    }
  } catch (error: any) {
    logger.error('Direct Anthropic processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    res.status(statusCode).json(errorResponse)
  }
}

/**
 * Handle message processing using unified AI SDK
 * Used for non-Anthropic providers that need format conversion
 * - Uses AI SDK adapters with output converted to Anthropic SSE format
 */
async function handleUnifiedProcessing({
  res,
  provider,
  request,
  modelId
}: HandleMessageProcessingOptions): Promise<void> {
  const actualModelId = modelId || request.model

  logger.info('Processing message via unified AI SDK', {
    providerId: provider.id,
    providerType: provider.type,
    modelId: actualModelId,
    stream: !!request.stream
  })

  try {
    // Validate request
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

    if (request.stream) {
      await streamUnifiedMessages({
        response: res,
        provider,
        modelId: actualModelId,
        params: request,
        onError: (error) => {
          logger.error('Stream error', error as Error)
        },
        onComplete: () => {
          logger.debug('Stream completed')
        }
      })
    } else {
      const response = await generateUnifiedMessage(provider, actualModelId, request)
      res.json(response)
    }
  } catch (error: any) {
    logger.error('Unified processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    res.status(statusCode).json(errorResponse)
  }
}

/**
 * Handle message processing - routes to appropriate handler based on provider and model
 *
 * Routing logic:
 * - Native Anthropic providers (type === 'anthropic'): Direct Anthropic SDK
 * - Providers with anthropicApiHost AND model supports Anthropic API: Direct Anthropic SDK
 * - Other providers/models: Unified AI SDK with Anthropic SSE conversion
 */
async function handleMessageProcessing({
  res,
  provider,
  request,
  modelId
}: HandleMessageProcessingOptions): Promise<void> {
  const actualModelId = modelId || request.model
  if (shouldUseDirectAnthropic(provider, actualModelId)) {
    return handleDirectAnthropicProcessing({ res, provider, request, modelId })
  }
  return handleUnifiedProcessing({ res, provider, request, modelId })
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

    return handleMessageProcessing({ res, provider, request, modelId })
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

    return handleMessageProcessing({ res, provider, request })
  } catch (error: any) {
    logger.error('Message processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    return res.status(statusCode).json(errorResponse)
  }
})

/**
 * @swagger
 * /v1/messages/count_tokens:
 *   post:
 *     summary: Count tokens for messages
 *     description: Count tokens for Anthropic Messages API format (required by Claude Code SDK)
 *     tags: [Messages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - messages
 *             properties:
 *               model:
 *                 type: string
 *                 description: Model ID
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *               system:
 *                 type: string
 *                 description: System message
 *     responses:
 *       200:
 *         description: Token count response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 input_tokens:
 *                   type: integer
 *       400:
 *         description: Bad request
 */
router.post('/count_tokens', async (req: Request, res: Response) => {
  try {
    const { model, messages, system } = req.body

    if (!model) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'model parameter is required'
        }
      })
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'messages parameter is required'
        }
      })
    }

    const estimatedTokens = estimateTokenCount({ messages, system })

    logger.debug('Token count estimated', {
      model,
      messageCount: messages.length,
      estimatedTokens
    })

    return res.json({
      input_tokens: estimatedTokens
    })
  } catch (error: any) {
    logger.error('Token counting error', { error })
    return res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message || 'Internal server error'
      }
    })
  }
})

/**
 * Provider-specific count_tokens endpoint
 */
providerRouter.post('/count_tokens', async (req: Request, res: Response) => {
  try {
    const { model, messages, system } = req.body

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'messages parameter is required'
        }
      })
    }

    const estimatedTokens = estimateTokenCount({ messages, system })

    logger.debug('Token count estimated (provider route)', {
      providerId: req.params.provider,
      model,
      messageCount: messages.length,
      estimatedTokens
    })

    return res.json({
      input_tokens: estimatedTokens
    })
  } catch (error: any) {
    logger.error('Token counting error', { error })
    return res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message || 'Internal server error'
      }
    })
  }
})

export { providerRouter as messagesProviderRoutes, router as messagesRoutes }
