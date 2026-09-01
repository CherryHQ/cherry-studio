import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { buildPaintingProviderOptions } from '../usePaintingProviderOptions'

function model(providerId: string, imageCapableOrOverrides: boolean | Partial<Model>): Model {
  const overrides =
    typeof imageCapableOrOverrides === 'boolean'
      ? { capabilities: imageCapableOrOverrides ? [MODEL_CAPABILITY.IMAGE_GENERATION] : [] }
      : imageCapableOrOverrides

  return {
    providerId,
    capabilities: [],
    isHidden: false,
    isEnabled: true,
    ...overrides
  } as Model
}

const RUNNING_OVMS = { ovmsSupported: true, ovmsStatus: 'running' as const }
const NO_OVMS = { ovmsSupported: false, ovmsStatus: 'not-running' as const }
type OvmsState = Pick<Parameters<typeof buildPaintingProviderOptions>[0], 'ovmsStatus' | 'ovmsSupported'>

function provider(id: string, isEnabled = true): Pick<Provider, 'id' | 'isEnabled'> {
  return { id, isEnabled }
}

function buildOptions(
  models: readonly Model[],
  ovmsState: OvmsState = NO_OVMS,
  providers: readonly Pick<Provider, 'id' | 'isEnabled'>[] = [...new Set(models.map((item) => item.providerId))].map(
    (id) => provider(id)
  )
) {
  return buildPaintingProviderOptions({ models, providers, ...ovmsState })
}

describe('buildPaintingProviderOptions', () => {
  it('returns empty when the user has no enabled image-gen models (no allowlist fallback)', () => {
    const result = buildOptions([])
    expect(result).toEqual([])
  })

  it('auto-includes any provider whose v2 model is image-capable (capability-derived)', () => {
    const result = buildOptions([model('brandnew', true)])
    expect(result).toEqual(['brandnew'])
  })

  it('does NOT add a provider whose models are not image-capable', () => {
    const result = buildOptions([model('text-only-prov', false)])
    expect(result).not.toContain('text-only-prov')
  })

  it('does not treat a provider with only disabled image models as available', () => {
    const result = buildOptions([
      model('disabled-provider', { capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION], isEnabled: false })
    ])

    expect(result).toEqual([])
  })

  it('excludes image-generation-capable models that explicitly output text only', () => {
    const result = buildOptions([
      model('openai', {
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        outputModalities: [MODALITY.TEXT]
      })
    ])

    expect(result).toEqual([])
  })

  it('keeps image-generation models that output image', () => {
    const result = buildOptions([
      model('openrouter', {
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      })
    ])

    expect(result).toEqual(['openrouter'])
  })

  it('does not duplicate a provider that has multiple image-capable v2 models', () => {
    const result = buildOptions([model('zhipu', true), model('zhipu', true)])
    expect(result.filter((id) => id === 'zhipu')).toHaveLength(1)
  })

  it('sorts capability-derived providers deterministically', () => {
    const result = buildOptions([model('zeta', true), model('alpha', true)])
    expect(result).toEqual(['alpha', 'zeta'])
  })

  it('does not include a disabled provider even when it owns an available painting model', () => {
    const result = buildOptions([model('disabled-provider', true)], NO_OVMS, [provider('disabled-provider', false)])

    expect(result).toEqual([])
  })

  it('hides ovms unless it is supported AND running', () => {
    expect(buildOptions([model('ovms', true)], NO_OVMS)).not.toContain('ovms')
    expect(buildOptions([model('ovms', true)], RUNNING_OVMS)).toContain('ovms')
  })
})
