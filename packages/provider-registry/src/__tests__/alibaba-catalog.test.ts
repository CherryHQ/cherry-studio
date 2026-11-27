import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CREATORS } from '../creators'
import { RegistryLoader } from '../registry-loader'
import type { ImageGenerationMode } from '../schemas/model'
import { buildParamsSchema } from '../utils/buildParamsSchema'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Alibaba Qwen catalog', () => {
  it('preserves Flash Next video inputs in the creator source and shipped catalog', () => {
    const creator = CREATORS.find(({ id }) => id === 'alibaba')
    const source = creator?.models?.find(({ id }) => id === 'qwen3-8-flash-next')

    for (const model of [source, loader.findModel('qwen3-8-flash-next')]) {
      expect(model?.inputModalities).toEqual(['text', 'image', 'video'])
      expect(model?.capabilities).toContain('video-recognition')
    }
  })

  it('maps QwenCloud to qwen3.8-flash with the Qwen3.8 chat effort contract', () => {
    const override = loader.findOverride('qwencloud', 'qwen3.8-flash')
    expect(override).toMatchObject({
      apiModelId: 'qwen3.8-flash',
      modelId: 'qwen3-8-flash',
      name: 'Qwen3.8 Flash',
      reasoningContracts: {
        'openai-chat-completions': {
          support: {
            controls: [{ default: 'xhigh', kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
            thinkingTokenLimits: { min: 0, max: 262144 }
          }
        }
      }
    })
    // No per-model Responses support list is published internationally, so the
    // contract mirrors qwen3.8-max's Chat-only shape, not DashScope's dual-endpoint one.
    expect(override?.reasoningContracts).not.toHaveProperty('openai-responses')
  })
})

