import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../imageOptions'

describe('splitParamValues', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'keeps unbound parameter %s in the vendor bag by identity',
    (key) => {
      const value = Object.freeze({ bytes: new Uint8Array([1, 2]), callback: () => 'opaque' })
      const input = Object.freeze({ numImages: 2, [key]: value })
      const result = splitParamValues(input)

      expect(result.structured).toEqual({ n: 2 })
      expect(Object.hasOwn(result.vendorBag, key)).toBe(true)
      expect(result.vendorBag[key]).toBe(value)
      expect(Object.getPrototypeOf(result.vendorBag)).toBe(Object.prototype)
      expect(input[key]).toBe(value)
      expect(input.numImages).toBe(2)
    }
  )

  it('routes binding-mapped keys to structured (numImages→n) and the rest to vendorBag', () => {
    expect(
      splitParamValues({ numImages: 2, size: '1024x1024', seed: 5, addWatermark: true, modelDescriptor: { id: 'x' } })
    ).toEqual({
      structured: { n: 2, size: '1024x1024', seed: 5 },
      vendorBag: { addWatermark: true, modelDescriptor: { id: 'x' } }
    })
  })

  it('skips empty-string / null / undefined values (byte-identical-wire guard)', () => {
    // negativePrompt is NOT an AI SDK native option → vendorBag.
    expect(splitParamValues({ size: '', seed: undefined, cfg: null, negativePrompt: 'x' })).toEqual({
      structured: {},
      vendorBag: { negativePrompt: 'x' }
    })
  })

  it("preserves n: 0 and the 'auto' size sentinel in structured", () => {
    expect(splitParamValues({ numImages: 0, size: 'auto' })).toEqual({
      structured: { n: 0, size: 'auto' },
      vendorBag: {}
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

  it('normalizes aspectRatio (ASPECT_X_Y → X:Y) once during the split, dropping invalid values', () => {
    expect(splitParamValues({ aspectRatio: 'ASPECT_16_9' }).structured).toEqual({ aspectRatio: '16:9' })
    // already-normalized passes through (idempotent); a mismatched value is dropped
    expect(splitParamValues({ aspectRatio: '1:1' }).structured).toEqual({ aspectRatio: '1:1' })
    expect(splitParamValues({ aspectRatio: 'weird' }).structured).toEqual({})
  })

  it.each([{ aspectRatio: 0 }, { aspectRatio: false }, { aspectRatio: {} }, { aspectRatio: ['1:1'] }])(
    'drops non-string aspect ratios without coercion: %j',
    (paramValues) => {
      expect(splitParamValues(paramValues).structured).toEqual({})
    }
  )
})
