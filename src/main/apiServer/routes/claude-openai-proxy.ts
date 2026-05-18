import { loggerService } from '@logger'
import type { Request, Response } from 'express'
import express from 'express'

import {
  type AnthropicMessagesRequest,
  ClaudeOpenAIProxyProviderError,
  claudeOpenAIProxyService,
  ClaudeOpenAIProxyValidationError
} from '../services/claude-openai-proxy'

const logger = loggerService.withContext('ClaudeOpenAIProxyRoutes')
const router = express.Router({ mergeParams: true })

const mapError = (error: unknown): { status: number; body: unknown } => {
  if (error instanceof ClaudeOpenAIProxyValidationError) {
    return {
      status: 400,
      body: { type: 'error', error: { type: 'invalid_request_error', message: error.message } }
    }
  }

  if (error instanceof ClaudeOpenAIProxyProviderError) {
    return {
      status: 400,
      body: { type: 'error', error: { type: 'invalid_request_error', message: error.message } }
    }
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { type: 'error', error: { type: 'api_error', message: error.message } }
    }
  }

  return {
    status: 500,
    body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }
  }
}

/**
 * @swagger
 * /v1/agents/claude-proxy/{providerId}/v1/messages:
 *   post:
 *     summary: Proxy Anthropic Messages requests to OpenAI-compatible providers
 *     description: Internal Cherry Claw compatibility endpoint used by Claude Agent SDK when the selected provider exposes only OpenAI Chat Completions format.
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *         description: OpenAI-compatible provider ID, such as a configured NewAPI provider.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [model, max_tokens, messages]
 *             properties:
 *               model:
 *                 type: string
 *                 example: gpt-5.5
 *               max_tokens:
 *                 type: integer
 *                 minimum: 1
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *               system:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *               stream:
 *                 type: boolean
 *               tools:
 *                 type: array
 *     responses:
 *       200:
 *         description: Anthropic Messages response or server-sent Anthropic Messages events.
 *       400:
 *         description: Invalid request or unsupported provider.
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal proxy error.
 */
router.post('/:providerId/v1/messages', async (req: Request, res: Response) => {
  const providerId = req.params.providerId
  const request = req.body as AnthropicMessagesRequest

  try {
    if (request.stream) {
      await claudeOpenAIProxyService.streamMessage(providerId, request, res)
      return
    }

    const response = await claudeOpenAIProxyService.createMessage(providerId, request)
    return res.json(response)
  } catch (error) {
    logger.error('Claude OpenAI proxy message failed', { error, providerId, model: request?.model })
    const { status, body } = mapError(error)
    return res.status(status).json(body)
  }
})

/**
 * @swagger
 * /v1/agents/claude-proxy/{providerId}/v1/messages/count_tokens:
 *   post:
 *     summary: Estimate Anthropic Messages token count for OpenAI-compatible providers
 *     description: Internal Cherry Claw compatibility endpoint that returns a conservative input token estimate for Claude Agent SDK context management.
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [model, messages]
 *             properties:
 *               model:
 *                 type: string
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *               system:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *     responses:
 *       200:
 *         description: Estimated token count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 input_tokens:
 *                   type: integer
 */
router.post('/:providerId/v1/messages/count_tokens', async (req: Request, res: Response) => {
  try {
    const response = await claudeOpenAIProxyService.countTokens(
      req.params.providerId,
      req.body as AnthropicMessagesRequest
    )
    return res.json(response)
  } catch (error) {
    logger.error('Claude OpenAI proxy token count failed', { error, providerId: req.params.providerId })
    const { status, body } = mapError(error)
    return res.status(status).json(body)
  }
})

export { router as claudeOpenAIProxyRoutes }
