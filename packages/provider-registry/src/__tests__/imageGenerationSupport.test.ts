import { describe, expect, it } from 'vitest'

import { ImageGenerationSupportSchema, ModelConfigSchema } from '../schemas/model'

/**
 * Locks the unified `ImageGenerationSupportSchema` shape: `modes` is a
 * `Record<Mode, ModeDef>` (no separate `modes:string[]` + `modeSchemas` split),
 * `supports` is a `Record<string, SupportSpec>` with a 5-arm discriminated
 * union (switch / enum / range / size / text) driving widget choice.
 */
describe('ImageGenerationSupportSchema', () => {
  it('requires `modes` but allows an empty modes record', () => {
    // An image-generation block conveys nothing without `modes`, so the field
    // is required; an empty record is still valid (every mode key is optional).
    expect(() => ImageGenerationSupportSchema.parse({})).toThrow()
    expect(ImageGenerationSupportSchema.parse({ modes: {} })).toEqual({ modes: {} })
  })

  it('gpt-image-1: pixel size enum + numImages range + quality/moderation/background enums', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: {
        generate: {
          supports: {
            size: {
              type: 'enum',
              options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
              default: 'auto',
              render: 'chips'
            },
            numImages: { type: 'range', min: 1, max: 10, default: 1 },
            quality: { type: 'enum', options: ['low', 'medium', 'high', 'auto'] },
            moderation: { type: 'enum', options: ['low', 'auto'] },
            background: { type: 'enum', options: ['transparent', 'opaque', 'auto'] }
          }
        },
        edit: {
          supports: {
            size: { type: 'enum', options: ['auto', '1024x1024'], render: 'chips' }
          }
        }
      }
    })
    expect(Object.keys(parsed.modes ?? {})).toEqual(expect.arrayContaining(['generate', 'edit']))
    const generateSpec = parsed.modes?.generate?.supports.numImages
    expect(generateSpec?.type).toBe('range')
  })

  it('imagen-4.0-ultra: aspectRatio enum + numImages capped at 1 + personGeneration enum', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: {
        generate: {
          supports: {
            aspectRatio: {
              type: 'enum',
              options: ['1:1', '16:9', '9:16', '4:3', '3:4'],
              default: '1:1'
            },
            numImages: { type: 'range', min: 1, max: 1, default: 1 },
            seed: { type: 'text' },
            personGeneration: { type: 'enum', options: ['ALLOW_ADULT', 'ALLOW_ALL', 'DONT_ALLOW'] }
          }
        }
      }
    })
    expect(parsed.modes?.generate?.supports.numImages).toEqual({ type: 'range', min: 1, max: 1, default: 1 })
  })

  it('FLUX.1-Kontext-pro: safetyTolerance range with default 6', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: {
        generate: {
          supports: {
            size: { type: 'enum', options: ['1024x1024', '1024x768', '768x1024'], render: 'chips' },
            numImages: { type: 'range', min: 1, max: 4, default: 1 },
            safetyTolerance: { type: 'range', min: 0, max: 6, default: 6 }
          }
        }
      }
    })
    expect(parsed.modes?.generate?.supports.safetyTolerance).toEqual({
      type: 'range',
      min: 0,
      max: 6,
      default: 6
    })
  })

  it('Ideogram V_3: per-mode supports — remix gains imageWeight; upscale gains resemblance + detail', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: {
        generate: {
          supports: {
            negativePrompt: { type: 'text', multiline: true },
            seed: { type: 'text' },
            magicPromptOption: { type: 'switch' },
            styleType: { type: 'enum', options: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'] },
            renderingSpeed: { type: 'enum', options: ['TURBO', 'DEFAULT', 'QUALITY'] }
          }
        },
        remix: {
          supports: {
            imageWeight: { type: 'range', min: 1, max: 100, default: 50 }
          }
        },
        upscale: {
          supports: {
            resemblance: { type: 'range', min: 1, max: 100, default: 50 },
            detail: { type: 'range', min: 1, max: 100 }
          }
        }
      }
    })
    expect(Object.keys(parsed.modes ?? {})).toContain('upscale')
    expect(parsed.modes?.upscale?.supports.detail?.type).toBe('range')
  })

  it('accepts vendorTransport per mode for PPIO-style endpoint routing', () => {
    const parsed = ImageGenerationSupportSchema.parse({
      modes: {
        edit: {
          supports: { imageResolution: { type: 'enum', options: ['2k', '4k', '8k'] } },
          vendorTransport: { endpoint: '/v3/image-upscaler', isSync: true }
        }
      }
    })
    expect(parsed.modes?.edit?.vendorTransport).toEqual({ endpoint: '/v3/image-upscaler', isSync: true })
  })

  it('rejects an unknown mode key', () => {
    expect(() =>
      ImageGenerationSupportSchema.parse({
        modes: { hallucinate: { supports: {} } }
      })
    ).toThrow()
  })

  it('rejects a range spec with min > max', () => {
    expect(() =>
      ImageGenerationSupportSchema.parse({
        modes: {
          generate: { supports: { numImages: { type: 'range', min: 5, max: 2 } } }
        }
      })
    ).toThrow()
  })

  it('rejects an unknown support spec type', () => {
    expect(() =>
      ImageGenerationSupportSchema.parse({
        modes: { generate: { supports: { foo: { type: 'volume' } } } }
      })
    ).toThrow()
  })

  it('rejects a supports key outside the canonical vocabulary', () => {
    expect(() =>
      ImageGenerationSupportSchema.parse({
        modes: { generate: { supports: { notACanonicalKey: { type: 'switch' } } } }
      })
    ).toThrow()
  })
})

describe('ModelConfigSchema with imageGeneration', () => {
  it('accepts a model entry carrying both `capabilities` and `imageGeneration`', () => {
    const parsed = ModelConfigSchema.parse({
      id: 'gpt-image-1',
      name: 'gpt-image-1',
      capabilities: ['image-generation'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['auto', '1024x1024'], render: 'chips' },
              numImages: { type: 'range', min: 1, max: 10, default: 1 }
            }
          },
          edit: {
            supports: {
              size: { type: 'enum', options: ['auto', '1024x1024'], render: 'chips' }
            }
          }
        }
      }
    })
    expect(Object.keys(parsed.imageGeneration?.modes ?? {})).toEqual(expect.arrayContaining(['generate', 'edit']))
  })

  it('omits `imageGeneration` entirely for non-image models', () => {
    const parsed = ModelConfigSchema.parse({ id: 'gpt-4', name: 'GPT-4' })
    expect(parsed.imageGeneration).toBeUndefined()
  })
})
