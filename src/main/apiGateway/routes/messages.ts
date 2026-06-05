import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { Elysia } from 'elysia'
import { approximateTokenSize } from 'tokenx'

import { messagesService } from '../services/messages'
import { processMessage } from '../services/ProxyStreamService'
import { CountTokensBodySchema, MessagesBodySchema } from './schemas'

/** Estimate token count from Anthropic-format messages (Claude Code SDK uses this). */
export interface CountTokensInput {
  messages: MessageCreateParams['messages']
  system?: MessageCreateParams['system']
}

export function estimateTokenCount(input: CountTokensInput): number {
  const { messages, system } = input
  let totalTokens = 0

  if (system) {
    if (typeof system === 'string') {
      totalTokens += approximateTokenSize(system)
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block.type === 'text' && block.text) totalTokens += approximateTokenSize(block.text)
      }
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalTokens += approximateTokenSize(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          totalTokens += approximateTokenSize(block.text)
        } else if (block.type === 'image') {
          if (block.source.type === 'base64') {
            const dataSize = block.source.data.length * 0.75
            totalTokens += Math.floor(dataSize / 100)
          } else {
            totalTokens += 1000
          }
        } else if (block.type === 'tool_use') {
          if (block.name) totalTokens += approximateTokenSize(block.name)
          if (block.input) totalTokens += approximateTokenSize(JSON.stringify(block.input))
          totalTokens += 10
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            totalTokens += approximateTokenSize(block.content)
          } else if (Array.isArray(block.content)) {
            for (const item of block.content) {
              if (typeof item === 'string') {
                totalTokens += approximateTokenSize(item)
              } else if (item.type === 'text' && item.text) {
                totalTokens += approximateTokenSize(item.text)
              }
            }
          }
          totalTokens += 10
        }
      }
    }
    totalTokens += 3
  }

  return totalTokens
}

/** Anthropic-dialect `invalid_request_error` envelope. */
const invalidRequest = (message: string) => ({
  type: 'error' as const,
  error: { type: 'invalid_request_error', message }
})

/**
 * Validate an Anthropic request (deeper per-message checks beyond the loose body
 * schema), then proxy it through the unified `AiService` path. The caller emits a
 * 400 in the Anthropic dialect when `ok` is false.
 */
async function runAnthropic(
  body: unknown,
  signal: AbortSignal | undefined
): Promise<{ ok: false; errors: string[] } | { ok: true; response: Response }> {
  // Trust boundary: narrow the loosely-validated body to the Anthropic SDK type;
  // `validateRequest` performs the deeper per-message checks.
  const request = body as MessageCreateParams
  const { isValid, errors } = messagesService.validateRequest(request)
  if (!isValid) return { ok: false, errors }

  const response = await processMessage({
    params: request,
    inputFormat: 'anthropic',
    outputFormat: 'anthropic',
    signal
  })
  return { ok: true, response }
}

/**
 * `/v1/messages` routes (mounted under `/v1`). Validation and provider errors are
 * shaped into the Anthropic error envelope by the global `onError` (path-based).
 */
export const messagesRoutes = new Elysia({ prefix: '/messages' })
  .post(
    '/',
    async ({ body, request, status }) => {
      // `model` is "providerId:modelId"; ProxyStreamService resolves it.
      const result = await runAnthropic(body, request.signal)
      if (!result.ok) return status(400, invalidRequest(result.errors.join('; ')))
      return result.response
    },
    {
      body: MessagesBodySchema,
      detail: { tags: ['Messages'], summary: 'Create message' }
    }
  )
  .post(
    '/count_tokens',
    ({ body, status }) => {
      if (!body.model) return status(400, invalidRequest('model parameter is required'))
      return {
        input_tokens: estimateTokenCount({
          messages: body.messages as MessageCreateParams['messages'],
          system: body.system as MessageCreateParams['system']
        })
      }
    },
    {
      body: CountTokensBodySchema,
      detail: { tags: ['Messages'], summary: 'Count tokens for messages' }
    }
  )
