import { describe, expect, it } from 'vitest'

import { createOpenAIOptions, createOpenRouterOptions, mergeProviderOptions } from '../factory'

describe('mergeProviderOptions', () => {
  it('deep merges provider options for the same provider', () => {
    const reasoningOptions = createOpenRouterOptions({
      reasoning: {
        enabled: true,
        effort: 'medium'
      }
    })
    const webSearchOptions = createOpenRouterOptions({
      plugins: [{ id: 'web', max_results: 5 }]
    })

    const merged = mergeProviderOptions(reasoningOptions, webSearchOptions)

    expect(merged.openrouter).toEqual({
      reasoning: {
        enabled: true,
        effort: 'medium'
      },
      plugins: [{ id: 'web', max_results: 5 }]
    })
  })

  it('preserves options from other providers while merging', () => {
    const openRouter = createOpenRouterOptions({
      reasoning: { enabled: true }
    })
    const openAI = createOpenAIOptions({
      reasoningEffort: 'low'
    })
    const merged = mergeProviderOptions(openRouter, openAI)

    expect(merged.openrouter).toEqual({ reasoning: { enabled: true } })
    expect(merged.openai).toEqual({ reasoningEffort: 'low' })
  })

  it('overwrites primitive values with later values', () => {
    const first = createOpenAIOptions({
      reasoningEffort: 'low',
      user: 'user-123'
    })
    const second = createOpenAIOptions({
      reasoningEffort: 'high',
      maxToolCalls: 5
    })

    const merged = mergeProviderOptions(first, second)

    expect(merged.openai).toEqual({
      reasoningEffort: 'high', // overwritten by second
      user: 'user-123', // preserved from first
      maxToolCalls: 5 // added from second
    })
  })

  it('overwrites arrays with later values instead of merging', () => {
    const first = createOpenRouterOptions({
      models: ['gpt-4', 'gpt-3.5-turbo']
    })
    const second = createOpenRouterOptions({
      models: ['claude-3-opus', 'claude-3-sonnet']
    })

    const merged = mergeProviderOptions(first, second)

    // Array is completely replaced, not merged
    expect(merged.openrouter?.models).toEqual(['claude-3-opus', 'claude-3-sonnet'])
  })

  it('deeply merges nested objects while overwriting primitives', () => {
    const first = createOpenRouterOptions({
      reasoning: {
        enabled: true,
        effort: 'low'
      },
      user: 'user-123'
    })
    const second = createOpenRouterOptions({
      reasoning: {
        effort: 'high',
        max_tokens: 500
      },
      user: 'user-456'
    })

    const merged = mergeProviderOptions(first, second)

    expect(merged.openrouter).toEqual({
      reasoning: {
        enabled: true, // preserved from first
        effort: 'high', // overwritten by second
        max_tokens: 500 // added from second
      },
      user: 'user-456' // overwritten by second
    })
  })

  it('replaces arrays instead of merging them', () => {
    const first = createOpenRouterOptions({ plugins: [{ id: 'old' }] })
    const second = createOpenRouterOptions({ plugins: [{ id: 'new' }] })
    const merged = mergeProviderOptions(first, second)
    // @ts-expect-error type-check for openrouter options is skipped. see function signature of createOpenRouterOptions
    expect(merged.openrouter?.plugins).toEqual([{ id: 'new' }])
  })
})
