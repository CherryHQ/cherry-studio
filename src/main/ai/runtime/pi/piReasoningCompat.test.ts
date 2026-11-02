import { describe, expect, it } from 'vitest'

import type { ReasoningWireMode } from '@cherrystudio/provider-registry'
import type { ResolvedReasoningProfile } from '@data/services/ProviderRegistryService'

import { projectPiReasoningCompat } from './piReasoningCompat'

type Profile = Pick<ResolvedReasoningProfile, 'wireDialect' | 'wire'>
type NonBudgetOperation = Exclude<ReasoningWireMode, { budget: unknown }>['operations'][number]

const adaptive: NonBudgetOperation = { target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }
const enabled: NonBudgetOperation = { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }
const effort: NonBudgetOperation = { target: 'thinking.type', value: { source: 'effort' } }
const summarized: NonBudgetOperation = {
  target: 'thinking.display',
  value: { source: 'literal', value: 'summarized' }
}

function profile(operations: NonBudgetOperation[], overrides: Partial<Profile> = {}): Profile {
  return { wireDialect: 'adaptive-always', wire: { effort: { operations } }, ...overrides }
}

describe('projectPiReasoningCompat', () => {
  it('prevents loss of the adaptive-always dialect projection', () => {
    expect(projectPiReasoningCompat(profile([adaptive]))).toEqual({ forceAdaptiveThinking: true })
  })

  it.each(['effort', 'adaptive-between-tools', 'budget'] as const)(
    'prevents dialect widening to %s even with an adaptive literal',
    (wireDialect) => {
      expect(projectPiReasoningCompat(profile([adaptive], { wireDialect }))).toEqual({})
    }
  )

  it('preserves override precedence when the profile is undefined', () => {
    expect(projectPiReasoningCompat(undefined)).toEqual({})
  })

  it('prevents dialect widening when the dialect is missing', () => {
    expect(projectPiReasoningCompat(profile([adaptive], { wireDialect: undefined }))).toEqual({})
  })

  it('preserves disabled-wire override precedence over the adaptive dialect', () => {
    expect(
      projectPiReasoningCompat(profile([adaptive], { wire: { disabled: true, effort: { operations: [adaptive] } } }))
    ).toEqual({})
  })

  it('preserves enabled-wire override precedence over the adaptive dialect', () => {
    expect(projectPiReasoningCompat(profile([enabled]))).toEqual({})
  })

  it('honors operation ordering when enabled follows adaptive', () => {
    expect(projectPiReasoningCompat(profile([adaptive, enabled]))).toEqual({})
  })

  it('honors operation ordering when adaptive follows enabled', () => {
    expect(projectPiReasoningCompat(profile([enabled, adaptive]))).toEqual({ forceAdaptiveThinking: true })
  })

  it('preserves override precedence when disabled follows adaptive', () => {
    expect(
      projectPiReasoningCompat(
        profile([adaptive, { target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }])
      )
    ).toEqual({})
  })

  it('preserves non-literal override precedence when effort follows adaptive', () => {
    expect(projectPiReasoningCompat(profile([adaptive, effort]))).toEqual({})
  })

  it.each(['default', 'auto', 'off'] as const)('restricts mode selection when adaptive exists only in %s', (mode) => {
    expect(projectPiReasoningCompat(profile([], { wire: { [mode]: { operations: [adaptive] } } }))).toEqual({})
  })

  it('restricts target selection when effort only writes thinking.display', () => {
    expect(projectPiReasoningCompat(profile([summarized]))).toEqual({})
  })

  it('restricts target selection when adaptive is nested under extra_body', () => {
    expect(
      projectPiReasoningCompat(
        profile([{ target: 'extra_body.thinking.type', value: { source: 'literal', value: 'adaptive' } }])
      )
    ).toEqual({})
  })

  it('keeps target selection independent of a later unrelated operation', () => {
    expect(projectPiReasoningCompat(profile([adaptive, summarized]))).toEqual({ forceAdaptiveThinking: true })
  })

  it('rejects an unauthorized rule that any budget operation disqualifies the adaptive dialect', () => {
    expect(
      projectPiReasoningCompat({
        wireDialect: 'adaptive-always',
        wire: {
          effort: {
            operations: [{ target: 'thinking.budget_tokens', value: { source: 'budget' } }, adaptive],
            budget: { missing: { type: 'fallback', value: 1024 } }
          }
        }
      })
    ).toEqual({ forceAdaptiveThinking: true })
  })
})
