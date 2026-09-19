import { describe, expect, it } from 'vitest'

import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

import { orderFallbackModels } from '../orderFallbackModels'

const id = (value: string) => value as RetryFallbackModelId

const healthy = (checkedAt = Date.now()) => ({ ok: true, checkedAt })
const broken = (checkedAt = Date.now()) => ({ ok: false, checkedAt })

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

  it('ranks an unprobed model ahead of one whose failure has gone stale', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = {
      'openai::gpt-4o': broken(Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1)
    }

    // A stale failure reads as unknown, the same tier as never having been probed — quality then
    // decides, and gpt-4o outranks llama-3.1-70b there.
    expect(orderFallbackModels(ids, health)).toEqual([id('openai::gpt-4o'), id('groq::llama-3.1-70b')])
  })

  it('treats a failure recorded exactly at the staleness boundary as expired, not fresh', () => {
    const ids = [id('openai::gpt-4o'), id('groq::llama-3.1-70b')]
    const health: ModelHealthMemory = { 'openai::gpt-4o': broken(Date.now() - MODEL_HEALTH_STALE_AFTER_MS) }

    expect(orderFallbackModels(ids, health)).toEqual([id('openai::gpt-4o'), id('groq::llama-3.1-70b')])
  })
})
