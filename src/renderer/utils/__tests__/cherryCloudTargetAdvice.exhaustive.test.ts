import { describe, expect, it } from 'vitest'

import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { type UniqueModelId, createUniqueModelId } from '@shared/data/types/model'

import { getCherryCloudTargetAdvice, hasKnownExhaustedTarget } from '../cherryCloudTargetAdvice'

const cloudA = createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'model-a')
const cloudB = createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'model-b')
const other = createUniqueModelId('openai', 'model-c')
const targets = [cloudA, cloudB, other]
const orders = [
  [],
  [cloudA],
  [cloudB],
  [other],
  [cloudA, cloudB],
  [cloudB, cloudA],
  [cloudA, other],
  [other, cloudA],
  [cloudB, other],
  [other, cloudB],
  [cloudA, cloudB, other],
  [cloudA, other, cloudB],
  [cloudB, cloudA, other],
  [cloudB, other, cloudA],
  [other, cloudA, cloudB],
  [other, cloudB, cloudA]
]

// Catches stale quota advice, lost multi-model identity and quota leaking to another provider.
describe('bounded actual target advice', () => {
  it('satisfies the contract for all ordered subsets, quota partitions and freshness states', () => {
    for (const freshness of ['unknown', 'fresh', 'stale'] as const) {
      for (let mask = 0; mask < 8; mask++) {
        const exhausted = new Set(targets.filter((_, bit) => mask & (1 << bit)))
        const facts = { freshness, isModelUnavailable: ({ id }: { id: UniqueModelId }) => exhausted.has(id) }
        expect(getCherryCloudTargetAdvice(undefined, facts)).toBeUndefined()
        expect(hasKnownExhaustedTarget(undefined)).toBe(false)
        for (const ids of orders) {
          const advice = getCherryCloudTargetAdvice(ids, facts)
          expect(advice?.map((target) => target.targetId)).toEqual(ids)
          const knownExhausted = freshness === 'fresh' ? ids.filter((id) => id !== other && exhausted.has(id)) : []
          expect(
            advice?.filter((target) => target.state === 'known-exhausted').map((target) => target.targetId)
          ).toEqual(knownExhausted)
          expect(hasKnownExhaustedTarget(advice)).toBe(knownExhausted.length > 0)
          const unknown = freshness === 'fresh' ? [] : ids.filter((id) => id !== other)
          expect(advice?.filter((target) => target.state === 'unknown').map((target) => target.targetId)).toEqual(
            unknown
          )
          if (ids.includes(other)) expect(advice).toContainEqual({ targetId: other, state: 'no-known-obstacle' })
        }
      }
    }
  })
})
