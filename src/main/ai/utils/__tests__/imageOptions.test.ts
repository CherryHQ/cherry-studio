import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../imageOptions'

describe('splitParamValues', () => {
  it('routes binding-mapped keys to structured (numImages→n) and the rest to vendorBag', () => {
    expect(
      splitParamValues({ numImages: 2, size: '1024x1024', seed: 5, addWatermark: true, modelDescriptor: { id: 'x' } })
    ).toEqual({
      structured: { n: 2, size: '1024x1024', seed: 5 },
      vendorBag: { addWatermark: true, modelDescriptor: { id: 'x' } }
    })
  })

  it('skips empty-string / null / undefined values (byte-identical-wire guard)', () => {
    expect(splitParamValues({ size: '', seed: undefined, cfg: null, negativePrompt: 'x' })).toEqual({
      structured: { negativePrompt: 'x' },
      vendorBag: {}
    })
  })

  it("preserves n: 0 and the 'auto' size sentinel in structured", () => {
    expect(splitParamValues({ numImages: 0, size: 'auto' })).toEqual({
      structured: { n: 0, size: 'auto' },
      vendorBag: {}
    })
  })

  it('keeps diffusion knobs (personGeneration/background/style) structured, vendor extras (cfg) bagged', () => {
    expect(
      splitParamValues({ personGeneration: 'allow_adult', background: 'opaque', style: 'vivid', cfg: 7.5 })
    ).toEqual({
      structured: { personGeneration: 'allow_adult', background: 'opaque', style: 'vivid' },
      vendorBag: { cfg: 7.5 }
    })
  })

  it('normalizes aspectRatio (ASPECT_X_Y → X:Y) once during the split, dropping invalid values', () => {
    expect(splitParamValues({ aspectRatio: 'ASPECT_16_9' }).structured).toEqual({ aspectRatio: '16:9' })
    // already-normalized passes through (idempotent); a mismatched value is dropped
    expect(splitParamValues({ aspectRatio: '1:1' }).structured).toEqual({ aspectRatio: '1:1' })
    expect(splitParamValues({ aspectRatio: 'weird' }).structured).toEqual({})
  })
})
