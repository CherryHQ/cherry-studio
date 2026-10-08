import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../imageOptions'

describe('splitParamValues', () => {
  it('routes binding-mapped keys to structured (numImages→n) and the rest to vendorBag', () => {
    expect(splitParamValues({ numImages: 2, size: '1024x1024', seed: 5, addWatermark: true })).toEqual({
      structured: { n: 2, size: '1024x1024', seed: 5 },
      vendorBag: { addWatermark: true }
    })
  })

  it('bags the vendor-body knobs (personGeneration/background/style/cfg) — only n/size/seed/aspectRatio are native', () => {
    expect(
      splitParamValues({ personGeneration: 'allow_adult', background: 'opaque', style: 'vivid', cfg: 7.5 })
    ).toEqual({
      structured: {},
      vendorBag: { personGeneration: 'allow_adult', background: 'opaque', style: 'vivid', cfg: 7.5 }
    })
  })

  it('preserves a canonical ratio independently of size and omits only explicit auto', () => {
    expect(splitParamValues({ aspectRatio: '10:16', size: '1024x1024' }).structured).toEqual({
      aspectRatio: '10:16',
      size: '1024x1024'
    })
    expect(splitParamValues({ aspectRatio: 'auto' }).structured).not.toHaveProperty('aspectRatio')
    expect(splitParamValues({ size: '1536x1024' }).structured).not.toHaveProperty('aspectRatio')
  })
})
