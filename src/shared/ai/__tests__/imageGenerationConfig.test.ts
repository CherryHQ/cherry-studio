import { describe, expect, it } from 'vitest'

import { openAIImageSupport } from '../../../../packages/provider-registry/src/creators/imageCanvases'
import { resolveImageCanvasParams } from '../imageCanvases'
import {
  applyImageGenerationConfig,
  imageConfigProtocol,
  imageParameterDefaults,
  imagePresetFamily,
  visibleImagePresets,
  ImageGenerationConfigSchema
} from '../imageGenerationConfig'

const base = openAIImageSupport(true)
const generate = {
  defaults: {
    imageResolution: '2K',
    aspectRatio: '16:9',
    quality: 'max',
    outputFormat: 'webp',
    outputCompression: 82,
    numImages: 2
  },
  options: {}
}
const config = ImageGenerationConfigSchema.parse({
  preset: 'gpt-image-2-5-sunburst',
  generate
})

describe('saved image model parameters', () => {
  it('selects the Seedream wire protocol independently while preserving native configurations', () => {
    const native = ImageGenerationConfigSchema.parse({ preset: 'seedream' })
    const compatible = ImageGenerationConfigSchema.parse({ ...native, apiProtocol: 'openai' })
    expect(imageConfigProtocol(native)).toBe('doubao')
    expect(imageConfigProtocol(compatible)).toBe('openai')
    expect(compatible.generate).toEqual(native.generate)
    expect(compatible.edit).toBeNull()
    expect(ImageGenerationConfigSchema.safeParse({ ...compatible, preset: 'gemini-3-1-flash-image' }).success).toBe(
      false
    )
  })
  it('uses the same saved defaults for generation and inherited edits, with explicit requests taking precedence', () => {
    const effective = applyImageGenerationConfig(base, config)
    for (const mode of ['generate', 'edit'] as const) {
      expect(resolveImageCanvasParams(effective, mode, imageParameterDefaults(effective, mode, {}))).toMatchObject({
        size: '2048x1152',
        quality: 'max',
        outputFormat: 'webp',
        outputCompression: 82,
        numImages: 2
      })
    }
    expect(imageParameterDefaults(effective, 'generate', { quality: 'low' }).quality).toBe('low')
    expect(base.modes.generate?.supports.quality).toMatchObject({
      default: 'auto'
    })
  })
  it('keeps editing defaults independent after inheritance is disabled', () => {
    const effective = applyImageGenerationConfig(base, {
      ...config,
      edit: {
        defaults: { imageResolution: '1K', aspectRatio: '2:3', quality: 'low' },
        options: {}
      }
    })
    expect(resolveImageCanvasParams(effective, 'edit', imageParameterDefaults(effective, 'edit', {}))).toMatchObject({
      size: '1024x1536',
      quality: 'low'
    })
    expect(
      resolveImageCanvasParams(effective, 'generate', imageParameterDefaults(effective, 'generate', {})).size
    ).toBe('2048x1152')
  })
  it('uses user-defined options and count limits', () => {
    const narrow = ImageGenerationConfigSchema.parse({
      generate: {
        options: { imageResolution: ['2K'], aspectRatio: ['16:9'] },
        maxImages: 3
      }
    })
    const effective = applyImageGenerationConfig(base, narrow)
    expect(effective.modes.generate?.supports.imageResolution).toMatchObject({
      options: ['2K'],
      default: '2K'
    })
    expect(effective.modes.generate?.supports.aspectRatio).toMatchObject({
      options: ['auto', '16:9']
    })
    expect(resolveImageCanvasParams(effective, 'generate', {})).toEqual({
      size: 'auto'
    })
    expect(() => imageParameterDefaults(effective, 'generate', { numImages: 4 })).toThrow()
    expect(() =>
      applyImageGenerationConfig(base, {
        ...narrow,
        generate: { defaults: {}, options: { quality: ['invented'] } }
      })
    ).not.toThrow()
    expect(() =>
      applyImageGenerationConfig(base, {
        ...narrow,
        generate: { defaults: {}, options: {}, maxImages: 11 }
      })
    ).not.toThrow()
    expect(() => applyImageGenerationConfig(openAIImageSupport(), config)).not.toThrow()
  })
  it('rejects a background and format combination that the API cannot honor', () => {
    expect(() =>
      applyImageGenerationConfig(base, {
        ...config,
        generate: {
          defaults: { background: 'transparent', outputFormat: 'jpeg' },
          options: {}
        }
      })
    ).toThrow('PNG or WebP')
  })
})

describe('compact image preset choices', () => {
  it('shows four families and defaults new settings to GPT Image', () => {
    expect(ImageGenerationConfigSchema.parse({}).preset).toBe('gpt-image-2-5-sunburst')
    expect(visibleImagePresets('catalog').map((choice) => choice.name)).toEqual([
      'GPT Image',
      'Nano Banana',
      'Seedream',
      'Grok Image'
    ])
  })
  it('groups variants without changing their persisted IDs', () => {
    for (const preset of ['gpt-image-2-5-flare', 'doubao-seedream-5-0-pro']) {
      expect(visibleImagePresets(preset)).toHaveLength(4)
      expect(visibleImagePresets(preset).some((choice) => choice.id === imagePresetFamily(preset))).toBe(true)
      expect(ImageGenerationConfigSchema.parse({ preset }).preset).toBe(preset)
    }
  })
  it('keeps only the currently saved legacy preset available for editing', () => {
    expect(visibleImagePresets('gpt-image-2').map((choice) => choice.id)).toContain('gpt-image-2')
    expect(visibleImagePresets('gpt-image-2').map((choice) => choice.id)).not.toContain('doubao-seedream-4-5')
    expect(visibleImagePresets('catalog').map((choice) => choice.id)).not.toContain('gpt-image-2')
  })
})

it('preserves custom tiers, ratios, pixel overrides and inherited editing', () => {
  const configured = applyImageGenerationConfig(
    base,
    ImageGenerationConfigSchema.parse({
      generate: {
        options: {
          imageResolution: ['6K'],
          aspectRatio: ['3:1'],
          quality: ['custom-quality']
        },
        defaults: {
          imageResolution: '6K',
          aspectRatio: '3:1',
          quality: 'custom-quality'
        },
        maxImages: 20,
        maxInputImages: 30,
        sizeRules: { '6K': { longEdge: 6144, multiple: 16 } }
      }
    })
  )
  expect(resolveImageCanvasParams(configured, 'edit', imageParameterDefaults(configured, 'edit', {}))).toMatchObject({
    size: '6144x2048',
    quality: 'custom-quality'
  })
  expect(configured.modes.edit?.maxInputImages).toBe(30)
  expect(configured.modes.generate?.supports.numImages).toMatchObject({
    max: 20
  })
})
