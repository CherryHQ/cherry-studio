import { describe, expect, it } from 'vitest'

import { ImageGenerationSupportSchema, ModelConfigSchema } from '../schemas/model'

/**
 * Locks the intended shape of `ImageGenerationSupportSchema` against real-
 * world models (gpt-image-1, imagen-4.0-ultra, FLUX.1-Kontext-pro, Ideogram
 * V_3). The schema is the contract the future generic painting UI reads to
 * render its controls without per-vendor branching.
 */
describe('ImageGenerationSupportSchema', () => {
  it('accepts an empty descriptor (every field optional)', () => {
    expect(ImageGenerationSupportSchema.parse({})).toEqual({})
  })

  it('accepts a gpt-image-1-shaped descriptor (pixel sizes + quality/moderation/background)', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: ['generate', 'edit'],
      sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      sizeMode: 'pixel',
      defaultSize: 'auto',
      allowAutoSize: true,
      batch: { min: 1, max: 10, default: 1 },
      supports: {
        quality: ['low', 'medium', 'high', 'auto'],
        moderation: ['low', 'auto'],
        background: ['transparent', 'opaque', 'auto']
      }
    })
    expect(parsed.modes).toEqual(['generate', 'edit'])
    expect(parsed.batch?.max).toBe(10)
    expect(parsed.supports?.quality).toContain('high')
  })

  it('accepts an imagen-4.0-ultra-shaped descriptor (aspect-ratio sizes + personGeneration + batch 1)', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: ['generate'],
      sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      sizeMode: 'aspect',
      defaultSize: '1:1',
      batch: { min: 1, max: 1, default: 1 },
      supports: {
        seed: true,
        personGeneration: ['ALLOW_ADULT', 'ALLOW_ALL', 'DONT_ALLOW']
      }
    })
    expect(parsed.sizeMode).toBe('aspect')
    expect(parsed.batch?.max).toBe(1)
  })

  it('accepts a FLUX.1-Kontext-pro-shaped descriptor (safetyTolerance default 6)', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: ['generate'],
      sizes: ['1024x1024', '1024x768', '768x1024'],
      sizeMode: 'pixel',
      defaultSize: '1024x1024',
      batch: { min: 1, max: 4, default: 1 },
      supports: { safetyTolerance: { min: 0, max: 6, default: 6 } }
    })
    expect(parsed.supports?.safetyTolerance).toEqual({ min: 0, max: 6, default: 6 })
  })

  it('accepts an Ideogram-V_3-shaped descriptor (styleType + renderingSpeed + magicPromptOption)', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: ['generate', 'remix', 'upscale'],
      sizes: ['ASPECT_1_1', 'ASPECT_16_9', 'ASPECT_9_16'],
      sizeMode: 'aspect',
      batch: { min: 1, max: 8, default: 1 },
      supports: {
        negativePrompt: true,
        seed: true,
        magicPromptOption: true,
        styleType: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN', 'RENDER_3D', 'ANIME'],
        renderingSpeed: ['TURBO', 'DEFAULT', 'QUALITY']
      }
    })
    expect(parsed.modes).toContain('upscale')
    expect(parsed.supports?.styleType).toContain('REALISTIC')
  })

  it('rejects an unknown mode', () => {
    expect(() => ImageGenerationSupportSchema.parse({ modes: ['hallucinate'] })).toThrow()
  })

  it('rejects a batch range with min > max', () => {
    expect(() => ImageGenerationSupportSchema.parse({ batch: { min: 5, max: 2 } })).toThrow(
      /min must be less than or equal to max/
    )
  })

  it('rejects an unknown sizeMode', () => {
    expect(() => ImageGenerationSupportSchema.parse({ sizeMode: 'volume' })).toThrow()
  })
})

describe('ModelConfigSchema with imageGeneration', () => {
  it('accepts a model entry carrying both `capabilities` and `imageGeneration`', () => {
    const parsed = ModelConfigSchema.parse({
      id: 'gpt-image-1',
      name: 'gpt-image-1',
      capabilities: ['image-generation'],
      imageGeneration: {
        modes: ['generate', 'edit'],
        sizes: ['auto', '1024x1024'],
        sizeMode: 'pixel',
        allowAutoSize: true,
        batch: { min: 1, max: 10, default: 1 }
      }
    })
    expect(parsed.imageGeneration?.modes).toEqual(['generate', 'edit'])
  })

  it('omits `imageGeneration` entirely for non-image models (backward compatible)', () => {
    const parsed = ModelConfigSchema.parse({ id: 'gpt-4', name: 'GPT-4' })
    expect(parsed.imageGeneration).toBeUndefined()
  })
})
