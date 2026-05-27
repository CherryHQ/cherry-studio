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

  it('returns {} when oldModelId is undefined (first model selection)', async () => {
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: undefined,
      newModelId: 'gpt-image-1',
      mode: 'generate'
    })
    expect(patch).toEqual({})
    expect(prefetchMock).not.toHaveBeenCalled()
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

  it('returns {} when the OLD model is unknown to the registry (custom-id painting)', async () => {
    mockSupportPerModel({
      'gpt-image-1': {
        modes: {
          generate: {
            supports: {
              size: { type: 'enum', options: ['1024x1024'], render: 'chips' },
              numImages: { type: 'range', min: 1, max: 10 },
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
    expect(patch).toEqual({})
  })

  it('V_3 → gpt-image-1: clears V_*-only keys, keeps shared keys', async () => {
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
              size: { type: 'enum', options: ['1024x1024', '1536x1024'], render: 'chips' },
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

    // V_3 keys: aspectRatio, numImages, negativePrompt, seed, magicPromptOption, styleType, renderingSpeed
    // gpt-image-1 keys: size, numImages, quality, background
    // Diff (V_3 - gpt-image-1): aspectRatio, negativePrompt, seed, magicPromptOption, styleType, renderingSpeed
    expect(patch).toEqual({
      aspectRatio: undefined,
      negativePrompt: undefined,
      seed: undefined,
      magicPromptOption: undefined,
      styleType: undefined,
      renderingSpeed: undefined
    })
    expect(patch).not.toHaveProperty('numImages')
    expect(patch).not.toHaveProperty('size')
    expect(patch).not.toHaveProperty('quality')
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
})
