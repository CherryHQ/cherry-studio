import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { REASONING_EFFORT } from '@cherrystudio/provider-registry'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { resolvePiThinkingLevel } from './piThinkingLevel'

const expectations = {
  default: undefined,
  none: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'ultra',
  auto: undefined
} satisfies Record<ReasoningEffortOption, ModelThinkingLevel | undefined>

describe('resolvePiThinkingLevel', () => {
  it.each<ReasoningEffortOption>(['default', ...Object.values(REASONING_EFFORT)])(
    'preserves the deliberate Pi selection for %s',
    (selection) => {
      expect(resolvePiThinkingLevel(selection)).toBe(expectations[selection])
    }
  )

  it('keeps absent input on the SDK default path', () => {
    expect(resolvePiThinkingLevel()).toBeUndefined()
  })

  it('requires a deliberate mapping for every canonical effort added to the registry', () => {
    for (const selection of Object.values(REASONING_EFFORT)) {
      expect(Object.hasOwn(expectations, selection), selection).toBe(true)
    }
  })
})
