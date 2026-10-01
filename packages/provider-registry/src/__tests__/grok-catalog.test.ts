import { describe, expect, it } from 'vitest'

import { isServerToolModelEligible } from '../patterns/serverToolModelEligibility'

describe('Grok native search eligibility', () => {
  it.each(['grok-4.7', 'grok-4-7', 'xai/grok-4.7', 'grok-4.3', 'grok-4.6'])(
    'allows native Web/X search for %s',
    (id) => {
      expect(isServerToolModelEligible(id, 'grok', 'web-search')).toBe(true)
    }
  )

  it.each(['grok-3', 'grok-2-image', 'grok-imagine-image', 'grok-4-unknown'])(
    'does not enable native search for unsupported model %s',
    (id) => {
      expect(isServerToolModelEligible(id, 'grok', 'web-search')).toBe(false)
    }
  )
})
