import { describe, expect, it } from 'vitest'

import { getEffectiveMaxToolCalls, usesOpenAIResponsesApi } from '../parameterBuilder'

describe('usesOpenAIResponsesApi', () => {
  it('maps the native OpenAI Responses provider', () => {
    expect(usesOpenAIResponsesApi('openai', undefined)).toBe(true)
  })

  it('maps Azure Responses', () => {
    expect(usesOpenAIResponsesApi('azure-responses', undefined)).toBe(true)
  })

  it('maps proxy providers tagged with the openai-response endpoint type', () => {
    expect(usesOpenAIResponsesApi('cherryin', 'openai-response')).toBe(true)
    expect(usesOpenAIResponsesApi('newapi', 'openai-response')).toBe(true)
  })

  it('does not map Chat Completions variants', () => {
    expect(usesOpenAIResponsesApi('openai-chat', undefined)).toBe(false)
    expect(usesOpenAIResponsesApi('azure', undefined)).toBe(false)
    expect(usesOpenAIResponsesApi('huggingface', undefined)).toBe(false)
  })

  it('does not map unrelated providers', () => {
    expect(usesOpenAIResponsesApi('anthropic', undefined)).toBe(false)
    expect(usesOpenAIResponsesApi('google', 'gemini')).toBe(false)
  })
})

describe('getEffectiveMaxToolCalls', () => {
  it('uses the default cap when settings are missing', () => {
    expect(getEffectiveMaxToolCalls()).toBe(20)
  })

  it('uses the default cap when the switch is off', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: false,
        maxToolCalls: 50
      })
    ).toBe(20)
  })

  it('uses a custom cap when enabled', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 50
      })
    ).toBe(50)
  })

  it('clamps invalid custom values back to the default cap', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 999
      })
    ).toBe(20)
  })

  it('uses the default cap for old assistants without the new fields', () => {
    expect(
      getEffectiveMaxToolCalls({
        temperature: 0.7,
        contextCount: 10
      } as { maxToolCalls?: number; enableMaxToolCalls?: boolean })
    ).toBe(20)
  })
})
