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

  it('rejects the old modes format rather than silently stripping it', () => {
    expect(ImageGenerationSupportSchema.safeParse({ modes: { generate: { supports: {} } } }).success).toBe(false)
    expect(ImageGenerationSupportSchema.safeParse({ supports: {}, inputs, modes: {} }).success).toBe(false)
  })
})
