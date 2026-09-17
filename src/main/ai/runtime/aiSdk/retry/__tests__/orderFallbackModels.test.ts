import { describe, expect, it } from 'vitest'

import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

import { orderFallbackModels } from '../orderFallbackModels'

const id = (value: string) => value as RetryFallbackModelId

const healthy = (checkedAt = 1) => ({ ok: true, checkedAt })
const broken = (checkedAt = 1) => ({ ok: false, checkedAt })

describe('orderFallbackModels', () => {
  it('tries a model whose last probe failed after one that has never been probed', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken() }

    expect(orderFallbackModels(ids, health)).toEqual([id('groq::llama-3.1-70b'), id('openai::gpt-4o')])
  })

  it('puts a probed-healthy model ahead of an unprobed higher-quality one', () => {
    const ids = [id('openai::gpt-3.5-turbo'), id('anthropic::claude-opus-4')]
    const health: ModelHealthMemory = { 'openai::gpt-3.5-turbo': healthy() }

    expect(orderFallbackModels(ids, health)[0]).toBe(id('openai::gpt-3.5-turbo'))
  })

  it('breaks ties within the same health tier by quality score', () => {
    const ids = [id('openai::gpt-3.5-turbo'), id('anthropic::claude-opus-4')]
    const health: ModelHealthMemory = { 'openai::gpt-3.5-turbo': healthy(), 'anthropic::claude-opus-4': healthy() }

    expect(orderFallbackModels(ids, health)).toEqual([id('anthropic::claude-opus-4'), id('openai::gpt-3.5-turbo')])
  })

  it('keeps every configured fallback, since a failed provider may have recovered', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken(), 'groq::llama-3.1-70b': broken() }

    expect(orderFallbackModels(ids, health)).toHaveLength(2)
  })
})
