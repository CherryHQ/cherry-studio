import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelListSchema } from '@cherrystudio/provider-registry'
import en from '@renderer/i18n/locales/en-us.json'
import i18n from '@renderer/i18n/resolver'
import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'

import modelCatalog from '../../../../../../packages/provider-registry/data/models.json'
import { isOptionsConfigItem } from '../../form/baseConfigItem'
import { imageGenerationToFields } from '../../form/imageGenerationToFields'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
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
    },
    tab: 'default',
    abortController: new AbortController()
  }
}

describe('canonicalGenerate', () => {
  beforeEach(() => {
    generatePaintingMock.mockClear()
  })

  it('rejects a DMXAPI preset before provider checking', async () => {
    const input = makeInput({}, { model: 'doubao-seedream-5-5' })
    input.provider = { ...input.provider, id: 'user-provider', presetProviderId: 'dmxapi' }
    vi.mocked(checkProviderEnabled).mockClear()
    await expect(canonicalGenerate(input)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: i18n.t('paintings.seedream.dmxapi_unsupported')
    })
    expect(checkProviderEnabled).not.toHaveBeenCalled()
    expect(generatePaintingMock).not.toHaveBeenCalled()
  })

  it.each(['1536x864', '864x1536', '1536x960', '3840x2160', '2160x3840'])(
    'offers and submits the GPT-Image-2 size %s without replacing it',
    async (size) => {
      const support = ModelListSchema.parse(modelCatalog).models.find(
        (model) => model.id === 'gpt-image-2'
      )?.imageGeneration
      const field = imageGenerationToFields(support, { mode: 'generate' }).find((item) => item.key === 'size')
      expect(field?.type).toBe('sizeChips')
      if (!field || !isOptionsConfigItem(field) || !Array.isArray(field.options)) {
        throw new Error('Expected static size choices')
      }
      expect(field.options).toContainEqual(expect.objectContaining({ value: size }))

      await canonicalGenerate(makeInput({ size }, { providerId: 'openai', model: 'gpt-image-2' }), {
        support,
        mode: 'generate'
      })
      expect(lastGenerateCall().paramValues.size).toBe(size)
    }
  )

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
    const support = {
      modes: {
        generate: {
          supports: { strength: { type: 'range' as const, min: 0, max: 10, default: 4 } }
        }
      }
    }

    await canonicalGenerate(makeInput({ strength: '4.5' }), { support, mode: 'generate' })

    expect(lastGenerateCall().paramValues.strength).toBe(4.5)
  })

  it.each([true, false, [], ['4.5']])('drops invalid numeric input %# instead of coercing it', async (value) => {
    const support = {
      modes: {
        generate: {
          supports: { strength: { type: 'range' as const, min: 0, max: 10, default: 4 } }
        }
      }
    }

    await canonicalGenerate(makeInput({ strength: value }), { support, mode: 'generate' })

    expect(lastGenerateCall().paramValues.strength).toBeUndefined()
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

  it('rejects input images beyond the selected mode limit before reading files', async () => {
    const binaryImage = vi.fn()
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }
    const inputFiles = [
      { id: 'file-1', ext: 'png' },
      { id: 'file-2', ext: 'png' }
    ] as unknown as FileEntry[]

    await expect(
      canonicalGenerate(makeInput({}, { inputFiles }), {
        mode: 'edit',
        support: { modes: { edit: { supports: {}, maxInputImages: 1 } } }
      })
    ).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'INPUT_IMAGE_LIMIT_EXCEEDED' })

    expect(binaryImage).not.toHaveBeenCalled()
    expect(generatePaintingMock).not.toHaveBeenCalled()
  })

  it('accepts multiple Qwen edit references when the registry does not declare a limit', async () => {
    const support = ModelListSchema.parse(modelCatalog).models.find(
      (model) => model.id === 'qwen-image-edit'
    )?.imageGeneration
    if (!support?.modes.edit) throw new Error('Expected qwen-image-edit edit support')

    const binaryImage = vi.fn(async () => ({ data: [1, 2, 3], mime: 'image/png' }))
    ;(window as unknown as { api: unknown }).api = { file: { binaryImage } }
    const inputFiles = [
      { id: 'file-1', ext: 'png' },
      { id: 'file-2', ext: 'png' },
      { id: 'file-3', ext: 'png' }
    ] as unknown as FileEntry[]

    expect(support.modes.edit.maxInputImages).toBeUndefined()
    await canonicalGenerate(makeInput({}, { inputFiles }), { mode: 'edit', support })

    expect(binaryImage).toHaveBeenCalledTimes(3)
    expect(lastGenerateCall().inputImages).toEqual([
      'data:image/png;base64,AQID',
      'data:image/png;base64,AQID',
      'data:image/png;base64,AQID'
    ])
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
    await expect(canonicalGenerate(makeInput({}), { mode: 'edit' })).rejects.toMatchObject({
      code: 'EDIT_IMAGE_REQUIRED'
    })
  })

  it('throws EDIT_IMAGE_REQUIRED when the only input for an edit mode is a non-image file', async () => {
    const inputFiles = [{ id: 'note', ext: 'txt' }] as unknown as FileEntry[]
    await expect(canonicalGenerate(makeInput({}, { inputFiles }), { mode: 'edit' })).rejects.toMatchObject({
      code: 'EDIT_IMAGE_REQUIRED'
    })
  })

  it('allows the generate mode without any input image', async () => {
    await expect(canonicalGenerate(makeInput({}), { mode: 'generate' })).resolves.toEqual([])
  })
  it('uses automatic GIF frame sizing instead of a stale static-image size', async () => {
    const support = ModelListSchema.parse(modelCatalog).models.find(
      (model) => model.id === 'gpt-image-2-6-flare'
    )?.imageGeneration
    await canonicalGenerate(
      makeInput(
        { size: '1024x1024', outputFormat: 'gif', frameCount: 4, frameDurationMs: 200 },
        { providerId: 'openai', model: 'gpt-image-2.6-flare' }
      ),
      { support, mode: 'generate' }
    )
    expect(lastGenerateCall().paramValues).toMatchObject({
      size: 'auto',
      outputFormat: 'gif',
      frameCount: 4,
      frameDurationMs: 200
    })
  })
  it('drops stale animation parameters when references select a static-only edit mode', async () => {
    Object.assign(window, {
      api: { file: { binaryImage: vi.fn().mockResolvedValue({ data: [1], mime: 'image/png' }) } }
    })
    await canonicalGenerate(
      makeInput(
        { outputFormat: 'gif', frameCount: 4, frameDurationMs: 200, complexity: 'low' },
        {
          inputFiles: [{ id: 'reference', ext: 'png' }] as unknown as FileEntry[]
        }
      ),
      {
        mode: 'edit',
        support: {
          modes: {
            edit: {
              supports: {
                outputFormat: { type: 'enum', options: ['png', 'jpeg', 'webp'] },
                complexity: { type: 'enum', options: ['low', 'medium', 'high'] }
              }
            }
          }
        }
      }
    )
    expect(lastGenerateCall().paramValues).toEqual({ complexity: 'low' })
  })
})

