import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import { isContextOverflowError } from '../contextOverflow'

describe('context overflow classification', () => {
  it.each([
    { message: 'The request cannot be processed', data: { error: { code: 'context_length_exceeded' } } },
    { message: "This model's maximum context length is 1048576 tokens. However, you requested 1065651 tokens." },
    { message: "This model's maximum context length is 1048576 tokens" },
    { message: 'Input exceeds the context limit (1048568 tokens)' },
    { message: "The input is longer than the model's context length" },
    { message: 'input token count exceeds the maximum' }
  ])('recognizes context overflow from a provider error', ({ message, data }) => {
    expect(
      isContextOverflowError(new APICallError({ message, data, statusCode: 400, url: 'test', requestBodyValues: {} }))
    ).toBe(true)
  })

  it.each([
    { message: 'Invalid context window parameter', statusCode: 400 },
    { message: 'rate limit: too many tokens', statusCode: 400 },
    { message: 'authentication failed: context_length_exceeded', statusCode: 400 },
    { message: 'context_length_exceeded', statusCode: 429 },
    { message: 'context_length_exceeded', statusCode: 500 }
  ])('does not treat other failures as overflow', ({ message, statusCode }) => {
    expect(isContextOverflowError(new APICallError({ message, statusCode, url: 'test', requestBodyValues: {} }))).toBe(
      false
    )
  })
})
