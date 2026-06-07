import { Elysia } from 'elysia'

import { processMessage } from '../proxyStream'
import { ChatCompletionBodySchema } from './schemas'

/**
 * `POST /v1/chat/completions` (OpenAI Chat Completions).
 *
 * The body is validated loosely by `ChatCompletionBodySchema`; validation and
 * pre-stream errors are shaped into the OpenAI error envelope by the global
 * `onError` (path-based). Returns the streaming/JSON `Response` directly.
 */
export const chatRoutes = new Elysia({ prefix: '/chat' }).post(
  '/completions',
  ({ body, request }) =>
    processMessage({
      params: body,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: request.signal
    }),
  {
    body: ChatCompletionBodySchema,
    detail: { tags: ['Chat'], summary: 'Create chat completion' }
  }
)
