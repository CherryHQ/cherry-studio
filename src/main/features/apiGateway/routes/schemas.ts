/**
 * Shared request/response schemas for the API gateway routes.
 *
 * The proxy bodies (OpenAI / Anthropic shapes) are validated *loosely*: only the
 * fields the gateway itself requires are enforced; everything else passes through
 * (`z.looseObject`) untouched so the converters receive the full upstream payload
 * and new SDK fields never get rejected. Handlers read the typed required fields
 * and cast once to the SDK type at the `processMessage` boundary.
 *
 * Attached to routes via Elysia's Standard Schema support (Zod validates natively
 * and feeds the `@elysia/openapi` plugin).
 */

import * as z from 'zod'

/**
 * A chat/message entry. `role` (and, for the estimator, `content`) is validated so
 * the entries carry real types; the rest of each message stays loose and the
 * converters parse the full shape.
 */
const MessageEntry = z.looseObject({ role: z.string() })

/** Message entry for token counting — `content` is named so the estimator can read it. */
const CountTokensEntry = z.looseObject({ role: z.string(), content: z.unknown() })

/**
 * Responses API `input` items are heterogeneous (messages, `function_call`,
 * `function_call_output`, …) and don't share a `role`, so they stay fully loose.
 */
const InputItem = z.looseObject({})

/** `POST /v1/chat/completions` body (OpenAI Chat Completions). */
export const ChatCompletionBodySchema = z.looseObject({
  model: z.string().min(1, 'Model is required'),
  messages: z.array(MessageEntry).min(1, 'Messages are required'),
  stream: z.boolean().optional()
})

/** `POST /v1/responses` body (OpenAI Responses). `input` is required and non-null. */
export const ResponsesBodySchema = z.looseObject({
  model: z.string().min(1, 'Model is required'),
  input: z.union([z.string(), z.array(InputItem)]),
  stream: z.boolean().optional()
})

/** `POST /v1/messages` body (Anthropic). Loose by design — the converters parse the full payload. */
export const MessagesBodySchema = z.looseObject({
  model: z.string().min(1, 'Model is required'),
  messages: z.array(MessageEntry).min(1, 'Messages are required'),
  stream: z.boolean().optional()
})

/** `POST /v1/messages/count_tokens` body — token estimation, no upstream call. */
export const CountTokensBodySchema = z.looseObject({
  messages: z.array(CountTokensEntry).min(1, 'messages parameter is required'),
  model: z.string().optional(),
  system: z.unknown().optional()
})
