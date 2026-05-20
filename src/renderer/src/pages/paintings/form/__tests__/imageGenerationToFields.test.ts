import type { ImageGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { imageGenerationToFields } from '../imageGenerationToFields'

/**
 * Locks the derivation contract: `ImageGenerationSupport` → `BaseConfigItem[]`.
 * Cases mirror the 5 archetypes populated in `models.json` (A.3) so a regression
 * in the mapping fails here before reaching the painting page.
 */
describe('imageGenerationToFields', () => {
  it('emits nothing for undefined or empty descriptors', () => {
    expect(imageGenerationToFields(undefined)).toEqual([])
    expect(imageGenerationToFields({} as ImageGenerationSupport)).toEqual([])
  })

  it('gpt-image-1: pixel sizeChips + slider(1-10) + select(quality/moderation/background)', () => {
    const items = imageGenerationToFields({
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

  it('imagen-4-ultra: aspect select + batch capped at 1 + seed + personGeneration', () => {
    const items = imageGenerationToFields({
      modes: ['generate'],
      sizes: ['1:1', '9:16', '16:9', '3:4', '4:3'],
      sizeMode: 'aspect',
      defaultSize: '1:1',
      batch: { min: 1, max: 1, default: 1 },
      supports: {
        seed: true,
        personGeneration: ['ALLOW_ADULT', 'ALLOW_ALL', 'DONT_ALLOW']
      }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('select')
    expect((byKey.size!.options as { value: string }[]).map((o) => o.value)).toEqual([
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

  it('flux-kontext-pro: safetyTolerance slider with default 6', () => {
    const items = imageGenerationToFields({
      modes: ['generate'],
      sizes: ['1024x1024', '1024x768'],
      sizeMode: 'pixel',
      defaultSize: '1024x1024',
      batch: { min: 1, max: 4, default: 1 },
      supports: { seed: true, safetyTolerance: { min: 0, max: 6, default: 6 } }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('sizeChips')
    expect(byKey.safetyTolerance?.type).toBe('slider')
    expect(byKey.safetyTolerance?.min).toBe(0)
    expect(byKey.safetyTolerance?.max).toBe(6)
    expect(byKey.safetyTolerance?.initialValue).toBe(6)
  })

  it('ideogram-v2a: negativePrompt + seed + magicPromptOption + styleType + renderingSpeed', () => {
    const items = imageGenerationToFields({
      modes: ['generate', 'remix', 'upscale'],
      sizes: ['ASPECT_1_1', 'ASPECT_16_9', 'ASPECT_9_16'],
      sizeMode: 'aspect',
      batch: { min: 1, max: 8, default: 1 },
      supports: {
        negativePrompt: true,
        seed: true,
        magicPromptOption: true,
        styleType: ['AUTO', 'REALISTIC', 'ANIME'],
        renderingSpeed: ['TURBO', 'DEFAULT', 'QUALITY']
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
      modes: ['generate'],
      sizes: ['1024x1024', '1280x1024', '1024x1280'],
      sizeMode: 'pixel',
      defaultSize: '1024x1024',
      batch: { min: 1, max: 4, default: 1 },
      supports: {
        negativePrompt: true,
        seed: true,
        promptEnhancement: true,
        numInferenceSteps: { min: 1, max: 50, default: 25 },
        guidanceScale: { min: 0, max: 20, default: 4.5 }
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

  it('omits the supports section when supports is empty', () => {
    const items = imageGenerationToFields({
      sizes: ['1024x1024'],
      sizeMode: 'pixel',
      batch: { min: 1, max: 4 },
      supports: {}
    })
    const keys = items.map((i) => i.key)
    expect(keys).toEqual(['size', 'numImages'])
  })

  it('emits no slider when batch is omitted', () => {
    const items = imageGenerationToFields({ sizes: ['1024x1024'], sizeMode: 'pixel' })
    expect(items.find((i) => i.key === 'numImages')).toBeUndefined()
  })

  it('renames emitted keys via opts.keyMap (silicon legacy field names)', () => {
    const items = imageGenerationToFields(
      {
        sizes: ['1024x1024'],
        sizeMode: 'pixel',
        batch: { min: 1, max: 4, default: 1 },
        supports: { numInferenceSteps: { min: 1, max: 50, default: 25 } }
      },
      { keyMap: { size: 'imageSize', numInferenceSteps: 'steps' } }
    )
    const keys = items.map((i) => i.key)
    expect(keys).toContain('imageSize')
    expect(keys).not.toContain('size')
    expect(keys).toContain('steps')
    expect(keys).not.toContain('numInferenceSteps')
    expect(keys).toContain('numImages')
  })

  it('emits customSize widget + custom chip when imageGeneration.customSize is set (zhipu cogview)', () => {
    const items = imageGenerationToFields({
      sizes: ['1024x1024', '768x1344'],
      sizeMode: 'pixel',
      defaultSize: '1024x1024',
      batch: { min: 1, max: 1, default: 1 },
      customSize: { min: 512, max: 2048 },
      supports: { seed: true }
    })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.size?.type).toBe('sizeChips')
    const sizeValues = (byKey.size?.options as { value: string }[]).map((o) => o.value)
    expect(sizeValues).toContain('1024x1024')
    expect(sizeValues).toContain('custom')
    expect(byKey.customSize?.type).toBe('customSize')
    expect((byKey.customSize as unknown as { validation: { minWidth: number } }).validation.minWidth).toBe(512)
  })

  it('does not emit customSize widget when imageGeneration.customSize is absent', () => {
    const items = imageGenerationToFields({
      sizes: ['1024x1024'],
      sizeMode: 'pixel',
      batch: { min: 1, max: 1, default: 1 }
    })
    expect(items.find((i) => i.key === 'customSize')).toBeUndefined()
    const sizeValues = ((items[0].options ?? []) as { value: string }[]).map((o) => o.value)
    expect(sizeValues).not.toContain('custom')
  })

  it('per-mode modeSchemas: ideogram-v3 remix adds imageWeight while preserving top-level fields', () => {
    const support: ImageGenerationSupport = {
      modes: ['generate', 'remix', 'upscale'],
      sizes: ['1:1', '16:9', '9:16'],
      sizeMode: 'aspect',
      defaultSize: '1:1',
      batch: { min: 1, max: 8, default: 1 },
      supports: { negativePrompt: true, seed: true, styleType: ['AUTO', 'REALISTIC'] },
      modeSchemas: {
        remix: { supports: { imageWeight: { min: 1, max: 100, default: 50 } } },
        upscale: { supports: { resemblance: { min: 1, max: 100, default: 50 }, detail: { min: 1, max: 100 } } }
      }
    }

    const generateKeys = imageGenerationToFields(support, { mode: 'generate' }).map((i) => i.key)
    expect(generateKeys).toContain('negativePrompt')
    expect(generateKeys).toContain('styleType')
    expect(generateKeys).not.toContain('imageWeight')
    expect(generateKeys).not.toContain('resemblance')

    const remixKeys = imageGenerationToFields(support, { mode: 'remix' }).map((i) => i.key)
    expect(remixKeys).toContain('imageWeight')
    expect(remixKeys).toContain('styleType') // top-level survives the merge
    expect(remixKeys).not.toContain('resemblance')

    const upscaleKeys = imageGenerationToFields(support, { mode: 'upscale' }).map((i) => i.key)
    expect(upscaleKeys).toContain('resemblance')
    expect(upscaleKeys).toContain('detail')
    expect(upscaleKeys).not.toContain('imageWeight')
  })

  it('emits canonical keys when keyMap is missing or empty', () => {
    const support: ImageGenerationSupport = {
      sizes: ['1024x1024'],
      sizeMode: 'pixel',
      batch: { min: 1, max: 4 },
      supports: { seed: true }
    }
    const a = imageGenerationToFields(support).map((i) => i.key)
    const b = imageGenerationToFields(support, { keyMap: {} }).map((i) => i.key)
    expect(a).toEqual(b)
    expect(a).toEqual(['size', 'numImages', 'seed'])
  })
})
