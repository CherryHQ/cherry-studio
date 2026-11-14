import { describe, expect, it } from 'vitest'

import { openRouterReasoningFromMetadata } from '../listModels/openRouterReasoning'

// OpenRouter publishes `supported_efforts` in descending order; an explicit `null`
// is "no allowlist" (the whole gateway vocabulary), not an omitted key.
const GATEWAY_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const

describe('openRouterReasoningFromMetadata', () => {
  it('publishes the full gateway vocabulary, max included, for an explicit null allowlist', () => {
    const reasoning = openRouterReasoningFromMetadata({
      reasoning: { supported_efforts: null },
      supported_parameters: ['reasoning', 'reasoning_effort']
    })

    expect(reasoning?.controls).toEqual([{ kind: 'effort', values: [...GATEWAY_EFFORTS] }])
    expect(reasoning?.selectableEfforts).toEqual([...GATEWAY_EFFORTS])
  })

  it('accepts a declared default that only the gateway vocabulary covers', () => {
    const reasoning = openRouterReasoningFromMetadata({
      reasoning: { supported_efforts: null, default_effort: 'max' }
    })

    expect(reasoning?.controls).toEqual([{ kind: 'effort', values: [...GATEWAY_EFFORTS], default: 'max' }])
    expect(reasoning?.defaultEffort).toBe('max')
  })

  it('keeps an omitted allowlist distinct from null and falls back to the standard tiers', () => {
    const reasoning = openRouterReasoningFromMetadata({
      reasoning: { mandatory: true },
      supported_parameters: ['reasoning', 'reasoning_effort']
    })

    expect(reasoning?.selectableEfforts).toEqual(['low', 'medium', 'high'])
  })

  it('does not offer Off for a mandatory model that rejects effort none', () => {
    const reasoning = openRouterReasoningFromMetadata({
      reasoning: { mandatory: true, supported_efforts: ['none', 'high'], default_effort: 'high' }
    })

    expect(reasoning?.controls).toEqual([{ kind: 'effort', values: ['high'], default: 'high' }])
    expect(reasoning?.selectableEfforts).toEqual(['high'])
  })

  it('keeps Off selectable when the model is not mandatory', () => {
    const reasoning = openRouterReasoningFromMetadata({
      reasoning: { mandatory: false, supported_efforts: ['none', 'high'] }
    })

    expect(reasoning?.controls).toEqual([{ kind: 'effort', values: ['none', 'high'] }, { kind: 'toggle' }])
    expect(reasoning?.selectableEfforts).toEqual(['none', 'high'])
  })
})
