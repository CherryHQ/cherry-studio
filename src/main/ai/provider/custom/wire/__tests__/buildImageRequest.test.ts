import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ParamValues } from '@cherrystudio/provider-registry'

import { splitParamValues } from '../../../../utils/imageOptions'
import { resolveProviderOptionsKey } from '../../../endpoint'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import { resolveWireRegistration } from '../wireProfile'

beforeEach(() => mockMainLoggerService.warn.mockClear())

describe('image option encoding responsibilities', () => {
  it.each(['ppio', 'dashscope', 'tokenhub', 'modelscope', 'dmxapi', 'aihubmix', 'ollama', 'ovms', 'silicon'])(
    '%s forwards canonical vendor values without duplicating SDK native options',
    (providerId) => {
      const params: ParamValues = {
        numImages: 2,
        size: '1024x1024',
        seed: 0,
        aspectRatio: '1:1',
        numInferenceSteps: 20,
        addWatermark: false,
        sourceLang: 'auto'
      }
      const { vendorBag } = splitParamValues(params)
      const result = buildVendorProviderOptions(
        resolveProviderOptionsKey(providerId),
        params,
        resolveWireRegistration(providerId, 'test-model'),
        vendorBag
      )
      expect(result).toEqual({ [providerId]: { numInferenceSteps: 20, addWatermark: false, sourceLang: 'auto' } })
    }
  )

  it('combines separate contributions without losing earlier nested values or mutating input', () => {
    const params: ParamValues = { seed: 0, addWatermark: false }
    const result = buildImageRequest(params, {
      fields: {
        seed: { contribute: (value) => ({ configuration: { seedValue: Number(value) } }) },
        addWatermark: { contribute: (value) => ({ configuration: { watermarkEnabled: Boolean(value) } }) }
      }
    })
    expect(result).toEqual({ configuration: { seedValue: 0, watermarkEnabled: false } })
    expect(params).toEqual({ seed: 0, addWatermark: false })
  })

  it('does not send empty nested configuration objects when a contribution is unset', () => {
    expect(
      buildImageRequest(
        { imageResolution: '2K' },
        {
          fields: {
            imageResolution: { contribute: () => ({ configuration: { unset: '' } }) }
          }
        }
      )
    ).toEqual({})
  })

  it('reports unmapped parameter names without leaking their values', () => {
    const params: ParamValues = { negativePrompt: 'private prompt text', numInferenceSteps: 20 }
    const { vendorBag } = splitParamValues(params)
    const result = buildVendorProviderOptions(
      resolveProviderOptionsKey('openai'),
      params,
      {
        profile: { fields: { numInferenceSteps: { to: 'iterationCount' } } }
      },
      vendorBag
    )
    expect(result).toEqual({ openai: { iterationCount: 20 } })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(expect.stringContaining('dropped'), {
      providerOptionsKey: 'openai',
      dropped: ['negativePrompt']
    })
    expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('private prompt text')
  })

  it('preserves false and auto passthrough values without a spurious dropped-parameter warning', () => {
    const params: ParamValues = { addWatermark: false, sequentialImageGeneration: 'auto' }
    const { vendorBag } = splitParamValues(params)
    expect(
      buildVendorProviderOptions(
        resolveProviderOptionsKey('aihubmix'),
        params,
        { profile: {}, passthrough: true },
        vendorBag
      )
    ).toEqual({ aihubmix: params })
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })
})
