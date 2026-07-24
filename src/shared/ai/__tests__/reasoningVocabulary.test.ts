import type { Model, RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { deriveThinkingOptions, nearestThinkingOption } from '../reasoning'

const model = (reasoning?: RuntimeReasoning, capabilities: string[] = ['reasoning']): Model =>
  ({
    id: 'p::m',
    providerId: 'p',
    apiModelId: 'm',
    name: 'm',
    capabilities,
    reasoning,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) as Model

describe('deriveThinkingOptions', () => {
  it('returns undefined when the model or active profile exposes no control', () => {
    expect(deriveThinkingOptions(model(undefined, []))).toBeUndefined()
    expect(deriveThinkingOptions(model(undefined))).toBeUndefined()
    expect(deriveThinkingOptions(model({ selectableEfforts: [] }))).toBeUndefined()
  })

  it('only presents the selectable efforts projected by registry enrichment', () => {
    expect(
      deriveThinkingOptions(
        model({
          controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
          selectableEfforts: ['none', 'low', 'medium', 'high', 'xhigh']
        })
      )
    ).toEqual(['default', 'none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('hoists none after the synthesized default option', () => {
    expect(deriveThinkingOptions(model({ selectableEfforts: ['low', 'none', 'high'] }))).toEqual([
      'default',
      'none',
      'low',
      'high'
    ])
  })
})

describe('nearestThinkingOption', () => {
  const options = ['default', 'none', 'low', 'medium', 'high', 'max'] as const

  it('keeps an in-vocabulary value', () => {
    expect(nearestThinkingOption('medium', options)).toBe('medium')
  })

  it("maps the legacy 'xhigh' alias onto the adjacent native tier", () => {
    expect(nearestThinkingOption('xhigh', options)).toBe('max')
  })

  it('breaks distance ties upward (minimal → low, not none)', () => {
    expect(nearestThinkingOption('minimal', options)).toBe('low')
  })

  it("never returns 'default'", () => {
    expect(nearestThinkingOption('high', ['default', 'high'])).toBe('high')
  })
})
