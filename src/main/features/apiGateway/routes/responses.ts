import { Elysia } from 'elysia'

import { processMessage } from '../proxyStream'
import { ResponsesBodySchema } from './schemas'

/**
 * `POST /v1/responses` (OpenAI Responses API).
 *
 * Body validated loosely by `ResponsesBodySchema`; validation and pre-stream
 * errors are shaped into the OpenAI error envelope by the global `onError`
 * (path-based). Returns the streaming/JSON `Response` directly.
 */
export const responsesRoutes = new Elysia({ prefix: '/responses' }).post(
  '/',
  ({ body, request }) =>
    processMessage({
      params: body,
      inputFormat: 'openai-responses',
      outputFormat: 'openai-responses',
      signal: request.signal
    }),
  {
    body: ResponsesBodySchema,
    detail: { tags: ['Responses'], summary: 'Create a response' }
  }
)
