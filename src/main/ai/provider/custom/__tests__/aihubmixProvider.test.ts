import { describe, expect, it } from 'vitest'

import { createAihubmix } from '../aihubmix/aihubmixProvider'

describe('createAihubmix', () => {
  const provider = createAihubmix({ apiKey: 'sk-test' })

  it('routes OpenAI LLM ids to the Responses API model', () => {
    const model = provider.languageModel('gpt-4o') as unknown as { constructor: { name: string }; provider: string }

    expect(model.constructor.name).toBe('OpenAIResponsesLanguageModel')
    expect(model.provider).toBe('aihubmix.openai-response')
  })

  it('routes OpenAI search preview ids to chat completions', () => {
    const model = provider.languageModel('gpt-4o-search-preview') as unknown as {
      constructor: { name: string }
      provider: string
    }

    expect(model.constructor.name).toBe('OpenAIChatLanguageModel')
    expect(model.provider).toBe('openai-compatible.aihubmix')
  })

  it('keeps non-OpenAI ids on the OpenAI-compatible fallback', () => {
    const model = provider.languageModel('qwen3.5-plus') as unknown as {
      constructor: { name: string }
      provider: string
    }

    expect(model.constructor.name).toBe('OpenAICompatibleChatLanguageModel')
    expect(model.provider).toBe('openai-compatible.aihubmix')
  })
})