describe('Seedream 5.5 request contract', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
  })
  const target = { model: 'doubao-seedream-5-5' }
  it('projects the effective mode pairing to canonical size only', async () => {
    await canonicalGenerate(
      makeInput({ imageResolution: 'custom', customSize_width: '1024', customSize_height: '1024' }, target),
      {
        support: {
          modes: {
            generate: {
              supports: {
                imageResolution: { type: 'enum', options: ['1K', '1.5K', '2K'] },
                customSize: { type: 'size', pairedEnumKey: 'imageResolution', minSide: 240, maxSide: 8601 }
              }
            }
          }
        },
        mode: 'generate'
      }
    )
    expect(lastGenerateCall().paramValues).toEqual({
      size: '1024x1024',
      outputFormat: 'jpeg',
      background: 'auto',
      addWatermark: true
    })
  })
  it('actually transmits target defaults and preserves explicit false', async () => {
    await canonicalGenerate(makeInput({}, target))
    expect(lastGenerateCall().paramValues).toEqual({
      imageResolution: '1K',
      outputFormat: 'jpeg',
      background: 'auto',
      addWatermark: true
    })
    await canonicalGenerate(makeInput({ addWatermark: false }, target))
    expect(lastGenerateCall().paramValues.addWatermark).toBe(false)
  })
  it.each([
    [{ size: '2150x2160' }, 'paintings.seedream.invalid_size'],
    [{ background: 'transparent', outputFormat: 'jpeg' }, 'paintings.seedream.transparent_png'],
    [{ background: 'transparent', outputFormat: 'webp' }, 'paintings.seedream.transparent_png']
  ])('rejects invalid parameters before provider, file or generation IPC: %j', async (params, key) => {
    const binaryImage = vi.fn()
    Object.assign(window, { api: { file: { binaryImage } } })
    await expect(
      canonicalGenerate(
        makeInput(params, { ...target, inputFiles: [{ id: 'ref', ext: 'png' }] as unknown as FileEntry[] })
      )
    ).rejects.toMatchObject({ code: 'REMOTE_ERROR', message: en[key as keyof typeof en] ?? 'missing translation' })
    expect(checkProviderEnabled).not.toHaveBeenCalled()
    expect(binaryImage).not.toHaveBeenCalled()
    expect(generatePaintingMock).not.toHaveBeenCalled()
  })
  it('leaves Lite and other models outside the target defaults and validation', async () => {
    await canonicalGenerate(makeInput({ size: '512x512', maxImages: 3 }, { model: 'doubao-seedream-5-0-lite' }))
    expect(lastGenerateCall().paramValues).toEqual({ size: '512x512', maxImages: 3 })
  })
})

it('uses the same effective mode fallback as the parameter schema for custom pairing', async () => {
  await canonicalGenerate(makeInput({ imageResolution: 'custom', customSize_width: 1024, customSize_height: 1024 }), {
    mode: 'generate',
    support: {
      modes: {
        edit: {
          supports: {
            imageResolution: { type: 'enum', options: ['1K'] },
            customSize: { type: 'size', pairedEnumKey: 'imageResolution', minSide: 240, maxSide: 8601 }
          }
        }
      }
    }
  })
  expect(lastGenerateCall().paramValues).toEqual({ size: '1024x1024' })
})
