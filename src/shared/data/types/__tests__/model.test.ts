import { areDifferentModelIdentities, resolveUniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

describe('resolveUniqueModelId', () => {
  it('reuses a pre-composed model ID from a persisted snapshot', () => {
    expect(resolveUniqueModelId(null, { provider: 'provider-a', id: 'provider-a::model-a' })).toBe(
      'provider-a::model-a'
    )
  })

  it('keeps the snapshot provider when a raw model ID contains the unique-ID separator', () => {
    expect(resolveUniqueModelId(null, { provider: 'provider-b', id: 'provider-a::model-a' })).toBe(
      'provider-b::provider-a::model-a'
    )
  })

  it('returns undefined for a legacy snapshot that cannot form a routable model ID', () => {
    expect(resolveUniqueModelId(null, { provider: 'provider-a', id: 'model?legacy-route' })).toBeUndefined()
  })

  it('distinguishes raw snapshot IDs that collide after unique-ID parsing', () => {
    expect(
      areDifferentModelIdentities(
        { modelId: null, modelSnapshot: { provider: 'provider-a', id: 'model-a' } },
        { modelId: null, modelSnapshot: { provider: 'provider-a', id: 'provider-a::model-a' } }
      )
    ).toBe(true)
  })

  it('does not classify unresolvable snapshots as different models', () => {
    expect(
      areDifferentModelIdentities(
        { modelId: null, modelSnapshot: { provider: 'provider-a', id: 'model?legacy-route' } },
        { modelId: null, modelSnapshot: { provider: 'provider-b', id: 'model#legacy-route' } }
      )
    ).toBe(false)
  })
})