describe('Alibaba Qwen-Image & Z-Image DashScope catalog', () => {
  const syncEndpoint = { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
  const qwen20Sizes = ['2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368']
  const qwen21Sizes = ['auto', '1024x1024', '2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368']
  const editMultiSizes = ['1024x1024', '2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368']

  const cases: Array<{
    id: string
    apiModelId: string
    ownedBy: string
    modes: ImageGenerationMode[]
    creatorKeys: string[]
    overrideKeys: string[]
    maxImages: number
    sizeOptions?: string[]
    generateSizeDefault?: string
    editSizeDefault?: string
    promptExtendDefault?: boolean
    maxEditInputImages?: number
    legalSize: string
  }> = [
    {
      id: 'qwen-image-max',
      apiModelId: 'qwen-image-max',
      ownedBy: 'alibaba',
      modes: ['generate'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 1,
      promptExtendDefault: true,
      legalSize: '1664x928'
    },
    {
      id: 'qwen-image-plus',
      apiModelId: 'qwen-image-plus',
      ownedBy: 'alibaba',
      modes: ['generate'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 1,
      promptExtendDefault: true,
      legalSize: '1664x928'
    },
    {
      id: 'qwen-image-2-0',
      apiModelId: 'qwen-image-2.0',
      ownedBy: 'alibaba',
      modes: ['edit', 'generate'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: qwen20Sizes,
      generateSizeDefault: '2048x2048',
      promptExtendDefault: true,
      maxEditInputImages: 3,
      legalSize: '2688x1536'
    },
    {
      id: 'qwen-image-2-0-pro',
      apiModelId: 'qwen-image-2.0-pro',
      ownedBy: 'alibaba',
      modes: ['edit', 'generate'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: qwen20Sizes,
      generateSizeDefault: '2048x2048',
      promptExtendDefault: true,
      maxEditInputImages: 3,
      legalSize: '2688x1536'
    },
    {
      id: 'qwen-image-2-1-pro',
      apiModelId: 'qwen-image-2.1-pro',
      ownedBy: 'alibaba',
      modes: ['edit', 'generate'],
      creatorKeys: ['numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: qwen21Sizes,
      generateSizeDefault: 'auto',
      editSizeDefault: 'auto',
      promptExtendDefault: true,
      maxEditInputImages: 10,
      legalSize: '2688x1536'
    },
    {
      id: 'qwen-image-2-1-turbo',
      apiModelId: 'qwen-image-2.1-turbo',
      ownedBy: 'alibaba',
      modes: ['edit', 'generate'],
      creatorKeys: ['numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: qwen21Sizes,
      generateSizeDefault: 'auto',
      editSizeDefault: 'auto',
      promptExtendDefault: true,
      maxEditInputImages: 10,
      legalSize: '2688x1536'
    },
    {
      id: 'qwen-image-edit-max',
      apiModelId: 'qwen-image-edit-max',
      ownedBy: 'alibaba',
      modes: ['edit'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: editMultiSizes,
      promptExtendDefault: true,
      legalSize: '2048x2048'
    },
    {
      id: 'qwen-image-edit-plus',
      apiModelId: 'qwen-image-edit-plus',
      ownedBy: 'alibaba',
      modes: ['edit'],
      creatorKeys: ['negativePrompt', 'numImages', 'seed', 'size'],
      overrideKeys: ['addWatermark', 'negativePrompt', 'numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 6,
      sizeOptions: editMultiSizes,
      promptExtendDefault: true,
      legalSize: '2048x2048'
    },
    {
      id: 'z-image-turbo',
      apiModelId: 'z-image-turbo',
      ownedBy: 'alibaba',
      modes: ['generate'],
      creatorKeys: ['numImages', 'seed', 'size'],
      overrideKeys: ['numImages', 'promptExtend', 'seed', 'size'],
      maxImages: 1,
      legalSize: '2048x2048'
    }
  ]

  it.each(cases)('$id declares intrinsic creator metadata and DashScope transport override', (spec) => {
    const model = loader.findModel(spec.id)
    expect(model).toBeDefined()
    expect(model?.ownedBy).toBe(spec.ownedBy)
    expect(model?.capabilities).toContain('image-generation')
    expect(Object.keys(model?.imageGeneration?.modes ?? {}).sort()).toEqual([...spec.modes].sort())

    const override = loader.findOverride('dashscope', spec.apiModelId)
    expect(override).toBeDefined()
    expect(override?.modelId).toBe(spec.id)
    expect(override?.apiModelId).toBe(spec.apiModelId)
    expect(Object.keys(override?.imageGeneration?.modes ?? {}).sort()).toEqual([...spec.modes].sort())

    for (const mode of spec.modes) {
      const creatorMode = model?.imageGeneration?.modes[mode]
      expect(creatorMode?.vendorTransport).toBeUndefined()
      expect(Object.keys(creatorMode?.supports ?? {}).sort()).toEqual(spec.creatorKeys)

      const overrideMode = override?.imageGeneration?.modes[mode]
      expect(overrideMode?.vendorTransport).toEqual(syncEndpoint)
      expect(Object.keys(overrideMode?.supports ?? {}).sort()).toEqual(spec.overrideKeys)
      expect(overrideMode?.supports.numImages).toEqual({
        type: 'range',
        min: 1,
        max: spec.maxImages,
        default: 1,
        step: 1
      })
      expect(overrideMode?.supports.promptExtend).toEqual({
        type: 'switch',
        ...(spec.promptExtendDefault !== undefined ? { default: spec.promptExtendDefault } : {})
      })
      const expectedDefault = mode === 'edit' ? spec.editSizeDefault : spec.generateSizeDefault
      if (spec.sizeOptions) {
        expect(overrideMode?.supports.size).toEqual({
          type: 'enum',
          options: spec.sizeOptions,
          render: 'chips',
          ...(expectedDefault ? { default: expectedDefault } : {})
        })
      } else {
        expect(creatorMode?.supports.size).toEqual({ type: 'text' })
        expect(overrideMode?.supports.size).toEqual({ type: 'text' })
      }
      if (mode === 'edit') {
        expect(overrideMode?.maxInputImages).toBe(spec.maxEditInputImages)
        expect(creatorMode?.maxInputImages).toBe(spec.maxEditInputImages)
      }

      const schema = buildParamsSchema(override?.imageGeneration, mode)
      const parsed = schema.parse({
        size: spec.legalSize,
        numImages: String(spec.maxImages),
        seed: '42'
      })
      expect(parsed).toMatchObject({
        size: spec.legalSize,
        numImages: spec.maxImages,
        seed: 42
      })

      const invalid = schema.parse({
        size: spec.sizeOptions ? '9999x9999' : 1234,
        numImages: spec.maxImages + 1,
        seed: 'not-a-seed'
      })
      expect(invalid.size).toBeUndefined()
      expect(invalid.numImages).toBeUndefined()
      expect(invalid.seed).toBeUndefined()
    }
  })

  it.each(['qwen-image-2.0', 'qwen-image-2.0-pro'])(
    'caps %s edit mode on qwencloud to 3 input images',
    (apiModelId) => {
      const override = loader.findOverride('qwencloud', apiModelId)
      expect(override?.imageGeneration?.modes.edit?.maxInputImages).toBe(3)
    }
  )
})
