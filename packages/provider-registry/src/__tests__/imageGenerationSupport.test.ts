import { describe, expect, it } from 'vitest'

import { ImageGenerationOverrideSchema, ImageGenerationSupportSchema } from '../schemas/model'

const inputs = {
  images: { min: 0, max: { kind: 'unknown' } },
  prompt: 'required',
  mask: 'unknown',
  mediaTypes: { kind: 'unknown' }
}

describe('image capability validation', () => {
  it('rejects protocol aliases and invalid ratio specs in every declaration layer', () => {
    const invalidSpecs = [
      ...['ASPECT_16_9', '16x9', '16_9', '0:1', '-1:9', 'Infinity:1', '1:NaN', '1:'].map((option) => ({
        type: 'enum',
        options: [option]
      })),
      { type: 'enum', options: [] },
      { type: 'enum', options: ['16:9'], default: 'ASPECT_16_9' },
      { type: 'enum', options: ['16:9'], default: '1:1' },
      { type: 'text' }
    ]
    for (const aspectRatio of invalidSpecs) {
      const supports = { aspectRatio }
      for (const delta of [{ supports }, { withImages: { supports } }, { operations: { remix: { supports } } }]) {
        expect(ImageGenerationSupportSchema.safeParse({ inputs, supports: {}, ...delta }).success).toBe(false)
        expect(ImageGenerationOverrideSchema.safeParse(delta).success).toBe(false)
      }
    }
  })

  it('accepts explicit auto and positive unreduced ratios, including nullable override removal', () => {
    const supports = { aspectRatio: { type: 'enum', options: ['auto', '10:16', '1.5:1'], default: 'auto' } }
    for (const delta of [{ supports }, { withImages: { supports } }, { operations: { remix: { supports } } }]) {
      expect(ImageGenerationSupportSchema.safeParse({ inputs, supports: {}, ...delta }).success).toBe(true)
      expect(ImageGenerationOverrideSchema.safeParse(delta).success).toBe(true)
    }
    expect(ImageGenerationOverrideSchema.parse({ supports: { aspectRatio: null } }).supports?.aspectRatio).toBeNull()
  })

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
