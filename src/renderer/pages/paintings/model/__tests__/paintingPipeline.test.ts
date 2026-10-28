import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import { MODEL_CAPABILITY } from '@shared/data/types/model'

import { paintingGenerate } from '../paintingPipeline'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

const mocks = vi.hoisted(() => ({ prefetch: vi.fn(), get: vi.fn(), generate: vi.fn(), binaryImage: vi.fn() }))
vi.mock('@data/hooks/useDataApi', () => ({ prefetch: mocks.prefetch }))
vi.mock('@data/DataApiService', () => ({ dataApiService: { get: mocks.get } }))
vi.mock('../generatePainting', () => ({ generatePainting: mocks.generate }))
vi.mock('../../utils/checkProviderEnabled', () => ({ checkProviderEnabled: vi.fn(async () => 'api-key') }))

const output = [{ id: 'generated-image' }] as FileMetadata[]
const images = [{ id: 'reference', ext: 'png' }] as FileEntry[]

function makeInput(overrides: Partial<PaintingData> = {}): GenerateInput {
  return {
    painting: {
      id: 'p1',
      providerId: 'aihubmix',
      mode: 'generate',
      model: 'qwen-image',
      prompt: 'a fox',
      files: [],
      params: {},
      ...overrides
    },
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: async () => 'api-key'
    },
    tab: 'default',
    abortController: new AbortController()
  }
}

describe('paintingGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetch.mockReset().mockResolvedValue(undefined)
    mocks.get
      .mockReset()
      .mockResolvedValue({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION], inputModalities: ['text'] })
    mocks.generate.mockResolvedValue(output)
    mocks.binaryImage.mockResolvedValue({ data: [1, 2, 3], mime: 'image/png' })
    Object.defineProperty(window, 'api', { value: { file: { binaryImage: mocks.binaryImage } }, configurable: true })
  })

  it('rejects image input on a resolved model without image input before reading or dispatching', async () => {
    await expect(paintingGenerate(makeInput({ inputFiles: images }))).rejects.toMatchObject({
      code: 'IMAGE_INPUT_NOT_SUPPORTED'
    })
    expect(mocks.binaryImage).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('forwards encoded images after a fresh effective-model read authorizes them', async () => {
    mocks.get.mockResolvedValue({
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      inputModalities: ['text', 'image']
    })
    expect(await paintingGenerate(makeInput({ inputFiles: images }))).toEqual(output)
    expect(mocks.get).toHaveBeenCalledWith('/models/aihubmix::qwen-image')
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      modelId: 'qwen-image',
      prompt: 'a fox',
      inputImages: ['data:image/png;base64,AQID']
    })
  })

  it.each(['failure', 'empty', 'missing modalities'])('fails closed for an image model lookup: %s', async (result) => {
    if (result === 'failure') mocks.get.mockRejectedValue(new Error('offline'))
    else mocks.get.mockResolvedValue(result === 'empty' ? null : { capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] })
    await expect(paintingGenerate(makeInput({ inputFiles: images }))).rejects.toMatchObject({
      code: 'IMAGE_INPUT_NOT_SUPPORTED'
    })
    expect(mocks.binaryImage).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('still generates text-only requests when lookups are unavailable', async () => {
    mocks.get.mockRejectedValue(new Error('offline'))
    mocks.prefetch.mockRejectedValue(new Error('offline'))
    expect(await paintingGenerate(makeInput())).toEqual(output)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ modelId: 'qwen-image', prompt: 'a fox' })
    expect(mocks.generate.mock.calls[0][0]).not.toHaveProperty('inputImages')
  })

  it('does not authorize images when support prefetch alone fails', async () => {
    mocks.prefetch.mockRejectedValue(new Error('support unavailable'))
    await expect(paintingGenerate(makeInput({ inputFiles: images }))).rejects.toMatchObject({
      code: 'IMAGE_INPUT_NOT_SUPPORTED'
    })
    expect(mocks.binaryImage).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('uses the effective mode and prompt requirement from support', async () => {
    mocks.get.mockResolvedValue({ capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION], inputModalities: ['image'] })
    mocks.prefetch.mockResolvedValue({ modes: { edit: { requirePrompt: false, supports: {} } } })
    expect(await paintingGenerate(makeInput({ inputFiles: images, prompt: '' }))).toEqual(output)
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      mode: 'edit',
      prompt: '',
      inputImages: ['data:image/png;base64,AQID']
    })
  })

  it('falls back to a supported generate mode without requiring images', async () => {
    mocks.prefetch.mockResolvedValue({ modes: { generate: { requirePrompt: true, supports: {} } } })
    expect(await paintingGenerate(makeInput({ mode: 'edit' }))).toEqual(output)
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ mode: 'generate', prompt: 'a fox' })
  })

  it('reports missing model fields without querying capability', async () => {
    await expect(paintingGenerate(makeInput({ model: undefined, inputFiles: images }))).rejects.toMatchObject({
      code: 'MISSING_REQUIRED_FIELDS'
    })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.binaryImage).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
