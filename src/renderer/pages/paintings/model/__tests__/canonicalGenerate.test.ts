import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalGenerate } from '../canonicalGenerate'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

// Capture the params handed to the shared generate skeleton — this is the
// partition output (`aiSdkParams` vs `providerBag`) under test.
const generatePaintingMock = vi.fn<(opts: unknown) => Promise<FileMetadata[]>>(async () => [] as FileMetadata[])
vi.mock('../generatePainting', () => ({
  generatePainting: (opts: unknown) => generatePaintingMock(opts)
}))

// Provider enablement / apiKey resolution is covered elsewhere; here it just
// needs to resolve so the partition runs.
vi.mock('../../utils/checkProviderEnabled', () => ({
  checkProviderEnabled: vi.fn(async () => 'api-key')
}))

interface CapturedGenerate {
  aiSdkParams: Record<string, unknown>
  providerBag?: Record<string, unknown>
}

function lastGenerateCall(): CapturedGenerate {
  return generatePaintingMock.mock.calls.at(-1)?.[0] as CapturedGenerate
}

function makeInput(params: Record<string, unknown>, overrides: Partial<PaintingData> = {}): GenerateInput {
  const painting: PaintingData = {
    id: 'p1',
    providerId: 'dashscope',
    mode: 'generate',
    model: 'qwen-image',
    prompt: 'a fox',
    files: [],
    params,
    ...overrides
  }
  return {
    painting,
    provider: {
      id: 'dashscope',
      name: 'DashScope',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: async () => 'api-key'
    } as never,
    tab: 'default',
    abortController: new AbortController()
  }
}

describe('canonicalGenerate', () => {
  beforeEach(() => {
    generatePaintingMock.mockClear()
  })

  it('partitions params into AI-SDK-native fields and the vendor bag, renaming positional keys', async () => {
    await canonicalGenerate(
      makeInput({ size: '1024x1024', numImages: 2, seed: 5, addWatermark: true, outputFormat: 'png' })
    )

    const call = lastGenerateCall()
    // size → imageSize, numImages → batchSize, seed stays; all AI-SDK native.
    expect(call.aiSdkParams).toEqual({ imageSize: '1024x1024', batchSize: 2, seed: 5 })
    // Unknown-to-AI-SDK keys flow through the vendor bag verbatim.
    expect(call.providerBag).toEqual({ addWatermark: true, outputFormat: 'png' })
  })

  it('composes the customSize widget trio into imageSize', async () => {
    await canonicalGenerate(makeInput({ size: 'custom', customSize_width: 512, customSize_height: 768 }))

    const call = lastGenerateCall()
    expect(call.aiSdkParams.imageSize).toBe('512x768')
    // The width/height companions are never sent raw.
    expect(call.providerBag).toBeUndefined()
  })

  it("carries the 'auto' size sentinel through to imageSize untouched", async () => {
    await canonicalGenerate(makeInput({ size: 'auto' }))

    const call = lastGenerateCall()
    // The custom-size block only special-cases 'custom'; 'auto' must survive.
    expect(call.aiSdkParams.imageSize).toBe('auto')
  })

  it('drops imageSize when the custom width/height pair is incomplete', async () => {
    await canonicalGenerate(makeInput({ size: 'custom', customSize_width: 512 }))

    const call = lastGenerateCall()
    expect(call.aiSdkParams).not.toHaveProperty('imageSize')
  })

  it('omits empty / undefined / empty-string params from the wire', async () => {
    await canonicalGenerate(makeInput({ size: '', seed: undefined, addWatermark: '' }))

    const call = lastGenerateCall()
    expect(call.aiSdkParams).toEqual({})
    expect(call.providerBag).toBeUndefined()
  })

  it('prefetches attached input images into aiSdkParams.inputImages as data URLs', async () => {
    const binaryImage = vi.fn(async () => ({ data: [1, 2, 3], mime: 'image/png' }))
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }

    const inputFiles = [{ id: 'file-1', ext: 'png' }] as unknown as FileEntry[]
    await canonicalGenerate(makeInput({}, { inputFiles }))

    expect(binaryImage).toHaveBeenCalledWith('file-1.png')
    const call = lastGenerateCall()
    // Encoded to a `data:` URL for the main-process image IPC (`base64('\x01\x02\x03') === 'AQID'`).
    expect(call.aiSdkParams.inputImages).toEqual(['data:image/png;base64,AQID'])
  })
})
