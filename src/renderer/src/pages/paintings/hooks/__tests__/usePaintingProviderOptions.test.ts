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
  it('keeps every legacy static-catalog provider visible even with zero v2 models (coexistence, no regression)', () => {
    const result = buildPaintingProviderOptions({ models: [], newApiProviderIds: [], ...NO_OVMS })
    // ovms filtered out when not running; the rest stay
    expect(result).toEqual([
      'zhipu',
      'aihubmix',
      'silicon',
      'dmxapi',
      'tokenflux',
      'new-api',
      'cherryin',
      'aionly',
      'ppio'
    ])
  })

  it('auto-includes a brand-new provider whose v2 model is image-capable (no allowlist edit) — the extensibility win', () => {
    const result = buildPaintingProviderOptions({
      models: [model('brandnew', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result).toContain('brandnew')
    // appended after the legacy block, before new-api compat ids
    expect(result.indexOf('brandnew')).toBeGreaterThan(result.indexOf('ppio'))
  })

  it('does NOT add a provider whose models are not image-capable', () => {
    const result = buildPaintingProviderOptions({
      models: [model('text-only-prov', false)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result).not.toContain('text-only-prov')
  })

  it('does not duplicate a legacy provider that also has an image-capable v2 model', () => {
    const result = buildPaintingProviderOptions({
      models: [model('zhipu', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result.filter((id) => id === 'zhipu')).toHaveLength(1)
  })

  it('sorts capability-derived extras deterministically (stable snapshot)', () => {
    const result = buildPaintingProviderOptions({
      models: [model('zeta', true), model('alpha', true)],
      newApiProviderIds: [],
      ...NO_OVMS
    })
    expect(result.indexOf('alpha')).toBeLessThan(result.indexOf('zeta'))
  })

  it('includes user-added new-api compat ids', () => {
    const result = buildPaintingProviderOptions({
      models: [],
      newApiProviderIds: ['my-compat-1'],
      ...NO_OVMS
    })
    expect(result).toContain('my-compat-1')
  })

  it('applies the ovms availability gate (hidden unless supported && running)', () => {
    expect(buildPaintingProviderOptions({ models: [], newApiProviderIds: [], ...NO_OVMS })).not.toContain('ovms')
    expect(buildPaintingProviderOptions({ models: [], newApiProviderIds: [], ...RUNNING_OVMS })).toContain('ovms')
  })
})
