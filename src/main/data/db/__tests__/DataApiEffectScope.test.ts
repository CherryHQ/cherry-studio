import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { describe, expect, it } from 'vitest'

import { DataApiEffectScope } from '../DataApiEffectScope'

const TOPIC_EFFECT: DataApiDataChangeEffect = {
  endpoint: '/topics/:id',
  routeParams: { id: 'topic-1' }
}

describe('DataApiEffectScope', () => {
  it('merges nested successful scopes into one deduplicated outer batch', () => {
    const scope = new DataApiEffectScope()
    const outer = scope.collect((effects) => {
      effects.add(TOPIC_EFFECT)
      const inner = scope.collect((nested) => nested.add({ ...TOPIC_EFFECT, routeParams: { id: 'topic-1' } }))
      expect(inner.committedEffects).toBeUndefined()
    })

    expect(outer.committedEffects).toEqual([TOPIC_EFFECT])
  })

  it('rolls back only a failed nested scope when its caller recovers', () => {
    const scope = new DataApiEffectScope()
    const outer = scope.collect((effects) => {
      effects.add(TOPIC_EFFECT)
      try {
        scope.collect((nested) => {
          nested.add({ endpoint: '/topics/latest' })
          throw new Error('nested rollback')
        })
      } catch {}
    })

    expect(outer.committedEffects).toEqual([TOPIC_EFFECT])
  })

  it('publishes no batch when the outer scope rolls back', () => {
    const scope = new DataApiEffectScope()

    expect(() =>
      scope.collect((effects) => {
        effects.add(TOPIC_EFFECT)
        throw new Error('outer rollback')
      })
    ).toThrow('outer rollback')
  })
})
