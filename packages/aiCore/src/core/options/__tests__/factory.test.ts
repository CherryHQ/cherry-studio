import type { OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import { describe, expect, it } from 'vitest'

import { mergeProviderOptions } from '../factory'
import type { TypedProviderOptions } from '../types'

// Helper to build typed options for tests without verbose casts at each call site
const opts = (o: Record<string, Record<string, unknown>>): Partial<TypedProviderOptions> =>
  o as Partial<TypedProviderOptions>

describe('mergeProviderOptions', () => {
  it('deep merges provider options for the same provider', () => {
    const reasoningOptions: Partial<TypedProviderOptions> = {
      openrouter: { reasoning: { enabled: true, effort: 'medium' } } as OpenRouterProviderOptions
    }
    const webSearchOptions = opts({ openrouter: { plugins: [{ id: 'web', max_results: 5 }] } })

    const merged = mergeProviderOptions(reasoningOptions, webSearchOptions)

    expect(merged.openrouter).toEqual({
      reasoning: { enabled: true, effort: 'medium' },
      plugins: [{ id: 'web', max_results: 5 }]
    })
  })

  it('preserves options from other providers while merging', () => {
    const openRouter: Partial<TypedProviderOptions> = {
      openrouter: { reasoning: { enabled: true, effort: 'medium' } } as OpenRouterProviderOptions
    }
    const openAI: Partial<TypedProviderOptions> = { openai: { reasoningEffort: 'low' } }
    const merged = mergeProviderOptions(openRouter, openAI)

    expect(merged.openrouter).toEqual({ reasoning: { enabled: true, effort: 'medium' } })
    expect(merged.openai).toEqual({ reasoningEffort: 'low' })
  })

  it('overwrites primitive values with later values', () => {
    const first: Partial<TypedProviderOptions> = { openai: { reasoningEffort: 'low', user: 'user-123' } }
    const second: Partial<TypedProviderOptions> = { openai: { reasoningEffort: 'high', maxToolCalls: 5 } }

    const merged = mergeProviderOptions(first, second)

    expect(merged.openai).toEqual({
      reasoningEffort: 'high',
      user: 'user-123',
      maxToolCalls: 5
    })
  })

  it('overwrites arrays with later values instead of merging', () => {
    const first = opts({ openrouter: { models: ['gpt-4', 'gpt-3.5-turbo'] } })
    const second = opts({ openrouter: { models: ['claude-3-opus', 'claude-3-sonnet'] } })

    const merged = mergeProviderOptions(first, second)

    expect((merged.openrouter as Record<string, unknown>)?.models).toEqual(['claude-3-opus', 'claude-3-sonnet'])
  })

  it('deeply merges nested objects while overwriting primitives', () => {
    const first = opts({
      openrouter: {
        reasoning: { enabled: true, effort: 'low' },
        user: 'user-123'
      }
    })
    const second = opts({
      openrouter: {
        reasoning: { effort: 'high', max_tokens: 500 },
        user: 'user-456'
      }
    })

    const merged = mergeProviderOptions(first, second)

    expect(merged.openrouter).toEqual({
      reasoning: { enabled: true, effort: 'high', max_tokens: 500 },
      user: 'user-456'
    })
  })

  it('replaces arrays instead of merging them', () => {
    const first = opts({ openrouter: { plugins: [{ id: 'old' }] } })
    const second = opts({ openrouter: { plugins: [{ id: 'new' }] } })
    const merged = mergeProviderOptions(first, second)
    expect((merged.openrouter as Record<string, unknown>)?.plugins).toEqual([{ id: 'new' }])
  })
})
