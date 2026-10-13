import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedImageGenerationSupport } from '@shared/ai/imageGeneration'
import type { FileEntry } from '@shared/data/types/file'

import { paintingGenerate } from '../paintingPipeline'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

let support: ResolvedImageGenerationSupport
let submitted: Record<string, unknown>[]
const image = { id: 'image', name: 'image', origin: 'internal', ext: 'png', size: 3, createdAt: 0 } as FileEntry

function makeInput(overrides: Partial<PaintingData> = {}): GenerateInput {
  return {
    painting: {
      id: 'painting',
      providerId: 'test',
      model: 'test',
      mode: 'edit',
      prompt: '',
      params: {},
      files: [],
      ...overrides
    },
    provider: { id: 'test', name: 'Test', apiHost: 'https://test.invalid', isEnabled: true, getApiKey: async () => '' },
    tab: 'default',
    abortController: new AbortController()
  }
}

describe('painting generation with effective capabilities', () => {
  beforeEach(() => {
    support = {
      modes: { edit: { supports: {}, requirePrompt: false, maxInputImages: 1 } },
      inputCapabilities: { files: true }
    }
    submitted = []
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.image.support.get') return { ok: true, data: support }
      if (route === 'ai.image.generate') {
        submitted.push((input as { payload: Record<string, unknown> }).payload)
        return { ok: true, data: { files: [image] } }
      }
      throw new Error(`Unexpected route: ${route}`)
    })
    window.api.file.binaryImage = vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' })
    window.api.file.getPhysicalPath = vi.fn().mockResolvedValue('/image.png')
  })

  it('delivers reference bytes for a prompt-free edit route and returns its saved result', async () => {
    const result = await paintingGenerate(makeInput({ inputFiles: [image] }))
    expect(result[0]).toMatchObject({ id: 'image', path: '/image.png' })
    expect(submitted).toEqual([
      expect.objectContaining({ mode: 'edit', prompt: '', inputImages: ['data:image/png;base64,AQID'] })
    ])
  })

  it('rejects missing and excessive references before submitting a paid request', async () => {
    await expect(paintingGenerate(makeInput())).rejects.toMatchObject({ code: 'EDIT_IMAGE_REQUIRED' })
    await expect(
      paintingGenerate(makeInput({ inputFiles: [image, { ...image, id: 'second' }] }))
    ).rejects.toMatchObject({ code: 'INPUT_IMAGE_LIMIT_EXCEEDED' })
    expect(submitted).toEqual([])
  })

  it('uses the selected model defaults after switching to text-only generation', async () => {
    support = {
      modes: { generate: { supports: { numImages: { type: 'range', min: 1, max: 2 } } } },
      inputCapabilities: { files: false }
    }
    await paintingGenerate(makeInput({ prompt: 'A cherry', params: { numImages: '2' } }))
    expect(submitted).toEqual([expect.objectContaining({ mode: 'generate', paramValues: { numImages: 2 } })])
    expect(submitted[0]).not.toHaveProperty('inputImages')
  })
})
