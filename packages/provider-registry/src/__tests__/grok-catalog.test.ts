import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isServerToolModelEligible } from '../patterns/serverToolModelEligibility'
import { RegistryLoader } from '../registry-loader'
import { buildParamsSchema } from '../utils/buildParamsSchema'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Grok native search eligibility', () => {
  it.each(['grok-4.7', 'grok-4-7', 'xai/grok-4.7', 'grok-4.3', 'grok-4.6'])(
    'allows native Web/X search for %s',
    (id) => {
      expect(isServerToolModelEligible(id, 'grok', 'web-search')).toBe(true)
    }
  )

  it.each(['grok-3', 'grok-2-image', 'grok-imagine-image', 'grok-4-unknown'])(
    'does not enable native search for unsupported model %s',
    (id) => {
      expect(isServerToolModelEligible(id, 'grok', 'web-search')).toBe(false)
    }
  )
})

describe('Grok native image catalog', () => {
  const legacyAspectRatios = [
    '1:1',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '2:3',
    '3:2',
    '9:19.5',
    '19.5:9',
    '9:20',
    '20:9',
    '1:2',
    '2:1',
    'auto'
  ]
  const image20AspectRatios = [
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '3:2',
    '2:3',
    '2:1',
    '1:2',
    '19.5:9',
    '9:19.5',
    '20:9',
    '9:20',
    '21:9',
    '5:2',
    'auto'
  ]

  describe.each([
    { id: 'grok-imagine-image', aspectRatios: legacyAspectRatios, maxInputImages: 3 },
    { id: 'grok-imagine-image-2-0', aspectRatios: image20AspectRatios, maxInputImages: 5 },
    { id: 'grok-imagine-image-quality', aspectRatios: legacyAspectRatios, maxInputImages: 3 }
  ])('$id', ({ id, aspectRatios, maxInputImages }) => {
    it('keeps the canonical model without native image generation support', () => {
      const model = loader.findModel(id)
      expect(model).toMatchObject({ id })
      expect(model?.imageGeneration).toBeUndefined()
    })

    it('declares generate and edit with the SKU reference image limit', () => {
      const support = loader.findOverride('grok', id)?.imageGeneration
      expect(support).toBeDefined()
      if (!support) throw new Error('Expected image generation support')
      expect(Object.keys(support.modes).sort()).toEqual(['edit', 'generate'])
      expect(support.modes.edit?.maxInputImages).toBe(maxInputImages)
    })

    it.each(['generate', 'edit'] as const)('offers only the SKU aspect ratio chips in %s mode', (mode) => {
      const supports = loader.findOverride('grok', id)?.imageGeneration?.modes[mode]?.supports
      expect(supports).toBeDefined()
      if (!supports) throw new Error('Expected image mode support')
      expect(loader.findOverride('grok', id)?.imageGeneration?.modes[mode]).not.toHaveProperty('vendorTransport')
      expect(Object.keys(supports).sort()).toEqual(['aspectRatio'])
      expect(supports.aspectRatio).toEqual({
        default: 'auto',
        options: aspectRatios,
        render: 'chips',
        type: 'enum'
      })
      if (supports.aspectRatio?.type !== 'enum') throw new Error('Expected aspect ratio presets')
      if (id !== 'grok-imagine-image-2-0') {
        expect(supports.aspectRatio.options).not.toContain('21:9')
        expect(supports.aspectRatio.options).not.toContain('5:2')
      }
    })

    it.each(['generate', 'edit'] as const)('round-trips supported aspect ratios in %s mode', (mode) => {
      const support = loader.findOverride('grok', id)?.imageGeneration
      expect(support).toBeDefined()
      if (!support) throw new Error('Expected image generation support')
      const schema = buildParamsSchema(support, mode)
      for (const aspectRatio of aspectRatios) {
        expect(schema.parse({ aspectRatio }).aspectRatio).toBe(aspectRatio)
      }
      expect(schema.parse({ aspectRatio: 'bogus' }).aspectRatio).toBeUndefined()
      if (id !== 'grok-imagine-image-2-0') {
        expect(schema.parse({ aspectRatio: '21:9' }).aspectRatio).toBeUndefined()
        expect(schema.parse({ aspectRatio: '5:2' }).aspectRatio).toBeUndefined()
      }
    })

    it('routes the SKU through the native image endpoint and API model ID', () => {
      const override = loader.findOverride('grok', id)
      expect(override).toMatchObject({ modelId: id, endpointTypes: ['openai-image-generation'] })
      if (id === 'grok-imagine-image-2-0') {
        expect(override?.apiModelId).toBe('grok-imagine-image-2.0')
      }
    })
  })

  it.each(['generate', 'edit'] as const)('adds exactly two aspect ratios to Image 2.0 in %s mode', (mode) => {
    const legacy = loader.findOverride('grok', 'grok-imagine-image')?.imageGeneration?.modes[mode]?.supports.aspectRatio
    const image20 = loader.findOverride('grok', 'grok-imagine-image-2-0')?.imageGeneration?.modes[mode]?.supports
      .aspectRatio
    if (legacy?.type !== 'enum' || image20?.type !== 'enum') throw new Error('Expected aspect ratio presets')
    expect(image20.options).toHaveLength(16)
    expect(legacy.options).toHaveLength(14)
    expect([...image20.options].sort()).toEqual([...legacy.options, '21:9', '5:2'].sort())
  })

  it('configures the xAI image adapter without overriding the provider connection', () => {
    const config = loader.findProvider('grok')?.endpointConfigs?.['openai-image-generation']
    expect(config).toBeDefined()
    expect(config?.adapterFamily).toBe('xai')
    expect(config).not.toHaveProperty('baseUrl')
  })
})
