import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canonicalGenerate } from '../canonicalGenerate'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

// Capture the options handed to the shared generate skeleton — this is the
// canonical `paramValues` bag (+ encoded inputImages) under test. The
// native-vs-vendor partition now lives in main (`splitParamValues`), so the bag
// stays canonical (no `numImages → n` rename here).
const generatePaintingMock = vi.fn<(opts: unknown) => Promise<FileMetadata[]>>(async () => [] as FileMetadata[])
vi.mock('../generatePainting', () => ({
  generatePainting: (opts: unknown) => generatePaintingMock(opts)
}))

vi.mock('../../utils/checkProviderEnabled', () => ({
  checkProviderEnabled: vi.fn(async () => 'api-key')
}))

interface CapturedGenerate {
  paramValues: Record<string, unknown>
  inputImages?: string[]
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

  it('ships the validated params as one canonical paramValues bag (no partition / rename)', async () => {
    await canonicalGenerate(
      makeInput({ size: '1024x1024', numImages: 2, seed: 5, addWatermark: true, outputFormat: 'png' })
    )

    const call = lastGenerateCall()
    // Canonical key names (numImages, not n); main does the native split + rename.
    expect(call.paramValues).toEqual({
      size: '1024x1024',
      numImages: 2,
      seed: 5,
      addWatermark: true,
      outputFormat: 'png'
    })
    expect(call.inputImages).toBeUndefined()
  })

  it('composes the customSize widget trio into size and drops the companions', async () => {
    await canonicalGenerate(makeInput({ size: 'custom', customSize_width: 512, customSize_height: 768 }))

    const call = lastGenerateCall()
    expect(call.paramValues.size).toBe('512x768')
    expect(call.paramValues).not.toHaveProperty('customSize_width')
    expect(call.paramValues).not.toHaveProperty('customSize_height')
  })

  it("carries the 'auto' size sentinel through to paramValues untouched", async () => {
    await canonicalGenerate(makeInput({ size: 'auto' }))
    expect(lastGenerateCall().paramValues.size).toBe('auto')
  })

  it('drops size when the custom width/height pair is incomplete', async () => {
    await canonicalGenerate(makeInput({ size: 'custom', customSize_width: 512 }))
    expect(lastGenerateCall().paramValues).not.toHaveProperty('size')
  })

  it('omits empty / undefined / empty-string params from the bag', async () => {
    await canonicalGenerate(makeInput({ size: '', seed: undefined, addWatermark: '' }))
    expect(lastGenerateCall().paramValues).toEqual({})
  })

  it('prefetches attached input images as data URLs, carried separately from paramValues', async () => {
    const binaryImage = vi.fn(async () => ({ data: [1, 2, 3], mime: 'image/png' }))
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }

    const inputFiles = [{ id: 'file-1', ext: 'png' }] as unknown as FileEntry[]
    await canonicalGenerate(makeInput({}, { inputFiles }))

    expect(binaryImage).toHaveBeenCalledWith('file-1.png')
    const call = lastGenerateCall()
    // Encoded to a `data:` URL (`base64('\x01\x02\x03') === 'AQID'`); not in paramValues.
    expect(call.inputImages).toEqual(['data:image/png;base64,AQID'])
    expect(call.paramValues).toEqual({})
  })
})
