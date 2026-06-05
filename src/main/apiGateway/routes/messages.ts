import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'
import { approximateTokenSize } from 'tokenx'

import { messagesService } from '../services/messages'
import { processMessage } from '../services/ProxyStreamService'

const logger = loggerService.withContext('ApiGatewayMessagesRoutes')

const router = express.Router()
const providerRouter = express.Router({ mergeParams: true })

/** Estimate token count from Anthropic-format messages (Claude Code SDK uses this). */
export interface CountTokensInput {
  messages: MessageCreateParams['messages']
  system?: MessageCreateParams['system']
}

export function estimateTokenCount(input: CountTokensInput): number {
  const { messages, system } = input
  let totalTokens = 0

  if (system) {
    if (typeof system === 'string') {
      totalTokens += approximateTokenSize(system)
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block.type === 'text' && block.text) totalTokens += approximateTokenSize(block.text)
      }
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalTokens += approximateTokenSize(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          totalTokens += approximateTokenSize(block.text)
        } else if (block.type === 'image') {
          if (block.source.type === 'base64') {
            const dataSize = block.source.data.length * 0.75
            totalTokens += Math.floor(dataSize / 100)
          } else {
            totalTokens += 1000
          }
        } else if (block.type === 'tool_use') {
          if (block.name) totalTokens += approximateTokenSize(block.name)
          if (block.input) totalTokens += approximateTokenSize(JSON.stringify(block.input))
          totalTokens += 10
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            totalTokens += approximateTokenSize(block.content)
          } else if (Array.isArray(block.content)) {
            for (const item of block.content) {
              if (typeof item === 'string') {
                totalTokens += approximateTokenSize(item)
              } else if (item.type === 'text' && item.text) {
                totalTokens += approximateTokenSize(item.text)
              }
            }
          }
          totalTokens += 10
        }
      }
    }
    totalTokens += 3
  }

  return totalTokens
}

function validateRequestBody(req: Request): { valid: boolean; error?: any } {
  const request: MessageCreateParams = req.body
  if (!request) {
    return {
      valid: false,
      error: { type: 'error', error: { type: 'invalid_request_error', message: 'Request body is required' } }
    }
  }
  return { valid: true }
}

/**
 * Process an Anthropic-format request through any configured provider via the
 * unified `AiService` path, translating the stream back to Anthropic SSE/JSON.
 */
async function handleMessageProcessing(res: Response, request: MessageCreateParams): Promise<void> {
  try {
    const validation = messagesService.validateRequest(request)
    if (!validation.isValid) {
      res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: validation.errors.join('; ') }
      })
      return
    }

    await processMessage({
      response: res,
      params: request,
      inputFormat: 'anthropic',
      outputFormat: 'anthropic',
      onError: (error) => logger.error('Message error', error as Error)
    })
  } catch (error: any) {
    logger.error('Message processing error', { error })
    const { statusCode, errorResponse } = messagesService.transformError(error)
    res.status(statusCode).json(errorResponse)
  }
}

async function handleCountTokens(
  req: Request,
  res: Response,
  options: { requireModel?: boolean; logContext?: Record<string, any> } = {}
): Promise<Response> {
  try {
    const { model, messages, system } = req.body
    const { requireModel = false, logContext = {} } = options

    if (requireModel && !model) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'model parameter is required' }
      })
    }
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages parameter is required' }
      })
    }

    const estimatedTokens = estimateTokenCount({ messages, system })
    logger.debug('Token count estimated', { model, messageCount: messages.length, estimatedTokens, ...logContext })
    return res.json({ input_tokens: estimatedTokens })
  } catch (error: any) {
    logger.error('Token counting error', { error })
    return res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: error.message || 'Internal server error' }
    })
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
 *             required: [model, max_tokens, messages]
 *     responses:
 *       200:
 *         description: Message response
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/', async (req: Request, res: Response) => {
  const bodyValidation = validateRequestBody(req)
  if (!bodyValidation.valid) return res.status(400).json(bodyValidation.error)

  try {
    const request: MessageCreateParams = req.body
    // `model` is "providerId:modelId"; ProxyStreamService resolves it.
    return await handleMessageProcessing(res, request)
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
 *     tags: [Messages]
 */
providerRouter.post('/', async (req: Request, res: Response) => {
  const bodyValidation = validateRequestBody(req)
  if (!bodyValidation.valid) return res.status(400).json(bodyValidation.error)

  try {
    const providerId = req.params.provider
    if (!providerId) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Provider ID is required in URL path' }
      })
    }

    const request: MessageCreateParams = req.body
    // Compose the gateway model string from the path provider + body model id.
    const composed: MessageCreateParams = { ...request, model: `${providerId}:${request.model}` }
    return await handleMessageProcessing(res, composed)
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
 *     tags: [Messages]
 */
router.post('/count_tokens', async (req: Request, res: Response) => {
  return handleCountTokens(req, res, { requireModel: true })
})

providerRouter.post('/count_tokens', async (req: Request, res: Response) => {
  return handleCountTokens(req, res, { requireModel: false, logContext: { providerId: req.params.provider } })
})

export { providerRouter as messagesProviderRoutes, router as messagesRoutes }
