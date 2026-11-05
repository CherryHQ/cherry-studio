import { describe, expect, it } from 'vitest'

import { serializeError } from '@main/ai/utils/serializeError'

import { ClaudeCodeResultError, claudeControlEvents } from '../ClaudeRuntimeState'

describe('Claude product control mapping', () => {
  it.each([400, 401, 429, 503])('preserves native HTTP %i for product error handling', (statusCode) => {
    const error = new ClaudeCodeResultError({
      message: 'failed',
      subtype: 'success',
      errors: ['failed'],
      terminalReason: 'api_error',
      statusCode
    })
    expect(serializeError(error)).toMatchObject({ statusCode, message: 'failed' })
  })

  it('includes all input buckets and the native reasoning estimate in display statistics', () => {
    expect(
      claudeControlEvents({
        type: 'result',
        sessionId: 'native',
        terminal: true,
        reasoningTokens: 4,
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 11
        } as never
      })
    ).toMatchObject([
      {
        type: 'chunk',
        chunk: {
          type: 'message-metadata',
          messageMetadata: {
            stats: {
              inputTokens: 21,
              outputTokens: 5,
              totalTokens: 26,
              outputTokenDetails: { reasoningTokens: 4 }
            }
          }
        }
      }
    ])
  })
})
