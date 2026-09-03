import { resolveUniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

describe('resolveUniqueModelId', () => {
  it('reuses a pre-composed model ID from a persisted snapshot', () => {
    expect(resolveUniqueModelId(null, { provider: 'legacy-provider', id: 'provider-a::model-a' })).toBe(
      'provider-a::model-a'
    )
  })

  it('returns undefined for a legacy snapshot that cannot form a routable model ID', () => {
    expect(resolveUniqueModelId(null, { provider: 'provider-a', id: 'model?legacy-route' })).toBeUndefined()
  })
})
