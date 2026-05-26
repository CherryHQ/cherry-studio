import type { ImageGenerationSupport } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computeModelFieldReset } from '../computeModelFieldReset'

// Mock the DataApi prefetch — the helper depends on it for the
// (providerId, modelId) → ImageGenerationSupport lookup.
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
      newModelId: 'gpt-image-2',
      providerKeyMap: undefined,
      mode: 'generate'
    })
    expect(patch).toEqual({})
    // No prefetch needed when there's nothing to diff against.
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('returns {} when switching to the same model', async () => {
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'gpt-image-2',
      newModelId: 'gpt-image-2',
      providerKeyMap: undefined,
      mode: 'generate'
    })
    expect(patch).toEqual({})
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('returns {} when the OLD model is unknown to the registry (custom-id painting)', async () => {
    mockSupportPerModel({
      'gpt-image-2': {
        modes: ['generate'],
        sizes: ['1024x1024'],
        sizeMode: 'pixel',
        batch: { min: 1, max: 10 },
        keyMap: { numImages: 'n' },
        supports: { quality: ['auto'] }
      }
    })
    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'unknown-custom-id',
      newModelId: 'gpt-image-2',
      providerKeyMap: undefined,
      mode: 'generate'
    })
    expect(patch).toEqual({})
  })

  it('aihubmix V_3 → gpt-image-2: clears V_*-only fields (aspectRatio, styleType, renderingSpeed, …) but keeps shared keys', async () => {
    mockSupportPerModel({
      V_3: {
        modes: ['generate', 'remix', 'upscale'],
        batch: { min: 1, max: 8 },
        keyMap: { size: 'aspectRatio' },
        modeSchemas: {
          generate: {
            sizes: ['ASPECT_1_1', 'ASPECT_16_9'],
            sizeMode: 'aspect',
            supports: {
              negativePrompt: true,
              seed: true,
              magicPromptOption: true,
              styleType: ['AUTO', 'REALISTIC'],
              renderingSpeed: ['DEFAULT', 'TURBO']
            }
          }
        }
      },
      'gpt-image-2': {
        modes: ['generate'],
        sizes: ['1024x1024', '1536x1024'],
        sizeMode: 'pixel',
        batch: { min: 1, max: 10 },
        keyMap: { numImages: 'n' },
        supports: { quality: ['auto', 'high'], background: ['auto', 'opaque'] }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'V_3',
      newModelId: 'gpt-image-2',
      providerKeyMap: undefined,
      mode: 'generate'
    })

    // V_3 emitted: aspectRatio (size keyMap'd), numImages, seed, negativePrompt,
    //              magicPromptOption, styleType, renderingSpeed
    // gpt-image-2 emitted: size, n (numImages keyMap'd), quality, background
    // Diff (V_3 - gpt-image-2): aspectRatio, numImages, seed, negativePrompt,
    //                           magicPromptOption, styleType, renderingSpeed
    expect(patch).toEqual({
      aspectRatio: undefined,
      numImages: undefined,
      seed: undefined,
      negativePrompt: undefined,
      magicPromptOption: undefined,
      styleType: undefined,
      renderingSpeed: undefined
    })
    // Sanity: shared keys NOT in the patch.
    expect(patch).not.toHaveProperty('size')
    expect(patch).not.toHaveProperty('n')
    expect(patch).not.toHaveProperty('quality')
  })

  it("keyMap divergence: gpt-image-1 (n) → imagen (numberOfImages) — clears `n`, doesn't touch `numberOfImages`", async () => {
    mockSupportPerModel({
      'gpt-image-1': {
        modes: ['generate'],
        sizes: ['1024x1024'],
        sizeMode: 'pixel',
        batch: { min: 1, max: 10 },
        keyMap: { numImages: 'n' },
        supports: { quality: ['auto'] }
      },
      'imagen-4-ultra': {
        modes: ['generate'],
        batch: { min: 1, max: 1 },
        keyMap: { numImages: 'numberOfImages' },
        supports: { personGeneration: ['ALLOW_ALL'] }
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'aihubmix',
      oldModelId: 'gpt-image-1',
      newModelId: 'imagen-4-ultra',
      providerKeyMap: undefined,
      mode: 'generate'
    })

    // gpt-image-1 has `size` and `n`; imagen has `numberOfImages` and `personGeneration`.
    expect(patch).toEqual({
      size: undefined,
      n: undefined,
      quality: undefined
    })
    expect(patch).not.toHaveProperty('numberOfImages')
    expect(patch).not.toHaveProperty('personGeneration')
  })

  it('resets a stale shared option value to the new model default', async () => {
    mockSupportPerModel({
      'jimeng-txt2img-v3.1': {
        modes: ['generate'],
        sizes: ['1328x1328', '2048x2048'],
        sizeMode: 'pixel',
        defaultSize: '1328x1328'
      },
      'seedream-5.0-lite': {
        modes: ['generate', 'edit'],
        sizes: ['2K', '3K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
        sizeMode: 'pixel',
        defaultSize: '2048x2048'
      }
    })

    const patch = await computeModelFieldReset({
      providerId: 'ppio',
      oldModelId: 'jimeng-txt2img-v3.1',
      newModelId: 'seedream-5.0-lite',
      providerKeyMap: undefined,
      mode: 'generate',
      currentValues: {
        size: '1328x1328'
      }
    })

    expect(patch).toEqual({
      size: '2048x2048'
    })
  })
})
