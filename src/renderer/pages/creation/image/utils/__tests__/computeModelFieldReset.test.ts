import type { ImageGenerationSupport } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computeModelFieldReset } from '../computeModelFieldReset'

const prefetchMock = vi.fn<(path: string, options?: unknown) => Promise<ImageGenerationSupport | null>>()
vi.mock('@data/hooks/useDataApi', () => ({
  prefetch: (path: string, options?: unknown) => prefetchMock(path, options)
}))

interface PrefetchCallOptions {
  params?: { providerId?: string; modelId?: string }
}

function mockSupportPerModel(byModelId: Record<string, ImageGenerationSupport | null>): void {
  prefetchMock.mockImplementation(async (_path: string, options?: unknown) => {
    const modelId = (options as PrefetchCallOptions | undefined)?.params?.modelId
    return modelId !== undefined ? (byModelId[modelId] ?? null) : null
  })
}

describe('computeModelFieldReset', () => {
  beforeEach(() => {
    prefetchMock.mockReset()
  })

  it('populates the new model defaults on first model selection (oldModelId undefined)', async () => {
    mockSupportPerModel({
      'qwen-image': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1664x928', '1328x1328'], default: '1328x1328', render: 'chips' },
              numImages: { type: 'range', min: 1, max: 4, default: 1 },
              promptExtend: { type: 'switch', default: true }
            }
          }
        }
      }
    })
    const patch = await computeModelFieldReset({
      providerId: 'dashscope',
      oldModelId: undefined,
      newModelId: 'qwen-image',
      mode: 'generate'
    })
    expect(patch).toEqual({
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
      mode: 'generate'
    })
    expect(patch).toEqual({})
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('populates new model defaults even when the OLD model is unknown (custom-id painting)', async () => {
    mockSupportPerModel({
      'gpt-image-1': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1024x1024'], default: '1024x1024', render: 'chips' },
              numImages: { type: 'range', min: 1, max: 10, default: 1 },
              quality: { type: 'enum', options: ['auto'] }
            }
          }
        }
      }
    })
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'unknown-custom-id',
      newModelId: 'gpt-image-1',
      mode: 'generate'
    })
    // size + numImages have defaults; quality enum has no default → skipped
    expect(patch).toEqual({
      size: '1024x1024',
      numImages: 1
    })
  })

  it('V_3 → gpt-image-1: clears V_*-only keys, populates new model defaults for missing', async () => {
    mockSupportPerModel({
      V_3: {
        modes: {
          generate: {
            supports: {
              aspectRatio: { type: 'enum', options: ['1:1', '16:9'] },
              numImages: { type: 'range', min: 1, max: 8 },
              negativePrompt: { type: 'text', multiline: true },
              seed: { type: 'text' },
              magicPromptOption: { type: 'switch' },
              styleType: { type: 'enum', options: ['AUTO', 'REALISTIC'] },
              renderingSpeed: { type: 'enum', options: ['DEFAULT', 'TURBO'] }
            }
          }
        }
      },
      'gpt-image-1': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1024x1024', '1536x1024'], default: '1024x1024', render: 'chips' },
              numImages: { type: 'range', min: 1, max: 10 },
              quality: { type: 'enum', options: ['auto', 'high'] },
              background: { type: 'enum', options: ['auto', 'opaque'] }
            }
          }
        }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'V_3',
      newModelId: 'gpt-image-1',
      mode: 'generate'
    })

    // Cleared (in V_3 but not in gpt-image-1):
    //   aspectRatio, negativePrompt, seed, magicPromptOption, styleType, renderingSpeed
    // Populated defaults (gpt-image-1 fields not provided in currentValues):
    //   size → '1024x1024' (enum default)
    //   numImages → 1 (range min)
    //   quality, background → no default → skipped
    expect(patch).toEqual({
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

  it('keeps a shared field with a valid current value (no default override)', async () => {
    mockSupportPerModel({
      'gpt-image-1': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1024x1024', '1536x1024'], default: '1024x1024', render: 'chips' },
              numImages: { type: 'range', min: 1, max: 10 }
            }
          }
        }
      },
      'dall-e-3': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1024x1024', '1792x1024'], default: '1024x1024', render: 'chips' },
              numImages: { type: 'range', min: 1, max: 1 }
            }
          }
        }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'gpt-image-1',
      newModelId: 'dall-e-3',
      mode: 'generate',
      currentValues: { size: '1024x1024', numImages: 1 }
    })
    // Shared values are valid for the new model → no patch entries.
    expect(patch).toEqual({})
  })

  it('resets a stale shared enum value to the new model default', async () => {
    mockSupportPerModel({
      'jimeng-txt2img-v3.1': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1328x1328', '2048x2048'], default: '1328x1328', render: 'chips' }
            }
          }
        }
      },
      'seedream-5.0-lite': {
        modes: {
          generate: {
            supports: {
              size: {
                type: 'enum',
                options: ['2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                default: '2048x2048',
                render: 'chips'
              }
            }
          }
        }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'ppio',
      oldModelId: 'jimeng-txt2img-v3.1',
      newModelId: 'seedream-5.0-lite',
      mode: 'generate',
      currentValues: { size: '1328x1328' }
    })

    expect(patch).toEqual({ size: '2048x2048' })
  })

  it('resets an out-of-range slider value carried from the previous model', async () => {
    mockSupportPerModel({
      'Qwen/Qwen-Image': {
        modes: { generate: { supports: { numInferenceSteps: { type: 'range', min: 1, max: 100, default: 30 } } } }
      },
      'Z-Image-Turbo': {
        modes: { generate: { supports: { numInferenceSteps: { type: 'range', min: 1, max: 30, default: 20 } } } }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'modelscope',
      oldModelId: 'Qwen/Qwen-Image',
      newModelId: 'Z-Image-Turbo',
      mode: 'generate',
      currentValues: { numInferenceSteps: 80 }
    })

    // 80 is outside the new model's [1, 30] window → reset to its default.
    expect(patch).toEqual({ numInferenceSteps: 20 })
  })

  it('keeps an in-range slider value carried from the previous model', async () => {
    mockSupportPerModel({
      'Qwen/Qwen-Image': {
        modes: { generate: { supports: { numInferenceSteps: { type: 'range', min: 1, max: 100, default: 30 } } } }
      },
      'Z-Image-Turbo': {
        modes: { generate: { supports: { numInferenceSteps: { type: 'range', min: 1, max: 30, default: 20 } } } }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'modelscope',
      oldModelId: 'Qwen/Qwen-Image',
      newModelId: 'Z-Image-Turbo',
      mode: 'generate',
      currentValues: { numInferenceSteps: 25 }
    })

    // 25 fits the new [1, 30] window → preserved, no patch entry.
    expect(patch).toEqual({})
  })

  it('resets a stale default-less enum value to undefined', async () => {
    mockSupportPerModel({
      modelA: {
        modes: { generate: { supports: { style: { type: 'enum', options: ['vivid', 'natural'] } } } }
      },
      modelB: {
        modes: { generate: { supports: { style: { type: 'enum', options: ['<auto>', '<photography>'] } } } }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'modelA',
      newModelId: 'modelB',
      mode: 'generate',
      currentValues: { style: 'vivid' }
    })

    // 'vivid' is absent from modelB's options and modelB's style has no
    // default → reset to undefined (previously skipped because the field
    // had no `initialValue`, leaking 'vivid' to the wire).
    expect(patch).toEqual({ style: undefined })
  })
})
