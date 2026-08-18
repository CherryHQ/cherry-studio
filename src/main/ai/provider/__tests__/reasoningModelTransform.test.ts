import { describe, expect, it } from 'vitest'

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
