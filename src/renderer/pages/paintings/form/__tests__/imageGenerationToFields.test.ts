import type { ImageGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { imageGenerationToFields } from '../imageGenerationToFields'

/**
 * Locks the derivation contract under the unified schema: `modes[mode].supports`
 * is a `Record<string, SupportSpec>` where each spec's `type` arm dictates the
 * widget. Cases mirror the 5 archetypes populated in `models.json` so a
 * regression in the dispatcher fails here before reaching the painting page.
 */
describe('imageGenerationToFields', () => {
  it('emits nothing for undefined or empty descriptors', () => {
    expect(imageGenerationToFields(undefined)).toEqual([])
    expect(imageGenerationToFields({ modes: {} } as ImageGenerationSupport)).toEqual([])
  })

  it('gpt-image-1: size enum (chips) + numImages slider + quality/moderation/background selects', () => {
    const items = imageGenerationToFields({
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
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('sizeChips')
    expect(byKey.size?.initialValue).toBe('auto')
    expect(byKey.numImages?.type).toBe('slider')
    expect(byKey.numImages?.min).toBe(1)
    expect(byKey.numImages?.max).toBe(10)
    expect(byKey.quality?.type).toBe('select')
    expect((byKey.quality!.options as { value: string }[]).map((o) => o.value)).toEqual([
      'low',
      'medium',
      'high',
      'auto'
    ])
    expect(byKey.moderation?.type).toBe('select')
    expect(byKey.background?.type).toBe('select')
  })

  it('i18n: semantic enum options carry a labelKey; literal enum options keep the raw value as label', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            quality: { type: 'enum', options: ['standard', 'hd'] },
            styleType: { type: 'enum', options: ['AUTO', 'REALISTIC'] },
            style: { type: 'enum', options: ['natural', '<photography>'] },
            function: { type: 'enum', options: ['expand', 'remove_watermark'] },
            aspectRatio: { type: 'enum', options: ['1:1', '16:9'] }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    // Semantic enums → translatable i18n labelKey, no raw label.
    expect(byKey.quality!.options).toEqual([
      { labelKey: 'paintings.quality_options.standard', value: 'standard' },
      { labelKey: 'paintings.quality_options.hd', value: 'hd' }
    ])
    expect(byKey.styleType!.options).toEqual([
      { labelKey: 'paintings.style_type_options.auto', value: 'AUTO' },
      { labelKey: 'paintings.style_type_options.realistic', value: 'REALISTIC' }
    ])
    // style / function: label is localized, but the option value is preserved
    // verbatim (incl. the `<...>` form) — that raw value is what reaches the request body.
    expect(byKey.style!.options).toEqual([
      { labelKey: 'paintings.style_options.natural', value: 'natural' },
      { labelKey: 'paintings.style_options.photography', value: '<photography>' }
    ])
    expect(byKey.function!.options).toEqual([
      { labelKey: 'paintings.dashscope.function_options.expand', value: 'expand' },
      { labelKey: 'paintings.dashscope.function_options.remove_watermark', value: 'remove_watermark' }
    ])
    // Literal enum (ratios) → raw value as label, no labelKey (nothing to translate).
    expect(byKey.aspectRatio!.options).toEqual([
      { label: '1:1', value: '1:1' },
      { label: '16:9', value: '16:9' }
    ])
  })

  it('imagen-4-ultra: aspectRatio enum + numImages capped at 1 + personGeneration select', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            aspectRatio: { type: 'enum', options: ['1:1', '9:16', '16:9', '3:4', '4:3'], default: '1:1' },
            numImages: { type: 'range', min: 1, max: 1, default: 1 },
            seed: { type: 'text' },
            personGeneration: { type: 'enum', options: ['ALLOW_ADULT', 'ALLOW_ALL', 'DONT_ALLOW'] }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.aspectRatio?.type).toBe('select')
    expect((byKey.aspectRatio!.options as { value: string }[]).map((o) => o.value)).toEqual([
      '1:1',
      '9:16',
      '16:9',
      '3:4',
      '4:3'
    ])
    expect(byKey.numImages?.max).toBe(1)
    expect(byKey.seed?.type).toBe('input')
    expect(byKey.personGeneration?.type).toBe('select')
    expect((byKey.personGeneration!.options as { value: string }[]).map((o) => o.value)).toContain('DONT_ALLOW')
  })

  it('flux-kontext-pro: safetyTolerance range slider with default 6', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            size: {
              type: 'enum',
              options: ['1024x1024', '1024x768'],
              default: '1024x1024',
              render: 'chips'
            },
            numImages: { type: 'range', min: 1, max: 4, default: 1 },
            seed: { type: 'text' },
            safetyTolerance: { type: 'range', min: 0, max: 6, default: 6 }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('sizeChips')
    expect(byKey.safetyTolerance?.type).toBe('slider')
    expect(byKey.safetyTolerance?.min).toBe(0)
    expect(byKey.safetyTolerance?.max).toBe(6)
    expect(byKey.safetyTolerance?.initialValue).toBe(6)
  })

  it('ideogram-v2a: negativePrompt textarea + seed text + magicPromptOption switch + selects', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            negativePrompt: { type: 'text', multiline: true },
            seed: { type: 'text' },
            magicPromptOption: { type: 'switch' },
            styleType: { type: 'enum', options: ['AUTO', 'REALISTIC', 'ANIME'] },
            renderingSpeed: { type: 'enum', options: ['TURBO', 'DEFAULT', 'QUALITY'] }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.negativePrompt?.type).toBe('textarea')
    expect(byKey.seed?.type).toBe('input')
    expect(byKey.magicPromptOption?.type).toBe('switch')
    expect(byKey.styleType?.type).toBe('select')
    expect(byKey.renderingSpeed?.type).toBe('select')
  })

  it('flux.1-dev: numInferenceSteps + guidanceScale + promptEnhancement', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            negativePrompt: { type: 'text', multiline: true },
            seed: { type: 'text' },
            promptEnhancement: { type: 'switch' },
            numInferenceSteps: { type: 'range', min: 1, max: 50, default: 25 },
            guidanceScale: { type: 'range', min: 0, max: 20, default: 4.5, step: 0.1 }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.numInferenceSteps?.type).toBe('slider')
    expect(byKey.numInferenceSteps?.min).toBe(1)
    expect(byKey.numInferenceSteps?.max).toBe(50)
    expect(byKey.numInferenceSteps?.initialValue).toBe(25)
    expect(byKey.guidanceScale?.step).toBe(0.1)
    expect(byKey.guidanceScale?.initialValue).toBe(4.5)
    expect(byKey.promptEnhancement?.type).toBe('switch')
  })

  it('falls back to the first declared mode when the requested mode is absent', () => {
    // Edit-only models (PPIO qwen-image-edit, image-upscaler, …) declare only
    // `modes.edit`. The PPIO painting provider is single-tab with
    // `painting.mode === 'generate'`, so the lookup must fall back to the
    // model's actual mode (edit) instead of rendering nothing.
    const support: ImageGenerationSupport = {
      modes: {
        edit: { supports: { seed: { type: 'text' }, addWatermark: { type: 'switch' } } }
      }
    }
    const items = imageGenerationToFields(support, { mode: 'generate' })
    const keys = items.map((i) => i.key)
    expect(keys).toEqual(['seed', 'addWatermark'])
  })

  it('size + paired customSize: enum gains custom chip; customSize widget gates on size === custom', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            size: {
              type: 'enum',
              options: ['1024x1024', '768x1344'],
              default: '1024x1024',
              render: 'chips'
            },
            customSize: { type: 'size', minSide: 512, maxSide: 2048, pairedEnumKey: 'size' },
            seed: { type: 'text' }
          }
        }
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('sizeChips')
    const sizeValues = (byKey.size!.options as { value: string }[]).map((o) => o.value)
    expect(sizeValues).toContain('1024x1024')
    expect(sizeValues).toContain('custom')
    expect(byKey.customSize?.type).toBe('customSize')
    expect((byKey.customSize as unknown as { validation: { minWidth: number } }).validation.minWidth).toBe(512)
  })

  it('size without paired customSize: no custom chip', () => {
    const items = imageGenerationToFields({
      modes: {
        generate: {
          supports: {
            size: {
              type: 'enum',
              options: ['1024x1024'],
              default: '1024x1024',
              render: 'chips'
            }
          }
        }
      }
    })
    expect(items.find((i) => i.key === 'customSize')).toBeUndefined()
    const sizeValues = ((items[0].options ?? []) as { value: string }[]).map((o) => o.value)
    expect(sizeValues).not.toContain('custom')
  })

  it('per-mode declarations: remix carries imageWeight on top of the shared keys', () => {
    const support: ImageGenerationSupport = {
      modes: {
        generate: {
          supports: {
            aspectRatio: { type: 'enum', options: ['1:1', '16:9', '9:16'], default: '1:1' },
            negativePrompt: { type: 'text', multiline: true },
            seed: { type: 'text' },
            styleType: { type: 'enum', options: ['AUTO', 'REALISTIC'] }
          }
        },
        remix: {
          supports: {
            aspectRatio: { type: 'enum', options: ['1:1', '16:9', '9:16'], default: '1:1' },
            negativePrompt: { type: 'text', multiline: true },
            seed: { type: 'text' },
            styleType: { type: 'enum', options: ['AUTO', 'REALISTIC'] },
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
    }

    const generateKeys = imageGenerationToFields(support, { mode: 'generate' }).map((i) => i.key)
    expect(generateKeys).toContain('negativePrompt')
    expect(generateKeys).toContain('styleType')
    expect(generateKeys).not.toContain('imageWeight')
    expect(generateKeys).not.toContain('resemblance')

    const remixKeys = imageGenerationToFields(support, { mode: 'remix' }).map((i) => i.key)
    expect(remixKeys).toContain('imageWeight')
    expect(remixKeys).toContain('styleType')
    expect(remixKeys).not.toContain('resemblance')

    const upscaleKeys = imageGenerationToFields(support, { mode: 'upscale' }).map((i) => i.key)
    expect(upscaleKeys).toContain('resemblance')
    expect(upscaleKeys).toContain('detail')
    expect(upscaleKeys).not.toContain('imageWeight')
  })
})
