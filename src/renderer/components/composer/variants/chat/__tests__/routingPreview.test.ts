import { describe, expect, it } from 'vitest'

import type { CategoryModelMap, ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import { EMPTY_DERIVED_ROUTING_TABLE, type DerivedRoutingTable } from '@shared/data/types/routing'

import { computeRoutingPreview, type RoutingPreviewInput } from '../routingPreview'

const FALLBACK = 'openai::gpt-4o-mini' as UniqueModelId
const CODER = 'deepseek::deepseek-coder' as UniqueModelId
const PINNED = 'anthropic::claude-opus-5' as UniqueModelId

const baseInput = (overrides: Partial<RoutingPreviewInput> = {}): RoutingPreviewInput => ({
  promptText: 'naber',
  fallbackModelId: FALLBACK,
  hasMentionedModels: false,
  autoEnabled: true,
  pinnedModelId: '',
  categoryModels: {},
  derivedTable: EMPTY_DERIVED_ROUTING_TABLE,
  health: {},
  modelExists: () => true,
  ...overrides
})

describe('computeRoutingPreview', () => {
  it('stays silent once an explicit @-mention already decides the destination', () => {
    expect(computeRoutingPreview(baseInput({ hasMentionedModels: true, pinnedModelId: PINNED }))).toBeUndefined()
  })

  it('reports a pinned model that differs from the default', () => {
    expect(computeRoutingPreview(baseInput({ pinnedModelId: PINNED }))).toEqual({
      destinationModelId: PINNED,
      reason: 'pinned'
    })
  })

  it('says nothing when the pinned model is the same as the default', () => {
    expect(computeRoutingPreview(baseInput({ pinnedModelId: FALLBACK }))).toBeUndefined()
  })

  it('falls through to category routing once a pinned model no longer exists', () => {
    const derivedTable: DerivedRoutingTable = {
      ...EMPTY_DERIVED_ROUTING_TABLE,
      general: [{ id: CODER, score: 10, quality: 10, affinity: 0, healthDelta: 0, quotaDelta: 0 }]
    }
    const result = computeRoutingPreview(
      baseInput({ pinnedModelId: PINNED, derivedTable, modelExists: (id) => id !== PINNED })
    )
    expect(result).toEqual({ destinationModelId: CODER, reason: 'category', category: 'general' })
  })

  it('leaves the default alone when auto-routing is off', () => {
    expect(computeRoutingPreview(baseInput({ autoEnabled: false, pinnedModelId: '' }))).toBeUndefined()

    const derivedTable: DerivedRoutingTable = {
      ...EMPTY_DERIVED_ROUTING_TABLE,
      code: [{ id: CODER, score: 10, quality: 10, affinity: 0, healthDelta: 0, quotaDelta: 0 }]
    }
    expect(
      computeRoutingPreview(baseInput({ autoEnabled: false, promptText: 'şu fonksiyonu refactor et', derivedTable }))
    ).toBeUndefined()
  })

  it('routes a coding request to the configured category model', () => {
    const categoryModels: CategoryModelMap = { code: [CODER] }
    const result = computeRoutingPreview(baseInput({ promptText: 'şu fonksiyonu refactor et', categoryModels }))
    expect(result).toEqual({ destinationModelId: CODER, reason: 'category', category: 'code' })
  })

  it('says nothing when the category pick is the same model already shown', () => {
    const categoryModels: CategoryModelMap = { general: [FALLBACK] }
    expect(computeRoutingPreview(baseInput({ categoryModels }))).toBeUndefined()
  })

  it('rescues a default whose last health probe failed, even with no category mapped', () => {
    const health: ModelHealthMemory = {
      [FALLBACK]: { ok: false, checkedAt: Date.now() },
      [CODER]: { ok: true, checkedAt: Date.now() }
    }
    expect(computeRoutingPreview(baseInput({ health }))).toEqual({
      destinationModelId: CODER,
      reason: 'health_rescue'
    })
  })

  it('says nothing when an unprobed default has no rescue candidate', () => {
    expect(computeRoutingPreview(baseInput())).toBeUndefined()
  })

  it('never throws, even if a lookup blows up', () => {
    expect(
      computeRoutingPreview(
        baseInput({
          modelExists: () => {
            throw new Error('boom')
          }
        })
      )
    ).toBeUndefined()
  })

  it('never throws when the pinned-model check itself blows up', () => {
    expect(
      computeRoutingPreview(
        baseInput({
          pinnedModelId: PINNED,
          modelExists: () => {
            throw new Error('boom')
          }
        })
      )
    ).toBeUndefined()
  })
})
