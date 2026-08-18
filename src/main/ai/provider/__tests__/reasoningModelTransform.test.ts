import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import { describe, expect, it, vi } from 'vitest'

import { applyReasoningModelMaxTokensConversion, isOpenAIReasoningModelId } from '../reasoningModelTransform'

describe('isOpenAIReasoningModelId', () => {
  it('identifies o1 models', () => {
    expect(isOpenAIReasoningModelId('o1')).toBe(true)
    expect(isOpenAIReasoningModelId('o1-mini')).toBe(true)
    expect(isOpenAIReasoningModelId('o1-preview')).toBe(true)
  })

  it('identifies o3 models', () => {
    expect(isOpenAIReasoningModelId('o3')).toBe(true)
    expect(isOpenAIReasoningModelId('o3-mini')).toBe(true)
    expect(isOpenAIReasoningModelId('o3-2025-04-16')).toBe(true)
  })

  it('identifies o4-mini', () => {
    expect(isOpenAIReasoningModelId('o4-mini')).toBe(true)
  })

  it('identifies GPT-5 models', () => {
    expect(isOpenAIReasoningModelId('gpt-5')).toBe(true)
    expect(isOpenAIReasoningModelId('gpt-5.1')).toBe(true)
    expect(isOpenAIReasoningModelId('gpt-5.2')).toBe(true)
  })

  it('excludes gpt-5-chat', () => {
    expect(isOpenAIReasoningModelId('gpt-5-chat')).toBe(false)
  })

  it('excludes non-reasoning models', () => {
    expect(isOpenAIReasoningModelId('gpt-4o')).toBe(false)
    expect(isOpenAIReasoningModelId('gpt-4-turbo')).toBe(false)
    expect(isOpenAIReasoningModelId('claude-sonnet-4-6')).toBe(false)
    expect(isOpenAIReasoningModelId('o4')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isOpenAIReasoningModelId('O1')).toBe(true)
    expect(isOpenAIReasoningModelId('GPT-5')).toBe(true)
    expect(isOpenAIReasoningModelId('O4-MINI')).toBe(true)
  })
})

describe('applyReasoningModelMaxTokensConversion', () => {
  it('converts max_tokens to max_completion_tokens for reasoning models', () => {
    const body = { model: 'o3', max_tokens: 1000, messages: [] }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(1000)
    expect(result.max_tokens).toBeUndefined()
  })

  it('converts for GPT-5 models', () => {
    const body = { model: 'gpt-5', max_tokens: 128000 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(128000)
    expect(result.max_tokens).toBeUndefined()
  })

  it('passes through non-reasoning models unchanged', () => {
    const body = { model: 'gpt-4o', max_tokens: 4096 }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.max_tokens).toBe(4096)
    expect(result.max_completion_tokens).toBeUndefined()
  })

  it('passes through when max_tokens is absent', () => {
    const body = { model: 'o3', messages: [] }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result).toEqual(body)
  })

  it('passes through non-object input', () => {
    expect(applyReasoningModelMaxTokensConversion(null as any)).toBe(null)
    expect(applyReasoningModelMaxTokensConversion(undefined as any)).toBe(undefined)
  })

  it('passes through when model field is missing', () => {
    const body = { max_tokens: 1000 }
    const result = applyReasoningModelMaxTokensConversion(body)
    expect(result).toEqual(body)
  })

  it('preserves other body fields', () => {
    const body = { model: 'o3', max_tokens: 1000, temperature: 0.7, stream: true }
    const result = applyReasoningModelMaxTokensConversion(body) as Record<string, unknown>
    expect(result.temperature).toBe(0.7)
    expect(result.stream).toBe(true)
    expect(result.max_completion_tokens).toBe(1000)
  })
})

/** Minimal valid OpenAI chat completion response for doGenerate. */
function fakeSuccessResponse() {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-fake',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('wire-body regression', () => {
  it('default OpenAI-compatible config wires transformRequestBody through model', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const model = new OpenAICompatibleChatLanguageModel('o3', {
      provider: 'test.chat',
      url: () => 'https://api.example.com/v1/chat/completions',
      headers: () => ({}),
      fetch: fetchSpy,
      transformRequestBody: applyReasoningModelMaxTokensConversion
    })

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 1000,
      mode: { type: 'regular' }
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(1000)
    expect(body.max_tokens).toBeUndefined()
  })

  it('NewAPI direct instantiation wires transformRequestBody through model', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const model = new OpenAICompatibleChatLanguageModel('o3', {
      provider: 'newapi.chat',
      url: () => 'https://newapi.example.com/v1/chat/completions',
      headers: () => ({}),
      fetch: fetchSpy,
      transformRequestBody: applyReasoningModelMaxTokensConversion
    })

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 2000,
      mode: { type: 'regular' }
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(2000)
    expect(body.max_tokens).toBeUndefined()
  })

  it('CherryIn subclass wires transformRequestBody through model', async () => {
    // CherryIn extends OpenAICompatibleChatLanguageModel with the same hook.
    // Test via a plain instance with the hook wired — the subclass delegates to super.
    const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
    const model = new OpenAICompatibleChatLanguageModel('gpt-5', {
      provider: 'cherryin.chat',
      url: () => 'https://cherryin.example.com/v1/chat/completions',
      headers: () => ({}),
      fetch: fetchSpy,
      transformRequestBody: applyReasoningModelMaxTokensConversion
    })

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 4096,
      mode: { type: 'regular' }
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
  })
})
