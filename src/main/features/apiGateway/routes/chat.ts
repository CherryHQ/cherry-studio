import { Elysia } from 'elysia'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
import { processMessage } from '../proxyStream'
import { ChatCompletionBodySchema } from './schemas'

/**
 * `POST /v1/chat/completions` (OpenAI Chat Completions).
 *
 * The body is validated loosely by `ChatCompletionBodySchema`; validation and
 * pre-stream errors are shaped into the OpenAI error envelope by the global
 * `onError` (path-based). Returns the streaming/JSON `Response` directly.
 *
 * `detail.tags`/`summary` are upstream-canonical API identifiers and stay in
 * English; only `description` is localized, and it holds an i18n *key* that
 * ../openapiDocs.ts resolves per request — so this one route registration
 * serves every language the docs UI's language switcher offers.
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
    detail: {
      tags: [DOC_TAGS.openai],
      summary: 'Chat Completions',
      description: DOC_DESCRIPTIONS.chat_completions
    }
  }
)
