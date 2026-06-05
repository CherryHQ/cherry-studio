import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'

import type { ExtendedChatCompletionCreateParams } from '../adapters'
import { processMessage } from '../services/ProxyStreamService'

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
    // Trust the SDK's structured `.status` rather than regex-matching `.message`.
    const errAny = error as unknown as { status?: unknown; code?: unknown }
    const status = typeof errAny.status === 'number' ? errAny.status : 500
    const code = typeof errAny.code === 'string' ? errAny.code : 'internal_error'
    const errorType =
      status === 401 || status === 403
        ? 'authentication_error'
        : status === 429
          ? 'rate_limit_error'
          : status >= 500 && status < 600
            ? 'server_error'
            : 'invalid_request_error'

    logger.error('Chat completion error', error)

    return {
      status,
      body: { error: { message: error.message || 'Internal server error', type: errorType, code } }
    }
  }

  logger.error('Chat completion unknown error', { error })
  return {
    status: 500,
    body: { error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' } }
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
router.post('/completions', async (req: Request, res: Response) => {
  try {
    const request = req.body as ExtendedChatCompletionCreateParams

    if (!request) {
      return res.status(400).json({
        error: { message: 'Request body is required', type: 'invalid_request_error', code: 'missing_body' }
      })
    }
    if (!request.model) {
      return res.status(400).json({
        error: { message: 'Model is required', type: 'invalid_request_error', code: 'missing_model' }
      })
    }
    if (!request.messages || request.messages.length === 0) {
      return res.status(400).json({
        error: { message: 'Messages are required', type: 'invalid_request_error', code: 'missing_messages' }
      })
    }

    logger.debug('Chat completion request', {
      model: request.model,
      messageCount: request.messages?.length || 0,
      stream: request.stream,
      temperature: request.temperature
    })

    return await processMessage({
      response: res,
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
