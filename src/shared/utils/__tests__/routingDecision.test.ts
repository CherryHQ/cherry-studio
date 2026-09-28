import { describe, expect, it } from 'vitest'

import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'

import { bestHealthyModelId, pickCategoryModel } from '../routingDecision'

// Distinct, known quality tiers (see `modelQuality.ts`), so assertions don't rely on sort stability
// between two equally-unscored ids.
const STRONG = 'x::claude-opus-5' as UniqueModelId // 98
const MID = 'x::gpt-5' as UniqueModelId // 90
const WEAK = 'x::haiku' as UniqueModelId // 48

const fresh = (ok: boolean) => ({ ok, checkedAt: Date.now() })

describe('pickCategoryModel', () => {
  it('picks the strongest candidate for hard work', () => {
    expect(pickCategoryModel([WEAK, STRONG], {}, 'hard')).toBe(STRONG)
  })

  it('picks the weakest candidate for easy work, to save quota', () => {
    expect(pickCategoryModel([WEAK, STRONG], {}, 'easy')).toBe(WEAK)
  })

  it('skips a candidate whose last health probe failed', () => {
    const health: ModelHealthMemory = { [STRONG]: fresh(false) }
    expect(pickCategoryModel([STRONG, MID, WEAK], health, 'hard')).toBe(MID)
  })

  it('falls back to the full candidate list when every candidate is unhealthy', () => {
    const health: ModelHealthMemory = { [STRONG]: fresh(false), [WEAK]: fresh(false) }
    expect(pickCategoryModel([STRONG, WEAK], health, 'hard')).toBe(STRONG)
  })
})

describe('bestHealthyModelId', () => {
  it('picks the highest-quality model among healthy, existing entries', () => {
    const health: ModelHealthMemory = { [WEAK]: fresh(true), [STRONG]: fresh(true), ['x::missing']: fresh(true) }
    expect(bestHealthyModelId(health, (id) => id !== 'x::missing')).toBe(STRONG)
  })

  it('ignores an entry whose last probe failed', () => {
    const health: ModelHealthMemory = { [STRONG]: fresh(false), [WEAK]: fresh(true) }
    expect(bestHealthyModelId(health, () => true)).toBe(WEAK)
  })

  it('returns undefined when nothing qualifies', () => {
    expect(bestHealthyModelId({}, () => true)).toBeUndefined()
  })
})
