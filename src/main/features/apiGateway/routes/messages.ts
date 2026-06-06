import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import { Elysia } from 'elysia'
import { approximateTokenSize } from 'tokenx'

import { processMessage } from '../proxyStream'
import { CountTokensBodySchema, MessagesBodySchema } from './schemas'

/** Estimate token count from Anthropic-format messages (Claude Code SDK uses this). */
export interface CountTokensInput {
  messages: MessageCreateParams['messages']
  system?: MessageCreateParams['system']
}

// TODO: unified token estimator
export function estimateTokenCount(input: CountTokensInput): number {
  const { messages, system } = input
  let totalTokens = 0

  // The body is only loosely validated (`content: z.unknown()`), so every block
  // is untrusted — guard each access so a malformed entry yields a best-effort
  // estimate instead of throwing a 500.
  if (system) {
    if (typeof system === 'string') {
      totalTokens += approximateTokenSize(system)
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          totalTokens += approximateTokenSize(block.text)
        }
      }
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalTokens += approximateTokenSize(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') {
          totalTokens += approximateTokenSize(block.text)
        } else if (block.type === 'image') {
          if (block.source?.type === 'base64' && typeof block.source.data === 'string') {
            totalTokens += Math.floor((block.source.data.length * 0.75) / 100)
          } else {
            totalTokens += 1000
          }
        } else if (block.type === 'tool_use') {
          if (typeof block.name === 'string') totalTokens += approximateTokenSize(block.name)
          if (block.input !== undefined) totalTokens += approximateTokenSize(JSON.stringify(block.input))
          totalTokens += 10
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            totalTokens += approximateTokenSize(block.content)
          } else if (Array.isArray(block.content)) {
            for (const item of block.content) {
              if (typeof item === 'string') {
                totalTokens += approximateTokenSize(item)
              } else if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
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
 * `/v1/messages` routes (mounted under `/v1`). The body is validated declaratively
 * by `MessagesBodySchema`; validation and provider errors are shaped into the
 * Anthropic error envelope by the app's single root `onError` (`gatewayErrorHandler`),
 * which dispatches by request path to `anthropicErrorHandler` (see ../errors.ts).
 */
export const messagesRoutes = new Elysia({ prefix: '/messages' })
  .post(
    '/',
    // `model` is "providerId:modelId"; ProxyStreamService resolves it.
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
