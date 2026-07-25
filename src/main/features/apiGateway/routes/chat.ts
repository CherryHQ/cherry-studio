import { Elysia } from 'elysia'

import { processMessage } from '../proxyStream'
import { ChatCompletionBodySchema } from './schemas'

/**
 * `POST /v1/chat/completions` (OpenAI Chat Completions).
 *
 * The body is validated loosely by `ChatCompletionBodySchema`; validation and
 * pre-stream errors are shaped into the OpenAI error envelope by the global
 * `onError` (path-based). Returns the streaming/JSON `Response` directly.
 *
 * `detail.tags`/`summary` hold i18n *keys*, not translated text — the OpenAPI
 * doc is generated once (see ../app.ts's internal introspection mount) and
 * translated per request by `translateOpenApiDoc`, so the same route
 * registration serves every language the docs UI's language switcher offers.
 */
export const chatRoutes = new Elysia({ prefix: '/chat' }).post(
  '/completions',
  ({ body, request }) =>
    processMessage({
      params: body,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: request.signal,
      requestHeaders: request.headers
    }),
  {
    body: ChatCompletionBodySchema,
    detail: { tags: ['apiGateway.docs.tags.chat'], summary: 'apiGateway.docs.summaries.chat_completion' }
  }
)
