import { describe, expect, it } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

/**
 * DeepSeek thinking-mode models must always route through the chat-completions
 * path (provider 'cherryin.openai-chat') so the reasoning_content patch applies.
 * An explicit 'openai-response' endpoint must not reroute them to the Responses
 * API (provider 'cherryin.openai'), which drops reasoning_content. Fixes #18150.
 */

describe('createCherryIn DeepSeek routing', () => {
  it('routes DeepSeek models through chat-completions even with an explicit openai-response endpoint', () => {
    const provider = createCherryIn({ endpointType: 'openai-response' })
    const model = provider.languageModel('deepseek-v4')

    expect(model.provider).toBe('cherryin.openai-chat')
  })

  it('routes DeepSeek models through chat-completions when endpointType is undefined', () => {
    const provider = createCherryIn()
    const model = provider.languageModel('deepseek-r1')

    expect(model.provider).toBe('cherryin.openai-chat')
  })

  it('keeps non-DeepSeek models on the responses path when openai-response is configured', () => {
    const provider = createCherryIn({ endpointType: 'openai-response' })
    const model = provider.languageModel('gpt-5')

    expect(model.provider).toBe('cherryin.openai')
  })
})
