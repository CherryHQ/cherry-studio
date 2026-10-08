import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import type { ImageGenerationSupport } from '@shared/data/types/model'

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
    },
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

  it('submits the same effective slider value rendered from a numeric string', async () => {
    const support: ImageGenerationSupport = {
      supports: {
        strength: {
          type: 'range',
          min: 0,
          max: 10,
          default: 4
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
      }
    }

    await canonicalGenerate(makeInput({ strength: '4.5' }), { support, operation: 'generate' })

    expect(lastGenerateCall().paramValues.strength).toBe(4.5)
  })

  it.each([true, false, [], ['4.5']])('rejects invalid numeric input %# before submitting', async (value) => {
    const support: ImageGenerationSupport = {
      supports: {
        strength: {
          type: 'range',
          min: 0,
          max: 10
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
      }
    }
    await expect(canonicalGenerate(makeInput({ strength: value }), { support })).rejects.toMatchObject({
      code: 'OPERATION_FAILED'
    })
    expect(generatePaintingMock).not.toHaveBeenCalled()
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

  it('rejects an incomplete custom size rather than submitting an unintended size', async () => {
    await expect(canonicalGenerate(makeInput({ size: 'custom', customSize_width: 512 }))).rejects.toMatchObject({
      code: 'OPERATION_FAILED'
    })
    expect(generatePaintingMock).not.toHaveBeenCalled()
  })

  it.each([true, false, [], ['512'], 'NaN', -1, 0, 1.5])(
    'rejects a malformed custom-size dimension %# before submission',
    async (width) => {
      await expect(
        canonicalGenerate(makeInput({ size: 'custom', customSize_width: width, customSize_height: 768 }))
      ).rejects.toMatchObject({ code: 'OPERATION_FAILED' })
      expect(generatePaintingMock).not.toHaveBeenCalled()
    }
  )

  it('removes input-inapplicable parameters while retaining explicit zero and false', async () => {
    const support: ImageGenerationSupport = {
      supports: {
        quality: {
          type: 'enum',
          options: ['high']
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
          seed: {
            type: 'text'
          },
          addWatermark: {
            type: 'switch'
          },
          quality: null
        }
      }
    }
    window.api.file.binaryImage = vi.fn().mockResolvedValue({ data: [1], mime: 'image/png' })
    await canonicalGenerate(
      makeInput(
        { quality: 'high', seed: 0, addWatermark: false },
        { inputFiles: [{ id: 'reference', ext: 'png' }] as FileEntry[] }
      ),
      { support }
    )
    expect(lastGenerateCall().paramValues).toEqual({ seed: 0, addWatermark: false })
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

  it('rejects input images beyond the selected mode limit before reading files', async () => {
    const binaryImage = vi.fn()
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }
    const inputFiles = [
      { id: 'file-1', ext: 'png' },
      { id: 'file-2', ext: 'png' }
    ] as unknown as FileEntry[]

    await expect(
      canonicalGenerate(makeInput({}, { inputFiles }), {
        operation: 'generate',
        support: {
          supports: {},
          inputs: {
            images: {
              min: 1,
              max: {
                kind: 'known',
                value: 1
              }
            },
            prompt: 'required',
            mask: 'unknown',
            mediaTypes: {
              kind: 'unknown'
            }
          }
        }
      })
    ).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'INPUT_IMAGE_LIMIT_EXCEEDED' })

    expect(binaryImage).not.toHaveBeenCalled()
    expect(generatePaintingMock).not.toHaveBeenCalled()
  })

  it('skips non-image input files (e.g. a pasted-text .txt) so they never ship as images', async () => {
    const binaryImage = vi.fn(async () => ({ data: [1, 2, 3], mime: 'image/png' }))
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }

    const inputFiles = [
      { id: 'note', ext: 'txt' },
      { id: 'pic', ext: 'png' }
    ] as unknown as FileEntry[]
    await canonicalGenerate(makeInput({}, { inputFiles }))

    // Only the image was fetched/encoded; the .txt was filtered out.
    expect(binaryImage).toHaveBeenCalledTimes(1)
    expect(binaryImage).toHaveBeenCalledWith('pic.png')
    expect(lastGenerateCall().inputImages).toEqual(['data:image/png;base64,AQID'])
  })

  it('throws EDIT_IMAGE_REQUIRED for an image-requiring mode with no image input', async () => {
    await expect(
      canonicalGenerate(makeInput({}), {
        operation: 'generate',
        support: {
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
        }
      })
    ).rejects.toMatchObject({
      code: 'EDIT_IMAGE_REQUIRED'
    })
  })

  it('throws EDIT_IMAGE_REQUIRED when the only input for an edit mode is a non-image file', async () => {
    const inputFiles = [{ id: 'note', ext: 'txt' }] as unknown as FileEntry[]
    await expect(
      canonicalGenerate(makeInput({}, { inputFiles }), {
        operation: 'generate',
        support: {
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
        }
      })
    ).rejects.toMatchObject({
      code: 'EDIT_IMAGE_REQUIRED'
    })
  })

  it('allows the generate mode without any input image', async () => {
    await expect(canonicalGenerate(makeInput({}), { operation: 'generate' })).resolves.toEqual([])
  })
})
