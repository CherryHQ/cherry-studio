import { describe, expect, it } from 'vitest'

import { type ExtendedChatCompletionCreateParams, OpenAiMessageConverter } from '../converters/OpenAiMessageConverter'

const converter = new OpenAiMessageConverter()

/** Build a minimal valid params object; spread overrides the fields under test. */
const params = (overrides: Partial<ExtendedChatCompletionCreateParams>): ExtendedChatCompletionCreateParams =>
  ({ model: 'provider:model', messages: [], ...overrides }) as ExtendedChatCompletionCreateParams

describe('OpenAiMessageConverter', () => {
  it('maps a developer message to a system UIMessage instead of dropping it', () => {
    const messages = converter.toUIMessages(params({ messages: [{ role: 'developer', content: 'Be terse.' }] }))
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].parts).toEqual([{ type: 'text', text: 'Be terse.' }])
  })

  it('prefers max_completion_tokens over the legacy max_tokens, falling back when absent', () => {
    expect(converter.extractStreamOptions(params({ max_completion_tokens: 100, max_tokens: 50 })).maxOutputTokens).toBe(
      100
    )
    expect(converter.extractStreamOptions(params({ max_tokens: 50 })).maxOutputTokens).toBe(50)
    expect(converter.extractStreamOptions(params({})).maxOutputTokens).toBeUndefined()
  })
})
