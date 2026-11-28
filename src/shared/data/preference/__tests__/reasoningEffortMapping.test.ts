import { describe, expect, it } from 'vitest'

import type { ReasoningEffortMappingOverrides } from '../preferenceTypes'
import { applyReasoningEffortMappingEntry, readReasoningEffortScopeMap } from '../reasoningEffortMapping'

describe('applyReasoningEffortMappingEntry', () => {
  it('sets a global entry without touching provider scopes', () => {
    const base: ReasoningEffortMappingOverrides = {
      providers: { openai: { default: { high: 'low' } } }
    }
    expect(applyReasoningEffortMappingEntry(base, { scope: 'global', source: 'low', target: 'medium' })).toEqual({
      global: { low: 'medium' },
      providers: { openai: { default: { high: 'low' } } }
    })
  })

  it('merges successive independent global entries', () => {
    const first = applyReasoningEffortMappingEntry({}, { scope: 'global', source: 'low', target: 'medium' })
    const second = applyReasoningEffortMappingEntry(first, { scope: 'global', source: 'high', target: 'low' })
    expect(second).toEqual({ global: { low: 'medium', high: 'low' } })
  })

  it('merges entries across different providers', () => {
    const first = applyReasoningEffortMappingEntry(
      {},
      { scope: 'provider', providerId: 'openai', source: 'low', target: 'medium' }
    )
    const second = applyReasoningEffortMappingEntry(first, {
      scope: 'provider',
      providerId: 'anthropic',
      source: 'high',
      target: 'low'
    })
    expect(second).toEqual({
      providers: {
        openai: { default: { low: 'medium' } },
        anthropic: { default: { high: 'low' } }
      }
    })
  })

  it('clears an entry with a null target and drops the emptied global map', () => {
    const base: ReasoningEffortMappingOverrides = { global: { low: 'medium' } }
    expect(applyReasoningEffortMappingEntry(base, { scope: 'global', source: 'low', target: null })).toEqual({
      global: undefined
    })
  })

  it('clears one provider entry while keeping siblings', () => {
    const base: ReasoningEffortMappingOverrides = {
      providers: { openai: { default: { low: 'medium', high: 'low' } } }
    }
    expect(
      applyReasoningEffortMappingEntry(base, { scope: 'provider', providerId: 'openai', source: 'low', target: null })
    ).toEqual({ providers: { openai: { default: { high: 'low' } } } })
  })

  it('does not mutate the input overrides object', () => {
    const base: ReasoningEffortMappingOverrides = { global: { low: 'medium' } }
    applyReasoningEffortMappingEntry(base, { scope: 'global', source: 'high', target: 'low' })
    expect(base).toEqual({ global: { low: 'medium' } })
  })
})

describe('readReasoningEffortScopeMap', () => {
  it('returns empty maps for missing scopes', () => {
    expect(readReasoningEffortScopeMap({}, 'global')).toEqual({})
    expect(readReasoningEffortScopeMap({}, 'provider', 'openai')).toEqual({})
  })
})
