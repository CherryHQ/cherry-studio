import { Elysia } from 'elysia'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
import { processMessage } from '../proxyStream'
import { ResponsesBodySchema } from './schemas'

/**
 * `POST /v1/responses` (OpenAI Responses API).
 *
 * Body validated loosely by `ResponsesBodySchema`; validation and pre-stream
 * errors are shaped into the OpenAI error envelope by the global `onError`
 * (path-based). Returns the streaming/JSON `Response` directly.
 *
 * `detail.tags`/`summary` stay in English; only `description` is localized — see chat.ts.
 */
export const responsesRoutes = new Elysia({ prefix: '/responses' }).post(
  '/',
  ({ body, request }) =>
    processMessage({
      params: body,
      inputFormat: 'openai-responses',
      outputFormat: 'openai-responses',
      signal: request.signal,
      requestHeaders: request.headers
    }),
  {
    body: ResponsesBodySchema,
    detail: { tags: [DOC_TAGS.openai], summary: 'Responses', description: DOC_DESCRIPTIONS.responses }
  }
)
