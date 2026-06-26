import { describe, expect, it } from 'vitest'

import { buildImageProviderOptions, splitParamValues } from '../../../../utils/imageOptions'
import { buildImageRequest } from '../buildImageRequest'
import { SILICON_WIRE_PROFILE } from '../wireProfile'

// The engine's silicon body must equal what buildImageProviderOptions produces
// today (the diffusion emitter), so the wire stays byte-identical. The oracle is
// computed from the REAL mapper — not a hand-written bag — to lock equivalence.
function oracleSiliconBag(paramValues: Record<string, unknown>): Record<string, unknown> {
  const { structured, vendorBag } = splitParamValues(paramValues)
  const opts = buildImageProviderOptions('silicon', {
    ...structured,
    providerOptions: { silicon: vendorBag as Record<string, unknown> }
  })
  return (opts.silicon ?? {}) as Record<string, unknown>
}

describe('buildImageRequest — silicon', () => {
  it('reproduces the buildImageProviderOptions silicon bag byte-identically', () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 42,
      negativePrompt: 'low quality',
      numInferenceSteps: 25,
      guidanceScale: 4.5,
      cfg: 7.5
    }
    const body = buildImageRequest(paramValues, SILICON_WIRE_PROFILE)
    expect(body).toEqual(oracleSiliconBag(paramValues))
    // native params (n/size) are not in the vendor body
    expect(body).not.toHaveProperty('n')
    expect(body).not.toHaveProperty('size')
  })

  it("drops 'auto'/blank and passes cfg through (matches compact())", () => {
    const paramValues = { quality: 'auto', negativePrompt: '', cfg: 7.5, promptEnhancement: true }
    expect(buildImageRequest(paramValues, SILICON_WIRE_PROFILE)).toEqual(oracleSiliconBag(paramValues))
  })

  it('matches the empty case', () => {
    expect(buildImageRequest({}, SILICON_WIRE_PROFILE)).toEqual(oracleSiliconBag({}))
  })
})
