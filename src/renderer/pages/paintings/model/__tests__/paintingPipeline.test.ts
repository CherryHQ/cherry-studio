import { mockPrefetch, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ImageGenerationOverrideSchema,
  ImageGenerationSupportSchema,
  resolveImageGenerationSupport
} from '@cherrystudio/provider-registry'
import type { FileEntry } from '@shared/data/types/file'

import models from '../../../../../../packages/provider-registry/data/models.json'
import catalog from '../../../../../../packages/provider-registry/data/provider-models.json'
import { paintingGenerate } from '../paintingPipeline'
import type { GenerateInput } from '../types/generateInput'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

function input(): GenerateInput {
  return {
    painting: {
      id: 'p1',
      providerId: 'tokenhub',
      mode: 'generate',
      model: 'hy-image-v3',
      prompt: 'a fox',
      params: {},
      files: [],
      inputFiles: [{ id: 'reference', ext: 'png' }] as FileEntry[]
    },
    provider: {
      id: 'tokenhub',
      name: 'TokenHub',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: async () => 'unused'
    },
    tab: 'default',
    abortController: new AbortController()
  }
}

describe('painting capability to IPC', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    request.mockReset()
    request.mockResolvedValue({
      files: [{ id: 'result', name: 'fox', ext: 'png', origin: 'internal', size: 3, createdAt: 0 }]
    })
    window.api.file.binaryImage = vi.fn().mockResolvedValue({ data: [1, 2, 3], mime: 'image/png' })
    window.api.file.getPhysicalPath = vi.fn().mockResolvedValue('/output/result.png')
  })

  function seedSupport(support: unknown) {
    mockPrefetch.mockResolvedValueOnce(ImageGenerationSupportSchema.parse(support))
  }

  it('delivers TokenHub reference generation without an edit mode or a lost input', async () => {
    const row = catalog.overrides.find((row) => row.providerId === 'tokenhub' && row.apiModelId === 'hy-image-v3')
    if (!row) throw new Error('Missing TokenHub hy-image-v3 fixture')
    const base = models.models.find((model) => model.id === row.modelId)
    seedSupport(
      resolveImageGenerationSupport(
        { imageGeneration: ImageGenerationSupportSchema.optional().parse(base?.imageGeneration) },
        { imageGeneration: ImageGenerationOverrideSchema.optional().parse(row.imageGeneration) }
      )
    )
    const result = await paintingGenerate(input())
    expect(result).toMatchObject([{ id: 'result', path: '/output/result.png' }])
    expect(request).toHaveBeenCalledWith(
      'ai.image.generate',
      expect.objectContaining({
        payload: expect.objectContaining({ operation: 'generate', inputImages: ['data:image/png;base64,AQID'] })
      })
    )
    expect(request.mock.calls[0][1].payload).not.toHaveProperty('mode')
  })

  it('rejects a missing reference on an image-only model before file IO and IPC', async () => {
    seedSupport({
      supports: {},
      inputs: {
        images: {
          min: 1,
          max: {
            kind: 'unknown'
          }
        },
        prompt: 'required',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      }
    })
    const requestInput = input()
    requestInput.painting.inputFiles = []
    await expect(paintingGenerate(requestInput)).rejects.toMatchObject({ code: 'EDIT_IMAGE_REQUIRED' })
    expect(window.api.file.binaryImage).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not silently substitute an upscale-only operation for generate', async () => {
    seedSupport({
      supports: {},
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
      operations: {
        generate: null,
        upscale: {
          supports: {},
          inputs: {
            images: {
              min: 1,
              max: {
                kind: 'unknown'
              }
            },
            prompt: 'optional'
          }
        }
      }
    })
    await expect(paintingGenerate(input())).rejects.toMatchObject({ code: 'OPERATION_FAILED' })
    expect(request).not.toHaveBeenCalled()
  })
})
