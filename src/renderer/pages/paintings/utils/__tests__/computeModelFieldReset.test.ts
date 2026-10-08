import { mockPrefetch as prefetchMock, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ImageGenerationSupport } from '@shared/data/types/model'

import { computeModelFieldReset } from '../computeModelFieldReset'

interface PrefetchCallOptions {
  params?: { providerId?: string; modelId?: string }
}

function mockSupportPerModel(byModelId: Record<string, ImageGenerationSupport | null>): void {
  prefetchMock.mockImplementation(async (_path: string, options?: unknown) => {
    const modelId = (options as PrefetchCallOptions | undefined)?.params?.modelId
    return modelId !== undefined ? (byModelId[modelId] ?? null) : null
  })
}

const generateSupport = (supports: ImageGenerationSupport['supports']): ImageGenerationSupport => ({
  supports,
  inputs: {
    images: { min: 0, max: { kind: 'unknown' } },
    prompt: 'required',
    mask: 'unknown',
    mediaTypes: { kind: 'unknown' }
  }
})

describe('computeModelFieldReset', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('populates the new model defaults on first model selection (oldModelId undefined)', async () => {
    mockSupportPerModel({
      'qwen-image': generateSupport({
        size: { type: 'enum', options: ['1664x928', '1328x1328'], default: '1328x1328', render: 'chips' },
        numImages: { type: 'range', min: 1, max: 4, default: 1 },
        promptExtend: { type: 'switch', default: true }
      })
    })
    const patch = await computeModelFieldReset({
      providerId: 'dashscope',
      oldModelId: undefined,
      newModelId: 'qwen-image',
      operation: 'generate'
    })
    expect(patch).toStrictEqual({
      size: '1328x1328',
      numImages: 1,
      promptExtend: true
    })
  })

  it('returns {} when switching to the same model', async () => {
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'gpt-image-1',
      newModelId: 'gpt-image-1',
      operation: 'generate'
    })
    expect(patch).toStrictEqual({})
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('populates new model defaults even when the OLD model is unknown (custom-id painting)', async () => {
    mockSupportPerModel({
      'gpt-image-1': generateSupport({
        size: { type: 'enum', options: ['1024x1024'], default: '1024x1024', render: 'chips' },
        numImages: { type: 'range', min: 1, max: 10, default: 1 },
        quality: { type: 'enum', options: ['auto'] }
      })
    })
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'unknown-custom-id',
      newModelId: 'gpt-image-1',
      operation: 'generate'
    })
    // size + numImages have defaults; quality enum has no default → skipped
    expect(patch).toStrictEqual({
      size: '1024x1024',
      numImages: 1
    })
  })

  it('V_3 → gpt-image-1: clears V_*-only keys, populates new model defaults for missing', async () => {
    mockSupportPerModel({
      V_3: generateSupport({
        aspectRatio: { type: 'enum', options: ['1:1', '16:9'] },
        numImages: { type: 'range', min: 1, max: 8 },
        negativePrompt: { type: 'text', multiline: true },
        seed: { type: 'text' },
        magicPromptOption: { type: 'switch' },
        styleType: { type: 'enum', options: ['AUTO', 'REALISTIC'] },
        renderingSpeed: { type: 'enum', options: ['DEFAULT', 'TURBO'] }
      }),
      'gpt-image-1': generateSupport({
        size: { type: 'enum', options: ['1024x1024', '1536x1024'], default: '1024x1024', render: 'chips' },
        numImages: { type: 'range', min: 1, max: 10 },
        quality: { type: 'enum', options: ['auto', 'high'] },
        background: { type: 'enum', options: ['auto', 'opaque'] }
      })
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'V_3',
      newModelId: 'gpt-image-1',
      operation: 'generate',
      currentValues: {
        aspectRatio: '1:1',
        negativePrompt: 'blur',
        seed: 0,
        magicPromptOption: false,
        styleType: 'AUTO',
        renderingSpeed: 'DEFAULT'
      }
    })

    // Cleared (in V_3 but not in gpt-image-1):
    //   aspectRatio, negativePrompt, seed, magicPromptOption, styleType, renderingSpeed
    // Populated defaults (gpt-image-1 fields not provided in currentValues):
    //   size → '1024x1024' (enum default)
    //   numImages → 1 (range min)
    //   quality, background → no default → skipped
    expect(patch).toStrictEqual({
      aspectRatio: undefined,
      negativePrompt: undefined,
      seed: undefined,
      magicPromptOption: undefined,
      styleType: undefined,
      renderingSpeed: undefined,
      size: '1024x1024',
      numImages: 1
    })
  })

  it('clears stale keys even when the old model has no capability record', async () => {
    mockSupportPerModel({
      next: generateSupport({ seed: { type: 'text' }, addWatermark: { type: 'switch', default: true } })
    })
    const currentValues = { seed: 0, addWatermark: false, staleOption: 'old' }
    const patch = await computeModelFieldReset({
      providerId: 'test',
      oldModelId: 'missing',
      newModelId: 'next',
      operation: 'generate',
      currentValues
    })
    expect(patch).toStrictEqual({ staleOption: undefined })
    expect({ ...currentValues, ...patch }).toStrictEqual({ seed: 0, addWatermark: false, staleOption: undefined })
  })

  it('clears known-model fields when the next model declares no parameters', async () => {
    mockSupportPerModel({ next: generateSupport({}) })
    const patch = await computeModelFieldReset({
      providerId: 'test',
      oldModelId: 'old',
      newModelId: 'next',
      operation: 'generate',
      currentValues: { seed: 0, customSize_width: 512, customSize_height: 768 }
    })
    expect(patch).toStrictEqual({ seed: undefined, customSize_width: undefined, customSize_height: undefined })
  })

  it('uses the live input branch when switching models', async () => {
    mockSupportPerModel({
      next: {
        supports: {
          seed: {
            type: 'text'
          }
        },
        inputs: {
          images: {
            min: 0,
            max: {
              kind: 'unknown'
            }
          },
          prompt: 'required',
          mask: 'unknown',
          mediaTypes: {
            kind: 'unknown'
          }
        },
        withImages: {
          supports: {
            strength: {
              type: 'range',
              min: 0,
              max: 1,
              default: 0.5
            },
            seed: null
          }
        }
      }
    })
    const patch = await computeModelFieldReset({
      providerId: 'test',
      oldModelId: 'old',
      newModelId: 'next',
      operation: 'generate',
      hasImages: true,
      currentValues: { seed: 0 }
    })
    expect(patch).toStrictEqual({ seed: undefined, strength: 0.5 })
  })

  it('keeps a shared field with a valid current value (no default override)', async () => {
    mockSupportPerModel({
      'gpt-image-1': generateSupport({
        size: { type: 'enum', options: ['1024x1024', '1536x1024'], default: '1024x1024', render: 'chips' },
        numImages: { type: 'range', min: 1, max: 10 }
      }),
      'dall-e-3': generateSupport({
        size: { type: 'enum', options: ['1024x1024', '1792x1024'], default: '1024x1024', render: 'chips' },
        numImages: { type: 'range', min: 1, max: 1 }
      })
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'gpt-image-1',
      newModelId: 'dall-e-3',
      operation: 'generate',
      currentValues: { size: '1024x1024', numImages: 1 }
    })
    // Shared values are valid for the new model → no patch entries.
    expect(patch).toStrictEqual({})
  })

  it('resets a stale shared enum value to the new model default', async () => {
    mockSupportPerModel({
      'jimeng-txt2img-v3.1': generateSupport({
        size: { type: 'enum', options: ['1328x1328', '2048x2048'], default: '1328x1328', render: 'chips' }
      }),
      'seedream-5.0-lite': generateSupport({
        size: {
          type: 'enum',
          options: ['2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
          default: '2048x2048',
          render: 'chips'
        }
      })
    })

    const patch = await computeModelFieldReset({
      providerId: 'ppio',
      oldModelId: 'jimeng-txt2img-v3.1',
      newModelId: 'seedream-5.0-lite',
      operation: 'generate',
      currentValues: { size: '1328x1328' }
    })

    expect(patch).toStrictEqual({ size: '2048x2048' })
  })

  it('resets an out-of-range slider value carried from the previous model', async () => {
    mockSupportPerModel({
      'Qwen/Qwen-Image': generateSupport({
        numInferenceSteps: { type: 'range', min: 1, max: 100, default: 30 }
      }),
      'Z-Image-Turbo': generateSupport({
        numInferenceSteps: { type: 'range', min: 1, max: 30, default: 20 }
      })
    })

    const patch = await computeModelFieldReset({
      providerId: 'modelscope',
      oldModelId: 'Qwen/Qwen-Image',
      newModelId: 'Z-Image-Turbo',
      operation: 'generate',
      currentValues: { numInferenceSteps: 80 }
    })

    // 80 is outside the new model's [1, 30] window → reset to its default.
    expect(patch).toStrictEqual({ numInferenceSteps: 20 })
  })

  it('keeps an in-range slider value carried from the previous model', async () => {
    mockSupportPerModel({
      'Qwen/Qwen-Image': generateSupport({
        numInferenceSteps: { type: 'range', min: 1, max: 100, default: 30 }
      }),
      'Z-Image-Turbo': generateSupport({
        numInferenceSteps: { type: 'range', min: 1, max: 30, default: 20 }
      })
    })

    const patch = await computeModelFieldReset({
      providerId: 'modelscope',
      oldModelId: 'Qwen/Qwen-Image',
      newModelId: 'Z-Image-Turbo',
      operation: 'generate',
      currentValues: { numInferenceSteps: 25 }
    })

    // 25 fits the new [1, 30] window → preserved, no patch entry.
    expect(patch).toStrictEqual({})
  })

  it('resets a decimal carried into an integer-backed catalog slider', async () => {
    mockSupportPerModel({
      modelA: generateSupport({ numImages: { type: 'range', min: 1, max: 10, default: 1 } }),
      modelB: generateSupport({ numImages: { type: 'range', min: 1, max: 10, default: 1 } })
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'modelA',
      newModelId: 'modelB',
      operation: 'generate',
      currentValues: { numImages: '2.5' }
    })

    expect(patch).toStrictEqual({ numImages: 1 })
  })

  it('resets a stale default-less enum value to undefined', async () => {
    mockSupportPerModel({
      modelA: generateSupport({ style: { type: 'enum', options: ['vivid', 'natural'] } }),
      modelB: generateSupport({ style: { type: 'enum', options: ['<auto>', '<photography>'] } })
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'modelA',
      newModelId: 'modelB',
      operation: 'generate',
      currentValues: { style: 'vivid' }
    })

    // 'vivid' is absent from modelB's options and modelB's style has no
    // default → reset to undefined (previously skipped because the field
    // had no `initialValue`, leaking 'vivid' to the wire).
    expect(patch).toStrictEqual({ style: undefined })
  })
})
