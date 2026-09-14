import { describe, expect, it } from 'vitest'

import { ImageGenerationSupportSchema } from '../schemas/model'

const inputs = {
  images: { min: 0, max: { kind: 'unknown' } },
  prompt: 'required',
  mask: 'unknown',
  mediaTypes: { kind: 'unknown' }
}

describe('image capability validation', () => {
  it('requires complete input facts and rejects legacy fields', () => {
    expect(ImageGenerationSupportSchema.safeParse({ supports: {} }).success).toBe(false)
    expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, modes: {} }).success).toBe(false)
    expect(
      ImageGenerationSupportSchema.safeParse({ supports: {}, inputs: { ...inputs, mask: undefined } }).success
    ).toBe(false)
  })

  it.each(['https://example.com/image', '//example.com/image'])(
    'rejects a non-relative protocol endpoint: %s',
    (endpoint) => {
      expect(
        ImageGenerationSupportSchema.safeParse({
          supports: {},
          inputs,
          protocol: { kind: 'custom', endpoint, isSync: true }
        }).success
      ).toBe(false)
    }
  )

  it('normalizes integer count ranges and preserves continuous precision', () => {
    const value = ImageGenerationSupportSchema.parse({
      inputs,
      supports: {
        numImages: { type: 'range', min: 1, max: 4 },
        guidanceScale: { type: 'range', min: 0, max: 20, step: 0.1 }
      }
    })
    expect(value.supports.numImages).toMatchObject({ step: 1 })
    expect(value.supports.guidanceScale).toMatchObject({ step: 0.1 })
  })

  it.each([
    { numImages: { type: 'range', min: 1, max: 4, default: 2.5 } },
    { numImages: { type: 'range', min: 5, max: 2 } },
    { notACanonicalKey: { type: 'switch' } },
    { seed: { type: 'volume' } }
  ])('rejects invalid support contracts %#', (supports) => {
    expect(ImageGenerationSupportSchema.safeParse({ supports, inputs }).success).toBe(false)
  })

  it('validates the resulting operation and image-input constraints, not just the base', () => {
    for (const difference of [
      { withImages: { inputs: { images: { min: 4, max: { kind: 'known', value: 2 } } } } },
      { operations: { upscale: { supports: { numImages: { type: 'range', min: 1, max: 1.5 } } } } }
    ]) {
      expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, ...difference }).success).toBe(false)
    }
  })
})
