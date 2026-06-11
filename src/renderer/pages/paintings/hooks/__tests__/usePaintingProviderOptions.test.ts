import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { buildPaintingProviderOptions } from '../usePaintingProviderOptions'

function model(providerId: string, imageCapable: boolean): Model {
  return {
    providerId,
    capabilities: imageCapable ? [MODEL_CAPABILITY.IMAGE_GENERATION] : []
  } as unknown as Model
}

const RUNNING_OVMS = { ovmsSupported: true, ovmsStatus: 'running' as const }
const NO_OVMS = { ovmsSupported: false, ovmsStatus: 'not-running' as const }

describe('buildPaintingProviderOptions', () => {
  it('returns empty when the user has no enabled image-gen models (no allowlist fallback)', () => {
    const result = buildPaintingProviderOptions({ models: [], newApiProviderIds: [], ...NO_OVMS })
    expect(result).toEqual([])
  })

  it('auto-includes any provider whose v2 model is image-capable (capability-derived)', () => {
    const result = buildPaintingProviderOptions({
      models: [model('brandnew', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result).toEqual(['brandnew'])
  })

  it('does NOT add a provider whose models are not image-capable', () => {
    const result = buildPaintingProviderOptions({
      models: [model('text-only-prov', false)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result).not.toContain('text-only-prov')
  })

  it('does not duplicate a provider that has multiple image-capable v2 models', () => {
    const result = buildPaintingProviderOptions({
      models: [model('zhipu', true), model('zhipu', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result.filter((id) => id === 'zhipu')).toHaveLength(1)
  })

  it('sorts capability-derived providers deterministically', () => {
    const result = buildPaintingProviderOptions({
      models: [model('zeta', true), model('alpha', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result).toEqual(['alpha', 'zeta'])
  })

  it('includes user-added new-api compat ids alongside capability-derived providers', () => {
    const result = buildPaintingProviderOptions({
      models: [model('silicon', true)],
      newApiProviderIds: ['my-compat-1'],
      ...NO_OVMS
    })
    expect(result).toContain('silicon')
    expect(result).toContain('my-compat-1')
  })

  it('hides ovms unless it is supported AND running', () => {
    expect(
      buildPaintingProviderOptions({
        models: [model('ovms', true)],
        newApiProviderIds: [],
        ...NO_OVMS
      })
    ).not.toContain('ovms')
    expect(
      buildPaintingProviderOptions({
        models: [model('ovms', true)],
        newApiProviderIds: [],
        ...RUNNING_OVMS
      })
    ).toContain('ovms')
  })
})
