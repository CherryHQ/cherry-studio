import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { application } from '@application'
import { CHERRY_FAST_MODE_HEADER, CHERRY_INTERNAL_REQUEST_TOKEN_HEADER } from '@main/ai/constants'
import { Elysia } from 'elysia'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
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
 *
 * `detail.tags`/`summary` stay in English; only `description` is localized — see chat.ts.
 */
export const messagesRoutes = new Elysia({ prefix: '/messages' })
  .post(
    '/',
    // `model` is "providerId:apiModelId"; ProxyStreamService resolves it.
    ({ body, request, headers }) => {
      const isInternalRequest = application
        .get('ApiGatewayService')
        .isInternalRequestToken(headers[CHERRY_INTERNAL_REQUEST_TOKEN_HEADER.toLowerCase()])
      return processMessage({
        params: body,
        inputFormat: 'anthropic',
        outputFormat: 'anthropic',
        fastMode: isInternalRequest && headers[CHERRY_FAST_MODE_HEADER.toLowerCase()] === 'true',
        signal: request.signal,
        requestHeaders: request.headers
      })
    },
    {
      body: MessagesBodySchema,
      detail: { tags: [DOC_TAGS.anthropic], summary: 'Messages', description: DOC_DESCRIPTIONS.messages }
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
      detail: { tags: [DOC_TAGS.anthropic], summary: 'Count Tokens', description: DOC_DESCRIPTIONS.count_tokens }
    }
  )
