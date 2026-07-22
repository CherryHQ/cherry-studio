import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { Elysia } from 'elysia'

import { processMessage } from '../proxyStream'
import { estimateAnthropicRequestTokens } from '../tokens/estimateAnthropicRequestTokens'
import { CountTokensBodySchema, MessagesBodySchema } from './schemas'

/** Anthropic-dialect `invalid_request_error` envelope. */
const invalidRequest = (message: string) => ({
  type: 'error' as const,
  error: { type: 'invalid_request_error', message }
})

/**
 * `/v1/messages` routes (mounted under `/v1`). The body is validated declaratively
 * by `MessagesBodySchema`; validation and provider errors are shaped into the
 * Anthropic error envelope by the app's single root `onError` (`gatewayErrorHandler`),
 * which dispatches by request path to `anthropicErrorHandler` (see ../errors.ts).
 */
export const messagesRoutes = new Elysia({ prefix: '/messages' })
  .post(
    '/',
    // `model` is "providerId:apiModelId"; ProxyStreamService resolves it.
    ({ body, request }) =>
      processMessage({
        params: body,
        inputFormat: 'anthropic',
        outputFormat: 'anthropic',
        signal: request.signal
      }),
    {
      body: MessagesBodySchema,
      detail: { tags: ['Messages'], summary: 'Create message' }
    }
  )
  .post(
    '/count_tokens',
    async ({ body, status }) => {
      if (!body.model) return status(400, invalidRequest('model parameter is required'))
      return {
        input_tokens: await estimateAnthropicRequestTokens(body as unknown as MessageCreateParams)
      }
    },
    {
      body: CountTokensBodySchema,
      detail: { tags: ['Messages'], summary: 'Count tokens for messages' }
    }
  )
