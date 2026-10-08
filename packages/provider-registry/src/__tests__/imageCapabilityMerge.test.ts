import { describe, expect, it } from 'vitest'

import { ImageGenerationSupportSchema } from '../schemas/model'
import { resolveImageCapability, resolveImageGenerationSupport } from '../utils/imageCapabilities'

const inputs = {
  images: { min: 0, max: { kind: 'known', value: 3 } },
  prompt: 'required',
  mask: 'unknown',
  mediaTypes: { kind: 'unknown' }
} as const

describe('image capability catalog v2', () => {
  it('merges canonical keys, replaces whole specs, and removes explicitly disabled keys', () => {
    const base = ImageGenerationSupportSchema.parse({
      supports: { seed: { type: 'text' }, size: { type: 'enum', options: ['a', 'b'], default: 'a' } },
      inputs
    })
    const merged = resolveImageGenerationSupport(
      { imageGeneration: base },
      {
        imageGeneration: { supports: { seed: null, size: { type: 'enum', options: ['c'] } } }
      }
    )
    expect(merged?.supports).toStrictEqual({ size: { type: 'enum', options: ['c'] } })
  })

  it('applies input and operation differences after the provider override', () => {
    const base = ImageGenerationSupportSchema.parse({
      supports: { seed: { type: 'text' } },
      inputs,
      withImages: { supports: { strength: { type: 'range', min: 0, max: 1 } } },
      operations: { upscale: { supports: { seed: null }, inputs: { images: { min: 1 }, prompt: 'optional' } } }
    })
    const merged = resolveImageGenerationSupport(
      { imageGeneration: base },
      {
        imageGeneration: { inputs: { images: { max: { kind: 'known', value: 2 } } } }
      }
    )
    expect(resolveImageCapability(merged, 'generate', true)).toMatchObject({
      kind: 'supported',
      capability: { supports: { seed: {}, strength: {} }, inputs: { images: { min: 0, max: { value: 2 } } } }
    })
    expect(resolveImageCapability(merged, 'upscale', true)).toMatchObject({
      kind: 'supported',
      capability: { supports: {}, inputs: { images: { min: 1 }, prompt: 'optional' } }
    })
    expect(resolveImageCapability(merged, 'remix', true)).toEqual({ kind: 'unsupported' })
  })

  it('rejects impossible merged inputs and incomplete protocol replacements', () => {
    const base = ImageGenerationSupportSchema.parse({ supports: {}, inputs })
    expect(() =>
      resolveImageGenerationSupport(
        { imageGeneration: base },
        {
          imageGeneration: { inputs: { images: { min: 4 } } }
        }
      )
    ).toThrow()
    expect(
      ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, protocol: { endpoint: '/new' } }).success
    ).toBe(false)
  })

  it('rejects individually valid differences whose combined image count is impossible', () => {
    const withImages = { inputs: { images: { min: 2 } } }
    const operations = { generate: { inputs: { images: { max: { kind: 'known', value: 1 } } } } }
    expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, withImages }).success).toBe(true)
    expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, operations }).success).toBe(true)

    const result = ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, withImages, operations })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Accepted an impossible combined image count')
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: ['operations', 'generate', 'inputs', 'images'] })
    )
  })

  it('validates the same operation-last order used to resolve generation with images', () => {
    const support = ImageGenerationSupportSchema.parse({
      supports: {},
      inputs,
      withImages: { inputs: { images: { min: 2 } } },
      operations: { generate: { inputs: { images: { min: 1, max: { kind: 'known', value: 1 } } } } }
    })
    expect(resolveImageCapability(support, 'generate', true)).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 1, max: { kind: 'known', value: 1 } } } }
    })
  })

  it.each(['remix', 'upscale'] as const)('does not apply the generation input difference to %s', (operation) => {
    const support = ImageGenerationSupportSchema.parse({
      supports: {},
      inputs,
      withImages: { inputs: { images: { min: 2 } } },
      operations: { [operation]: { inputs: { images: { max: { kind: 'known', value: 1 } } } } }
    })
    expect(resolveImageCapability(support, operation, true)).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 0, max: { kind: 'known', value: 1 } } } }
    })
  })

  it('revalidates input and operation composition after provider differences are merged', () => {
    const base = ImageGenerationSupportSchema.parse({
      supports: {},
      inputs,
      withImages: { inputs: { images: { min: 2 } } }
    })
    const operations = { generate: { inputs: { images: { max: { kind: 'known', value: 1 } } } } } as const
    expect(() => resolveImageGenerationSupport({ imageGeneration: base }, { imageGeneration: { operations } })).toThrow(
      'minimum image count exceeds maximum'
    )

    const cleared = resolveImageGenerationSupport(
      { imageGeneration: base },
      { imageGeneration: { withImages: null, operations } }
    )
    expect(resolveImageCapability(cleared, 'generate', true)).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 0, max: { kind: 'known', value: 1 } } } }
    })
  })

  it('rejects the old modes format rather than silently stripping it', () => {
    expect(ImageGenerationSupportSchema.safeParse({ modes: { generate: { supports: {} } } }).success).toBe(false)
    expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, modes: {} }).success).toBe(false)
  })
})
