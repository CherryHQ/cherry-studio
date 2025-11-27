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
})
