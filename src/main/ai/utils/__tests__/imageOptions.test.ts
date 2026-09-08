import type { ParamValues } from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../imageOptions'

describe('splitParamValues', () => {
  it('routes binding-mapped keys to structured (numImages→n) and the rest to vendorBag', () => {
    // The fixture used to carry a `modelDescriptor` too, asserting that non-catalog
    // keys land in the bag. That is unreachable in production — `imageParamsSchema`
    // strips them at the IPC boundary — and the `ParamValues` parameter now says so.
    expect(splitParamValues({ numImages: 2, size: '1024x1024', seed: 5, addWatermark: true })).toEqual({
      structured: { n: 2, size: '1024x1024', seed: 5 },
      vendorBag: { addWatermark: true }
    })
  })

  it('skips empty-string / null / undefined values (byte-identical-wire guard)', () => {
    // `cfg: null` is cast in: the catalog types it `number | undefined` and
    // `blankToUndefined` maps null → undefined at the boundary, so the type is right
    // that it cannot arrive. The runtime guard is still defensive and still covered —
    // this pins the guard, not a reachable input. negativePrompt is not native → bag.
    const withNull = { size: '', seed: undefined, cfg: null, negativePrompt: 'x' } as unknown as ParamValues
    expect(splitParamValues(withNull)).toEqual({
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
})
